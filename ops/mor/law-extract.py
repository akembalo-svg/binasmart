# -*- coding: utf-8 -*-
"""Ministry of Revenue laws (proclamations, regulations, directives) into knowledge/law/.

The PDFs come from /root/legal-sources/mor/files (harvested from mor.gov.et, see ops/mor/mor-to-md.js). Each job names a
PDF, how to read it and the header written by hand after reading the document (ops/mor/headers/<out>.md: plain-language
summary and key articles in English and Amharic). What this adds to ops/law-ingest.py:

  script split     A bilingual Negarit Gazette sets Amharic left and English right, and the columns overlap in x, so a
                   crop at the page middle cuts words off both. Words are split by SCRIPT instead: Ethiopic to the
                   Amharic text, Latin to the English text, and a word with neither (a number, a bracket) goes with
                   the nearest classified word on its line.
  numbers check    Some Amharic PDFs extract with real Ethiopic letters but broken digits (979/2016 on mor.gov.et:
                   "01" for Article 11). Letters alone do not prove a text is usable, so every job states the article
                   numbers it must find in order, and a text that loses them is refused.
  furniture        Gazette running heads ("Federal Negarit Gazette No. ...", the legacy-font Amharic head, page numbers)
                   are dropped from both columns.

  python3 ops/mor/law-extract.py [out-name ...]     (no names: every job)
"""
import html, json, os, re, subprocess, sys
from collections import defaultdict

ROOT = "/var/www/connectcare/binasmart/"
SRC = "/root/legal-sources/mor/"
OUTDIR = ROOT + "knowledge/law/"
HEADERS = ROOT + "ops/mor/headers/"
MANIFEST = json.load(open(SRC + "manifest.json", encoding="utf-8"))

ETH = re.compile(r"[ሀ-፿]")
LAT = re.compile(r"[A-Za-z]")


def file_of(endpoint, id_):
    for r in MANIFEST["files"].values():
        if r.get("ok") and r["endpoint"] == endpoint and r["id"] == id_:
            return r
    raise SystemExit("not downloaded: %s#%s" % (endpoint, id_))


def words(pdf, first=None, last=None):
    """[(page, xMin, yMin, xMax, yMax, text)] from pdftotext -bbox."""
    cmd = ["pdftotext", "-bbox"]
    if first: cmd += ["-f", str(first)]
    if last: cmd += ["-l", str(last)]
    out = subprocess.run(cmd + [pdf, "-"], capture_output=True).stdout.decode("utf-8", "replace")
    res, page, width = [], 0, 0.0
    for m in re.finditer(r'<page width="([\d.]+)"|<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', out):
        if m.group(1):
            page += 1; width = float(m.group(1))
            continue
        res.append((page, float(m.group(2)), float(m.group(3)), float(m.group(4)), float(m.group(5)), html.unescape(m.group(6)), width))
    return res


def lines_of(ws, tol=3.0):
    """Group words into lines by y, then order by x."""
    ws = sorted(ws, key=lambda w: (w[0], w[2], w[1]))
    lines, cur, cy, cp = [], [], None, None
    for w in ws:
        if cur and (w[0] != cp or abs(w[2] - cy) > tol):
            lines.append(sorted(cur, key=lambda x: x[1])); cur = []
        if not cur: cy, cp = w[2], w[0]
        cur.append(w)
    if cur: lines.append(sorted(cur, key=lambda x: x[1]))
    return lines


def split_by_script(ws):
    """-> (amharic_words, english_words)."""
    am, en = [], []
    by_line = lines_of(ws)
    for line in by_line:
        tags = []
        for w in line:
            t = w[5]
            tags.append("am" if ETH.search(t) else "en" if LAT.search(t) else None)
        for i, w in enumerate(line):
            tag = tags[i]
            if tag is None:
                best, bd = None, 1e9
                for j, o in enumerate(line):
                    if tags[j] is None: continue
                    d = abs((o[1] + o[3]) / 2 - (w[1] + w[3]) / 2)
                    if d < bd: best, bd = tags[j], d
                tag = best or "en"
            (am if tag == "am" else en).append(w)
    return am, en


