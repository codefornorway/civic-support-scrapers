# Civic Support Scrapers

Scrape Norwegian NGOs’ **local chapter pages** into a **single, normalized dataset**.
Each scraper targets one organization’s website (e.g., Røde Kors, Kirkens Bymisjon, etc.) and outputs records with the same schema:

- `name`
- `description`
- `image` (absolute URL)
- `address`
- `email`
- `source` (canonical page URL)
- `coordinates` → `[lat, lon]` _(from the page when present; optionally geocoded **only** when missing)_
- `notes` (optional HTML snippet, e.g., “Velkommen”, key contacts)
- `organization`
- `city`

Built for reliability and politeness: rate-limited requests, HTML parsing via Cheerio, retries with backoff, and optional Nominatim geocoding with disk caching.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Repository Structure](#repository-structure)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [CLI Options (env vars)](#cli-options-env-vars)
- [Outputs](#outputs)
- [Data Schema](#data-schema)
- [How It Works](#how-it-works)
- [Add a New Organization Scraper](#add-a-new-organization-scraper)
- [Quality Checklist](#quality-checklist)
- [Troubleshooting](#troubleshooting)
- [Performance & Etiquette](#performance--etiquette)
- [Contributing](#contributing)
- [License](#license)

---

## Prerequisites

- **Node.js 18+** (tested on Node 18–22)
- Internet access

---

## Repository Structure

```text
.
├─ scrapers/
│  ├─ rodekors/
│  │  └─ rode-kors.js             # Røde Kors scraper (example)
│  ├─ kirkens-bymisjon/
│  │  └─ kirkens-bymisjon.js      # (your next scraper)
│  └─ <org-slug>/
│     └─ <org>.js
├─ lib/                            # Shared utilities (optional; can be folded later)
│  ├─ http.js                      # axios + retry/backoff
│  ├─ geocode.js                   # Nominatim + disk cache
│  └─ dom.js                       # tiny helpers (normalizers/selectors)
├─ data/
│  ├─ rodekors-local.json          # final JSON per org
│  ├─ rodekors-local.partial.json  # partial on Ctrl+C
│  └─ <org>-local.json
└─ .cache/
   └─ geocode-cache.json           # geocode cache shared by all scrapers
```

> If you’re starting from a single file (`rode-kors.js`), you can keep that structure and move to this layout gradually. The README works either way.

---

## Installation

From the repo root:

```bash
npm init -y
npm i axios cheerio p-limit html-minifier-terser
```

If you run scripts with ES modules, ensure `package.json` contains:

```json
{
  "type": "module",
  "scripts": {
    "start:rode-kors": "node scrapers/rodekors/rode-kors.js"
  }
}
```

---

## Quick Start

### Run a single scraper (Røde Kors example)

**macOS/Linux**

```bash
CONCURRENCY=3 SLEEP_MS=600 node scrapers/rodekors/rode-kors.js
```

**Windows PowerShell**

```powershell
$env:CONCURRENCY=3; $env:SLEEP_MS=600; node scrapers/rodekors/rode-kors.js
```

### Fast testing on a subset

```bash
# Only one county (e.g., Agder)
ONLY_COUNTY=agder node scrapers/rodekors/rode-kors.js

# Only one city within the county (e.g., Kvinesdal in Agder)
ONLY_COUNTY=agder ONLY_CITY=kvinesdal node scrapers/rodekors/rode-kors.js
```

### Geocode missing coordinates (optional)

Coordinates are taken from the page when present.
Enable geocoding **only for records missing coordinates**:

```bash
GEOCODE=1 CONCURRENCY=3 SLEEP_MS=600 node scrapers/rodekors/rode-kors.js
```

Geocoding uses **Nominatim** with \~1 req/sec and a disk cache; subsequent runs are fast.

---

# Røde Kors, polite defaults

CONCURRENCY=3 SLEEP_MS=600 node scripts/scrape.js rodekors

# Geocode only when coordinates are missing

GEOCODE=1 CONCURRENCY=3 SLEEP_MS=600 node scripts/scrape.js rodekors

# Agder only

ONLY_COUNTY=agder node scripts/scrape.js rodekors

# Kvinesdal only

ONLY_COUNTY=agder ONLY_CITY=kvinesdal node scripts/scrape.js rodekors

# Polite defaults, pretty logs

LOG_LEVEL=info CONCURRENCY=3 SLEEP_MS=600 node scripts/scrape.js rodekors

# Verbose (HTTP + cache hits)

LOG_LEVEL=verbose GEOCODE=1 ONLY_COUNTY=agder node scripts/scrape.js rodekors

# Deep debug

LOG_LEVEL=debug ONLY_COUNTY=agder ONLY_CITY=kvinesdal node scripts/scrape.js rodekors

GEOCODE=1 CONCURRENCY=3 SLEEP_MS=600 LOG_LEVEL=info node scripts/scrape.js rodekors

# Polite defaults, pretty logs

LOG_LEVEL=info CONCURRENCY=3 SLEEP_MS=600 node scripts/scrape.js rodekors

# With geocoding (only when coordinates are missing)

LOG_LEVEL=info GEOCODE=1 CONCURRENCY=3 SLEEP_MS=600 node scripts/scrape.js rodekors

# Narrow to a subset

ONLY_COUNTY=agder LOG_LEVEL=info node scripts/scrape.js rodekors
ONLY_COUNTY=agder ONLY_CITY=kvinesdal LOG_LEVEL=verbose node scripts/scrape.js rodekors

## CLI Options (env vars)

| Variable       | Default | Description                                                           |
| -------------- | ------- | --------------------------------------------------------------------- |
| `CONCURRENCY`  | `5`     | Max parallel HTTP requests. Keep modest (2–5).                        |
| `SLEEP_MS`     | `300`   | Delay (ms) between page groups to reduce load.                        |
| `ONLY_COUNTY`  | —       | Restrict to a county slug (e.g., `agder`).                            |
| `ONLY_CITY`    | —       | Restrict to a city slug within the selected county.                   |
| `GEOCODE`      | _off_   | `1/true/yes` enables geocoding **only** when coordinates are missing. |
| `GEO_RATE_MS`  | `1100`  | Min delay between geocode calls (Nominatim).                          |
| `MAX_GEOCODES` | `10000` | Safety cap on geocode lookups.                                        |

---

## Outputs

- `data/<org>-local.json` – Final dataset for the organization.
- `data/<org>-local.partial.json` – Saved if you interrupt with **Ctrl+C**.
- `.cache/geocode-cache.json` – Disk cache for geocoding results.

The terminal logs show:

- Each requested URL
- County/city discovery counts
- Per-city progress (`[n/total] Completed`)
- Geocoding cache hits/misses

---

## Data Schema

Every scraper outputs the same normalized shape:

```json
{
  "name": "Arendal Røde Kors",
  "description": "Arendal Røde Kors er en frivillig, medlemsstyrt organisasjon ...",
  "image": "https://www.example.org/path/to/cover.jpg",
  "address": "Hans Thornes vei 26, 4846 ARENDAL",
  "email": "leder@arendal-rk.no",
  "source": "https://www.example.org/lokalforeninger/agder/arendal/",
  "coordinates": [58.4887604, 8.7585903],
  "notes": "<p>Styreleder: ...</p>",
  "organization": "Røde Kors",
  "city": "Arendal"
}
```

- Fields may be `null` if truly unavailable.
- `coordinates` is `[lat, lon]` and is only geocoded if missing on the page.

---

## How It Works

1. **Discovery**

   - Start at the organization’s listing page (e.g., `/lokalforeninger/`).
   - Collect **county** links (depth `/org/{county}/`), then **city** links (depth `/org/{county}/{city}/`).
   - Apply a **stop-list** to exclude non-city subpages (`/om`, `/kontakt`, etc.).

2. **Extraction**

   - Parse each city page with **Cheerio** to extract name, description, image, address, email, notes, coordinates, etc.
   - Normalize image URLs to absolute.
   - Prefer semantic selectors (e.g., `<dt>Adresse</dt><dd>…</dd>`), fall back to heuristics.

3. **Coordinates**

   - If present (e.g., `data-marker`), store them directly.
   - If **missing** and `GEOCODE=1`, look up via **Nominatim** using progressively broader queries (address, postal code+city, city+county). Results are cached.

4. **Politeness**

   - Requests are rate-limited via `CONCURRENCY` + `SLEEP_MS`.
   - HTTP errors are retried with backoff.
   - Geocoding is serialized and throttled (`GEO_RATE_MS`).

---

## Add a New Organization Scraper

Use the existing scraper (Røde Kors) as a template.

1. **Create a folder & file**

   ```
   scrapers/<org-slug>/<org>.js
   ```

2. **Set constants**

   - `BASE` (site origin), `START` (listing index)
   - Organization name (to populate `organization` in the output)

3. **Implement discovery**

   - `getCountyLinks()` – return only `/.../{county}/`
   - `getCityLinks(countyUrl)` – return only `/.../{county}/{city}/`
   - Add a **`STOP_SLUGS`** set for non-city paths (lower-case)

4. **Implement extraction**

   - **Name**: `<h1>`
   - **Description**: prefer a designated block (e.g., `.lead p`), then meta `description`, then nearest `<p>` after `<h1>`
   - **Image**: Open Graph `<meta property="og:image">`, then first `<img>`
   - **Address**: prefer semantic blocks (e.g., `<dt>Adresse</dt><dd>…</dd>`); otherwise try a robust regex; optionally map `data-*`
   - **Email**: near the header or anywhere on the page
   - **Notes**: capture a relevant section (e.g., from “Velkommen” to next `<h2>`) as HTML
   - **Coordinates**: map widget / `data-*` first; regex second

5. **Geocoding (optional)**

   - Keep it **off** by default; enable with `GEOCODE=1`
   - Only perform geocoding when coordinates are missing

6. **Output file**

   - Write to `data/<org-slug>-local.json`
   - On SIGINT, write `data/<org-slug>-local.partial.json`

> Tip: during development, test with `ONLY_COUNTY` and `ONLY_CITY` to iterate quickly.

---

## Quality Checklist

- [ ] County discovery returns **only** county pages (depth check = 1).
- [ ] City discovery returns **only** city pages (depth check = 2, stop-list applied).
- [ ] Description fallback order is correct (primary selector → meta → nearest paragraph).
- [ ] Address prefers semantic (`dt/dd`) structure, then map `data-*`, then regex.
- [ ] Image URL is always absolute.
- [ ] Coordinates are copied from the page when present; otherwise geocoded **only when missing**.
- [ ] `ONLY_COUNTY` / `ONLY_CITY` paths work.
- [ ] Respectful defaults: `CONCURRENCY=2..3`, `SLEEP_MS≥600`.
- [ ] Output validates against the schema (spot check a sample).

---

## Troubleshooting

- **HTTP 429/5xx or timeouts**
  Lower `CONCURRENCY`, increase `SLEEP_MS`:

  ```bash
  CONCURRENCY=2 SLEEP_MS=900 node scrapers/<org>/<org>.js
  ```

- **Fields are `null`**
  That’s expected when the site doesn’t publish them. We rely on semantic selectors first and won’t fabricate values.

- **Geocoding slow**
  It’s deliberately throttled (\~1 req/sec). Results are cached in `.cache/geocode-cache.json`. Re-runs will be fast.

- **Stop-list misses a subpage**
  Add it (lower-case) to the scraper’s `STOP_SLUGS` set.

---

## Performance & Etiquette

- Use conservative settings (`CONCURRENCY=2–3`, `SLEEP_MS≥600`).
- Run off-peak, and consider contacting site owners if scraping regularly.
- **Geocoding**: Follow Nominatim’s usage policy. Keep requests modest and include a clear User-Agent (already set).

---

## Contributing

PRs welcome! Good first issues:

- New organization scrapers
- Better selectors for edge cases
- Export helpers (CSV/Excel)
- Tests & CI for selectors and schema

---

## License

MIT (unless your project uses a different license—update accordingly).

---

**Happy scraping!** If you want, I can also generate a minimal `lib/` with shared utils and a tiny CLI runner to select organizations (e.g., `npm run scrape -- rodekors`).
