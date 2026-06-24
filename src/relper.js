import fetch from 'node-fetch';
import { readFile } from 'fs/promises';
import { parseStringPromise } from 'xml2js';

/**
 * Fetch and parse RELPER XML feed.
 *
 * In mock mode (RELPER_FEED_URL starts with 'mock://') reads from
 * mock-feed.xml locally. Swap to real URL in .env when ready.
 */
export const fetchFeed = async () => {
  const feedUrl = process.env.RELPER_FEED_URL;

  let rawXml;

  if (!feedUrl || feedUrl.startsWith('mock://')) {
    console.log('[relper] Using mock XML feed');
    rawXml = await readFile('./mock-feed.xml', 'utf-8');
  } else {
    console.log(`[relper] Fetching feed: ${feedUrl}`);

    const res = await fetch(feedUrl, { timeout: 15000 });

    if (!res.ok) {
      throw new Error(`RELPER feed fetch failed: ${res.status} ${res.statusText}`);
    }

    rawXml = await res.text();
  }

  const parsed = await parseStringPromise(rawXml, {
    explicitArray: false,  // don't wrap single values in arrays
    trim: true,
    emptyTag: null,        // empty tags become null instead of ''
  });

  // xml2js wraps everything in the root element name
  const root = parsed.listings || parsed.nekretnine || parsed.properties || parsed.oglasi;
  if (!root) {
    throw new Error('[relper] Unexpected XML structure — root element not found. Check mock-feed.xml field names against real feed.');
  }

  const items = root.listing || root.nekretnina || root.property || root.oglas || [];

  // xml2js returns a single object (not array) when there's only one item
  return Array.isArray(items) ? items : [items];
};
