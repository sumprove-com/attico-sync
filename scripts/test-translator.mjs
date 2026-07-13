/**
 * Smoke test — translates one mock property via Azure and prints EN/RU output.
 */
import dotenv from 'dotenv';
dotenv.config();

import { readFile } from 'fs/promises';
import { parseStringPromise } from 'xml2js';
import { parseProperty } from '../src/parser.js';
import { translateProperties, isEnabled } from '../src/translator.js';

if (!isEnabled()) {
  console.error('Set AZURE_TRANSLATOR_KEY and TRANSLATE_ENABLED=true in .env');
  process.exit(1);
}

const xml = await readFile('mock-feed.xml', 'utf-8');
const parsed = await parseStringPromise(xml, {
  explicitArray: false,
  trim: true,
  emptyTag: null,
});

const root = parsed.listings || parsed.nekretnine || parsed.properties || parsed.oglasi;
const items = root.listing || root.nekretnina || root.property || root.oglas || [];
const raw = Array.isArray(items) ? items[0] : items;
const prop = parseProperty(raw);

if (!prop) {
  console.error('Failed to parse mock property');
  process.exit(1);
}

console.log('Source (sr):');
console.log('  naziv:', prop.naziv);
console.log('  opis:', prop.opis_sr?.slice(0, 120) + '...');

await translateProperties([prop]);

console.log('\nEnglish:');
console.log('  naziv:', prop.naziv_en);
console.log('  opis:', prop.opis_en?.slice(0, 120) + '...');

console.log('\nRussian:');
console.log('  naziv:', prop.naziv_ru);
console.log('  opis:', prop.opis_ru?.slice(0, 120) + '...');

console.log('\nneedsTranslationPush:', prop.needsTranslationPush);
console.log('locale_fallback:', prop.locale_fallback);
