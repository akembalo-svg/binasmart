"""Finalize one telecom host dir: dedupe, fix lang/kind, drop out-of-scope news pages, write manifest.json + README.md."""
import hashlib, json, os, re, sys, urllib.parse, html, collections

BASE = os.path.dirname(os.path.abspath(__file__))
HOST = sys.argv[1]
D = os.path.join(BASE, "out", "telecom", HOST)
ETH = re.compile(r"[ሀ-፿]")

NEWS = re.compile(r"ethio-telecom-(launch|announc|sign|celebrat|inaugur|partner|unveil|hand|win|award|rural|telestream|pay|resume|hold|host|take|reach|expand|introduc|deploy|conclud)|-launches-|/telestream", re.I)

KINDS = [("sim", r"sim|esim|number-port|portab|registration|national-id"), ("roaming", r"roam|international"),
         ("faq", r"faq|frequently|how-to|getting-started|guide"), ("tariff", r"tariff|price|pricing|rate"),
         ("coverage", r"coverage|4g|5g|network"),
         ("legal", r"terms|condition|policy|privacy|law|regulat|proclamation|directive|complaint|rights|consumer|determination|regulation"),
         ("package", r"package|offer|bundle|airtime|air-time|top-up|data|voice|sms|plan|recharge|micro|share|crbt|deal|wifi"),
         ("internet", r"fixed|broadband|ftth|internet"),
         ("business", r"business|enterprise|corporate|vpn|cloud|solution|vas|apn|bulk"),
         ("contact", r"contact|shop|store|center|centre|branch")]


def kind_of(url, title, use_title=True):
    u = urllib.parse.unquote(urllib.parse.urlparse(url).path).lower()
    s = u + (" " + (title or "").lower() if use_title else "")
    if u.endswith(".pdf"):
        s = u
    for k, rx in KINDS:
        if re.search(rx, s):
            return k
    return "other"


rows = {}
fails = {}
for l in open(os.path.join(D, "manifest.jsonl"), encoding="utf-8"):
    try:
        e = json.loads(l)
    except Exception:
        continue
    if e.get("file") and os.path.exists(os.path.join(D, e["file"])):
        rows[e["url"]] = e
    elif not e.get("file"):
        fails[e["url"]] = e
# a url that later succeeded is not a failure
for u in list(fails):
    if u in rows:
        del fails[u]

# drop duplicates: safaricom paths without /en/ that are byte-identical to the /en/ page
removed = []
if HOST == "www.safaricom.et":
    by = {e["sha256"]: e for e in rows.values() if "/en" in e["url"]}
    for u, e in list(rows.items()):
        if "/en" not in u and u.rstrip("/") != "https://www.safaricom.et" and e["sha256"] in by:
            removed.append((u, "duplicate of " + by[e["sha256"]]["url"]))
            del rows[u]
# out-of-scope news/press (site has them under top-level slugs)
for u, e in list(rows.items()):
    if HOST == "www.ethiotelecom.et" and NEWS.search(u):
        removed.append((u, "news/press (out of scope)"))
        del rows[u]
for u, why in removed:
    pass

# also purge files no longer in manifest
keep = set(e["file"] for e in rows.values())
for fn in os.listdir(D):
    if re.match(r"^[0-9a-f]{40}\.", fn) and fn not in keep:
        os.remove(os.path.join(D, fn))

out = []
soft = 0
for u, e in rows.items():
    p = os.path.join(D, e["file"])
    b = open(p, "rb").read()
    assert hashlib.sha256(b).hexdigest() == e["sha256"], u
    isdoc = e["file"].endswith((".pdf", ".doc", ".docx", ".xls", ".xlsx", ".json"))
    q = urllib.parse.urlparse(u).query
    if "lang=am" in q:
        lang = "am"
    elif "lang=Tig" in q:
        lang = "ti"
    elif "lang=om" in q:
        lang = "om"
    elif "lang=so" in q:
        lang = "so"
    else:
        lang = "en"
    if isdoc and ETH.search(urllib.parse.unquote(u)) or re.search(r"amharic|-amh|_amh|AMH", u):
        lang = "am"
    am_chars = None
    if e["file"].endswith(".html"):
        t = re.sub(rb"<script.*?</script>|<style.*?</style>|<nav.*?</nav>|<header.*?</header>|<footer.*?</footer>", b"", b, flags=re.S | re.I)
        t = re.sub(rb"<[^>]+>", b" ", t).decode("utf-8", "ignore")
        am_chars = len(ETH.findall(t))
        if lang == "am" and am_chars < 20:
            e["note"] = "lang=am URL but body has little Amharic text (%d Ethiopic chars) - probably English fallback" % am_chars
    e["lang"] = lang
    e["amharicChars"] = am_chars
    generic_title = HOST == "www.safaricom.et"
    e["kind"] = kind_of(u, e.get("title"), use_title=not generic_title)
    e["postType"] = e.get("postType")
    out.append(e)
