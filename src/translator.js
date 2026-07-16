import crypto from 'crypto';
import fetch from 'node-fetch';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { formatDescriptionPlain, formatDescriptionHtmlTranslated } from './descriptionFormat.js';

const CACHE_FILE = './translate-cache.json';
const DEFAULT_ENDPOINT = 'https://api.cognitive.microsofttranslator.com';
const SOURCE_LANG = 'sr-Latn';
const TARGET_LANGS = ['en', 'ru'];
const CHARS_PER_MIN = Number(process.env.AZURE_TRANSLATOR_CHARS_PER_MIN ?? 30000);
const WINDOW_MS = Number(process.env.AZURE_TRANSLATOR_WINDOW_MS ?? 60000);
const MAX_RETRIES = 5;
const CACHE_SAVE_EVERY = 10;
const PROGRESS_EVERY = 25;

let cache = {};
let charsUsed = 0;
const charLog = [];

export const hashText = (text) =>
  crypto.createHash('sha256').update(text ?? '', 'utf8').digest('hex');

export const sourceHash = (naziv, opis) => hashText(`${naziv}|${opis ?? ''}`);

export const isEnabled = () => {
  if (process.env.TRANSLATE_ENABLED === 'false') return false;
  return Boolean(process.env.AZURE_TRANSLATOR_KEY);
};

export const loadCache = async () => {
  if (existsSync(CACHE_FILE)) {
    try {
      const raw = await readFile(CACHE_FILE, 'utf-8');
      cache = JSON.parse(raw);
      console.log(`[translator] Loaded ${Object.keys(cache).length} cached translations`);
    } catch {
      console.warn('[translator] Cache file corrupted — starting fresh');
      cache = {};
    }
  }
};

export const saveCache = async () => {
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
  console.log(`[translator] Saved ${Object.keys(cache).length} translations to cache`);
};

export const markTranslationPushed = (relper_id, naziv, opis) => {
  const entry = cache[relper_id];
  if (entry) entry.pushedHash = sourceHash(naziv, opis);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pruneCharLog = (now) => {
  while (charLog.length && charLog[0].t <= now - WINDOW_MS) charLog.shift();
};

const charsInWindow = () => charLog.reduce((s, e) => s + e.chars, 0);

const acquireCharBudget = async (chars) => {
  while (true) {
    const now = Date.now();
    pruneCharLog(now);
    const used = charsInWindow();
    if (used + chars <= CHARS_PER_MIN) {
      charLog.push({ t: now, chars });
      return;
    }
    const waitMs = charLog[0].t + WINDOW_MS - now + 50;
    console.log(
      `[translator] Throttling — waiting ${Math.ceil(waitMs / 1000)}s (${used}/${CHARS_PER_MIN} chars in window)`
    );
    await sleep(waitMs);
  }
};

const rollbackCharBudget = () => {
  charLog.pop();
};

const needsNazivEn = (prop) => prop.naziv_en === prop.naziv;
const needsOpisEn = (prop) => prop.opis_en === prop.opis_sr && prop.opis_sr != null;
const needsNazivRu = (prop) => prop.naziv_ru === prop.naziv;
const needsOpisRu = (prop) => prop.opis_ru === prop.opis_sr && prop.opis_sr != null;

const needsAnyTranslation = (prop) =>
  needsNazivEn(prop) || needsOpisEn(prop) || needsNazivRu(prop) || needsOpisRu(prop);

const applyLocaleFields = (prop) => {
  prop.opis_en_plain = formatDescriptionPlain(prop.opis_en);
  prop.opis_en_html = formatDescriptionHtmlTranslated(prop.opis_en);
  prop.opis_ru_plain = formatDescriptionPlain(prop.opis_ru);
  prop.opis_ru_html = formatDescriptionHtmlTranslated(prop.opis_ru);

  if (!needsNazivEn(prop) && !needsOpisEn(prop)) prop.locale_fallback.en = false;
  if (!needsNazivRu(prop) && !needsOpisRu(prop)) prop.locale_fallback.ru = false;
};

const applyCached = (prop, entry) => {
  if (needsNazivEn(prop) && entry.en?.naziv) prop.naziv_en = entry.en.naziv;
  if (needsOpisEn(prop) && entry.en?.opis) prop.opis_en = entry.en.opis;
  if (needsNazivRu(prop) && entry.ru?.naziv) prop.naziv_ru = entry.ru.naziv;
  if (needsOpisRu(prop) && entry.ru?.opis) prop.opis_ru = entry.ru.opis;
  applyLocaleFields(prop);
};

const parseAzureResponse = (data, fields) => {
  const result = { en: {}, ru: {} };
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    const translations = data[i]?.translations || [];
    for (const t of translations) {
      if (t.to === 'en') result.en[field] = t.text;
      if (t.to === 'ru') result.ru[field] = t.text;
    }
  }
  return result;
};

const getApiBase = () =>
  (process.env.AZURE_TRANSLATOR_ENDPOINT ?? DEFAULT_ENDPOINT).replace(/\/$/, '');

const buildTranslateUrl = (fromLang, toParams) => {
  const base = getApiBase();
  const query = `api-version=3.0&from=${fromLang}&${toParams}`;
  if (base.includes('.cognitiveservices.azure.com')) {
    return `${base}/translator/text/v3.0/translate?${query}`;
  }
  return `${base}/translate?${query}`;
};

