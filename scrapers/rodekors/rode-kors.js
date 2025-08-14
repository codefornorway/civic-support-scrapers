// scrapers/rodekors/rode-kors.js
import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import fs from 'fs/promises';
import path from 'path';
import { get } from '../../lib/http.js';
import { Geocoder } from '../../lib/geocode.js';
import { normSpace, titleCase, parsePath, firstEmail, firstLatLng, getOgImage } from '../../lib/utils.js';
import { minify } from 'html-minifier-terser';
import pkg from '../../package.json' with { type: 'json' };

const ORG = 'Røde Kors';
const BASE = 'https://www.rodekors.no';
const START = `${BASE}/lokalforeninger/`;

const STOP_SLUGS = new Set([
  'om',
  'kontakt',
  'organisering',
  'ansatte',
  'nyheter',
  'aktuelt',
  'aktiviteter',
  'vakttelefon',
  'hjelpekorps',
  'frivillighet',
  'stotte',
  'støtte',
  'avisa',
  'om-oss',
  'om-organisasjonen',
  'om-telemark-rode-kors',
  'om-vestfold-rode-kors',
]);

function parseLocal(url) {
  return parsePath(BASE, url);
}

function isCityLink(href, expectedCounty) {
  try {
    const u = new URL(href, BASE);
    const { county, city, depthAfterBase } = parseLocal(u.href);
    if (!county || !city) return false;
    if (depthAfterBase !== 2) return false;
    if (expectedCounty && county !== expectedCounty) return false;
    if (STOP_SLUGS.has(String(city).toLowerCase())) return false;
    return true;
  } catch {
    return false;
  }
}

async function getCountyLinks(httpUA, logger) {
  logger.section('Discover counties');
  const sp = logger.spinner(`Fetching index: ${START}`);
  sp.start();
  const $ = cheerio.load(await get(START, { userAgent: httpUA, logger }));
  sp.succeed(`Fetched index`);

  const set = new Set();
  $('a[href^="/lokalforeninger/"]').each((_, a) => {
    const href = $(a).attr('href');
    const { county, city, depthAfterBase } = parseLocal(href);
    if (county && !city && depthAfterBase === 1) {
      set.add(new URL(href, BASE).href.replace(/\/+$/, '/'));
    }
  });
  logger.success(`${set.size} counties found`);
  return [...set];
}

async function getCityLinks(countyUrl, httpUA, logger) {
  const sp = logger.spinner(`Discover cities in: ${countyUrl}`);
  sp.start();
  const html = await get(countyUrl, { userAgent: httpUA, logger });
  const $ = cheerio.load(html);
  const { county: countySlug } = parseLocal(countyUrl);

  const heading = $('h1,h2,h3')
    .filter((_, el) => $(el).text().trim().toLowerCase().includes('lokalforeninger i'))
    .first();

  const set = new Set();
  if (heading.length) {
    const nodes = [];
    let node = heading[0].nextSibling;
    while (node) {
      if (node.type === 'tag' && /^(h1|h2|h3)$/i.test(node.name)) break;
      nodes.push(node);
      node = node.nextSibling;
    }
    const wrapper = $('<div/>');
    nodes.forEach(n => wrapper.append(n));
    wrapper.find('a[href]').each((_, a) => {
      const href = $(a).attr('href');
      if (isCityLink(href, countySlug)) {
        const abs = new URL(href, BASE).href.replace(/\/+$/, '/');
        set.add(abs);
      }
    });
  }

  if (set.size === 0) {
    $('a[href^="/lokalforeninger/"]').each((_, a) => {
      const href = $(a).attr('href');
      if (isCityLink(href, countySlug)) {
        const abs = new URL(href, BASE).href.replace(/\/+$/, '/');
        set.add(abs);
      }
    });
  }

  sp.succeed(`Found ${set.size} cities`);
  return [...set];
}

