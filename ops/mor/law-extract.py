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
  column split     (mode cols-am / cols-en) Where the PDF's columns do NOT overlap, split by page geometry instead: the job
                   measures the gutter (every Amharic word ends left of it, every English word starts right of it) and the
                   band between the running head and the footer (top, bottom, page_top for the masthead page). The script
                   split misroutes an English word that carries an Ethiopic colon ("follows፡", "Article፡") and a bare
                   number; geometry does not. The running head is cut by position, so the furniture patterns are not
                   applied (they also dropped a body line that names the "Federal Negarit Gazette", as in an effective-
                   date article). The script prints any word that straddles the gutter inside the band.
  remap            Some gazettes set the Amharic in a font whose text layer is off by one code point for a few rows
                   (Visual Geez Unicode in 1395/2025: ሇ for ለ, ሌ for ል, ዴ for ድ, ንዐስ for ንዑስ). The job gives the font
                   and the mapping measured against clean Amharic statutes; only words lying inside that font's spans
                   (read with PyMuPDF) are remapped, so a signature block in another font is left alone.
  sections         An ordered list of [paragraph prefix, heading]: a "### heading" is written before the first paragraph
                   (after the previous match) that starts with the prefix. Headings are written by hand after reading the
                   text; a prefix that is not found refuses the job. In the cols modes paragraphs are separated by a
                   blank line (the chunker splits on those), and a job may add paragraph starts (breaks) and line
                   starts that only continue a sentence (nobreak).

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


def text_of(ws, extra_furniture=(), furniture=True):
    out = []
    for line in lines_of(ws):
        s = " ".join(w[5] for w in line).strip()
        if not s or (furniture and any(p.search(s) for p in FURNITURE)) or any(p.search(s) for p in extra_furniture):
            continue
        if re.search(r"\.{6,}|…{3,}", s):   # a contents line with dotted leaders
            continue
        out.append(s)
    t = "\n".join(out)
    t = t.replace("‹‹", "«").replace("››", "»")
    return t


def reflow(t, extra_head=None, sep="\n", nobreak=None):
    """Join wrapped lines into paragraphs; keep a break before article headings and numbered items.
    extra_head: more line starts that open a paragraph; nobreak: line starts that never do (a wrapped "Article 62 is
    deleted", "፱፻፸፱/፪ሺ፰" or "አንቀጽ (፪) ተተክቷል" continuing the sentence above)."""
    head = re.compile(r"^(Article\s+\d+|\d{1,3}\.\s+[A-Z]|PART|CHAPTER|SECTION|Schedule|አንቀጽ|ክፍል|ምዕራፍ|[፩-፼]+\.\s|\d{1,3}/|\(\d{1,2}\)|[a-z]\)|\([a-z]\)|[ሀለሐመሠረሰሸቀበተቸኀነኘአከኸወዐዘዠየደጀገጠጨጰጸፀፈፐ]\)|[፩-፼]+/)")
    extra = re.compile(extra_head) if extra_head else None
    nob = re.compile(nobreak) if nobreak else None
    paras, cur = [], ""
    for line in t.split("\n"):
        line = line.strip()
        if not line: continue
        if cur and (head.match(line) or (extra and extra.match(line))) and not (nob and nob.match(line)):
            paras.append(cur); cur = line
        else:
            cur = (cur + " " + line).strip() if cur else line
    if cur: paras.append(cur)
    return sep.join(paras)


def split_by_columns(ws, job):
    """-> (left_words, right_words, straddlers) by page geometry; words outside the band are dropped."""
    gutter, top, bottom = job["gutter"], job["top"], job["bottom"]
    page_top = {int(k): v for k, v in job.get("page_top", {}).items()}
    left, right, straddle = [], [], []
    for w in ws:
        if w[2] < page_top.get(w[0], top) or w[2] > bottom:
            continue
        if w[1] < gutter < w[3]:
            straddle.append(w)
        ((left if (w[1] + w[3]) / 2 < gutter else right)).append(w)
    return left, right, straddle


