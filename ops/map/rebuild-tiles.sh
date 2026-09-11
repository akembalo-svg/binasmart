#!/bin/bash
# Rebuild the Addis vector tiles from Protomaps' daily planet build.
#
# Why: the live map is a frozen snapshot. The file named addis-20260901.pmtiles was actually built on
# 2026-03-28 — the filename is not the build date — so Addis is being shown as it was five and a half
# months ago. New roads, new buildings and renamed streets do not appear. This is the one thing a paid
# map service genuinely does better than a self-hosted file, and the fix is to rebuild, not to start
# paying per map load.
#
# HOW, and why not the obvious way. The first version of this script used stock planetiler, which
# built successfully and produced a blank map: planetiler's default profile emits the OpenMapTiles
# schema (transportation, building) while our style.json expects the Protomaps schema (roads,
# buildings, earth, pois). Every layer name missed, so the map rendered nothing while every check
# short of looking at it passed.
#
# `pmtiles extract` avoids the whole class of problem by copying from the official Protomaps build
# rather than regenerating it: the schema is right because it IS the Protomaps basemap. It is also
# far cheaper — 56 range requests and about ten seconds, against an 89 MB jar, a full Ethiopia OSM
# download and a 4 GB heap.
#
#   bash ops/map/rebuild-tiles.sh [--dry-run]
# Cron: monthly, off-peak.
set -uo pipefail

ROOT=/var/www/connectcare/binasmart
MAPDIR=$ROOT/public/map
STYLE=$ROOT/public/ride/style.json
WORK=/root/storage/tilebuild
PMTILES=$WORK/pmtiles
STAMP=$(date +%Y%m%d)
OUT=$MAPDIR/addis-$STAMP.pmtiles
BUILD=$WORK/addis-$STAMP.pmtiles
DRY=${1:-}

# Matched to the file already in production, so the new one is a like-for-like replacement.
BBOX="38.55,8.75,39.10,9.25"
MAXZOOM=15
MIN_BYTES=7000000        # production file is 9.7 MB; anything near 7 means something is wrong

mkdir -p "$WORK" "$MAPDIR"
log() { echo "[tiles] $*"; }

alert() {
  node --env-file="$ROOT/.env" -e '
    const text = process.argv[1];
    const routes = [
      [process.env.BINA_DRIVER_BOT_TOKEN, "8825386029"],
      [process.env.BINASMART_TG_TOKEN, process.env.BINASMART_OPS_TG_CHAT || "8096525984"],
    ].filter(r => r[0] && r[1]);
    (async () => { for (const [t, c] of routes) {
      const r = await fetch("https://api.telegram.org/bot"+t+"/sendMessage", { method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: c, text }) }).catch(() => null);
      if (r && r.ok) return;
    } })();
  ' "$1" 2>/dev/null
}

CURRENT=$(grep -oE 'addis-[0-9]{8}\.pmtiles' "$STYLE" | head -1)
log "live now: ${CURRENT:-none}   building: addis-$STAMP.pmtiles"
[ "$CURRENT" = "addis-$STAMP.pmtiles" ] && { log "today's build is already live"; exit 0; }

if [ ! -x "$PMTILES" ]; then
  log "fetching the pmtiles CLI"
  curl -sL --max-time 300 -o "$WORK/p.tgz" \
    https://github.com/protomaps/go-pmtiles/releases/download/v1.22.1/go-pmtiles_1.22.1_Linux_x86_64.tar.gz \
    && tar xzf "$WORK/p.tgz" -C "$WORK" pmtiles && chmod +x "$PMTILES" \
    || { alert "🗺️ Addis tile rebuild FAILED: could not fetch the pmtiles CLI"; exit 1; }
fi

# Protomaps publishes daily; today's may not be up yet, so walk back until one answers.
SRC=""
for back in 1 2 3 4; do
  D=$(date -d "$back days ago" +%Y%m%d)
  if [ "$(curl -s -o /dev/null -w '%{http_code}' -r 0-99 -m 30 "https://build.protomaps.com/$D.pmtiles")" = "206" ]; then
    SRC="https://build.protomaps.com/$D.pmtiles"; log "source build: $D"; break
  fi
done
[ -z "$SRC" ] && { log "no Protomaps daily build reachable"; alert "🗺️ Addis tile rebuild FAILED: no Protomaps daily build reachable. Map unchanged."; exit 1; }

[ "$DRY" = "--dry-run" ] && { log "dry run — stopping before the extract"; exit 0; }

rm -f "$BUILD"
log "extracting the Addis window"
"$PMTILES" extract "$SRC" "$BUILD" --bbox="$BBOX" --maxzoom=$MAXZOOM >"$WORK/build.log" 2>&1
RC=$?
if [ $RC -ne 0 ] || [ ! -s "$BUILD" ]; then
  log "extract failed (rc=$RC)"; tail -4 "$WORK/build.log" | sed 's/^/    /'
  rm -f "$BUILD"; alert "🗺️ Addis tile rebuild FAILED (rc=$RC). Map unchanged, still on ${CURRENT}."
  exit 1
fi

SIZE=$(stat -c%s "$BUILD")
if [ "$SIZE" -lt "$MIN_BYTES" ]; then
  log "refusing: $SIZE bytes is too small"
  rm -f "$BUILD"; alert "🗺️ Addis tile rebuild REFUSED: new file only $((SIZE/1024/1024)) MB. Map unchanged."
  exit 1
fi

# The check that would have caught the blank map: the style expects the Protomaps schema, so the
# archive must actually BE the Protomaps basemap. A file with the wrong layer names renders nothing
# while passing every other test.
if ! "$PMTILES" show "$BUILD" 2>/dev/null | grep -q "Protomaps Basemap"; then
  log "refusing: not the Protomaps basemap schema — style.json would render a blank map"
  rm -f "$BUILD"
  alert "🗺️ Addis tile rebuild REFUSED: the new file is not the Protomaps basemap schema, which would have blanked the map. Map unchanged."
  exit 1
fi

mv "$BUILD" "$OUT"
log "built $(du -h "$OUT" | cut -f1), schema verified"

cp -p "$STYLE" "$STYLE.prev"
sed -i "s/addis-[0-9]\{8\}\.pmtiles/addis-$STAMP.pmtiles/" "$STYLE"
sleep 2
CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 30 -r 0-99 "https://bina.et/static/map/addis-$STAMP.pmtiles")
if [ "$CODE" != "206" ] && [ "$CODE" != "200" ]; then
  log "live check failed (HTTP $CODE) — rolling back"; mv "$STYLE.prev" "$STYLE"
  alert "🗺️ Addis tiles built but do not serve (HTTP $CODE). Rolled back; map unchanged."
  exit 1
fi
rm -f "$STYLE.prev"

ls -1t "$MAPDIR"/addis-*.pmtiles 2>/dev/null | tail -n +3 | while read -r old; do
  log "removing older build $(basename "$old")"; rm -f "$old"
done

log "done — live on addis-$STAMP.pmtiles (HTTP $CODE)"
alert "🗺️ Addis map updated: addis-$STAMP.pmtiles ($(du -h "$OUT" | cut -f1)) from the Protomaps build of $D. Previous kept for rollback."
