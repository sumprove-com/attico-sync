import crypto from 'crypto';
import fetch from 'node-fetch';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { formatDescriptionPlain, formatDescriptionHtmlTranslated } from './descriptionFormat.js';

const CACHE_FILE = './translate-cache.json';
const API_ENDPOINT = 'https://api.cognitive.microsofttranslator.com';
const SOURCE_LANG = 'sr-Latn';
const TARGET_LANGS = ['en', 'ru'];
const REQUEST_DELAY_MS = 200;

let cache = {};
let charsUsed = 0;

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

const callAzure = async (texts, fields) => {
  const key = process.env.AZURE_TRANSLATOR_KEY;
  const region = process.env.AZURE_TRANSLATOR_REGION;
  if (!region) throw new Error('AZURE_TRANSLATOR_REGION is required');

  const toParams = TARGET_LANGS.map((l) => `to=${l}`).join('&');
  const url = `${API_ENDPOINT}/translate?api-version=3.0&from=${SOURCE_LANG}&${toParams}`;

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

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Azure Translator ${res.status} — ${body}`);
  }

  charsUsed += texts.reduce((sum, t) => sum + t.length, 0);
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

  for (const prop of properties) {
    prop.needsTranslationPush = false;

    try {
      const result = await translateProperty(prop);

      if (result === 'translated') {
        translated++;
        await sleep(REQUEST_DELAY_MS);
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
  }

  console.log(
    `[translator] Translated: ${translated} new, ${cached} from cache, ${skipped} skipped, ${errors} errors` +
    (charsUsed > 0 ? ` | ${charsUsed} chars sent to API` : '')
  );
};