def remap_words(pdf, ws, remap):
    """Apply remap["map"] to the words that lie inside spans of remap["font"]. -> (words, stats)."""
    import fitz
    doc = fitz.open(pdf)
    boxes = defaultdict(list)       # page -> [(x0, y0, x1, y1, font)]
    for pno in sorted(set(w[0] for w in ws)):
        for b in doc[pno - 1].get_text("rawdict")["blocks"]:
            for l in b.get("lines", []):
                for s in l["spans"]:
                    if s["chars"] and ETH.search("".join(c["c"] for c in s["chars"])):
                        boxes[pno].append(tuple(s["bbox"]) + (s["font"],))
    table = {k: v for k, v in remap["map"].items()}
    out, stats = [], defaultdict(int)
    for w in ws:
        if not ETH.search(w[5]):
            out.append(w); continue
        cx, cy = (w[1] + w[3]) / 2, (w[2] + w[4]) / 2
        font = next((f for x0, y0, x1, y1, f in boxes[w[0]] if x0 - 1 <= cx <= x1 + 1 and y0 - 1 <= cy <= y1 + 1), None)
        stats[font or "(no span)"] += 1
        if font == remap["font"]:
            t = "".join(table.get(c, c) for c in w[5])
            if t != w[5]: stats["changed"] += 1
            w = w[:5] + (t,) + w[6:]
        out.append(w)
    return out, dict(stats)


def add_sections(body, sections, sep):
    """Insert '### heading' before the paragraph starting with each prefix, in order. -> (body, missing)."""
    paras, out, i, missing = body.split(sep), [], 0, []
    for prefix, heading in sections:
        j = i
        while j < len(paras) and not paras[j].startswith(prefix):
            j += 1
        if j == len(paras):
            missing.append(prefix); continue
        out.extend(paras[i:j]); out.append("### " + heading); i = j
    out.extend(paras[i:])
    return sep.join(out), missing


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
    stats = {}
    sep = "\n\n" if mode in ("cols-am", "cols-en") else "\n"
    if mode in ("cols-am", "cols-en"):
        left, right, straddle = split_by_columns(ws, job)
        ws = left if mode == "cols-am" else right
        stats["straddling the gutter"] = [(w[0], w[5]) for w in straddle]
        stats["other script in column"] = [(w[0], w[5]) for w in ws if (LAT if mode == "cols-am" else ETH).search(w[5])]
        if job.get("remap"):
            ws, stats["remap"] = remap_words(pdf, ws, job["remap"])
    if mode in ("cols-am", "cols-en"):
        body = reflow(text_of(ws, [re.compile(p) for p in job.get("furniture", [])], furniture=False), job.get("breaks"), sep, job.get("nobreak"))
    elif mode != "ocr":
        body = reflow(text_of(ws, [re.compile(p) for p in job.get("furniture", [])]))
    # running heads that land on a body line: "፲፮ሺ፮ 16006 ነU¶T ፷፩ ነሐሴ ፲፭ ቀን ፪ሺ፲፮" and the page numbers of the 1434 column
    body = re.sub(r"\s*(?:[፩-፼]+\s+\d{4,5}\s+)?ነU¶T\s+[፩-፼]+\s+\S+\s+[፩-፼]+\s+ቀን\s+[፩-፼]+", " ", body)
    body = re.sub(r"\s*›\.M(?:\s+\d{5})?\s*", " ", body)
    body = re.sub(r"[ 	]{2,}", " ", body)
    for a, b in job.get("replace", []):
        if a not in body: stats.setdefault("replace not found", []).append(a)
        body = body.replace(a, b)
    missing_sections = []
    if job.get("sections"):
        body, missing_sections = add_sections(body, job["sections"], sep)
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
    if missing_sections: problems.append("section prefixes not found in order: %s" % "; ".join(missing_sections[:6]))
    if stats.get("replace not found"): problems.append("replace strings not found: %s" % "; ".join(stats["replace not found"][:6]))
    hdr_path = HEADERS + job["out"]
    header = open(hdr_path, encoding="utf-8").read().strip() if os.path.exists(hdr_path) else None
    if header is None: problems.append("no header written yet (%s)" % hdr_path)
    for k, v in stats.items():
        print("  %s: %s" % (k, v if not isinstance(v, list) else (len(v), v[:12])))
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
