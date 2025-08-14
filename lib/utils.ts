// @ts-nocheck
// lib/utils.ts
export const normSpace = s =>
  String(s || '')
    .replace(/\s+/g, ' ')
    .trim();

export const titleCase = s =>
  String(s || '')
    .toLowerCase()
    .replace(/(^|\s|-)\p{L}/gu, m => m.toUpperCase());

export function parsePath(base, url) {
  try {
    const u = new URL(url, base);
    const parts = u.pathname.split('/').filter(Boolean);
    const i = parts.indexOf('lokalforeninger'); // org-specific; adjust per scraper
    const rest = i >= 0 ? parts.slice(i + 1) : [];
    return {
      county: rest[0] || null,
      city: rest[1] || null,
      depthAfterBase: rest.length,
    };
  } catch {
    return { county: null, city: null, depthAfterBase: 0 };
  }
}

export function firstEmail(text) {
  const m = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}

export function firstLatLng(textOrHtml) {
  const m = String(textOrHtml || '').match(/\b([+-]?\d{1,2}\.\d{4,}),\s*([+-]?\d{1,3}\.\d{4,})\b/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng];
  return null;
}

export function getOgImage($, BASE) {
  const og = $('meta[property="og:image"]').attr('content') || null;
  if (og) {
    try {
      return new URL(og, BASE).href;
    } catch {
      return og;
    }
  }
  const firstImg = $('img').first().attr('src');
  return firstImg ? new URL(firstImg, BASE).href : null;
}
