import fetch from 'node-fetch';
import pLimit from 'p-limit';
import { getLocaleText } from './parser.js';

const BASE = 'https://api.webflow.com/v2';

const limit = pLimit(1);
const REQUEST_DELAY_MS = 1100;

let lastRequestTime = 0;
let siteLocales = null;

const throttledFetch = async (url, options) => {
  return limit(async () => {
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < REQUEST_DELAY_MS) {
      await sleep(REQUEST_DELAY_MS - elapsed);
    }
    lastRequestTime = Date.now();

    const res = await fetch(url, options);

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '60', 10);
      console.warn(`[webflow] Rate limited — waiting ${retryAfter}s`);
      await sleep(retryAfter * 1000);
      return throttledFetch(url, options);
    }

    return res;
  });
};

const headers = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${process.env.WEBFLOW_API_TOKEN}`,
  'accept-version': '2.0.0',
});

const resolveLocaleKey = (locale) => {
  const sub = (locale.subdirectory || '').toLowerCase();
  if (sub === 'en') return 'en';
  if (sub === 'ru') return 'ru';

  const tag = (locale.tag || '').toLowerCase();
  if (tag.startsWith('en')) return 'en';
  if (tag.startsWith('ru')) return 'ru';
  return 'sr';
};

const getLocales = () => {
  if (!siteLocales) {
    throw new Error('[webflow] Site locales not initialized — call fetchSiteLocales() first');
  }
  return siteLocales;
};

const buildLocaleConfig = (byKey) => {
  const keys = ['sr', 'en', 'ru'].filter((key) => byKey[key]?.cmsLocaleId);
  return {
    byKey,
    keys,
    cmsLocaleIds: keys.map((key) => byKey[key].cmsLocaleId),
  };
};

const loadLocalesFromEnv = () => {
  const sr = process.env.WEBFLOW_CMS_LOCALE_SR;
  const en = process.env.WEBFLOW_CMS_LOCALE_EN;
  const ru = process.env.WEBFLOW_CMS_LOCALE_RU;
  if (!sr || !en || !ru) return null;

  return buildLocaleConfig({
    sr: { cmsLocaleId: sr, tag: 'sr' },
    en: { cmsLocaleId: en, tag: 'en' },
    ru: { cmsLocaleId: ru, tag: 'ru' },
  });
};

export const fetchSiteLocales = async () => {
  const fromEnv = loadLocalesFromEnv();
  if (fromEnv) {
    siteLocales = fromEnv;
    console.log(
      `[webflow] Locales (env): ${fromEnv.keys.map((key) => `${key}=${fromEnv.byKey[key].cmsLocaleId}`).join(', ')}`
    );
    return fromEnv;
  }

  const siteId = process.env.WEBFLOW_SITE_ID;
  if (!siteId) {
    throw new Error(
      '[webflow] WEBFLOW_SITE_ID is required (or set WEBFLOW_CMS_LOCALE_SR/EN/RU env vars)'
    );
  }

  const res = await throttledFetch(`${BASE}/sites/${siteId}`, { headers: headers() });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `[webflow] fetchSiteLocales failed: ${res.status} — ${body}. ` +
      'Add sites:read scope to your Webflow API token, or set WEBFLOW_CMS_LOCALE_SR, WEBFLOW_CMS_LOCALE_EN, and WEBFLOW_CMS_LOCALE_RU in .env'
    );
  }

  const data = await res.json();
  const byKey = {};

  const primary = data.locales?.primary;
  if (!primary?.cmsLocaleId) {
    throw new Error('[webflow] Site has no primary locale — enable localization in Webflow first');
  }

  byKey.sr = { cmsLocaleId: primary.cmsLocaleId, tag: primary.tag };

  for (const locale of data.locales?.secondary || []) {
    if (!locale.enabled || !locale.cmsLocaleId) continue;
    const key = resolveLocaleKey(locale);
    if (key !== 'sr') {
      byKey[key] = { cmsLocaleId: locale.cmsLocaleId, tag: locale.tag };
    }
  }

  const config = buildLocaleConfig(byKey);

  if (config.keys.length < 3) {
    console.warn(
      `[webflow] Expected 3 locales (sr/en/ru), found ${config.keys.length}: ${config.keys.join(', ')}`
    );
  }

  siteLocales = config;
  console.log(
    `[webflow] Locales: ${config.keys.map((key) => `${key}=${byKey[key].cmsLocaleId}`).join(', ')}`
  );
  return config;
};

export const fetchCMSItems = async () => {
  const collectionId = process.env.WEBFLOW_COLLECTION_ID;
  const all = [];
  let offset = 0;
  const limit_per_page = 100;

  while (true) {
    const url = `${BASE}/collections/${collectionId}/items?limit=${limit_per_page}&offset=${offset}`;
    const res = await throttledFetch(url, { headers: headers() });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`[webflow] fetchCMSItems failed: ${res.status} — ${body}`);
    }

    const data = await res.json();
    all.push(...data.items);

    console.log(`[webflow] Fetched items ${offset + 1}–${offset + data.items.length} (total so far: ${all.length})`);

    if (data.items.length < limit_per_page) break;
    offset += limit_per_page;
  }

  console.log(`[webflow] Total CMS items fetched: ${all.length}`);
  return all;
};

const buildSharedFieldData = (prop) => ({
  'estate-id': Number(prop.relper_id),
  'property-type-3': prop.tip,
  transakcija: prop.transakcija,
  room: prop.broj_soba,
  'square-footage': prop.kvadratura != null ? String(prop.kvadratura) : null,
  price: prop.cena,
  location: prop.lokacija,
  street: prop.adresa,
  floor: prop.sprat,
  images: prop.slike.map((url) => ({ url })),
  'first-image': prop.prva_slika ? { url: prop.prva_slika } : null,
  heating: prop.heating,
  beds: prop.beds,
  fridge: prop.fridge,
  'closets-cabinets': prop.closets,
  sink: prop.sink,
  'kitchen-elements': prop.kitchen_elements,
  parking: prop.parking,
  elevator: prop.elevator,
  terrace: prop.terrace,
  stove: prop.stove,
  'washing-machine': prop.washing_machine,
  'air-conditioning': prop.air_conditioning,
  tv: prop.tv,
  'video-surveillance': prop.video_surveillance,
  dishwasher: prop.dishwasher,
  'pet-friendly': prop.pet_friendly,
  lat: prop.lat,
  lng: prop.lng,
});

const buildFieldData = (prop, locale) => {
  const text = getLocaleText(prop, locale);
  return {
    ...buildSharedFieldData(prop),
    name: text.naziv,
    'description-plain': text.opis_plain,
    'description-rich': text.opis_html,
  };
};

const logLocaleFallback = (prop, locale) => {
  if (locale === 'sr' || !prop.locale_fallback?.[locale]) return;
  console.warn(
    `[webflow] ${prop.relper_id} (${locale}): no RELPER translation — using Serbian content`
  );
};

const previewFieldData = (fieldData) => ({
  ...fieldData,
  images: `[${fieldData.images.length} images]`,
});

const logDryRunFieldData = (action, prop, locale) => {
  logLocaleFallback(prop, locale);
  const fieldData = buildFieldData(prop, locale);
  console.log(`[webflow] DRY RUN — would ${action} (${locale}): ${prop.relper_id} — ${prop.naziv}`);
  console.log(JSON.stringify(previewFieldData(fieldData), null, 2));
};

const publishItems = async (collectionId, itemId, locales) => {
  const res = await throttledFetch(
    `${BASE}/collections/${collectionId}/items/publish`,
    {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        items: [{ id: itemId, cmsLocaleIds: locales.cmsLocaleIds }],
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    console.error(`[webflow] Publish failed: ${res.status} — ${body}`);
    return false;
  }

  return true;
};

const patchItemLocales = async (collectionId, itemId, prop, locales, localeKeys) => {
  const items = localeKeys.map((locale) => {
    logLocaleFallback(prop, locale);
    return {
      id: itemId,
      cmsLocaleId: locales.byKey[locale].cmsLocaleId,
      fieldData: buildFieldData(prop, locale),
    };
  });

  const res = await throttledFetch(
    `${BASE}/collections/${collectionId}/items`,
    {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ items }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    console.error(`[webflow] Locale patch failed for ${prop.relper_id}: ${res.status} — ${body}`);
    return false;
  }

  return true;
};

export const createItem = async (prop) => {
  const locales = getLocales();

  if (process.env.DRY_RUN === 'true') {
    for (const locale of locales.keys) {
      logDryRunFieldData('create', prop, locale);
    }
    return true;
  }

  const collectionId = process.env.WEBFLOW_COLLECTION_ID;

  const res = await throttledFetch(
    `${BASE}/collections/${collectionId}/items`,
    {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        cmsLocaleIds: locales.cmsLocaleIds,
        fieldData: buildFieldData(prop, 'sr'),
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    console.error(`[webflow] Create failed for ${prop.relper_id}: ${res.status} — ${body}`);
    return false;
  }

  const data = await res.json();
  const itemId = data.id || data.items?.[0]?.id;
  if (!itemId) {
    console.error(`[webflow] Create response missing item id for ${prop.relper_id}`);
    return false;
  }

  const secondaryLocales = locales.keys.filter((key) => key !== 'sr');
  if (secondaryLocales.length > 0) {
    const patched = await patchItemLocales(collectionId, itemId, prop, locales, secondaryLocales);
    if (!patched) {
      console.warn(`[webflow] Created ${itemId} but secondary locale patch failed for ${prop.relper_id}`);
      return false;
    }
  }

  const published = await publishItems(collectionId, itemId, locales);

  if (published) {
    console.log(
      `[webflow] Created (${locales.keys.join(', ')}): ${prop.relper_id} — ${prop.naziv} (${itemId})`
    );
    return true;
  }

  console.warn(`[webflow] Created draft but publish failed for ${prop.relper_id} (${itemId})`);
  return false;
};

export const updateItem = async (itemId, prop) => {
  const locales = getLocales();

  if (process.env.DRY_RUN === 'true') {
    for (const locale of locales.keys) {
      logDryRunFieldData('update', prop, locale);
    }
    return true;
  }

  const collectionId = process.env.WEBFLOW_COLLECTION_ID;
  const patched = await patchItemLocales(collectionId, itemId, prop, locales, locales.keys);
  if (!patched) return false;

  const published = await publishItems(collectionId, itemId, locales);

  if (published) {
    console.log(
      `[webflow] Updated (${locales.keys.join(', ')}): ${prop.relper_id} — ${prop.naziv}`
    );
    return true;
  }

  console.warn(`[webflow] Updated draft but publish failed for ${prop.relper_id} (${itemId})`);
  return false;
};

export const unpublishItem = async (itemId, relper_id) => {
  const locales = getLocales();

  if (process.env.DRY_RUN === 'true') {
    console.log(
      `[webflow] DRY RUN — would unpublish (${locales.keys.join(', ')}) item ${itemId} (RELPER ID: ${relper_id})`
    );
    return true;
  }

  const collectionId = process.env.WEBFLOW_COLLECTION_ID;

  const res = await throttledFetch(
    `${BASE}/collections/${collectionId}/items/live`,
    {
      method: 'DELETE',
      headers: headers(),
      body: JSON.stringify({
        items: [{ id: itemId, cmsLocaleIds: locales.cmsLocaleIds }],
      }),
    }
  );

  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    console.error(`[webflow] Unpublish failed for item ${itemId}: ${res.status} — ${body}`);
    return false;
  }

  console.log(
    `[webflow] Unpublished (${locales.keys.join(', ')}) item ${itemId} (RELPER ID: ${relper_id})`
  );
  return true;
};

const CHANGE_CHECKS = [
  { prop: 'naziv', cms: 'name' },
  { prop: 'opis_sr_plain', cms: 'description-plain' },
  { prop: 'opis_sr_html', cms: 'description-rich' },
  { prop: 'tip', cms: 'property-type-3' },
  { prop: 'transakcija', cms: 'transakcija' },
  { prop: 'cena', cms: 'price' },
  { prop: 'kvadratura', cms: 'square-footage', toCms: (v) => (v != null ? String(v) : v) },
  { prop: 'broj_soba', cms: 'room' },
  { prop: 'sprat', cms: 'floor' },
  { prop: 'lokacija', cms: 'location' },
  { prop: 'adresa', cms: 'street' },
  { prop: 'lat', cms: 'lat' },
  { prop: 'lng', cms: 'lng' },
  { prop: 'heating', cms: 'heating' },
  { prop: 'parking', cms: 'parking' },
  { prop: 'elevator', cms: 'elevator' },
  { prop: 'terrace', cms: 'terrace' },
];

export const hasChanges = (prop, existingFieldData) => {
  const incomingFirst = prop.prva_slika || null;
  const existingFirst = existingFieldData['first-image']?.url || null;
  if (String(incomingFirst ?? '') !== String(existingFirst ?? '')) return true;

  return CHANGE_CHECKS.some(({ prop: key, cms, toCms }) => {
    const incoming = toCms ? toCms(prop[key]) : prop[key];
    const existing = existingFieldData[cms];

    if (incoming == null && existing == null) return false;
    return String(incoming) !== String(existing);
  });
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
