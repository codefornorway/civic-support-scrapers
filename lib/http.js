// lib/http.js
import axios from 'axios';

// simple local sleep helper
export const sleep = ms => new Promise(r => setTimeout(r, ms));

function truncateUrl(u, max = 120) {
  if (!u) return '';
  return u.length <= max ? u : u.slice(0, max - 1) + '…';
}

export async function get(url, { tries = 3, userAgent, timeout = 25000, logger } = {}) {
  let attempt = 0;
  let lastErr;

  while (attempt < tries) {
    try {
      logger?.verbose?.(`HTTP GET ${url} (try ${attempt + 1}/${tries})`);
      const { data, status } = await axios.get(url, {
        headers: {
          'User-Agent': userAgent || 'CivicSupportScrapers/1.0 (+hey@codefornorway.org)',
        },
        timeout,
        validateStatus: s => s >= 200 && s < 500, // retry on 5xx
      });

      if (status >= 200 && status < 300 && typeof data === 'string') return data;
      throw new Error(`HTTP ${status} or non-HTML response`);
    } catch (e) {
      lastErr = e;
      const wait = 800 * (attempt + 1); // linear backoff
      logger?.warn?.(`Retry in ${wait}ms → ${truncateUrl(url)} — ${e.message}`);
      await sleep(wait);
      attempt++;
    }
  }

  throw lastErr;
}
