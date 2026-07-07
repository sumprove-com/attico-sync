# attico-sync

RELPER XML Feed → Webflow CMS sync service for Attico Group.

Runs every 30 minutes via GitHub Actions. Reads RELPER XML, geocodes addresses via Mapbox, syncs to Webflow CMS.

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```

Fill in `.env`:

| Variable | Description |
|---|---|
| `RELPER_FEED_URL` | RELPER XML feed URL (set to `mock://` for local testing) |
| `WEBFLOW_API_TOKEN` | Webflow API token (Site Settings → Integrations → API Access) |
| `WEBFLOW_COLLECTION_ID` | Nekretnine collection ID (from Webflow CMS URL or API) |
| `WEBFLOW_SITE_ID` | Site ID (required — used to resolve sr/en/ru locale IDs) |
| `MAPBOX_TOKEN` | Mapbox access token (for geocoding) |
| `DRY_RUN` | Set to `true` to log what would happen without writing to Webflow |

Auth for RELPER is embedded in `RELPER_FEED_URL` as a query param (`?secret=...`). `RELPER_API_KEY` in `.env.example` is unused by the code today.

### 3. Get your Webflow Collection ID
1. Open Webflow Designer → CMS → Nekretnine collection
2. The URL contains the collection ID: `webflow.com/dashboard/sites/{site-id}/cms/{collection-id}`
3. Or: call `GET https://api.webflow.com/v2/sites/{site-id}/collections` with your token

---

## Running locally

```bash
# Test with mock XML feed (no Webflow writes)
RELPER_FEED_URL=mock:// DRY_RUN=true npm start

# Test with mock XML feed + real Webflow writes
RELPER_FEED_URL=mock:// npm start

# Test with real RELPER feed + dry run
DRY_RUN=true npm start

# Full production run
npm start
```

On Windows PowerShell, set env vars separately or use a `.env` file with `dotenv`.

**Always do a dry run first** when connecting to the real RELPER feed for the first time. Check the logs, confirm the field mappings look right, then run without DRY_RUN.

---

## Multi-locale sync (sr / en / ru)

The sync writes to all three Webflow CMS locales on every create, update, publish, and unpublish operation by passing `cmsLocaleId` / `cmsLocaleIds` to the Webflow API.

**Requirements:**

- `WEBFLOW_SITE_ID` must be set — locale IDs are fetched from `GET /v2/sites/{siteId}` at the start of each run (requires `sites:read` scope on your API token)
- Alternatively, set `WEBFLOW_CMS_LOCALE_SR`, `WEBFLOW_CMS_LOCALE_EN`, and `WEBFLOW_CMS_LOCALE_RU` in `.env` (run `node scripts/fetch-locale-ids.mjs` once with a token that has `sites:read` to print these values)
- Webflow Localization must be enabled with Serbian (primary), English, and Russian
- For items that existed **before** localization was added, EN/RU variants must be added manually in the Webflow CMS panel (the API cannot add locales to existing items)

**RELPER translations:** The parser looks for optional `property_name_en`, `property_description_en`, `property_name_ru`, and `property_description_ru` XML fields. Until RELPER exposes these, EN/RU locales receive Serbian content as a fallback (logged as a warning).

---

## Webflow CMS field slugs

The field slugs in `src/webflow.js` → `buildFieldData()` must match your Webflow CMS collection exactly.

To verify: Webflow Designer → CMS → Nekretnine → each field → Settings → the slug shown there.

Default mapping assumed:

| CMS Field Name | Expected Slug |
|---|---|
| Relper ID | `relper-id` |
| Naziv | `naziv` |
| Tip | `tip` |
| Transakcija | `transakcija` |
| Cena | `cena` |
| Kvadratura | `kvadratura` |
| Broj soba | `broj-soba` |
| Sprat | `sprat` |
| Lokacija | `lokacija` |
| Adresa | `adresa` |
| Lat | `lat` |
| Lng | `lng` |
| Opis SR | `opis-sr` |
| Namena lokala | `namena-lokala` |
| Featured | `featured` |
| Lift | `lift` |
| Parking | `parking` |
| Terasa | `terasa` |
| Podrum | `podrum` |
| Novogradnja | `novogradnja` |
| Eksluzivno | `eksluzivno` |
| Slike | `slike` |

---

## When you get the real RELPER XML feed

1. Fetch one page of raw XML manually (Postman or curl)
2. Compare field names to `mock-feed.xml`
3. Update field mappings in `src/parser.js` → `parseProperty()` if they differ
4. Set `RELPER_FEED_URL` in `.env`
5. Run `DRY_RUN=true npm start` — verify logs
6. Run `npm start` — first real sync

---

## Deploying with GitHub Actions

### 1. Create a private GitHub repo

Create an empty private repo (e.g. `attico-sync`) on GitHub.

### 2. Push this project

From the project root:

```powershell
git init
git add .
git status
git commit -m "Add RELPER to Webflow sync with GitHub Actions"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/attico-sync.git
git push -u origin main
```

Before committing, run `git status` and confirm `.env`, `webflow/`, and `node_modules/` are **not** listed.

### 3. Add repository secrets

GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Secret | Value |
|---|---|
| `RELPER_FEED_URL` | Your RELPER feed URL |
| `WEBFLOW_API_TOKEN` | Webflow API token |
| `WEBFLOW_COLLECTION_ID` | Nekretnine collection ID |
| `WEBFLOW_SITE_ID` | Site ID |
| `MAPBOX_TOKEN` | Mapbox token |
| `DRY_RUN` | `true` for first test, then `false` |
| `WEBFLOW_CMS_LOCALE_SR` | Optional — sr `cmsLocaleId` if token lacks `sites:read` |
| `WEBFLOW_CMS_LOCALE_EN` | Optional — en `cmsLocaleId` if token lacks `sites:read` |
| `WEBFLOW_CMS_LOCALE_RU` | Optional — ru `cmsLocaleId` if token lacks `sites:read` |

### 4. Run and verify

1. Go to **Actions** → **RELPER Webflow Sync** → **Run workflow** (manual trigger)
2. Check logs for `[sync] DRY RUN: YES` and expected create/update counts
3. Set secret `DRY_RUN` to `false`
4. Run workflow again and confirm Webflow CMS updates
5. Scheduled runs fire every 30 minutes (UTC)

### Free tier

Private repos include 2,000 GitHub Actions minutes/month on the free plan. This sync (~1 min × 48 runs/day) fits comfortably.

---

## Geocode cache

`geocode-cache.json` is created automatically and maps address strings → `{ lat, lng }`.

- **Locally:** persists in the project root between runs (gitignored)
- **GitHub Actions:** persisted between runs via Actions cache (not committed to git)

---

## Error handling

- If the XML feed is unreachable → logs error, skips the run, does NOT touch existing CMS items
- If a single property fails → logs error, continues with the rest
- If Webflow rate limits → waits for `retry-after` header duration, then retries once
- Unpublish (not delete) for properties removed from the feed — client can restore manually in Webflow
- Fatal errors exit with code 1 so GitHub Actions marks the run as failed

---

## Adjusting sync interval

Edit `.github/workflows/sync.yml` → `schedule.cron`. Standard cron syntax (UTC).

```
*/30 * * * *   every 30 minutes
0 * * * *      top of every hour
0 */2 * * *    every 2 hours
```