const callAzure = async (texts, fields, attempt = 0) => {
  const key = process.env.AZURE_TRANSLATOR_KEY;
  const region = process.env.AZURE_TRANSLATOR_REGION;
  if (!region) throw new Error('AZURE_TRANSLATOR_REGION is required');

  const charCount = texts.reduce((sum, t) => sum + t.length, 0);
  await acquireCharBudget(charCount);

  const toParams = TARGET_LANGS.map((l) => `to=${l}`).join('&');
  const url = buildTranslateUrl(SOURCE_LANG, toParams);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Ocp-Apim-Subscription-Region': region,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify(texts.map((t) => ({ Text: t }))),
    timeout: 15000,
  });

  if (res.status === 429) {
    rollbackCharBudget();
    if (attempt < MAX_RETRIES) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '60', 10);
      console.warn(
        `[translator] Rate limited (429) — waiting ${retryAfter}s (attempt ${attempt + 1}/${MAX_RETRIES})`
      );
      await sleep(retryAfter * 1000);
      return callAzure(texts, fields, attempt + 1);
    }
    const body = await res.text();
    throw new Error(`Azure Translator 429 — ${body}`);
  }

  if (!res.ok) {
    rollbackCharBudget();
    const body = await res.text();
    throw new Error(`Azure Translator ${res.status} — ${body}`);
  }

  charsUsed += charCount;
  return parseAzureResponse(await res.json(), fields);
};

const translateProperty = async (prop) => {
  if (!needsAnyTranslation(prop)) {
    applyLocaleFields(prop);
    return 'skipped';
  }

  const nazivHash = hashText(prop.naziv);
  const opisHash = hashText(prop.opis_sr ?? '');
  const hash = sourceHash(prop.naziv, prop.opis_sr);
  const cached = cache[prop.relper_id];

  if (
    cached &&
    cached.nazivHash === nazivHash &&
    cached.opisHash === opisHash &&
    cached.en &&
    cached.ru
  ) {
    applyCached(prop, cached);
    return 'cached';
  }

  const texts = [];
  const fields = [];
  const translateNaziv = needsNazivEn(prop) || needsNazivRu(prop);
  const translateOpis = needsOpisEn(prop) || needsOpisRu(prop);

  if (translateNaziv && prop.naziv) {
    texts.push(prop.naziv);
    fields.push('naziv');
  }
  if (translateOpis && prop.opis_sr) {
    texts.push(prop.opis_sr);
    fields.push('opis');
  }

  if (texts.length === 0) {
    applyLocaleFields(prop);
    return 'skipped';
  }

  const translated = await callAzure(texts, fields);

  if (needsNazivEn(prop) && translated.en.naziv) prop.naziv_en = translated.en.naziv;
  if (needsOpisEn(prop) && translated.en.opis) prop.opis_en = translated.en.opis;
  if (needsNazivRu(prop) && translated.ru.naziv) prop.naziv_ru = translated.ru.naziv;
  if (needsOpisRu(prop) && translated.ru.opis) prop.opis_ru = translated.ru.opis;

  cache[prop.relper_id] = {
    nazivHash,
    opisHash,
    sourceHash: hash,
    pushedHash: cached?.pushedHash ?? null,
    en: {
      naziv: prop.naziv_en,
      opis: prop.opis_en,
    },
    ru: {
      naziv: prop.naziv_ru,
      opis: prop.opis_ru,
    },
  };

  applyLocaleFields(prop);
  return 'translated';
};

const hasRealTranslation = (prop) =>
  prop.naziv_en !== prop.naziv ||
  (prop.opis_sr != null && prop.opis_en !== prop.opis_sr) ||
  prop.naziv_ru !== prop.naziv ||
  (prop.opis_sr != null && prop.opis_ru !== prop.opis_sr);

export const translateProperties = async (properties) => {
  charsUsed = 0;

  if (!isEnabled()) {
    console.log('[translator] Disabled — using Serbian fallback for EN/RU');
    return;
  }

  let translated = 0;
  let cached = 0;
  let skipped = 0;
  let errors = 0;
  let sinceLastSave = 0;
  let processed = 0;
  const total = properties.length;

  for (const prop of properties) {
    processed++;
    prop.needsTranslationPush = false;

    try {
      const result = await translateProperty(prop);

      if (result === 'translated') {
        translated++;
        sinceLastSave++;
        if (sinceLastSave >= CACHE_SAVE_EVERY) {
          await saveCache();
          sinceLastSave = 0;
        }
      } else if (result === 'cached') {
        cached++;
      } else {
        skipped++;
      }

      const hash = sourceHash(prop.naziv, prop.opis_sr);
      const entry = cache[prop.relper_id];
      if (hasRealTranslation(prop) && entry?.pushedHash !== hash) {
        prop.needsTranslationPush = true;
      }
    } catch (err) {
      errors++;
      console.warn(`[translator] Failed for ${prop.relper_id}: ${err.message} — keeping Serbian fallback`);
      applyLocaleFields(prop);
    }

    if (processed % PROGRESS_EVERY === 0) {
      console.log(
        `[translator] Progress: ${processed}/${total} (translated ${translated}, cached ${cached}, errors ${errors})` +
        (charsUsed > 0 ? ` | ${charsUsed} chars sent` : '')
      );
    }
  }

  console.log(
    `[translator] Translated: ${translated} new, ${cached} from cache, ${skipped} skipped, ${errors} errors` +
    (charsUsed > 0 ? ` | ${charsUsed} chars sent to API` : '')
  );
};
