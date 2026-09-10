# -*- coding: utf-8 -*-
"""Turn the Federal Courts Proclamation PDF into a knowledge document Asmat can cite.

Two things matter here:
1. The PDF's Amharic column uses a LEGACY font encoding, so it extracts as corrupted characters — ፋዯራሌ ፌርዴ
   where the words are ፌደራል ፍርድ. That must never enter the index: Asmat quoting gibberish at someone in
   court would be worse than saying nothing. Only the English column is kept, and any Ethiopic that bled
   across the column boundary is stripped.
2. The file is named 1234-2013 for the Ethiopian year. The proclamation cites ITSELF as
   "Federal Courts Proclamation No. 1234/2021", so that is the citation recorded.
"""
import os, re, subprocess, urllib.request

URL = "https://lawyer.et/wp-content/uploads/2023/08/Federal-Courts-Proclamation-1234-2013-1.pdf"
OUT_DIR = "/var/www/connectcare/binasmart/knowledge/web/law"
PDF, TXT = "/tmp/fcp.pdf", "/tmp/fcp_en.txt"

if not os.path.exists(PDF):
    req = urllib.request.Request(URL, headers={"user-agent": "Mozilla/5.0 Chrome/126"})
    open(PDF, "wb").write(urllib.request.urlopen(req, timeout=90).read())

info = subprocess.run(["pdfinfo", PDF], capture_output=True, text=True).stdout
w = int(float(re.search(r"Page size:\s+([\d.]+)", info).group(1)))
h = int(float(re.search(r"Page size:\s+[\d.]+ x ([\d.]+)", info).group(1)))
pages = int(re.search(r"Pages:\s+(\d+)", info).group(1))
subprocess.run(["pdftotext", "-layout", "-x", str(w // 2), "-y", "0", "-W", str(w // 2), "-H", str(h), PDF, TXT], check=True)

raw = open(TXT, encoding="utf-8", errors="replace").read()
ETHIOPIC = re.compile(r"[ሀ-፿ᎀ-᎟ⶀ-⷟]+")

lines = []
for ln in raw.split("\n"):
    ln = ETHIOPIC.sub(" ", ln)                        # drop the corrupted Amharic bleed
    ln = ln.replace("lawyer.et", " ")
    ln = re.sub(r"Federal Negarit Gazette No\.\s*\d+.*?page\s*\d+", " ", ln)
    ln = re.sub(r"\s{2,}", " ", ln).strip()
    if not ln or re.fullmatch(r"[\d\s.,:;'\"()\-–—|]+", ln):
        continue
    lines.append(ln)

text = "\n".join(lines)
# a numbered article starts a section; give the chunker headings to work with
text = re.sub(r"\n(\d{1,3})\.\s+([A-Z][^\n]{2,70})\n", lambda m: f"\n\n## Article {m.group(1)}. {m.group(2).strip()}\n\n", text)
text = re.sub(r"\n(CHAPTER [A-Z]+)\n", lambda m: f"\n\n# {m.group(1).title()}\n\n", text)
text = re.sub(r"\n{3,}", "\n\n", text).strip()

assert not ETHIOPIC.search(text), "corrupted Amharic survived the filter"
assert "1234/2021" in text, "the self-citation should be present"

os.makedirs(OUT_DIR, exist_ok=True)
body = ("---\n"
        'url: "https://lawyer.et/wp-content/uploads/2023/08/Federal-Courts-Proclamation-1234-2013-1.pdf"\n'
        'title: "Federal Courts Proclamation No. 1234/2021"\n'
        'source_name: "Federal Negarit Gazette"\n'
        'lang: "en"\n'
        'fetched: "2026-09-10"\n'
        "---\n\n"
        "# Federal Courts Proclamation No. 1234/2021\n\n"
        "Federal Negarit Gazette, 27th Year No. 26, Addis Ababa, 26 April 2021. Replaces the Federal Courts\n"
        "Proclamation No. 25/1996. This is the English text of the proclamation; the Amharic column of the\n"
        "published PDF uses a legacy font encoding that cannot be read reliably, so it is not reproduced here.\n"
        "Cite it as Proclamation No. 1234/2021 (Ethiopian year 2013).\n\n" + text + "\n")
path = os.path.join(OUT_DIR, "federal-courts-proclamation-1234-2021.md")
open(path, "w", encoding="utf-8").write(body)

print(f"pages {pages} · english {len(text):,} chars · no Ethiopic ✓")
print("articles found:", len(re.findall(r"^## Article", text, re.M)))
print("chapters found:", len(re.findall(r"^# Chapter", text, re.M)))
print("->", path)
