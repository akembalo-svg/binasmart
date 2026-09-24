#!/bin/sh
# Monthly refresh of the Addis places and government-office contacts (knowledge source "places").
#
#   ops/places/refresh.sh            cron: 30 0 1 * *  (00:30 UTC on the 1st, 03:30 Addis)
#
# It only regenerates files: the nightly 03:30 UTC knowledge/ingest.js run picks up whatever changed, so no
# second ingest schedule exists to drift. Each step is independent - a map server that is down this month
# must not stop the office contacts being read - and every generator refuses to write a mobile number.
# A new hospital or pharmacy mapped in OpenStreetMap reaches Bini within a month without anybody touching it.
cd "$(dirname "$0")/../.." || exit 1
echo "== places refresh $(date -u +%Y-%m-%dT%H:%MZ)"
node ops/places/osm-addis.js || echo "!! osm-addis failed"
node ops/places/office-contacts.js || echo "!! office-contacts failed"
node ops/places/office-contacts-md.js || echo "!! office-contacts-md failed"
# Employers listed since last month that match exactly one mapped place get an unconfirmed point.
node --env-file=.env ops/places/employer-osm.js --apply | grep -E "employers without|written" || echo "!! employer-osm failed"
echo "== done $(date -u +%Y-%m-%dT%H:%MZ)"
