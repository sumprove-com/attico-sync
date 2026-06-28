import fetch from 'node-fetch';
import pLimit from 'p-limit';

const BASE = 'https://api.webflow.com/v2';

const limit = pLimit(1);
const REQUEST_DELAY_MS = 1100;

let lastRequestTime = 0;

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

const buildFieldData = (prop) => ({
  name: prop.naziv,
  'estate-id': Number(prop.relper_id),
  'description-rich': prop.opis_sr_html,
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

const logDryRunFieldData = (action, prop) => {
  const fieldData = buildFieldData(prop);
  const preview = {
    ...fieldData,
    images: `[${fieldData.images.length} images]`,
  };
  console.log(`[webflow] DRY RUN — would ${action}: ${prop.relper_id} — ${prop.naziv}`);
  console.log(JSON.stringify(preview, null, 2));
};

const publishItems = async (collectionId, itemIds) => {
  const res = await throttledFetch(
    `${BASE}/collections/${collectionId}/items/publish`,
    {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ itemIds }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    console.error(`[webflow] Publish failed: ${res.status} — ${body}`);
    return false;
  }

  return true;
};

export const createItem = async (prop) => {
  if (process.env.DRY_RUN === 'true') {
    logDryRunFieldData('create', prop);
    return true;
  }

  const collectionId = process.env.WEBFLOW_COLLECTION_ID;

  const res = await throttledFetch(
    `${BASE}/collections/${collectionId}/items`,
    {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ fieldData: buildFieldData(prop) }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    console.error(`[webflow] Create failed for ${prop.relper_id}: ${res.status} — ${body}`);
    return false;
  }

  const item = await res.json();
  const published = await publishItems(collectionId, [item.id]);

  if (published) {
    console.log(`[webflow] Created: ${prop.relper_id} — ${prop.naziv} (${item.id})`);
    return true;
  }

  console.warn(`[webflow] Created draft but publish failed for ${prop.relper_id} (${item.id})`);
  return false;
};

export const updateItem = async (itemId, prop) => {
  if (process.env.DRY_RUN === 'true') {
    logDryRunFieldData('update', prop);
    return true;
  }

  const collectionId = process.env.WEBFLOW_COLLECTION_ID;

  const res = await throttledFetch(
    `${BASE}/collections/${collectionId}/items/${itemId}`,
    {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ fieldData: buildFieldData(prop) }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    console.error(`[webflow] Update failed for ${prop.relper_id}: ${res.status} — ${body}`);
    return false;
  }

  const published = await publishItems(collectionId, [itemId]);

  if (published) {
    console.log(`[webflow] Updated: ${prop.relper_id} — ${prop.naziv}`);
    return true;
  }

  console.warn(`[webflow] Updated draft but publish failed for ${prop.relper_id} (${itemId})`);
  return false;
};

export const unpublishItem = async (itemId, relper_id) => {
  if (process.env.DRY_RUN === 'true') {
    console.log(`[webflow] DRY RUN — would unpublish item ${itemId} (RELPER ID: ${relper_id})`);
    return true;
  }

  const collectionId = process.env.WEBFLOW_COLLECTION_ID;

  const res = await throttledFetch(
    `${BASE}/collections/${collectionId}/items/${itemId}/live`,
    {
      method: 'DELETE',
      headers: headers(),
    }
  );

  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    console.error(`[webflow] Unpublish failed for item ${itemId}: ${res.status} — ${body}`);
    return false;
  }

  console.log(`[webflow] Unpublished item ${itemId} (RELPER ID: ${relper_id})`);
  return true;
};

const CHANGE_CHECKS = [
  { prop: 'naziv', cms: 'name' },
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