FURNITURE = [
    re.compile(r"Federal\s+Negarit\s+Ga[zs]ette", re.I), re.compile(r"FEDERAL NEGARIT GAZETTE", re.I),
    re.compile(r"ፌዴራል\s*ነጋሪት\s*ጋዜጣ|ነጋሪት\s*ጋዜጣ"), re.compile(r"Ød‰L|Uz¤È|›\.M"), re.compile(r"^\s*page\s*\d*\s*$", re.I),
    re.compile(r"^\s*[\d፩-፼፻ሺ]+\s*$"), re.compile(r"Negarit G\. P\.O\.Box", re.I), re.compile(r"ያንዱ ዋጋ|Unit Price", re.I),
]


def text_of(ws, extra_furniture=()):
    out = []
    for line in lines_of(ws):
        s = " ".join(w[5] for w in line).strip()
        if not s or any(p.search(s) for p in FURNITURE) or any(p.search(s) for p in extra_furniture):
            continue
        if re.search(r"\.{6,}|…{3,}", s):   # a contents line with dotted leaders
            continue
        out.append(s)
    t = "\n".join(out)
    t = t.replace("‹‹", "«").replace("››", "»")
    return t


def reflow(t):
    """Join wrapped lines into paragraphs; keep a break before article headings and numbered items."""
    head = re.compile(r"^(Article\s+\d+|\d{1,3}\.\s+[A-Z]|PART|CHAPTER|SECTION|Schedule|አንቀጽ|ክፍል|ምዕራፍ|[፩-፼]+\.\s|\d{1,3}/|\(\d{1,2}\)|[a-z]\)|\([a-z]\)|[ሀለሐመሠረሰሸቀበተቸኀነኘአከኸወዐዘዠየደጀገጠጨጰጸፀፈፐ]\)|[፩-፼]+/)")
    paras, cur = [], ""
    for line in t.split("\n"):
        line = line.strip()
        if not line: continue
        if cur and head.match(line):
            paras.append(cur); cur = line
        else:
            cur = (cur + " " + line).strip() if cur else line
    if cur: paras.append(cur)
    return "\n".join(paras)


def check_numbers(body, must):
    """Every entry of `must` (a regex) must be found, in order."""
    pos, missing = 0, []
    for pat in must:
        m = re.compile(pat, re.M).search(body, pos)
        if not m: missing.append(pat)
        else: pos = m.end()
    return missing


