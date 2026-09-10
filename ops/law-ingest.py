# -*- coding: utf-8 -*-
"""General extractor for curated legal PDFs into knowledge/law/.

Generalises what the first two documents taught, so the next one Ibrahim sends is one line of config
rather than a fresh investigation:

  encoding check   A legacy-font PDF extracts as Latin gibberish that LOOKS like text. Indexing it is
                   worse than skipping it - unreadable to a person, matching nothing, and still
                   taking chunks. Refuse unless there is real Unicode.
  contents strip   A long compilation opens with pages of dotted leaders. Density finds them: a
                   contents line is short and ends in a page number, and those cluster. Take the LAST
                   dense window, not the first sparse one - the title page is sparse too.
  running header   The compiler's name repeats on every page and would otherwise appear in every chunk.
  validate first   Refuse to write if the result looks wrong. A bad document in a search index does
                   not sit quietly; it competes with the good ones.

  python3 law_ingest.py
"""
import os, re, subprocess, sys

ROOT = "/var/www/connectcare/binasmart/"
OUTDIR = ROOT + "knowledge/law/"

JOBS = [
    dict(pdf="/root/cass-v5.pdf", out="cassation-unpublished-v5.md",
         title="ያልታተሙ የሰበር ውሳኔዎች — ቅጽ 5 (የፌደራል ጠቅላይ ፍርድ ቤት ሰበር ሰሚ ችሎት)",
         url="https://fsc.gov.et/", lang="am", min_eth=100000,
         note="Unpublished binding interpretations of the Federal Supreme Court Cassation Division, volume 5. Compiled by a private practitioner; the decisions are binding law, the compilation is the compiler's work and should be credited when quoted."),
    dict(pdf="/root/taxappeal.pdf", out="tax-appeal-commission-directive.md",
         title="የፌዴራል የግብር ይግባኝ ኮሚሽን መመሪያ", url="https://mor.gov.et/", lang="am", min_eth=6000,
         note="Directive of the FDRE Tax Appeal Commission."),
    dict(pdf="/root/criminal.pdf", out="criminal-law-procedure-training.md",
         title="የወንጀል ሕግና የወንጀል ሥነ ሥርዓት — የሥልጠና ሰነድ", url=None, lang="am", min_eth=6000,
         note="Training material on Ethiopian criminal law and criminal procedure. Explanatory, not itself a source of law - the Criminal Code and the Criminal Procedure Code govern."),
]


def tocish(l):
    l = l.strip()
    return bool(re.search(r"[0-9]{1,3}$", l)) and len(l) < 110


def clean(txt):
    txt = txt.replace("�", "")
    lines = txt.split(chr(10))
    W = 60
    last = -1
    for i in range(0, max(0, len(lines) - W)):
        if sum(1 for l in lines[i:i + W] if tocish(l)) / W >= 0.15:
            last = i
    cut = min(last + W, len(lines) - 1) if last >= 0 else 0
    if cut > len(lines) * 0.25:      # the contents live at the front; anything deeper is not the TOC
        cut = 0
    dropped = cut
    txt = chr(10).join(lines[cut:])
    txt = re.sub(r"[^\n]*\.{5,}[^\n]*\n", "", txt)
    txt = re.sub(r"^\s*[ivxlcdmIVXLCDM]{1,6}\s*$", "", txt, flags=re.M)
    txt = re.sub(r"^\s*\d{1,3}\s*$", "", txt, flags=re.M)
    txt = re.sub(r"[ \t]{2,}", " ", txt)
    txt = re.sub(r"\n{3,}", "\n\n", txt).strip()
    return txt, dropped


def repeated_header(txt):
    """A line appearing on most pages is furniture, not content."""
    counts = {}
    for l in txt.split(chr(10)):
        k = l.strip()
        if 8 < len(k) < 70:
            counts[k] = counts.get(k, 0) + 1
    return [k for k, n in counts.items() if n >= 12]


os.makedirs(OUTDIR, exist_ok=True)
written, refused = [], []

for j in JOBS:
    name = os.path.basename(j["pdf"])
    print("\n=== %s ===" % name)
    txt_path = "/tmp/" + name + ".txt"
    subprocess.run(["pdftotext", "-layout", j["pdf"], txt_path], check=True)
    raw = open(txt_path, encoding="utf-8", errors="replace").read()

    eth = sum(1 for c in raw if 0x1200 <= ord(c) <= 0x137F)
    if eth < j["min_eth"]:
        print("  REFUSED: only %d Ethiopic characters (needs %d) — legacy font or scan"
              % (eth, j["min_eth"]))
        refused.append(name)
        continue

    body, dropped = clean(raw)
    for h in repeated_header(body):
        body = body.replace(h, "")
    body = re.sub(r"\n{3,}", "\n\n", body).strip()

    eth2 = sum(1 for c in body if 0x1200 <= ord(c) <= 0x137F)
    print("  contents lines dropped: %d   ethiopic kept: %d of %d   size: %d KB"
          % (dropped, eth2, eth, len(body.encode()) // 1024))
    if eth2 < j["min_eth"] * 0.5:
        print("  REFUSED: cleaning removed too much")
        refused.append(name)
        continue

    fm = ['---', 'url: "%s"' % (j["url"] or ""), 'title: "%s"' % j["title"],
          'lang: "%s"' % j["lang"], 'source_note: "%s"' % j["note"], '---', '', '# ' + j["title"], '', '']
    open(OUTDIR + j["out"], "w", encoding="utf-8").write(chr(10).join(fm) + body + chr(10))
    print("  wrote knowledge/law/%s" % j["out"])
    written.append(j["out"])

print("\nwritten: %s" % (", ".join(written) or "none"))
if refused:
    print("refused: %s" % ", ".join(refused))
print("\nknowledge/law now holds:")
for f in sorted(os.listdir(OUTDIR)):
    print("  %-42s %6d KB" % (f, os.path.getsize(OUTDIR + f) // 1024))
