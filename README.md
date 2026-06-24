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
| `WEBFLOW_SITE_ID` | Site ID (from Webflow Site Settings) |
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
