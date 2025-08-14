// lib/geocode.js
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import pLimit from 'p-limit';
import pkg from '../package.json' with { type: 'json' };
import { normSpace, titleCase } from './utils.js';

export class Geocoder {
  constructor({
    enabled = false,
    rateMs = 1100,
    maxCalls = 10000,
    cachePath = '.cache/geocode-cache.json',
    userAgent = `CivicSupportScrapers/${pkg.version} (+hey@codefornorway.org)`,
    logger,
  } = {}) {
    this.enabled = enabled;
    this.rateMs = rateMs;
    this.maxCalls = maxCalls;
    this.cachePath = cachePath;
    this.userAgent = userAgent;
    this.logger = logger;
    this.cache = Object.create(null);
    this.cacheDirty = false;
    this.calls = 0;
    this.queue = pLimit(1);
  }

  async load() {
    try {
      await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
      const buf = await fs.readFile(this.cachePath, 'utf8');
      this.cache = JSON.parse(buf);
      this.logger?.info?.(`Geocode cache loaded (${Object.keys(this.cache).length} entries)`);
    } catch {
      this.cache = Object.create(null);
      this.logger?.warn?.('No geocode cache found, starting fresh');
    }
  }

  async save() {
    if (!this.cacheDirty) return;
    await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
    await fs.writeFile(this.cachePath, JSON.stringify(this.cache, null, 2), 'utf8');
    this.cacheDirty = false;
    this.logger?.success?.('Geocode cache saved');
  }

  _cacheGet(key) {
    return this.cache[key] || null;
  }
  _cachePut(key, value) {
    this.cache[key] = value;
    this.cacheDirty = true;
  }

  buildQueries(address, city, county) {
    const queries = [];
    const addr = normSpace(address);
    const cityTC = titleCase(city);
    const countyTC = titleCase(county);

    let postCode = null,
      cityFromAddr = null;
    const m = addr.match(/(\d{4})\s+([A-ZÆØÅa-zæøå\- ]+)/);
    if (m) {
      postCode = m[1];
      cityFromAddr = normSpace(m[2]);
    }

    if (addr) queries.push(`${addr}, Norway`);
    if (addr && countyTC) queries.push(`${addr}, ${countyTC}, Norway`);
    if (postCode && cityFromAddr) queries.push(`${postCode} ${titleCase(cityFromAddr)}, Norway`);
    if (postCode && !cityFromAddr) queries.push(`${postCode}, Norway`);
    if (cityTC && countyTC) queries.push(`${cityTC}, ${countyTC}, Norway`);
    if (cityTC) queries.push(`${cityTC}, Norway`);

    return [...new Set(queries)].slice(0, 6);
  }

  async geocode(query) {
    const key = `nominatim:${query.toLowerCase()}`;
    const cached = this._cacheGet(key);
    if (cached) {
      this.logger?.verbose?.(`🌐 (cache) ${query} -> [${cached[0]}, ${cached[1]}]`);
      return cached;
    }
    if (this.calls >= this.maxCalls) {
      this.logger?.warn?.('⛔ MAX_GEOCODES reached; skipping further lookups.');
      return null;
    }

    return await this.queue(async () => {
      this.logger?.debug?.(`Geocoding: ${query}`);
      try {
        const { data } = await axios.get('https://nominatim.openstreetmap.org/search', {
          headers: { 'User-Agent': this.userAgent },
          params: { q: query, countrycodes: 'no', format: 'jsonv2', limit: 1, addressdetails: 1 },
          timeout: 20000,
        });
        await new Promise(r => setTimeout(r, this.rateMs));
        this.calls++;

        if (Array.isArray(data) && data.length) {
          const lat = parseFloat(data[0].lat);
          const lon = parseFloat(data[0].lon);
          if (Number.isFinite(lat) && Number.isFinite(lon)) {
            const coords = [lat, lon];
            this._cachePut(key, coords);
            this.logger?.verbose?.(`Geocode OK: ${query} -> [${lat}, ${lon}]`);
            return coords;
          }
        }
        this.logger?.debug?.(`No geocode result: ${query}`);
        return null;
      } catch (e) {
        this.logger?.warn?.(`Geocode error: ${e.message}`);
        return null;
      }
    });
  }

  async geocodeAddress(address, city, county) {
    if (!this.enabled || !address) return null;
    for (const q of this.buildQueries(address, city, county)) {
      const coords = await this.geocode(q);
      if (coords) return coords;
    }
    return null;
  }
}
