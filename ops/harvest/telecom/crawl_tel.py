"""Generic polite BFS crawl for the telecom pack. usage: crawl_tel.py <cfg>"""
import hashlib, json, os, re, sys, time, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import Fetcher, links, title_of

BASE = os.path.dirname(os.path.abspath(__file__))
CFG = sys.argv[1]

DENY_COMMON = re.compile(
    r"(/press|/news|/event|/career|/job|/vacanc|/tender|/investor|/annual-|/csr|/esg|/history|"
    r"/gallery|/logos|/feed|/comments|\?s=|/wp-admin|/wp-login|/wp-json|/xmlrpc|/author/|/tag/|"
    r"/category/|/supply-chain|/corruption|/login|/signin|/cart|/checkout|/my-account|"
    r"/m-?pesa|mpesa|ethio-telecom-(launch|announc|sign|celebrat|inaugur|partner|unveil|hand|win|award|rural|telestream|pay|resume|hold|host|take|reach|expand|introduc|deploy|conclud)|-launches-|/20\d\d/\d\d/|replytocom|/blog|/media-center|/sustainab|/about-us/leadership)", re.I)
ASSET = re.compile(r"\.(jpg|jpeg|png|gif|svg|webp|ico|css|js|woff2?|ttf|eot|mp4|mp3|avi|zip|rar|json|xml)(\?|$)", re.I)
DOCEXT = re.compile(r"\.(pdf|docx?|xlsx?)(\?|$)", re.I)

CONFIGS = {
 "ethio": dict(
    host="www.ethiotelecom.et", langs=["am"], maxdepth=3, maxpages=700,
    seeds=["https://www.ethiotelecom.et/", "https://www.ethiotelecom.et/site-map/",
           "https://www.ethiotelecom.et/faq/", "https://www.ethiotelecom.et/mobile-packages/",
           "https://www.ethiotelecom.et/esim/", "https://www.ethiotelecom.et/international-roaming/",
           "https://www.ethiotelecom.et/contact-us/", "https://www.ethiotelecom.et/4gcoverage/"],
    hosts_ok=("www.ethiotelecom.et", "ethiotelecom.et"),
    skip_existing="out/www.ethiotelecom.et/manifest.jsonl"),
 "safaricom": dict(
    host="www.safaricom.et", langs=[], maxdepth=3, maxpages=300,
    seeds=["https://www.safaricom.et/"], hosts_ok=("www.safaricom.et", "safaricom.et"),
    skip_existing="out/www.safaricom.et/manifest.jsonl"),
}
def _eca_seeds():
    r = json.load(open(os.path.join(BASE, "out", "_recon", "eca_rest.json"), encoding="utf-8"))
    out = ["https://www.eca.et/"]
    for k in ("pages", "posts"):
        out += [x["link"] for x in r[k]]
    out += [x["source_url"] for x in r["media"]]
    return out
CONFIGS["eca"] = dict(host="www.eca.et", langs=[], maxdepth=2, maxpages=300, seeds=_eca_seeds(),
                      hosts_ok=("www.eca.et", "eca.et"), skip_existing=None)
def _saf_seeds():
    import re as _re
    x = open(os.path.join(BASE, "out", "_recon", "www.safaricom.et_sitemap.xml"), encoding="utf-8").read()
    out = []
    for u in _re.findall(r"<loc>([^<]+)</loc>", x):
        u = u.replace("https://safaricom.et", "https://www.safaricom.et").rstrip("/")
        if _re.search(r"/(careers|investor|tenders|work-with-us|leadership|media-center|financial|test)", u):
            continue
        out.append(u)
    out += ["https://www.safaricom.et/en/personal/getting-started/get-sim-card"]
    return out
CONFIGS["safaricom"] = dict(host="www.safaricom.et", langs=[], maxdepth=2, maxpages=200, seeds=_saf_seeds(),
                            hosts_ok=("www.safaricom.et", "safaricom.et"), skip_existing=None, slash=False,
                            soft_marker=b"Page data not found")
C = CONFIGS[CFG]
HOST = C["host"]
OUT = os.path.join(BASE, "out", "telecom", HOST)


def canon(u):
    u = u.split("#")[0]
    p = urllib.parse.urlparse(u)
    if p.netloc not in C["hosts_ok"]:
        return None
    path = p.path or "/"
    if C.get("slash", True) and not path.endswith("/") and "." not in path.split("/")[-1]:
        path += "/"
    q = "&".join(kv for kv in p.query.split("&") if kv.split("=")[0].lower() == "lang" and kv.split("=")[-1] in C["langs"] + ["Tig"][:0])
    return urllib.parse.urlunparse(("https", HOST, path, "", q, ""))


def wanted(u):
    p = urllib.parse.urlparse(u)
    t = urllib.parse.unquote(p.path + ("?" + p.query if p.query else ""))
    if DOCEXT.search(p.path):
        return True
    if ASSET.search(p.path):
        return False
    if DENY_COMMON.search(t):
        return False
    return True


KINDS = [("sim", "sim|esim|number-port|portab|registration"), ("roaming", "roam|international"),
         ("faq", "faq|frequently|help|how-to|getting-started|guide"), ("tariff", "tariff|price|pricing|rate"),
         ("package", "package|offer|bundle|airtime|top-up|data|voice|sms|plan|recharge"),
         ("coverage", "coverage|4g|5g|network"),
         ("legal", "terms|condition|policy|privacy|law|regulat|proclamation|directive|complaint|rights|consumer"),
         ("internet", "fixed|broadband|ftth|internet|wifi"),
         ("business", "business|enterprise|corporate|vpn|cloud|solution|vas"),
         ("contact", "contact|shop|store|center|centre|branch")]