def build(job):
    r = file_of(job["endpoint"], job["id"])
    pdf = SRC + r["path"]
    mode = job.get("mode", "full")
    ws = words(pdf, job.get("first"), job.get("last")) if mode != "ocr" else []
    if mode == "ocr":   # a scan: the text comes from ops/mor/ocr-column.sh, one "=== page n ===" block per page
        parts = job["ocr"] if isinstance(job["ocr"], list) else [[job["ocr"], job.get("first"), job.get("last")]]
        raw = ""
        for path_, first_, last_ in parts:   # one or more OCR files, each cut to its wanted pages
            t = open(SRC + path_, encoding="utf-8").read()
            if last_:
                cut = t.find("=== page %d ===" % (last_ + 1))
                if cut > 0: t = t[:cut]
            if first_:
                cut = t.find("=== page %d ===" % first_)
                if cut > 0: t = t[cut:]
            raw += "\n" + t
        raw = re.sub(r"=== page \d+ ===", "\n", raw)
        keep = []
        for line in raw.split("\n"):
            s2 = line.strip()
            if not s2 or any(p.search(s2) for p in FURNITURE) or any(re.search(p, s2) for p in job.get("furniture", [])):
                continue
            keep.append(s2)
        body = reflow("\n".join(keep))
    elif mode in ("en", "am"):
        am, en = split_by_script(ws)
        ws = en if mode == "en" else am
    elif mode == "right":   # legacy-font Amharic column (Latin gibberish): the English column by position instead
        frac = job.get("split", 0.5)
        ws = [w for w in ws if w[1] >= frac * w[6]]
    if mode != "ocr":
        body = reflow(text_of(ws, [re.compile(p) for p in job.get("furniture", [])]))
    # running heads that land on a body line: "፲፮ሺ፮ 16006 ነU¶T ፷፩ ነሐሴ ፲፭ ቀን ፪ሺ፲፮" and the page numbers of the 1434 column
    body = re.sub(r"\s*(?:[፩-፼]+\s+\d{4,5}\s+)?ነU¶T\s+[፩-፼]+\s+\S+\s+[፩-፼]+\s+ቀን\s+[፩-፼]+", " ", body)
    body = re.sub(r"\s*›\.M(?:\s+\d{5})?\s*", " ", body)
    body = re.sub(r"[ 	]{2,}", " ", body)
    for a, b in job.get("replace", []):
        body = body.replace(a, b)
    # the repository is public: a cover letter's switchboard or a signatory's mobile number must not ride along
    phone = re.search(r"\+\s?251[\s\d/-]{6,}|\b0?9\d{8}\b|\b011[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b", body)
    eth = len(ETH.findall(body))
    lat = len(LAT.findall(body))
    problems = []
    if job["lang"] == "am" and eth < job.get("min_eth", 5000): problems.append("only %d Ethiopic characters" % eth)
    if job["lang"] == "en" and lat < job.get("min_lat", 5000): problems.append("only %d Latin letters" % lat)
    if phone: problems.append("a phone number is in the text: %r (cut those pages with first/last)" % phone.group(0))
    missing = check_numbers(body, job.get("must", []))
    if missing: problems.append("numbers not found in order: %s" % ", ".join(missing[:6]))
    hdr_path = HEADERS + job["out"]
    header = open(hdr_path, encoding="utf-8").read().strip() if os.path.exists(hdr_path) else None
    if header is None: problems.append("no header written yet (%s)" % hdr_path)
    return r, body, eth, lat, problems, header


def front(job, r):
    q = lambda s: str(s).replace("\\", "\\\\").replace('"', '\\"')
    src = r["source_url"]
    from urllib.parse import quote
    href = src if re.search(r"%[0-9A-Fa-f]{2}", src) else quote(src, safe=":/?&=#-._~")
    fm = ["---", 'url: "%s"' % href, 'title: "%s"' % q(job["title"]), 'source_name: "Ministry of Revenue (mor.gov.et)"',
          'lang: "%s"' % job["lang"], 'fetched: "%s"' % r["fetched"][:10], 'number: "%s"' % q(job["number"]),
          'extraction: "%s"' % q(job["quality"]), 'source_note: "%s"' % q(job.get("note", "")),
          'sha256: "%s"' % r["sha256"], 'generated_by: "ops/mor/law-extract.py"', "---", ""]
    return "\n".join(fm)


if __name__ == "__main__":
    jobs = json.load(open(ROOT + "ops/mor/law-jobs.json", encoding="utf-8"))
    names = set(sys.argv[1:])
    dry = "--dry" in names; names.discard("--dry")
    for job in jobs:
        if names and job["out"] not in names: continue
        r, body, eth, lat, problems, header = build(job)
        print("=== %s  (%s#%s, %sp)  eth=%d latin=%d  %d KB" % (job["out"], job["endpoint"], job["id"], r.get("pages"), eth, lat, len(body.encode()) // 1024))
        if dry:
            open("/tmp/law-extract-" + job["out"] + ".txt", "w", encoding="utf-8").write(body)
            print("  dry run: /tmp/law-extract-%s.txt" % job["out"]);
            for p in problems: print("  !", p)
            continue
        if problems:
            print("  REFUSED: " + "; ".join(problems)); continue
        md = front(job, r) + header + "\n\n## Full text" + (" (English)" if job["lang"] == "en" else " (Amharic)") + "\n\n" + body + "\n"
        open(OUTDIR + job["out"] + ".md", "w", encoding="utf-8").write(md)
        print("  wrote knowledge/law/%s.md" % job["out"])
