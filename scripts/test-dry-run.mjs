/**
 * Local dry-run smoke test — verifies 3-locale payloads in logs.
 */
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const env = {
  ...process.env,
  RELPER_FEED_URL: 'mock://',
  DRY_RUN: 'true',
  WEBFLOW_CMS_LOCALE_SR: process.env.WEBFLOW_CMS_LOCALE_SR || '69a0a37320c8336fe957a109',
  WEBFLOW_CMS_LOCALE_EN: process.env.WEBFLOW_CMS_LOCALE_EN || '000000000000000000000001',
  WEBFLOW_CMS_LOCALE_RU: process.env.WEBFLOW_CMS_LOCALE_RU || '000000000000000000000002',
};

const result = spawnSync('node', ['index.js'], {
  env,
  stdio: 'inherit',
  cwd: root,
});

process.exit(result.status ?? 1);
