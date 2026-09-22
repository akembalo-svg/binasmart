# Telecom pack: laptop harvest tooling

The telecom knowledge pack (`knowledge/telecom`, source `telecom`) is a hand harvest. `ethiotelecom.et` does not
answer the server (its host times out) and `eca.et` is flaky for large PDFs, so the pages are fetched on a laptop,
shipped to the server, verified by SHA-256 there and only then built into documents. `safaricom.et` does answer the
server, but its pages were harvested the same way so that the three sites share one set of bytes on disk; the weekly
job compares its live pages with the harvest and reports a difference (see "The weekly job" below).

Everything here is Python 3 standard library only (no `requests`, no `pip install`). It runs on Windows, macOS or
Linux. Nothing in this folder contains a server address, a user name, a password or a key: the server is named by
an environment variable and there is no default.

| file | what it does |
|---|---|
| `common.py` | the polite fetcher (`Fetcher`): 5 s pacing, one kept-alive connection per host, retry, resume, manifest |
| `recon_fetch.py` | fetch one URL into `out/_recon/` to look at it (robots.txt, sitemaps) |
| `eca_rest_index.py` | list the regulator's WordPress pages, posts and PDF uploads into `out/_recon/eca_rest.json` |
| `eca_rest_save.py` | save the regulator's three REST indexes into its harvest folder |
| `crawl_tel.py` | the crawl: `python crawl_tel.py ethio|safaricom|eca` |
| `finalize_tel.py` | de-duplicate, set language and kind, write `manifest.json`, `sums.txt` and the folder's `README.md` |
| `ship_tel.py` | send one host folder to the server over ssh (base64 on stdin, no scp), resumable |
| `verify_tel.py` | check every shipped file's SHA-256 on the server against the manifest |

Output goes to `out/telecom/<host>/` next to these scripts (git-ignored). Raw bytes are named
`<sha1-of-url>.<ext>`; `manifest.json` maps them to URL, status, content type, bytes, sha256, fetchedAt, title,
language and kind.

## Before you start

1. Read each site's `robots.txt` yourself: `python recon_fetch.py https://www.ethiotelecom.et/robots.txt` (and
   `www.eca.et`, `www.safaricom.et`). The crawler does **not** fetch or interpret `robots.txt`; it skips the
   sections named in `DENY_COMMON` in `crawl_tel.py` (press, careers, tenders, news, login and so on) and that is
   the whole of its politeness policy apart from the pacing. If a site's robots.txt forbids something the crawler
   would fetch, add it to `DENY_COMMON` before you run.
2. Fetch the sitemaps you will seed from: `python recon_fetch.py https://www.safaricom.et/sitemap.xml` writes
   `out/_recon/www.safaricom.et_sitemap.xml`, which the Safaricom crawl reads. For the regulator run
   `python eca_rest_index.py` first; it writes `out/_recon/eca_rest.json`, which seeds the ECA crawl.
3. Use your normal connection and a normal working day. The user agent is
   `Mozilla/5.0 (Windows NT 10.0; Win64; x64) BinaSmart-research (+https://bina.et)`: it says who is asking.

## Run it

```
cd ops/harvest/telecom
python crawl_tel.py safaricom        # 25-30 pages, a few minutes
python crawl_tel.py eca              # the regulator: pages, posts and PDFs
python crawl_tel.py ethio            # the big one: up to 700 pages, well over an hour at 5 s a page
python finalize_tel.py www.safaricom.et
python finalize_tel.py www.eca.et
python finalize_tel.py www.ethiotelecom.et
```

What the crawler does, and why:

- **Pacing.** One request every 5 seconds per host (`Fetcher(delay=5.0)`), never in parallel to the same host.
- **Keep-alive.** `persistent=True`: one connection per host is reused. `ethiotelecom.et` times out on roughly half
  of NEW TCP connections but is fast and reliable over a kept-alive one, which is why the harvest is done from a
  laptop that can hold the connection open. A failed request is retried once on a fresh connection.
