/**
 * One-time helper: prints WEBFLOW_CMS_LOCALE_* env vars for .env
 * Requires a Webflow API token with sites:read scope.
 */
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config({ override: true });

const siteId = process.env.WEBFLOW_SITE_ID;
const token = process.env.WEBFLOW_API_TOKEN;

if (!siteId || !token) {
  console.error('Set WEBFLOW_SITE_ID and WEBFLOW_API_TOKEN in .env first');
  process.exit(1);
}

const resolveLocaleKey = (locale) => {
  const sub = (locale.subdirectory || '').toLowerCase();
  if (sub === 'en') return 'en';
  if (sub === 'ru') return 'ru';
  const tag = (locale.tag || '').toLowerCase();
  if (tag.startsWith('en')) return 'en';
  if (tag.startsWith('ru')) return 'ru';
  return 'sr';
};

const res = await fetch(`https://api.webflow.com/v2/sites/${siteId}`, {
  headers: {
    Authorization: `Bearer ${token}`,
    'accept-version': '2.0.0',
  },
});

if (!res.ok) {
  console.error(`Failed (${res.status}):`, await res.text());
  console.error('\nRegenerate your Webflow API token with the sites:read scope, then re-run.');
  process.exit(1);
}

const data = await res.json();
const byKey = {};

byKey.sr = data.locales.primary.cmsLocaleId;
for (const locale of data.locales.secondary || []) {
  if (!locale.enabled) continue;
  const key = resolveLocaleKey(locale);
  if (key !== 'sr') byKey[key] = locale.cmsLocaleId;
}

console.log('Add these to your .env:\n');
console.log(`WEBFLOW_CMS_LOCALE_SR=${byKey.sr}`);
if (byKey.en) console.log(`WEBFLOW_CMS_LOCALE_EN=${byKey.en}`);
if (byKey.ru) console.log(`WEBFLOW_CMS_LOCALE_RU=${byKey.ru}`);
