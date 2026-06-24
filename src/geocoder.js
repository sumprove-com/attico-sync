import fetch from 'node-fetch';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

const CACHE_FILE = './geocode-cache.json';
const NOVI_SAD_CENTER = { lat: 45.2671, lng: 19.8335 };
const SHARED_HOOD_COORDS = { lat: 45.25558, lng: 19.845444 };

let cache = {};

export const loadCache = async () => {
  if (existsSync(CACHE_FILE)) {
    try {
      const raw = await readFile(CACHE_FILE, 'utf-8');
      cache = JSON.parse(raw);
      console.log(`[geocoder] Loaded ${Object.keys(cache).length} cached addresses`);
    } catch {
      console.warn('[geocoder] Cache file corrupted — starting fresh');
      cache = {};
    }
  }
};

export const saveCache = async () => {
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
  console.log(`[geocoder] Saved ${Object.keys(cache).length} addresses to cache`);
};

const geocodeKey = (address) => address?.toLowerCase().trim() || '';

const coordsMatch = (a, b, tolerance = 0.00001) =>
  Math.abs(Number(a.lat) - Number(b.lat)) < tolerance &&
  Math.abs(Number(a.lng) - Number(b.lng)) < tolerance;

export const geocode = async (address) => {
  if (!address) return NOVI_SAD_CENTER;

  const key = geocodeKey(address);
  if (cache[key]) return cache[key];

  const token = process.env.MAPBOX_TOKEN;
  if (!token) {
    console.warn('[geocoder] No MAPBOX_TOKEN set — using NS center fallback for all addresses');
    return NOVI_SAD_CENTER;
  }

  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json`
      + `?access_token=${token}`
      + `&limit=1`
      + `&country=rs`
      + `&proximity=19.8335,45.2671`;

    const res = await fetch(url, { timeout: 8000 });
    if (!res.ok) throw new Error(`Mapbox API ${res.status}`);

    const data = await res.json();
    const feature = data.features?.[0];

    if (!feature) {
      console.warn(`[geocoder] No result for "${address}" — using NS center`);
      cache[key] = NOVI_SAD_CENTER;
      return NOVI_SAD_CENTER;
    }

    const [lng, lat] = feature.center;
    const coords = { lat, lng };
    cache[key] = coords;
    return coords;
  } catch (err) {
    console.warn(`[geocoder] Failed to geocode "${address}": ${err.message} — using NS center`);
    cache[key] = NOVI_SAD_CENTER;
    return NOVI_SAD_CENTER;
  }
};

const decimalPlaces = (n) => {
  const parts = String(n).split('.');
  return parts[1]?.length ?? 0;
};

const coordsAreImprecise = (lat, lng) => {
  if (lat == null || lng == null) return false;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return false;
  if (Number.isInteger(la) && Number.isInteger(ln)) return true;
  return decimalPlaces(la) < 4 || decimalPlaces(ln) < 4;
};

const isFallbackCoords = (lat, lng) => coordsMatch({ lat, lng }, NOVI_SAD_CENTER);

const isSharedHoodCoords = (lat, lng) => coordsMatch({ lat, lng }, SHARED_HOOD_COORDS);

export const geocodeProperties = async (properties, existingCMSMap) => {
  let geocoded = 0;
  let skipped = 0;

  for (const prop of properties) {
    const existing = existingCMSMap.get(prop.relper_id);
    const key = geocodeKey(prop.addressForGeocode);
    const cached = key ? cache[key] : null;

    const streetChanged = existing && existing.fieldData.street !== prop.adresa;
    const missingCoords = !existing?.fieldData.lat || !existing?.fieldData.lng;
    const existingLat = existing?.fieldData.lat;
    const existingLng = existing?.fieldData.lng;
    const badCoords =
      existing &&
      (isFallbackCoords(existingLat, existingLng) ||
        isSharedHoodCoords(existingLat, existingLng));
    const impreciseCoords = existing && coordsAreImprecise(existingLat, existingLng);

    if (prop.lat != null && prop.lng != null) {
      skipped++;
      continue;
    }

    const cmsMatchesCache =
      cached &&
      existing &&
      coordsMatch({ lat: existingLat, lng: existingLng }, cached);

    if (
      existing &&
      !missingCoords &&
      !streetChanged &&
      !badCoords &&
      !impreciseCoords &&
      cmsMatchesCache
    ) {
      prop.lat = existingLat;
      prop.lng = existingLng;
      skipped++;
      continue;
    }

    const coords = await geocode(prop.addressForGeocode);
    prop.lat = coords.lat;
    prop.lng = coords.lng;
    geocoded++;

    await sleep(100);
  }

  console.log(`[geocoder] Geocoded: ${geocoded} new, ${skipped} reused from CMS`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
