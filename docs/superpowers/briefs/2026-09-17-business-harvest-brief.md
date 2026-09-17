# Business pack — manual harvest brief

**Date:** 2026-09-17 · **For:** whoever can reach these hosts. **Read `knowledge/business/sources.json` first.**

Three hosts in this pack answer neither the VPS in Paris nor a laptop in the UAE, and one answers both
with an empty shell. Each was probed five times per path on 2026-09-17, one host at a time, at least
5 seconds apart, keep-alive on, apex and `www.`.

| host | what it holds that we need | what is wrong |
| --- | --- | --- |
| `etrade.gov.et` | online trade registration and licensing, the **business licence checker**, the fee schedule, the renewal calendar | answers **200 with 45 KB** and extracts to **zero characters** from both machines. A client-rendered SPA. `/api/services` answers 405, so a JSON API exists |
| `ecc.gov.et` | the customs procedure: declaration, clearance, duty bands, franco valuta, Electronic Single Window | timeout on every path from both machines; `knowledge/web/ecc/` has been empty since 2026-09-08 |
| `eipo.gov.et` | trademark and patent registration: what to file, what it costs, how long it takes | timeout on every path from both machines |

## What a harvest must produce

One directory per host under `/root/storage/packs/business-manual/<host>/`, containing:

- **the raw bytes of each page, one file per URL** — for `etrade`, the **rendered DOM** (`document.documentElement.outerHTML`
  after the page settles), not the served shell; for the other two, the served bytes are fine;
- **`manifest.json`**, an array (or `{items: [...]}`), one entry per file:

      { "url": "https://ecc.gov.et/declaration",
        "status": 200,
        "contentType": "text/html",
        "sha256": "…",
        "capturedAt": "2026-09-20T08:14:03Z",
        "file": "declaration.html" }

- PDFs are welcome. They are selected only through the site's `allowPdf` list in the registry — **a list, never a pattern** —
  and each is capped at 60,000 characters of `pdftotext -layout` output.

## The rules the harvest must respect

1. **At least 5 seconds between requests to one host**, one request at a time, and a user agent that names
   BinaSmart and links `https://bina.et/support`.
2. **Read the host's own `robots.txt` first and obey it.** If it names `ClaudeBot`, `GPTBot` or `anthropic`
   the way `efda.gov.et` does, **stop and report** — the pack honours that and the registry gets
   `doNotFetch: true`, not a harvest.
3. **Nothing transactional.** No login page, no application form, no submission, no payment, no page that
   requires an account. The allow and deny lists in `knowledge/business/sources.json` are the rule; the
   harvest may bring more than they allow, because the importer applies them again, but it must never bring
   a page behind a login.
4. **No credentials of any kind** in the harvest, the manifest or the capture script.
5. **A scanned PDF is a photograph of paper.** Run `pdftotext -layout -q <file> -` first; **a file that yields
   zero characters goes to `/root/storage/packs/business-manual/<host>/ocr/` and is not imported.** It stays
   there until Ibrahim decides about OCR — the same open question §2.1 of the banking 15a report left for 58
   National Bank directives. Never invent text for one.
6. **Capture the day**, not the clock: `capturedAt` is when the bytes were read, and the importer writes that
   date onto the document.

## What to capture, in priority order

**`etrade.gov.et`** — the licence checker page and its result view; the registration and licensing service
pages; the fee schedule; the renewal rules; any published guideline or FAQ. **Not** a real licence lookup
for a real business, and **not** anything behind a login.

**`ecc.gov.et`** — the declaration procedure; clearance steps; the duty and tariff pages; franco valuta;
the Electronic Single Window pages; published directives and guidelines; the FAQ.

**`eipo.gov.et`** — trademark registration steps and fees; patent and utility-model registration; copyright
deposit; the forms list; the FAQ.

## How it is imported, once the bytes exist

    cd /var/www/connectcare/binasmart
    node ops/packs/fetch-pack.js --pack business --site ecc --from-dir /root/storage/packs/business-manual --dry-run
    node ops/packs/fetch-pack.js --pack business --site ecc --from-dir /root/storage/packs/business-manual

**Always pass `--from-dir` with its path.** `DIR_ROOT` in `fetch-pack.js` is hard-coded to
`/root/storage/packs/banking-manual`, so a bare `--from-dir` would import the banking harvest into
`knowledge/business/`.

Then flip that site's registry entry from `fetch: "manual"` to `fetch: "dir"`, add `dir: "<host>"`, keep the
`why` as a `historyNote` so the measurement is not lost, and re-run Tasks 8 to 13.
