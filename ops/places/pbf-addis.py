#!/usr/bin/env python3
"""Every named place and street in Addis Ababa, from the Geofabrik Ethiopia extract - no Overpass.

    /root/storage/osm-venv/bin/python ops/places/pbf-addis.py [--pbf /root/storage/osm/ethiopia-latest.osm.pbf]
                                                             [--out /root/storage/osm-addis-latest.json]

Why: the public Overpass servers are overloaded by day (25 September 2026: runtime errors, 504s, and a mirror
serving map data from 31 May). download.geofabrik.de publishes the whole country as one file, rebuilt daily
(140 MB). This reads it on our own server with pyosmium and writes the SAME JSON osm-addis.js and
ride/gazetteer.js already read - {at, elements:[{type,id,lat,lon|center,tags}], bySub:{typeid: sub-city}} - so
nothing downstream changes. Kept: every element with a name inside the Addis Ababa boundary (relation 1707699),
and its sub-city from the ten sub-city boundaries (point-in-polygon, not a query per sub-city).
"""
import argparse, json, os, sys, time
import osmium
import shapely.wkb as wkblib
from shapely.geometry import Point
from shapely.prepared import prep

ap = argparse.ArgumentParser()
ap.add_argument('--pbf', default='/root/storage/osm/ethiopia-latest.osm.pbf')
ap.add_argument('--out', default='/root/storage/osm-addis-latest.json')
a = ap.parse_args()

CITY = 1707699
SUBS = {11589433: 'Arada', 11589457: 'Bole', 11589481: 'Addis Ketema', 11589495: 'Kirkos', 11589562: 'Gulele',
        11589571: 'Lideta', 11589590: 'Yeka', 11589616: 'Nifas Silk-Lafto', 11589637: 'Akaki Kality', 11589660: 'Kolfe Keranio'}
BBOX = (8.80, 9.12, 38.60, 38.92)          # generous box around the city; the polygon decides
wkbf = osmium.geom.WKBFactory()
inbox = lambda lat, lon: BBOX[0] < lat < BBOX[1] and BBOX[2] < lon < BBOX[3]
KEEP = ('name', 'name:en', 'name:am', 'alt_name', 'old_name', 'short_name', 'amenity', 'shop', 'office', 'tourism', 'leisure',
        'place', 'craft', 'healthcare', 'public_transport', 'highway', 'building', 'railway', 'historic', 'man_made',
        'religion', 'denomination', 'cuisine', 'operator', 'phone', 'contact:phone', 'website', 'contact:website',
        'opening_hours', 'addr:street', 'addr:housenumber', 'addr:suburb', 'addr:neighbourhood', 'stars', 'brand')
def tags(o):
    return {k: v for k, v in ((t.k, t.v) for t in o.tags) if k in KEEP}

# Pass 1: the city and sub-city boundaries.
class Bounds(osmium.SimpleHandler):
    def __init__(self):
        super().__init__(); self.polys = {}
    def area(self, ar):
        if ar.from_way(): return
        rid = ar.orig_id()
        if rid == CITY or rid in SUBS:
            try: self.polys[rid] = wkblib.loads(wkbf.create_multipolygon(ar), hex=True)
            except Exception as e: print('boundary', rid, 'failed:', e, file=sys.stderr)
t0 = time.time()
b = Bounds(); b.apply_file(a.pbf, locations=True, idx='flex_mem')
if CITY not in b.polys: sys.exit('Addis Ababa boundary not found in the extract')
city = prep(b.polys[CITY]); subs = {SUBS[r]: prep(p) for r, p in b.polys.items() if r in SUBS}
print('boundaries: city + %d sub-cities (%.0fs)' % (len(subs), time.time() - t0))

def subOf(pt):
    for n, p in subs.items():
        if p.contains(pt): return n
    return None

out, bySub = [], {}
def keep(kind, oid, lat, lon, tg, as_center):
    if not inbox(lat, lon): return
    pt = Point(lon, lat)
    if not city.contains(pt): return
    e = {'type': kind, 'id': oid, 'tags': tg}
    if as_center: e['center'] = {'lat': round(lat, 7), 'lon': round(lon, 7)}
    else: e['lat'] = round(lat, 7); e['lon'] = round(lon, 7)
    out.append(e)
    s = subOf(pt)
    if s: bySub[kind + str(oid)] = s

# Pass 2: every named node, way (its centre) and multipolygon relation (its centre).
class Named(osmium.SimpleHandler):
    def node(self, n):
        if 'name' not in n.tags and 'name:en' not in n.tags: return
        if not n.location.valid(): return
        keep('node', n.id, n.location.lat, n.location.lon, tags(n), False)
    def way(self, w):
        if 'name' not in w.tags and 'name:en' not in w.tags: return
        try:
            g = wkblib.loads(wkbf.create_linestring(w), hex=True)
            c = g.representative_point() if not g.is_closed else g.centroid
        except Exception: return
        keep('way', w.id, c.y, c.x, tags(w), True)
    def area(self, ar):
        if ar.from_way(): return
        if 'name' not in ar.tags and 'name:en' not in ar.tags: return
        try: c = wkblib.loads(wkbf.create_multipolygon(ar), hex=True).representative_point()
        except Exception: return
        keep('relation', ar.orig_id(), c.y, c.x, tags(ar), True)
Named().apply_file(a.pbf, locations=True, idx='flex_mem')

stamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(os.path.getmtime(a.pbf)))
tmp = a.out + '.tmp'
json.dump({'at': stamp, 'source': 'geofabrik ethiopia-latest.osm.pbf', 'elements': out, 'bySub': bySub}, open(tmp, 'w'), ensure_ascii=False)
os.replace(tmp, a.out)
print('named elements in Addis: %d · with a sub-city: %d · extract of %s · %.0fs' % (len(out), len(bySub), stamp, time.time() - t0))
