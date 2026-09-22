#!/bin/bash
# The daily jobs round: read every source, then fetch the logo of any company that is new.
# Run from cron at 04:40 UTC (07:40 Addis) so the board is fresh before people look at it.
# Sources are paced inside jobs/harvest.js; this script only decides the order.
set -u
cd /var/www/connectcare/binasmart || exit 1
/usr/bin/node --env-file=.env jobs/harvest.js --all
# Logos, cheapest source first: the company's own website, then the advert it posted, then ethiojobs'
# company list. Each one only touches employers that still have no logo.
/usr/bin/node --env-file=.env jobs/fetch-logos.js
/usr/bin/node --env-file=.env jobs/logos-from-source.js
/usr/bin/node --env-file=.env jobs/logos-from-ethiojobs.js
# One vacancy, one entry - tidy anything the day's harvest duplicated.
/usr/bin/node --env-file=.env jobs/dedupe.js
# Tell Bing, Yandex and Seznam about the day's new vacancies (Google does not take IndexNow;
# for Google it is the sitemap and the category linking).
/usr/bin/node --env-file=.env ops/indexnow.js
