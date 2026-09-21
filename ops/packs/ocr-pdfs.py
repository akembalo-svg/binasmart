# -*- coding: utf-8 -*-
"""OCR the scanned PDFs of a harvested host, on this server, into the sidecar fetch-pack.js reads.

Same method as the banking pack's NBE run and as ops/law-ocr.py: PyMuPDF rasterises each page at 300 dpi,
Tesseract reads it (psm 6, Amharic + English), and the text is written beside the PDFs as one
<harvest-file-stem>.ocr.txt per PDF, pages separated by a form feed, with an ocr-manifest.json giving each
file its url, page count, language mode, the quality this run measured and the numbers it checked.
ops/packs/fetch-pack.js READS the sidecar and never runs OCR. Nothing leaves this machine: no third-party
OCR, no upload, Tesseract 5 and PyMuPDF only.

The Ethiopian Communications Authority publishes its regulations as a bilingual Negarit Gazette page: the
Amharic text in the left column, the English text in the right. Read as one block, psm 6 interleaves the two
columns line by line and both languages come out as noise. So a page can be split down the middle (--split):
the left half is read as Amharic+English, the right half as English, and the document is written as the whole
English text first and the whole Amharic text after it, each page break kept.

  python3 ops/packs/ocr-pdfs.py --dir /root/storage/packs/telecom-manual/www.eca.et \
      --url https://www.eca.et/wp-content/uploads/2026/03/Universal-Access-Fund-Regulation-No-585-2026-2.pdf \
      --title "Universal Access Fund Regulation No. 585/2026" --expect 585 --split 0.5

Quality is measured, not assumed: the mean word confidence Tesseract reports for the English column, the share
of Ethiopic characters that are ordinary syllables, and whether the instrument's own number (--expect) is read
back out of the text. `good` needs all three; anything less is `poor` and the document says so in its header.
"""
import argparse, hashlib, json, os, re, subprocess, sys, tempfile, datetime

import fitz  # PyMuPDF

ap = argparse.ArgumentParser()
ap.add_argument('--dir', required=True)
ap.add_argument('--url', action='append', required=True)
ap.add_argument('--title', action='append', default=[])
ap.add_argument('--expect', action='append', default=[], help='the instrument number that must be readable, e.g. 585')
ap.add_argument('--split', type=float, default=0.0, help='split each page at this fraction of its width (bilingual gazette)')
ap.add_argument('--dpi', type=int, default=300)
ap.add_argument('--pages', type=int, default=0, help='only the first N pages (a trial)')
args = ap.parse_args()

DPI = args.dpi
OUT = os.path.join(args.dir, 'ocr')
os.makedirs(OUT, exist_ok=True)
man = json.load(open(os.path.join(args.dir, 'manifest.json'), encoding='utf-8'))
rows = man if isinstance(man, list) else (man.get('items') or man.get('files'))


def ethiopic(s):
    return sum(1 for c in s if 0x1200 <= ord(c) <= 0x137F)


def clean_ocr(t):
    """Take off what a page border and a decorative masthead leave behind: a line with no word of three
    letters and no digit in it (a stray slash, a bracket, a bullet), and the one to four symbols an ornamental
    column rule puts at the start of a line. No letter and no digit is ever removed, and nothing is reordered."""
    out = []
    for line in t.split('\n'):
        l = line.rstrip()
        l = re.sub('^[\\s>|~»«\\\\/°¥¢£_=*]{1,4}(?=[A-Za-z0-9(“"ሀ-፿])', '', l)
        if l.strip() and not re.search('[A-Za-zሀ-፿]{3,}|[0-9]', l):
            continue
        out.append(l)
    return '\n'.join(out)


def run_tess(png, lang):
    """Return (text, mean word confidence) for one image."""
    base = png[:-4] + '.' + lang.replace('+', '_')
    subprocess.run(['nice', '-n', '19', 'tesseract', png, base, '-l', lang, '--psm', '6', 'txt', 'tsv'],
                   capture_output=True, check=True)
    text = clean_ocr(open(base + '.txt', encoding='utf-8', errors='replace').read())
    confs = []
    for line in open(base + '.tsv', encoding='utf-8', errors='replace').read().split('\n')[1:]:
        p = line.split('\t')
        if len(p) >= 12 and p[0] == '5' and p[11].strip():
            try:
                c = float(p[10])
            except ValueError:
                continue
            if c >= 0:
                confs.append(c)
    return text, (sum(confs) / len(confs) if confs else 0.0), len(confs)


docs = []
old = os.path.join(OUT, 'ocr-manifest.json')
prev = json.load(open(old, encoding='utf-8')) if os.path.exists(old) else None
files = list(prev['files']) if prev else []

