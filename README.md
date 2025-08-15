Here’s a clean, professional, and detailed **README.md** you can drop in:

---

# Civic Support Scrapers

Scrape Norwegian NGOs’ **local chapter pages** into a **single, normalized dataset** — consistently, politely, and with great observability.

Each scraper targets one organization (e.g., **Røde Kors**, **Kirkens Bymisjon**, …) and emits a uniform record schema so downstream tooling can treat all orgs the same.

---

## Highlights

- **Uniform schema** across organizations
- **Polite by default**: rate limits, retries with backoff, geocoding throttle + disk cache
- **Strong selectors** with semantic fallbacks
- **Beautiful terminal UX**: progress bar, counters, sections, and leveled logs
- **Resumability**: partial dataset written on **Ctrl+C**
- **Per-record freshness**: `data_updated` field stamped on every record

---

## Table of Contents

- [Requirements](#requirements)
- [Install](#install)
- [Repository Structure](#repository-structure)
- [Quick Start](#quick-start)
- [CLI / Env Options](#cli--env-options)
- [Output & Schema](#output--schema)
- [How It Works](#how-it-works)
- [Logging & Progress](#logging--progress)
- [Geocoding](#geocoding)
- [Performance & Etiquette](#performance--etiquette)
- [Add a New Organization](#add-a-new-organization)
- [Quality Checklist](#quality-checklist)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## Requirements

- **Node.js ≥ 20.6** (supports JSON import attributes). Tested on Node 20–22.
- Internet access

> If you must use Node 18, you can replace JSON import attributes with a tiny helper; otherwise stick to Node 20+.

---

## Install

From the repo root:

```bash
npm install
```

This pulls in: `axios`, `cheerio`, `p-limit`, `html-minifier-terser`, `cli-progress`, `chalk`, `boxen`, `ora`, `pretty-ms`.

---

## Repository Structure

```
.
├─ scripts/
│  └─ scrape.js                      # CLI runner, picks org scraper by slug
├─ scrapers/
│  ├─ rodekors/
│  │  └─ rode-kors.js                # Røde Kors scraper (reference implementation)
│  └─ <org-slug>/
│     └─ <org>.js                    # Your next scraper
├─ lib/
│  ├─ http.js                        # axios GET with retry/backoff
│  ├─ geocode.js                     # Nominatim + serialized rate limiting + cache
│  ├─ log.js                         # terminal UX (sections, progress, levels)
│  └─ utils.js                       # shared DOM/text helpers
├─ data/
│  └─ <org>-local.json               # final dataset per org (written on completion)
└─ .cache/
   └─ geocode-cache.json             # shared geocoding cache
```

---

## Quick Start

Use the CLI runner (`scripts/scrape.js`) and pass the organization slug.

**Polite defaults (Røde Kors):**

```bash
LOG_LEVEL=info CONCURRENCY=3 SLEEP_MS=600 node scripts/scrape.js rodekors
```

**With geocoding (only for missing coordinates):**

```bash
LOG_LEVEL=info GEOCODE=1 CONCURRENCY=3 SLEEP_MS=600 node scripts/scrape.js rodekors
```

**Narrow scope while developing:**

```bash
ONLY_COUNTY=agder node scripts/scrape.js rodekors
ONLY_COUNTY=agder ONLY_CITY=kvinesdal node scripts/scrape.js rodekors
```

**Stamp a specific `data_updated` date (per record):**

```bash
DATA_UPDATED=2023-06-01 node scripts/scrape.js rodekors
```

---

## CLI / Env Options

| Variable       | Default | Description                                                                      |
| -------------- | ------- | -------------------------------------------------------------------------------- |
| `ORG`          | —       | Organization slug (or pass as CLI arg, e.g., `node scripts/scrape.js rodekors`). |
| `CONCURRENCY`  | `5`     | Max concurrent HTTP fetches (keep modest: 2–5).                                  |
| `SLEEP_MS`     | `300`   | Delay between tasks for politeness (ms).                                         |
| `ONLY_COUNTY`  | —       | Limit discovery to a single county slug (e.g., `agder`).                         |
| `ONLY_CITY`    | —       | Limit to a city slug **within** the chosen county.                               |
| `GEOCODE`      | off     | `1/true/yes` to geocode **only if coordinates are missing**.                     |
| `GEO_RATE_MS`  | `1100`  | Min delay (ms) between geocoding calls (Nominatim policy friendly).              |
| `MAX_GEOCODES` | `10000` | Hard cap on geocoding calls per run.                                             |
| `LOG_LEVEL`    | `info`  | `silent`, `error`, `warn`, `info`, `verbose`, `debug`.                           |
| `DATA_UPDATED` | today   | Per-record `data_updated` (ISO `YYYY-MM-DD`). Defaults to today (UTC).           |

> The HTTP **User-Agent** is `CivicSupportScrapers/<version from package.json> (+hey@codefornorway.org)`.

---

## Output & Schema

Final dataset is written to `data/<org>-local.json` (array of objects). Each **record**:

```json
{
  "name": "Arendal Røde Kors",
  "description": "Arendal Røde Kors er en frivillig, medlemsstyrt organisasjon ...",
  "image": "https://www.rodekors.no/globalassets/.../treffpunkt-hove-for-sosiale-medier.jpg",
  "address": "Hans Thornes vei 26, 4846 ARENDAL",
  "email": "leder@arendal-rk.no",
  "source": "https://www.rodekors.no/lokalforeninger/agder/arendal/",
  "coordinates": [58.4887604, 8.7585903],
  "notes": "<p>Styreleder: ...</p>",
  "organization": "Røde Kors",
  "city": "Arendal",
  "data_updated": "2023-06-01"
}
```

**Field notes**

- `coordinates` is `[lat, lon]`. Value comes from the page when present; geocoding runs **only if missing**.
- `notes` is a concise HTML snippet:

  - For Røde Kors, it’s content from **`<h2/3>Velkommen` up to `.expander-list-header`** (exclusive). If the header isn’t present, `notes = null`.

- Records **without an address** are **skipped** (not written).

A **partial** file is written on **Ctrl+C** to `data/<org>-local.partial.json`.

---

## How It Works

1. **Discover**

   - Start at org index (e.g., `/lokalforeninger/`).
   - Collect **county** links at depth 1 (`/org/{county}/`).
   - For each county, collect **city** links at depth 2 (`/org/{county}/{city}/`).
   - Filter out non-city pages with an organization-specific **stop list** (`om`, `kontakt`, …).

2. **Extract**

   - `name`: `<h1>`
   - `description`: prefer structured intro (e.g., `.lead p`), then meta `description`, then nearest paragraph after `<h1>`.
   - `image`: `<meta property="og:image">` fallback to first `<img>` (absolute URL).
   - `address`: prefer semantic `<dt>Adresse</dt><dd>…</dd>`, fallback to map data or regex.
   - `email`: first valid email near the top or anywhere on the page.
   - `notes`: targeted slice based on headings (see schema notes).
   - `coordinates`: from map widget (`data-marker`) or inline text; otherwise geocode if enabled.

3. **Write**

   - Stream results into an array and save to `data/<org>-local.json`.
   - On SIGINT, write a partial file with whatever’s collected so far.

---

## Logging & Progress

The scraper prints structured sections and a live progress bar:

```
Extract records
────────────────────────
Scraping | ███████░░░ 128/319 | 40% | ETA: 5m 12s | page:94 geo:29 skip:6 err:1
```

**Counters**

- `page`: coordinates read from page (map/regex)
- `geo`: coordinates obtained via geocoding
- `skip`: records skipped due to missing `address`
- `err`: extraction errors

Use `LOG_LEVEL=verbose` for more detail (HTTP/geocode hits). `debug` adds per-query traces.

---

## Geocoding

- Engine: **Nominatim** (OpenStreetMap)
- When: **only** if page lacks coordinates
- Throttle: serialized queue, **`GEO_RATE_MS`** delay between calls (default 1100ms)
- Cache: `.cache/geocode-cache.json` (shared for all orgs; speeds up subsequent runs)
- Query strategy: progressively broader (address → address+county → `POSTCODE CITY` → `POSTCODE` → `CITY, COUNTY` → `CITY`)

---

## Performance & Etiquette

- Keep **`CONCURRENCY` low** (2–3) and **`SLEEP_MS` ≥ 600** for production runs.
- Respect retry/backoff signals and avoid hammering origins.
- Geocoding is intentionally slow; please don’t lower the throttle for large runs.
- Consider off-peak schedules and contacting site owners for ongoing crawls.

---

## Add a New Organization

Use `scrapers/rodekors/rode-kors.js` as a reference:

1. **Create**: `scrapers/<org-slug>/<org>.js`
2. **Constants**: set `BASE`, `START`, `ORG`
3. **Stop list**: `STOP_SLUGS` for non-city subpaths (lower-case)
4. **Discovery**:

   - `getCountyLinks()` → URLs like `/.../{county}/` (depth 1)
   - `getCityLinks()` → URLs like `/.../{county}/{city}/` (depth 2)

5. **Extraction**: implement robust selectors + fallbacks per site
6. **Register** the scraper in `scripts/scrape.js` registry
7. **Test** with `ONLY_COUNTY`/`ONLY_CITY` and low concurrency

---

## Quality Checklist

- [ ] County pages (depth 1) only; city pages (depth 2) only
- [ ] Non-city pages excluded by stop list
- [ ] Image URLs normalized to absolute
- [ ] `address` preferred via semantic `dt/dd`; regex/map otherwise
- [ ] `notes` scoped specifically to the intended slice
- [ ] Records without `address` are skipped
- [ ] `coordinates` copied from page; geocoding happens only when missing
- [ ] Progress bar reflects `page`, `geo`, `skip`, `err`
- [ ] Output passes a quick JSON schema spot check on samples

---

## Troubleshooting

**Too noisy / can’t see progress**

- Use `LOG_LEVEL=info` (default). `verbose`/`debug` add detail; `warn` quiets things down.

**Geocoding slow**

- That’s by design (rate-limited; cached). Subsequent runs will reuse `.cache/geocode-cache.json`.

**HTTP 429/5xx**

- Reduce `CONCURRENCY`, increase `SLEEP_MS`. The HTTP client already retries with backoff.

**Unexpected pages scraped**

- Add more slugs to `STOP_SLUGS` and/or refine the “depth” checks.

**Wrong JSON date**

- Set an explicit `DATA_UPDATED=YYYY-MM-DD` in your run command.

---

## Contributing

PRs welcome! Especially:

- New organization scrapers
- Selector improvements for edge cases
- Exporters (CSV/Parquet)
- Tests for selectors and schema

---

## License

MIT

---

**Happy scraping!**
