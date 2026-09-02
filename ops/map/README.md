# Self-hosted map assets (`public/map`, `public/vendor`)

Self-hosted map tiles, glyphs, and client library for BinaSmart Ride's rider
map. No CDN or third-party tile server dependency at runtime — everything
the browser needs is served from this app's own `/static/` path via
`@fastify/static`.

- **Vector tiles**: a bbox extract of the Protomaps daily basemap build,
  covering Addis Ababa, in PMTiles format (single-file archive, HTTP
  Range-addressable — no tile server process needed).
  `public/map/addis-<BUILD>.pmtiles` (currently `addis-20260901.pmtiles`).
- **Glyphs**: self-hosted PBF font ranges for MapLibre's text rendering,
  from `protomaps/basemaps-assets`, `fonts/Noto Sans Regular/` — includes
  the Ethiopic range so Amharic labels render as text, not boxes.
  `public/map/fonts/Noto Sans Regular/*.pbf`.
- **Client library**: MapLibre GL JS **4.7.1** + the `pmtiles` client
  **3.2.1**, vendored (not loaded from unpkg/jsdelivr at runtime).
  `public/vendor/maplibre-gl.js`, `public/vendor/maplibre-gl.css`,
  `public/vendor/pmtiles.js`.

## The rule that matters most