- **Resume.** Every saved page is appended to `manifest.jsonl` as it is saved. Stop the crawl at any time (Ctrl-C,
  a closed lid) and run the same command again: `resume()` re-adopts everything already on disk and only fetches
  what is missing. Failed URLs are retried, saved ones are not fetched twice.
- **Soft-404 guard.** Both sites answer HTTP 200 for pages that do not exist. Safaricom returns the text
  `Page data not found`; Ethio telecom returns its home page for an unknown path. The crawler recognises both
  (the marker text, and a body that matches the home page's hash or size and title), records the URL as a
  failure (`soft-404`) and saves nothing. The list is written to `soft404.json`.
- **Stop rule.** Ten consecutive failures abort the crawl: a site that has started refusing you is not asked again.
- **Scope.** `crawl_tel.py ethio` skips pages already held by the banking harvest when
  `out/www.ethiotelecom.et/manifest.jsonl` (that harvest's manifest) is present, so the two packs do not hold the
  same page twice; without that folder nothing is skipped. Only `en` and `am` (`?lang=am`) views are followed for Ethio telecom; other host names are never
  followed. Files over 25 MB are skipped. Oromo, Somali and Tigrinya pages that were picked up early are kept but
  are not part of the pack.

## Ship it and check it

```
export BINA_SERVER=user@host            # the server that receives the harvest; there is NO default
python ship_tel.py www.eca.et            # repeat until it prints "remaining 0"
python ship_tel.py www.safaricom.et
python ship_tel.py www.ethiotelecom.et
python verify_tel.py www.eca.et www.safaricom.et www.ethiotelecom.et
```

On Windows PowerShell: `$env:BINA_SERVER = "user@host"`.

`ship_tel.py` sends files through `ssh` (key-based login must already work: it runs with `BatchMode=yes`, so it never
asks for a password), five at a time, gzip and base64 on stdin. Each call works for at most about 100 seconds, so
run it again until nothing is left; it compares the remote file sizes first and sends only what is missing or
short. Files land in `/root/storage/packs/telecom-manual/<host>/`; set `BINA_REMOTE_DIR` to put them somewhere else.

`verify_tel.py` recomputes SHA-256 on the server for every file in the manifest and prints
`verified=N mismatched=0 missing=0 extra=0 ancillary_ok=4/4` per host. Do not build the pack from a host that shows
anything other than that.

## Build the pack (on the server)

Run these on the server, from the repository root, one at a time, and read the dry run before the real one:

```
python3 ops/packs/telecom-registry.py                # rebuild knowledge/telecom/sources.json from the manifests
node ops/packs/fetch-pack.js --pack telecom --from-dir /root/storage/packs/telecom-manual --dry-run
node ops/packs/fetch-pack.js --pack telecom --from-dir /root/storage/packs/telecom-manual
node --env-file=.env ops/packs/am-headers.js --pack telecom --only-missing     # Amharic titles for new English pages
node --env-file=.env knowledge/ingest.js --source telecom
```

`fetch-pack.js` has no `--help`; every option is read from its source (see the comment above `main`). A run of
`--from-dir` builds only the `fetch: "dir"` sites, and refuses to run when the harvest records a relaxed TLS
handshake the registry does not declare. A PDF with no text layer (Regulation 585/2026 was one) is read on the
server by `ops/packs/ocr-pdfs.py`; read that script's header before running it. Afterwards run `node --test test/telecom/*.test.js`.

## The weekly job

`ops/packs/freshness.js --pack telecom` never fetches Ethio telecom or the regulator. Once a month (the run whose
day of the month is 1 to 7, so the first Sunday) it sends one note: the pack is manual, re-harvest from the
laptop, and how old the harvest is. Every run it also fetches the Safaricom pages, five seconds apart, and compares
the text the pack's own reader takes from the live page with the text it takes from the harvested bytes; a page that
reads differently, or now answers "not found", is named in the note. It never rewrites a page: a difference means
run the steps above, read the diff, and rebuild.
