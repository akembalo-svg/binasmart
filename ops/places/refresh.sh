#!/bin/sh
# Monthly refresh of the Addis places and government-office contacts (knowledge source "places").
#
#   ops/places/refresh.sh            cron: 30 0 1 * *  (00:30 UTC on the 1st, 03:30 Addis)
#
# Map data comes from the Geofabrik Ethiopia extract (one file, rebuilt daily), read on this server by
# ops/places/pbf-addis.py - not from the public Overpass servers, which were overloaded by day and whose mirror
# served four-month-old data on 25 September 2026. It regenerates files only: the nightly 03:30 UTC
# knowledge/ingest.js run indexes whatever changed, and ride/gazetteer.js reloads the city file by itself.
# Each step is independent; every generator refuses to write a mobile number.
cd "$(dirname "$0")/../.." || exit 1
PBF=/root/storage/osm/ethiopia-latest.osm.pbf
echo "== places refresh $(date -u +%Y-%m-%dT%H:%MZ)"
mkdir -p /root/storage/osm
# -R keeps the server's date (the extract's real age); -z downloads only when there is a newer one.
curl -sfL -R -z "$PBF" -o "$PBF.new" https://download.geofabrik.de/africa/ethiopia-latest.osm.pbf && [ -s "$PBF.new" ] && mv "$PBF.new" "$PBF"
rm -f "$PBF.new"
/root/storage/osm-venv/bin/python ops/places/pbf-addis.py --pbf "$PBF" --out /root/storage/osm-addis-latest.json \
  && node ops/places/osm-addis.js --from /root/storage/osm-addis-latest.json || echo "!! map refresh failed"
node ops/places/office-contacts.js || echo "!! office-contacts failed"
node ops/places/office-contacts-md.js || echo "!! office-contacts-md failed"
# Employers listed since last month that match exactly one mapped place get an unconfirmed point.
node --env-file=.env ops/places/employer-osm.js --apply | grep -E "employers without|written" || echo "!! employer-osm failed"
# Wikidata's Addis hotels (CC0) for the hotel directory; a failed fetch keeps last month's file.
node ops/places/wikidata-hotels.js || echo "!! wikidata-hotels failed"
echo "== done $(date -u +%Y-%m-%dT%H:%MZ)"