function getCoordsFromDataMarker($) {
  const el = $('._jsMap[data-marker], .googleMap[data-marker], [data-marker]').first();
  if (!el.length) return { coords: null, addrFromMarker: null };
  let raw = el.attr('data-marker');
  if (!raw) return { coords: null, addrFromMarker: null };
  raw = raw.trim();
  try {
    let arr;
    try {
      arr = JSON.parse(raw);
    } catch {
      arr = JSON.parse(raw.replace(/'/g, '"'));
    }
    const lat = parseFloat(arr?.[0]);
    const lng = parseFloat(arr?.[1]);
    const addr = typeof arr?.[2] === 'string' ? normSpace(arr[2]) : null;
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { coords: [lat, lng], addrFromMarker: addr };
    return { coords: null, addrFromMarker: addr };
  } catch {
    return { coords: null, addrFromMarker: null };
  }
}

/** Return both item and meta (for counters) */
async function extractCity(url, { httpUA, geocoder, logger }) {
  logger.debug(`Extract ${url}`);
  const html = await get(url, { userAgent: httpUA, logger });
  const $ = cheerio.load(html);

  const name = $('h1').first().text().trim() || null;

  // Description
  let description = normSpace($('.lead p').first().text()) || null;
  if (!description) {
    const metaDesc = $('meta[name="description"]').attr('content');
    if (metaDesc) description = normSpace(metaDesc);
  }
  if (!description) {
    const h1 = $('h1').first();
    description = normSpace(h1.nextAll('p').first().text()) || null;
  }
  if (!description) {
    description = normSpace($('h1').first().parent().nextAll().find('p').first().text()) || null;
  }

  // Map coords + address fallback
  const { coords: coordsFromMarker, addrFromMarker } = getCoordsFromDataMarker($);

  // Address: prefer dt/dd pairs
  let address = null;
  $('dt').each((_, dt) => {
    const label = $(dt).text().trim().toLowerCase();
    if (/(adresse|besøksadresse|postadresse)/i.test(label)) {
      const ddText = normSpace($(dt).next('dd').text());
      if (ddText) address = ddText;
    }
  });
  if (!address && addrFromMarker) address = addrFromMarker;
  if (!address) {
    const pageText = normSpace($('body').text());
    const m = pageText.match(/(?:Adresse|Besøksadresse|Postadresse)\s*:?\s*([^<\n\r]+?\b\d{4}\b[^<\n\r]+)/i);
    if (m?.[1]) address = normSpace(m[1]);
  }

  // Email
  const topChunk = $('h1').first().nextUntil('h2').text();
  const email = firstEmail(topChunk) || firstEmail($('body').text());

  // Image
  const image = getOgImage($, BASE);

  // Notes: from "Velkommen" until next h2
  let notesHtml = null;
  const welcome = $('h2, h3')
    .filter((_, el) => $(el).text().trim().toLowerCase().includes('velkommen'))
    .first();
  if (welcome.length) {
    const frag = [];
    let node = welcome[0].nextSibling;
    while (node) {
      if (node.type === 'tag' && /^h2$/i.test(node.name)) break;
      frag.push(node);
      node = node.nextSibling;
    }
    const wrapper = $('<div/>');
    frag.forEach(n => wrapper.append(n));
    const raw = wrapper.html() || '';
    notesHtml = raw.trim() ? await minify(raw, { collapseWhitespace: true, removeComments: true }) : null;
  }

  // Coordinates
  let coordSource = null;
  let coordinates = null;

  if (coordsFromMarker) {
    coordinates = coordsFromMarker;
    coordSource = 'page';
  } else {
    coordinates = firstLatLng(html) || firstLatLng($('body').text()) || null;
    if (coordinates) coordSource = 'regex';
  }

  // Geocode only if still missing
  const { county, city } = parseLocal(url);
  let geocodeTried = false;
  if (!coordinates && geocoder?.enabled && address) {
    geocodeTried = true;
    const geo = await geocoder.geocodeAddress(address, city, county);
    if (geo) {
      coordinates = geo;
      coordSource = 'geocode';
    }
  }

  return {
    item: {
      name: name || null,
      description,
      image,
      address,
      email,
      source: url,
      coordinates,
      notes: notesHtml,
      organization: ORG,
      city: city ? titleCase(city) : null,
    },
    meta: { coordSource, geocodeTried, hadAddress: !!address },
  };
}

export async function run(opts = {}, logger) {
  const { concurrency = 5, sleepMs = 300, onlyCounty = null, onlyCity = null, geocode: geoOpts = {}, outputDir = 'data', userAgent } = opts;

  // UA from opts (CLI), fallback to package.json directly if missing
  const httpUA = userAgent || `CivicSupportScrapers/${pkg.version} (+hey@codefornorway.org)`;

  const limit = pLimit(concurrency);

  logger.section('Initialize');
  const geocoder = new Geocoder({
    enabled: !!geoOpts.enabled,
    rateMs: geoOpts.rateMs ?? 1100,
    maxCalls: geoOpts.maxCalls ?? 10000,
    cachePath: '.cache/geocode-cache.json',
    userAgent: httpUA,
    logger,
  });
  await geocoder.load();

  const counties = await getCountyLinks(httpUA, logger);

  let countyLinks = [...counties];
  if (onlyCounty) {
    const wanted = `${BASE}/lokalforeninger/${onlyCounty.replace(/\/+$/, '')}/`;
    countyLinks = countyLinks.filter(u => u === wanted);
    logger.info(`ONLY_COUNTY=${onlyCounty} → ${countyLinks.length} match(es)`);
  }

  logger.section('Discover city pages');
  const citySet = new Set();
  for (const c of countyLinks) {
    const links = await getCityLinks(c, httpUA, logger);
    links.forEach(l => citySet.add(l));
  }

  let cityLinks = [...citySet];
  if (onlyCity) {
    cityLinks = cityLinks.filter(u => parseLocal(u).city === onlyCity);
    logger.info(`ONLY_CITY=${onlyCity} → ${cityLinks.length} match(es)`);
  }

  logger.success(`Total city pages: ${cityLinks.length}\n`);

  logger.section('Extract records');
  const bar = logger.progress(cityLinks.length, { label: 'Scraping' });

  const out = [];
  let processed = 0;
  const counters = { pageCoords: 0, geocoded: 0, errors: 0, geocodeMiss: 0, skippedNoAddress: 0 };

  process.on('SIGINT', async () => {
    bar.stop();
    const partialPath = path.join(outputDir, 'rodekors-local.partial.json');
    await fs.writeFile(partialPath, JSON.stringify(out, null, 2), 'utf8');
    logger.warn(`Saved partial → ${partialPath} (${out.length} records)`);
    await geocoder.save();
    process.exit(130);
  });

  const tasks = cityLinks.map(u =>
    limit(async () => {
      try {
        const { item, meta } = await extractCity(u, { httpUA, geocoder, logger });

        // Skip records with no address
        if (!item.address) {
          counters.skippedNoAddress++;
          logger.verbose(`Skip (no address): ${u}`);
        } else {
          out.push(item);
          if (meta.coordSource === 'page') counters.pageCoords++;
          else if (meta.coordSource === 'geocode') counters.geocoded++;
          else if (!item.coordinates && meta.geocodeTried) counters.geocodeMiss++;
        }
      } catch (err) {
        counters.errors++;
        logger.error(`Error ${u} — ${err.message}`);
      } finally {
        processed++;
        bar.update(processed, {
          pageCoords: counters.pageCoords,
          geocoded: counters.geocoded,
          skipped: counters.skippedNoAddress,
          errors: counters.errors,
        });
        await new Promise(r => setTimeout(r, sleepMs));
      }
    })
  );

  await Promise.all(tasks);
  bar.stop();

  const outPath = path.join(outputDir, 'rodekors-local.json');
  await fs.writeFile(outPath, JSON.stringify(out, null, 2), 'utf8');
  logger.success(`Wrote ${out.length} records → ${outPath}`);

  logger.section('Summary');
  logger.kv('Counts', {
    total_written: out.length,
    coords_from_page: counters.pageCoords,
    coords_geocoded: counters.geocoded,
    geocode_missed: counters.geocodeMiss,
    skipped_no_address: counters.skippedNoAddress,
    errors: counters.errors,
  });

  await geocoder.save();
}