def kind_of(url, title):
    s = (urllib.parse.unquote(url) + " " + (title or "")).lower()
    for k, rx in KINDS:
        if re.search(rx, s):
            return k
    return "other"


def main():
    os.makedirs(OUT, exist_ok=True)
    f = Fetcher(HOST, OUT, delay=5.0, persistent=True)
    f.log("=== START %s telecom harvest ===" % HOST)
    f.resume()
    have = set()
    sk = C.get("skip_existing")
    if sk and os.path.exists(os.path.join(BASE, sk)):
        for l in open(os.path.join(BASE, sk), encoding="utf-8"):
            try:
                e = json.loads(l)
                if e.get("file"):
                    have.add(canon(e["url"]) or e["url"])
            except Exception:
                pass
    f.log("already-held elsewhere (banking pack): %d" % len(have))
    fp = {}
    for lg, u in [("en", "https://%s/" % HOST)] + [(l, "https://%s/?lang=%s" % (HOST, l)) for l in C["langs"]]:
        st, ct, b = f.get(u)
        if b:
            fp[lg] = (hashlib.sha256(b).hexdigest(), len(b), title_of(b))
            f.log("HOME[%s] len=%d title=%s" % (lg, len(b), fp[lg][2]))

    def home_like(body, lg):
        x = fp.get(lg)
        if not x or C.get("soft_marker"):
            return False
        if hashlib.sha256(body).hexdigest() == x[0]:
            return True
        return abs(len(body) - x[1]) < 400 and title_of(body) == x[2]

    soft = []
    queue = []
    qs = set()
    depth = {}

    def push(u, d):
        c = canon(u)
        if not c or c in qs or not wanted(c):
            return
        qs.add(c)
        queue.append(c)
        depth[c] = d

    for s in C["seeds"]:
        push(s, 0)
    for s in list(queue):
        for lg in C["langs"]:
            push(s + ("&" if "?" in s else "?") + "lang=" + lg, 0)
    i = 0
    last_prog = time.time()
    skipped_have = 0

    def nsaved():
        return len([1 for e in f.manifest if e.get("file")])

    while i < len(queue) and nsaved() < C["maxpages"]:
        if f.stop():
            f.log("ABORT: 10 consecutive failures")
            break
        u = queue[i]
        i += 1
        d = depth[u]
        if u in have:
            skipped_have += 1
            continue
        cached = next((e for e in f.manifest if e.get("url") == u and e.get("file")), None)
        if cached:
            body = open(os.path.join(OUT, cached["file"]), "rb").read()
            ctype = cached["contentType"]
        else:
            if u in f.seen:
                continue
            f.seen.add(u)
            is_doc = bool(DOCEXT.search(urllib.parse.urlparse(u).path))
            st, ctype, body = f.get(u, timeout=120 if is_doc else 60)
            if st is None or st >= 400:
                f.record_failure(u, "HTTP %s" % (st or ctype))
                f.log("FAIL %s %s" % (st or ctype, u))
                continue
            lg = "am" if "lang=am" in u else "en"
            if C.get("soft_marker") and C["soft_marker"] in body:
                soft.append(u)
                f.record_failure(u, "soft-404 (Page data not found at HTTP 200)")
                f.log("SOFT404 %s" % u)
                continue
            if (not is_doc and "html" in (ctype or "") and home_like(body, lg)
                    and urllib.parse.urlparse(u).path.strip("/") != ""):
                soft.append(u)
                f.record_failure(u, "soft-404 (homepage body)")
                f.log("SOFT404 %s" % u)
                continue
            if len(body) > 25 * 1024 * 1024:
                f.record_failure(u, "too large: %d bytes" % len(body))
                f.log("SKIP big %s" % u)
                continue
            lgf = "am" if "lang=am" in u else ("ti" if "lang=Tig" in u else "en")
            e = f.save(u, st, ctype, body, lang=lgf, extra={"kind": kind_of(u, title_of(body))})
            f.log("OK %s (%d B) [%s|%s] %s" % (u, len(body), e["lang"], e["kind"], (e.get("title") or "")[:50]))
        if "html" in (ctype or "") and d < C["maxdepth"]:
            for l in links(body, u):
                cl = canon(l)
                if not cl:
                    continue
                push(cl, d + 1)
                if not DOCEXT.search(cl) and "lang=" not in cl:
                    for lg in C["langs"]:
                        push(cl + "?lang=" + lg, d + 1)
        if time.time() - last_prog > 120:
            f.log("PROGRESS %d/%d queue, saved=%d soft404=%d" % (i, len(queue), nsaved(), len(soft)))
            last_prog = time.time()
    json.dump(soft, open(os.path.join(OUT, "soft404.json"), "w"), indent=1)
    f.write_manifest()
    f.log("=== DONE %s: saved=%d failures=%d soft404=%d skipped_have=%d queue=%d ===" % (
        HOST, nsaved(), len(f.manifest) - nsaved(), len(soft), skipped_have, len(queue)))


if __name__ == "__main__":
    main()
