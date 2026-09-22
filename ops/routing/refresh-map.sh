#!/bin/bash
# Refresh the Ethiopia map the router drives on.
#
#   ops/routing/refresh-map.sh --check     download and inspect only; touches nothing live
#   ops/routing/refresh-map.sh             full refresh: import, restart, verify, roll back on failure
#
# GraphHopper routes on an OpenStreetMap extract (/root/routing/ethiopia-latest.osm.pbf). OSM improves
# daily - new roads, corrected one-ways, closed streets - and none of it reaches a rider until the file
# is replaced and the graph rebuilt. Without this the map slowly drifts away from Addis as it is.
#
# Why it runs at night: rebuilding the graph stops the router for several minutes. 02:30 Addis is the
# quietest hour; a rider quoting a fare at that moment would otherwise get an error.
#
# The safety rules, in order of how badly they bite:
#   1. A partial or truncated download must never replace a working map. The new file has to be at
#      least 80% of the size of the one in use, or it is thrown away.
#   2. The old .pbf AND the old graph-cache are kept until the new router answers a real Addis route.
#   3. If the new graph cannot route Bole -> Piassa, everything is put back and the owner is told.
set -uo pipefail

SRC="https://download.geofabrik.de/africa/ethiopia-latest.osm.pbf"
DIR="/root/routing"
PBF="$DIR/ethiopia-latest.osm.pbf"
CACHE="$DIR/graph-cache"
KEEP="$DIR/previous"
TMP="$DIR/new.osm.pbf"
PORT=8989
# Bole (Medhanialem) -> Piassa. A route that has always existed; if this fails the graph is wrong.
TEST="point=8.9950,38.7870&point=9.0350,38.7500&profile=car"
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

say() { printf '%s\n' "$*"; }

tell_owner() {
  local text="$1"
  local tok="${BINASMART_TG_TOKEN:-}" chat="${BINA_OWNER_TG_CHAT:-}"
  [ -z "$tok" ] && tok=$(grep -oP '^BINASMART_TG_TOKEN=\K.*' /var/www/connectcare/binasmart/.env 2>/dev/null)
  [ -z "$chat" ] && chat=$(grep -oP '^BINA_OWNER_TG_CHAT=\K.*' /var/www/connectcare/binasmart/.env 2>/dev/null)
  [ -z "$tok" ] || [ -z "$chat" ] && return 0
  curl -s -m 20 -X POST "https://api.telegram.org/bot$tok/sendMessage" \
    -H 'content-type: application/json' \
    -d "$(printf '{"chat_id":"%s","text":%s,"parse_mode":"HTML"}' "$chat" "$(printf '%s' "$text" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")" >/dev/null || true
}

routes_ok() {
  local code
  code=$(curl -s -o /dev/null -m 25 -w '%{http_code}' "http://127.0.0.1:$PORT/route?$TEST")
  [ "$code" = "200" ]
}

OLD_SIZE=$(stat -c%s "$PBF" 2>/dev/null || echo 0)
OLD_DATE=$(stat -c%y "$PBF" 2>/dev/null | cut -d' ' -f1)
say "[map] in use: $(numfmt --to=iec "$OLD_SIZE" 2>/dev/null || echo "$OLD_SIZE") from $OLD_DATE"

say "[map] downloading the current Ethiopia extract…"
if ! curl -sSL --fail -m 3600 -o "$TMP" "$SRC"; then
  say "[map] download failed — nothing changed"
  [ "$CHECK_ONLY" = 1 ] || tell_owner "🗺️ <b>Map refresh failed</b>%0AThe download did not complete. The router is untouched and still working."
  rm -f "$TMP"; exit 1
fi

NEW_SIZE=$(stat -c%s "$TMP")
say "[map] downloaded: $(numfmt --to=iec "$NEW_SIZE" 2>/dev/null || echo "$NEW_SIZE")"

# Rule 1: a truncated file must never replace a working map.
if [ "$OLD_SIZE" -gt 0 ] && [ "$NEW_SIZE" -lt $((OLD_SIZE * 80 / 100)) ]; then
  say "[map] REFUSED: the new file is smaller than 80% of the one in use — treating it as truncated"
  [ "$CHECK_ONLY" = 1 ] || tell_owner "🗺️ <b>Map refresh refused</b>%0AThe downloaded file looked truncated, so it was thrown away. The router still uses the old map."
  rm -f "$TMP"; exit 1
fi

if [ "$CHECK_ONLY" = 1 ]; then
  say "[map] --check: file looks sound. Nothing was replaced, the router was not touched."
  rm -f "$TMP"
  exit 0
fi

mkdir -p "$KEEP"
say "[map] keeping the working map and graph in $KEEP"
rm -rf "$KEEP/graph-cache" "$KEEP/ethiopia-latest.osm.pbf"
cp -p "$PBF" "$KEEP/ethiopia-latest.osm.pbf" 2>/dev/null || true
mv "$CACHE" "$KEEP/graph-cache" 2>/dev/null || true

mv "$TMP" "$PBF"
say "[map] importing — the router is down for a few minutes"
pm2 restart gh-routing >/dev/null 2>&1

# GraphHopper rebuilds the graph on start; give it time before judging it.
for i in $(seq 1 60); do
  sleep 20
  if routes_ok; then
    say "[map] router answering after $((i * 20))s"
    rm -rf "$KEEP/graph-cache" "$KEEP/ethiopia-latest.osm.pbf"
    tell_owner "🗺️ <b>Map updated</b>%0AEthiopia map refreshed ($OLD_DATE → today) and the router is answering normally."
    exit 0
  fi
done

say "[map] the new graph does not route — putting the old map back"
pm2 stop gh-routing >/dev/null 2>&1
rm -rf "$CACHE"
mv "$KEEP/graph-cache" "$CACHE" 2>/dev/null || true
cp -p "$KEEP/ethiopia-latest.osm.pbf" "$PBF" 2>/dev/null || true
pm2 restart gh-routing >/dev/null 2>&1
sleep 40
if routes_ok; then
  tell_owner "🗺️ <b>Map refresh failed — old map restored</b>%0AThe new map would not route, so the previous one is back and ride is working. Nothing for you to do."
else
  tell_owner "🚨 <b>Router not answering after a map refresh</b>%0AThe old map was restored but the router is still not routing. Ride fares will fail until this is looked at."
fi
exit 1