**Never overwrite a `.pmtiles` file in place.** `.pmtiles` gets a
`Cache-Control: public, max-age=2592000, immutable` response header (see
`server.js`'s `onSend` hook) so a browser (and any intermediate cache) that
has fetched byte ranges from `addis-20260901.pmtiles` will keep using those
bytes for up to 30 days regardless of what's on disk now — an in-place
overwrite silently serves stale tiles to already-loaded clients, or worse,
mixes old and new tile bytes across separate range requests.

Always:

1. Write a **new** versioned filename: `addis-<DATE>.pmtiles`.
2. Update the MapLibre style's `pmtiles://` URL to point at the new file
   (the style lives in the rider map task, not here).
3. Deploy.
4. Delete the old `.pmtiles` file **the next day** (once the 30-day
   immutable cache on the old URL is moot because nothing references it
   any more — the safety margin is for in-flight page loads, not for the
   cache lifetime itself).

## Refreshing the tile extract

```sh
# 1. Find the latest daily build key. NOTE: the documented
#    build.protomaps.com/builds.json endpoint 404s — the real
#    metadata feed (reverse-engineered from maps.protomaps.com/builds'
#    JS bundle) is build-metadata.protomaps.dev:
curl -s https://build-metadata.protomaps.dev/builds.json \
  | python3 -c "import sys,json;b=json.load(sys.stdin);print(sorted(x['key'] for x in b if x['key'].endswith('.pmtiles'))[-1])"
# -> e.g. 20260901.pmtiles

BUILD=20260901          # the key above, without .pmtiles
DATE=20260901           # today's date, or the build date — used in our filename

# 2. Extract just the Addis Ababa bbox from the full planet build
#    (the data URL itself IS still build.protomaps.com — only the
#    builds.json metadata listing moved):
cd /var/www/connectcare/binasmart
pmtiles extract "https://build.protomaps.com/$BUILD.pmtiles" \
  public/map/addis-$DATE.pmtiles --bbox=38.55,8.75,39.10,9.25

# 3. Verify before wiring it up (see Verification below), update the
#    style's pmtiles:// URL, deploy, restart:
pm2 restart binasmart-api

# 4. The next day, once nothing references the old file:
rm -f public/map/addis-<OLD_DATE>.pmtiles
git add -A public/map && git commit -m "chore(map): retire addis-<OLD_DATE>.pmtiles" && git push origin main
```

The `pmtiles` CLI must be installed (`/usr/local/bin/pmtiles`) — see
[go-pmtiles releases](https://github.com/protomaps/go-pmtiles/releases) if
it's missing on a fresh VPS.

### The 95 MB rule

GitHub rejects a single committed file ≥ 100 MB outright. Before committing
a fresh extract:

```sh
stat -c '%s bytes' public/map/addis-$DATE.pmtiles
```

If it's ≥ 95 MB, re-extract with a tighter `--bbox` or add `--maxzoom=15`
(each extra zoom level roughly doubles tile-storage size) until it's under
95 MB. The current file is ~10 MB (zoom 0–15, full bbox above) — there's a
lot of headroom before this becomes a real constraint for Addis Ababa
specifically.

## Verification

```sh
cd /var/www/connectcare/binasmart/public/map
pmtiles show addis-20260901.pmtiles
# -> tile type: mvt, min zoom: 0, max zoom: 15, addressed tiles count: 3277

# A known central-Addis tile (z15, x=19912, y=15560) should return real
# vector tile bytes, not an empty/near-empty response:
pmtiles tile addis-20260901.pmtiles 15 19912 15560 | wc -c
# -> ~20296 bytes
```

For glyphs, confirm the Ethiopic range actually has content (an empty/near-
empty file means Amharic labels will render as boxes — do not ship it):

```sh
stat -c '%s bytes' "public/map/fonts/Noto Sans Regular/4864-5119.pbf"
# -> ~125000 bytes (well over the ~1 KB "empty range" floor)
```

For the live app, confirm range requests and cache headers behave (see
`server.js`'s `onSend` hook — cache headers are only set on responses under
400, so a miss/416 never gets pinned in a client cache):

```sh
curl -sI http://127.0.0.1:4210/static/map/addis-20260901.pmtiles | grep -iE "HTTP|cache-control"
# -> 200, Cache-Control: public, max-age=2592000, immutable

curl -s -o /dev/null -w "range %{http_code} %{size_download}\n" \
  -H "Range: bytes=0-16383" http://127.0.0.1:4210/static/map/addis-20260901.pmtiles
# -> 206 16384

curl -sI "http://127.0.0.1:4210/static/map/fonts/Noto%20Sans%20Regular/4864-5119.pbf" | grep -iE "HTTP|cache-control"
# -> 200, Cache-Control: public, max-age=86400

curl -sI "http://127.0.0.1:4210/static/map/fonts/Noto%20Sans%20Regular/99999-100000.pbf" | grep -iE "HTTP|cache-control"
# -> 404, and NO Cache-Control max-age line (a miss is never cached)
```

## Glyph font — do not add a fallback stack

Only one font directory is self-hosted: `Noto Sans Regular` (from
`protomaps/basemaps-assets`, `fonts/Noto Sans Regular/`, 256 range files,
Ethiopic range `4864-5119.pbf` ≈ 125 KB). The MapLibre style **must**
reference exactly `["Noto Sans Regular"]` in every `text-font` — a fallback
stack like `["Noto Sans Regular", "Noto Sans Bold"]` will 404 on any glyph
range for the fonts that don't exist on disk (only `Regular` was vendored),
which either breaks label rendering for that range or silently falls back
to boxes depending on the MapLibre version's error handling. If a second
weight is ever needed, vendor its directory from the same
`basemaps-assets` repo first.

## Vendored client library

`public/vendor/maplibre-gl.js` had its `//# sourceMappingURL=...` comment
stripped (no `.map` file is shipped, so leaving it in just produces a 404
in devtools on every load — cosmetic, but noisy). If re-vendoring a newer
MapLibre version, repeat:

```sh
sed -i '/^\/\/# sourceMappingURL=maplibre-gl.js.map/d' public/vendor/maplibre-gl.js
```

## Licences

- **OpenStreetMap data** (the basemap content itself): Open Database
  License (ODbL) — attribution **must** be shown on the rendered map
  (e.g. a small "© OpenStreetMap contributors" control/link). This is a
  legal requirement of the licence, not optional styling.
- **MapLibre GL JS**: BSD 3-Clause.
- **pmtiles** (client + CLI): BSD 3-Clause.
- **Noto Sans** (glyphs): SIL Open Font License 1.1.
