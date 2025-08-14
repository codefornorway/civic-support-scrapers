// scripts/scrape.js
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { createLogger } from '../lib/log.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Add new organizations here:
const REGISTRY = {
  rodekors: '../scrapers/rodekors/rode-kors.js',
};

function usage() {
  const names = Object.keys(REGISTRY).join(', ');
  console.log(`Usage:
  ORG=<org> [CONCURRENCY=3] [SLEEP_MS=600] [GEOCODE=1] [LOG_LEVEL=info] node scripts/scrape.js
  or
  node scripts/scrape.js <org>

Available orgs: ${names}
LOG_LEVEL: silent | error | warn | info | verbose | debug

Examples:
  ORG=rodekors CONCURRENCY=3 SLEEP_MS=600 node scripts/scrape.js
  node scripts/scrape.js rodekors
  GEOCODE=1 ONLY_COUNTY=agder ONLY_CITY=kvinesdal LOG_LEVEL=verbose node scripts/scrape.js rodekors
`);
}

async function main() {
  const orgEnv = process.env.ORG && process.env.ORG.trim();
  const orgArg = process.argv[2] && process.argv[2].trim();
  const org = (orgEnv || orgArg || '').toLowerCase();

  if (!org || !REGISTRY[org]) {
    usage();
    process.exit(org ? 2 : 1);
  }

  await fs.mkdir('data', { recursive: true });
  await fs.mkdir('.cache', { recursive: true });

  const logger = createLogger({
    level: (process.env.LOG_LEVEL || 'info').toLowerCase(),
    name: org,
  });

  logger.banner(`Civic Support Scrapers`, `Organization: ${org}`);

  const modPath = path.join(__dirname, REGISTRY[org]);
  const scraper = await import(modPath);

  const opts = {
    concurrency: Number(process.env.CONCURRENCY || 5),
    sleepMs: Number(process.env.SLEEP_MS || 300),
    onlyCounty: process.env.ONLY_COUNTY?.toLowerCase() || null,
    onlyCity: process.env.ONLY_CITY?.toLowerCase() || null,
    geocode: {
      enabled: /^(1|true|yes)$/i.test(process.env.GEOCODE || ''),
      rateMs: Number(process.env.GEO_RATE_MS || 1100),
      maxCalls: Number(process.env.MAX_GEOCODES || 10000),
    },
    outputDir: 'data',
  };

  logger.section('Options');
  logger.kv('Runtime Configuration', opts);

  if (typeof scraper.run !== 'function') {
    logger.error(`Scraper "${org}" does not export run(opts, logger).`);
    process.exit(3);
  }

  try {
    await scraper.run(opts, logger);
    logger.done();
  } catch (err) {
    logger.error(err.stack || err.message);
    process.exit(1);
  }
}

main();