out.sort(key=lambda e: e["url"])
allrows = out + sorted(fails.values(), key=lambda e: e["url"])
json.dump(allrows, open(os.path.join(D, "manifest.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
# rewrite jsonl to the cleaned set so ship/verify use one source of truth
with open(os.path.join(D, "manifest.jsonl"), "w", encoding="utf-8") as fh:
    for e in allrows:
        fh.write(json.dumps(e, ensure_ascii=False) + "\n")
with open(os.path.join(D, "sums.txt"), "w", encoding="utf-8") as fh:
    for e in out:
        fh.write("%s  %s\n" % (e["sha256"], e["file"]))

n_html = sum(1 for e in out if e["file"].endswith(".html"))
n_pdf = sum(1 for e in out if e["file"].endswith(".pdf"))
n_json = sum(1 for e in out if e["file"].endswith(".json"))
langc = collections.Counter(e["lang"] for e in out if e["file"].endswith(".html"))
kindc = collections.Counter(e["kind"] for e in out)
tot = sum(e["bytes"] for e in out)
soft404 = [e for e in fails.values() if "soft-404" in (e.get("error") or "")]
nonsoft = [e for e in fails.values() if "soft-404" not in (e.get("error") or "")]
noteam = [e for e in out if e.get("note")]

md = []
md.append("# %s - telecom pack harvest (2026-09-22)\n" % HOST)
md.append("Harvested from the operator's own computer with the Python stdlib Fetcher (ops/harvest/telecom/common.py), UA `BinaSmart-research`, 5 s pacing, keep-alive; robots.txt was read by the operator before the crawl. Raw bytes are `<sha1-of-url>.<ext>`; `manifest.json` maps them to URL, status, content-type, bytes, sha256, fetchedAt, title, lang, kind.\n")
md.append("- Files: **%d** (HTML %d, PDF %d, JSON %d), %.1f MB total" % (len(out), n_html, n_pdf, n_json, tot / 1e6))
md.append("- HTML by language: %s" % dict(langc))
nom = sum(1 for e in out if e["lang"] in ("om", "so"))
if nom:
    md.append("- Oromo (?lang=om) and Somali (?lang=so) pages: %d, kept but NOT extended - they were picked up before the crawler was limited to English + Amharic (+2 Tigrinya); no om/so coverage was attempted for the rest of the site. Marked lang=om / lang=so in manifest.json." % nom)
md.append("- By kind: %s" % dict(kindc.most_common()))
md.append("- Soft-404 responses dropped (HTTP 200 with homepage / 'Page data not found' body): %d" % len(soft404))
md.append("- Failed / non-200 (dropped): %d" % len(nonsoft))
if removed:
    md.append("- Removed after crawl: %d (%s)" % (len(removed), ", ".join(sorted(set(w for _, w in removed)))[:200]))
md.append("")
if noteam:
    md.append("## lang=am URLs whose body is (nearly) English\n")
    for e in noteam[:60]:
        md.append("- %s (%s Ethiopic chars)" % (e["url"], e["amharicChars"]))
    md.append("")
if nonsoft:
    md.append("## Failures\n")
    for e in nonsoft[:80]:
        md.append("- %s -> %s" % (e["url"], e.get("error")))
    md.append("")
if soft404:
    md.append("## Soft-404 URLs\n")
    for e in soft404[:80]:
        md.append("- %s" % e["url"])
    md.append("")
extra = os.path.join(BASE, "readme_extra_%s.md" % HOST)
if os.path.exists(extra):
    md.append(open(extra, encoding="utf-8").read())
open(os.path.join(D, "README.md"), "w", encoding="utf-8").write("\n".join(md) + "\n")
print(HOST, "files", len(out), "html", n_html, "pdf", n_pdf, "json", n_json, "MB %.1f" % (tot / 1e6), dict(langc),
      "soft404", len(soft404), "fails", len(nonsoft), "removed", len(removed), "am-fallback", len(noteam))