for n, url in enumerate(args.url):
    hit = [e for e in rows if e.get('url') == url and e.get('file')]
    if not hit:
        sys.exit('not in the harvest manifest: ' + url)
    e = hit[0]
    pdf = os.path.join(args.dir, e['file'])
    stem = e['file'].rsplit('.', 1)[0]
    expect = args.expect[n] if n < len(args.expect) else None
    title = args.title[n] if n < len(args.title) else os.path.basename(url)
    doc = fitz.open(pdf)
    N = doc.page_count if not args.pages else min(args.pages, doc.page_count)
    print('%s: %d pages, dpi %d, split %s' % (os.path.basename(url), N, DPI, args.split or 'no'), flush=True)
    left_pages, right_pages, econf, aconf, ewords = [], [], [], [], 0
    work = tempfile.mkdtemp(prefix='ocrpdf-')
    for pn in range(N):
        pix = doc[pn].get_pixmap(dpi=DPI)
        full = os.path.join(work, 'p%03d.png' % pn)
        pix.save(full)
        if args.split:
            from PIL import Image
            im = Image.open(full)
            W, H = im.size
            cut = int(W * args.split)
            lp, rp = os.path.join(work, 'p%03dL.png' % pn), os.path.join(work, 'p%03dR.png' % pn)
            im.crop((0, 0, cut, H)).save(lp)
            im.crop((cut, 0, W, H)).save(rp)
            at, ac, _ = run_tess(lp, 'amh+eng')
            et, ec, nw = run_tess(rp, 'eng')
            left_pages.append(at.strip())
            right_pages.append(et.strip())
            aconf.append(ac); econf.append(ec); ewords += nw
        else:
            et, ec, nw = run_tess(full, 'amh+eng')
            right_pages.append(et.strip())
            econf.append(ec); ewords += nw
        print('  page %d/%d  eng-conf %.1f' % (pn + 1, N, econf[-1]), flush=True)
    text = '\f'.join(right_pages)
    if args.split:
        text += '\f' + '\n\n[The Amharic column of the same pages, read separately]\n\n' + '\f'.join(left_pages)
    txtname = stem + '.ocr.txt'
    open(os.path.join(OUT, txtname), 'w', encoding='utf-8').write(text)
    eth = ethiopic(text)
    lat = len(re.findall(r'[A-Za-z]', text))
    valid = sum(1 for c in text if 0x1200 <= ord(c) <= 0x135A)
    valid_share = valid / eth if eth else None
    mean_conf = sum(econf) / len(econf) if econf else 0
    number_found = bool(expect and re.search(r'(?<!\d)' + re.escape(expect) + r'\s*/\s*20\d\d', text))
    good = mean_conf >= 80 and number_found and (valid_share is None or valid_share >= 0.9)
    files.append({
        'file': txtname, 'url': url, 'title': title, 'sha256_pdf': e.get('sha256'),
        'pages': N, 'language_mode': ('eng (right column) + amh+eng (left column)' if args.split else 'amh+eng'),
        'psm': '6', 'dpi': DPI, 'ocr_quality': 'good' if good else 'poor',
        'quality_detail': {'english_mean_word_confidence': round(mean_conf, 1), 'english_words': ewords,
                           'amharic_column_mean_word_confidence': round(sum(aconf) / len(aconf), 1) if aconf else None,
                           'ethiopic_chars': eth, 'latin_chars': lat,
                           'ethiopic_valid_share': round(valid_share, 4) if valid_share is not None else None,
                           'expected_number': expect, 'number_found': number_found},
        'chars': len(text), 'duplicate_of': None,
        'generatedAt': datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
    })
    print('  done: %d chars, English confidence %.1f, number %s found: %s -> %s'
          % (len(text), mean_conf, expect, number_found, 'good' if good else 'poor'), flush=True)

# the manifest is rewritten whole, keeping earlier rows for other urls
seen = {}
for f in files:
    seen[f['url']] = f
files = list(seen.values())
json.dump({'source': os.path.basename(args.dir.rstrip('/')), 'generatedAt': datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
           'tesseract': subprocess.run(['tesseract', '--version'], capture_output=True, text=True).stderr.split('\n')[0] or 'tesseract 5',
           'tessdata': 'system tessdata amh.traineddata + eng.traineddata (Ubuntu tesseract-ocr-amh)',
           'rasteriser': 'PyMuPDF %s @ %d dpi' % (fitz.VersionBind, DPI), 'psm': '6',
           'documents': len(files), 'pages': sum(f['pages'] for f in files),
           'chars': sum(f['chars'] for f in files), 'files': files},
          open(os.path.join(OUT, 'ocr-manifest.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('wrote', os.path.join(OUT, 'ocr-manifest.json'))
