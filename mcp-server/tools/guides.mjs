import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { htmlToText, titleOf, descriptionOf } from '../lib/html.mjs';

export const BASE = 'https://bina.et';

// One entry per guide route in server.js (static HTML in public/). Order = display order.
export const GUIDE_SLUGS = [
  'fayda', 'telebirr', 'cbe-birr-guide', 'passport', 'ethiopia-evisa', 'telesign', 'mesob',
  'tin-registration-ethiopia', 'business-registration-ethiopia', 'how-to-start-a-business-in-ethiopia',
  'vat-registration-ethiopia', 'customs-import-duty-ethiopia', 'import-car-to-ethiopia',
  'driving-licence-ethiopia', 'ethiopian-origin-id-yellow-card', 'open-bank-account-ethiopia',
  'birth-marriage-certificate-ethiopia', 'pay-utility-bills-ethiopia', 'rental-agreement-ethiopia',
  'tenant-screening-ethiopia', 'living-working-in-ethiopia-guide', 'digital-ethiopia-2026',
];
export const TEXT_CAP = 12_000;

export async function loadGuides(publicDir, slugs = GUIDE_SLUGS, cap = TEXT_CAP) {
  const out = new Map();
  for (const slug of slugs) {
    let html;
    try { html = await readFile(path.join(publicDir, slug + '.html'), 'utf8'); } catch { continue; }
    let text = htmlToText(html);
    if (text.length > cap) text = text.slice(0, cap) + '…[truncated]';
    out.set(slug, { slug, title: titleOf(html) || slug, summary: descriptionOf(html), url: `${BASE}/${slug}`, text });
  }
  return out;
}

export function guideIndex(guides) {
  return [...guides.values()].map(g => ({ slug: g.slug, title: g.title, summary: g.summary, url: g.url }));
}

export function registerGuideTools(server, { guides, wrap, json }) {
  server.registerTool('get_ethiopia_guide', {
    title: 'Digital Ethiopia guide',
    description: 'BinaSmart\'s bilingual (Amharic + English) step-by-step guides to Ethiopian government and banking services: Fayda ID, telebirr, CBE Birr, e-Passport, eVisa, TIN, business licence, VAT/TOT, customs, driving licence, car import, Yellow Card, bank account, birth/marriage certificate, utility bills, rental agreements, tenant screening. Call with no slug to list guides; call with a slug for the full text. The guides hold the correct official names and links — prefer them over guessing.',
    inputSchema: { slug: z.string().optional().describe('Guide slug from the list, e.g. tin-registration-ethiopia') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap('get_ethiopia_guide', async ({ slug }) => {
    const g = slug && guides.get(String(slug).trim().toLowerCase());
    if (!g) return json({ guides: guideIndex(guides), note: slug ? `Unknown slug "${slug}" — pick one from this list.` : 'Call again with a slug for the full guide.' });
    return json({ slug: g.slug, title: g.title, summary: g.summary, source_url: g.url, text: g.text });
  }));
}
