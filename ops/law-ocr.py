# -*- coding: utf-8 -*-
"""OCR the court-forms PDF, because nothing else can read it.

The document is set in PowerGeez and Addis98 - Ethiopian fonts that predate Unicode. Both pdftotext
and PyMuPDF return raw byte codes: 0 Ethiopic characters out of 295 pages. The bytes could in
principle be mapped back with a PowerGeez table, and I am deliberately not doing that: a wrong table
produces fluent, confident, WRONG Amharic, which in a legal corpus is worse than no document at all.
OCR reads the glyphs as a person would, so the encoding stops mattering.

What OCR costs is precision, and this document is full of the two things OCR handles worst: dotted
form lines, and numbers. Numbers are the danger - "አዋጅ ቁጥር 133/98" misread as 138/98 would be quoted
by Asmat as law. So:

  - lines are kept only if they are mostly Ethiopic and mostly not punctuation
  - the OCR warning goes in the TITLE, not just the header, because the title travels with every
    chunk into retrieval while a header only reaches the first one
  - the per-page confidence is measured and reported, not assumed
"""
import os, re, subprocess, sys, json

PDF = "/root/new.pdf"
OUT = "/var/www/connectcare/binasmart/knowledge/law/court-forms-ocr.md"
WORK = "/root/ocr"
DPI = 300

os.makedirs(WORK, exist_ok=True)
import fitz
doc = fitz.open(PDF)
N = doc.page_count
print("pages: %d" % N, flush=True)

def ethiopic(s):
    return sum(1 for c in s if 0x1200 <= ord(c) <= 0x137F)

def keep(line):
    """Keep a line only if it reads as Amharic prose rather than OCR debris."""
    l = line.strip()
    if len(l) < 12:
        return False
    eth = ethiopic(l)
    if eth < 6:
        return False
    # debris is dominated by dots, dashes, equals and stray latin
    junk = sum(1 for c in l if c in ".-=_()/\\|«»<>[]{}*~^`" or (c.isascii() and c.isalpha()))
    if junk > len(l) * 0.35:
        return False
    if eth < len(l.replace(" ", "")) * 0.45:
        return False
    return True

pages_kept, kept_lines, stats = 0, [], []
for pn in range(N):
    png = "%s/p.png" % WORK
    doc[pn].get_pixmap(dpi=DPI).save(png)
    subprocess.run(["tesseract", png, "%s/p" % WORK, "-l", "amh", "--psm", "6"],
                   capture_output=True)
    try:
        raw = open("%s/p.txt" % WORK, encoding="utf-8", errors="replace").read()
    except FileNotFoundError:
        continue
    lines = [l for l in raw.split(chr(10))]
    good = [l.strip() for l in lines if keep(l)]
    ratio = len(good) / max(1, len([l for l in lines if l.strip()]))
    stats.append(round(ratio, 2))
    if good:
        pages_kept += 1
        kept_lines.append("\n".join(good))
    if (pn + 1) % 25 == 0:
        print("  %3d/%d pages, %d kept, mean clean-line ratio %.2f"
              % (pn + 1, N, pages_kept, sum(stats) / len(stats)), flush=True)

body = "\n\n".join(kept_lines)
eth = ethiopic(body)
mean = sum(stats) / max(1, len(stats))
print("\n  pages with usable text: %d of %d" % (pages_kept, N))
print("  ethiopic characters kept: %d" % eth)
print("  mean clean-line ratio: %.2f" % mean)

json.dump({"pages": N, "kept": pages_kept, "ethiopic": eth, "mean_ratio": mean},
          open("/root/ocr-report.json", "w"))

if eth < 40000:
    print("REFUSING TO WRITE: too little usable text recovered")
    sys.exit(1)

TITLE = "የፍርድ ቤት ቅጾችና ውሳኔ ናሙናዎች (በOCR የተነበበ — ቁጥሮችና ጥቅሶች ከዋናው ሰነድ ይረጋገጡ)"
HEAD = """---
url: ""
title: "%s"
lang: "am"
source_note: "Court forms and specimen rulings. The source PDF is set in the pre-Unicode PowerGeez and Addis98 fonts, which no text extractor can read, so this was recovered by OCR (tesseract amh, %d dpi). OCR misreads digits: every proclamation number, article number and date here MUST be verified against the original before it is relied on. Mean clean-line ratio %.2f across %d pages."
---

# %s

⚠️ ይህ ሰነድ በOCR (በምስል ንባብ) የተዘጋጀ ነው። የአዋጅ ቁጥሮች፣ የአንቀጽ ቁጥሮችና ቀኖች ስህተት ሊኖራቸው ይችላል —
ከዋናው ሰነድ ወይም ከፍርድ ቤቱ ያረጋግጡ። አወቃቀሩና ቅርጹ ግን ጠቃሚ ናቸው።

""" % (TITLE, DPI, mean, N, TITLE)

open(OUT, "w", encoding="utf-8").write(HEAD + body + "\n")
print("  wrote %s (%d KB)" % (OUT, len((HEAD + body).encode()) // 1024))
