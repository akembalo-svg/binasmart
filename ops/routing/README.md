# GraphHopper routing server (`gh-routing`)

Self-hosted routing engine for BinaSmart Ride. Replaces OSRM because the VPS
has no Docker (see the amendment in
`docs/superpowers/specs/2026-09-02-binasmart-ride-design.md` §3). Runs
**GraphHopper 10** on Java 21, a `car` profile with **turn costs** enabled
(real turn restrictions, e.g. no-U-turn, are respected in ETA/fare), and is
process-managed by pm2 with restart guards.

- App HTTP (routing API): `127.0.0.1:8989` — loopback only, not internet-facing.
- Admin HTTP: `127.0.0.1:8990` — loopback only.
- Health: `GET http://127.0.0.1:8989/health` and `GET http://127.0.0.1:8990/healthcheck`.
- Data on disk (not in git — large binaries): `/root/routing/` — the jar, the
  Ethiopia `.osm.pbf` extract, `config.yml` (mirrored here), and
  `graph-cache/` (the built graph).

## One-time setup on a fresh VPS

```sh
mkdir -p /root/routing && cd /root/routing

# GraphHopper 10 web jar
wget -q https://github.com/graphhopper/graphhopper/releases/download/10.0/graphhopper-web-10.0.jar

# Ethiopia OSM extract (Geofabrik redirects "latest" to the dated file transparently)
wget -q https://download.geofabrik.de/africa/ethiopia-latest.osm.pbf

# Config (this repo is the source of truth for it)
cp /var/www/connectcare/binasmart/ops/routing/config.yml /root/routing/config.yml

# Import the graph — needs ~3 GB heap; with turn costs on, expect several
# minutes (edge-based contraction hierarchies are much slower to build than
# node-based, especially the last few high-degree hub nodes).
cd /root/routing
java -Xmx3g -jar graphhopper-web-10.0.jar import config.yml

# Start under pm2 using the checked-in ecosystem file, then persist
pm2 start /var/www/connectcare/binasmart/ops/routing/ecosystem.config.js
pm2 save
```

## The rule that matters most

**Any change to `profiles`, `graph.encoded_values`, or `turn_costs` in
`config.yml` invalidates `graph-cache/`.** The on-disk graph encodes exactly
those settings; GraphHopper will refuse to serve (or silently misbehave) if
the config no longer matches what was imported.

After any such config change:

1. `pm2 stop gh-routing`
2. Delete the stale cache: `rm -rf /root/routing/graph-cache` (if your shell
   environment blocks `rm -rf` under `/root`, use
   `python3 -c "import shutil; shutil.rmtree('/root/routing/graph-cache')"`
   instead).
3. Re-import **before** touching pm2 again:
   `cd /root/routing && java -Xmx3g -jar graphhopper-web-10.0.jar import config.yml`
4. Only then restart the server: `pm2 restart gh-routing` (or `pm2 start
   ops/routing/ecosystem.config.js` if it isn't running).

Do the import first, with the full `-Xmx3g` heap, on the CLI. **Do not** just
restart the pm2 server against a missing/stale `graph-cache/` — the server
process runs with `-Xmx2g`, and an in-process import under that smaller heap
is more likely to OOM (which is exactly what `-XX:+ExitOnOutOfMemoryError`
and the pm2 restart guards exist to contain, not to make routine).

## Refreshing the map data

OSM data goes stale (new roads, closures). To refresh:

```sh
cd /root/routing
wget -q -O ethiopia-latest.osm.pbf.new https://download.geofabrik.de/africa/ethiopia-latest.osm.pbf
mv ethiopia-latest.osm.pbf.new ethiopia-latest.osm.pbf
pm2 stop gh-routing
python3 -c "import shutil; shutil.rmtree('/root/routing/graph-cache')"
java -Xmx3g -jar graphhopper-web-10.0.jar import config.yml
pm2 restart gh-routing
```

## pm2 process

Defined in `ecosystem.config.js` in this directory (mirrors the live
`gh-routing` app):

- `min_uptime: 60000`, `max_restarts: 10`, `restart_delay: 5000`,
  `max_memory_restart: '1500M'` — a crash-looping or leaking process gets a
  bounded number of restarts, spaced out, instead of hammering the VPS.
- `-XX:+ExitOnOutOfMemoryError` on the JVM — on OOM the process exits cleanly
  instead of limping along in a corrupted state, so pm2's restart logic (not
  a wedged JVM) decides what happens next.

Deploy/redeploy: `pm2 start ops/routing/ecosystem.config.js && pm2 save`.

## Route API example

```sh
curl -s "http://127.0.0.1:8989/route?point=9.0108,38.7578&point=8.9806,38.7900&profile=car&points_encoded=false&instructions=false" \
 | python3 -c "import sys,json;d=json.load(sys.stdin);p=d['paths'][0];print('distance m',round(p['distance']),'| time s',round(p['time']/1000),'| pts',len(p['points']['coordinates']))"
```

Returns `distance`, `time` (ms), and `points.coordinates` (the route
geometry) for the requested profile — the fields `ride/geo.js` (Task 1
consumer) needs for fare and ETA.
