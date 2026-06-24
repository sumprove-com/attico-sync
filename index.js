import dotenv from 'dotenv';
dotenv.config({ override: true });
import { fetchFeed } from './src/relper.js';
import { parseProperties } from './src/parser.js';
import { loadCache, saveCache, geocodeProperties } from './src/geocoder.js';
import {
  fetchCMSItems,
  createItem,
  updateItem,
  unpublishItem,
  hasChanges,
} from './src/webflow.js';

const run = async () => {
  const startTime = Date.now();
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[sync] Starting — ${new Date().toISOString()}`);
  console.log(`[sync] DRY RUN: ${process.env.DRY_RUN === 'true' ? 'YES (no changes will be written)' : 'NO'}`);
  console.log('─'.repeat(60));

  const stats = { created: 0, updated: 0, unpublished: 0, skipped: 0, errors: 0 };
  let failed = false;

  try {
    const rawItems = await fetchFeed();
    const properties = parseProperties(rawItems);

    if (properties.length === 0) {
      console.warn('[sync] No valid properties parsed from feed — aborting to protect existing CMS data');
      return;
    }

    const cmsItems = await fetchCMSItems();
    const cmsMap = new Map(
      cmsItems.map((item) => [String(item.fieldData['estate-id']), item])
    );
    console.log(`[sync] CMS has ${cmsMap.size} existing items`);

    await loadCache();
    await geocodeProperties(properties, cmsMap);
    await saveCache();

    for (const prop of properties) {
      try {
        const existing = cmsMap.get(prop.relper_id);

        if (!existing) {
          if (await createItem(prop)) stats.created++;
          else stats.errors++;
        } else if (hasChanges(prop, existing.fieldData)) {
          if (await updateItem(existing.id, prop)) stats.updated++;
          else stats.errors++;
        } else {
          stats.skipped++;
        }

        cmsMap.delete(prop.relper_id);

      } catch (err) {
        console.error(`[sync] Error processing ${prop.relper_id}: ${err.message}`);
        stats.errors++;
      }
    }

    for (const [relper_id, item] of cmsMap) {
      try {
        if (await unpublishItem(item.id, relper_id)) stats.unpublished++;
        else stats.errors++;
      } catch (err) {
        console.error(`[sync] Error unpublishing ${relper_id}: ${err.message}`);
        stats.errors++;
      }
    }

  } catch (err) {
    console.error(`[sync] Fatal error: ${err.message}`);
    console.error(err.stack);
    failed = true;
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('─'.repeat(60));
  console.log(`[sync] Done in ${duration}s`);
  console.log(`[sync] Created: ${stats.created} | Updated: ${stats.updated} | Unpublished: ${stats.unpublished} | Skipped: ${stats.skipped} | Errors: ${stats.errors}`);
  console.log('─'.repeat(60));

  if (failed) process.exit(1);
};

run();
