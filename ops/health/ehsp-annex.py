# -*- coding: utf-8 -*-
"""Annex II of Ethiopia's Essential Health Services Package, turned from a table into sentences.

Table 19 states, for every intervention the health system provides, WHICH FACILITY LEVEL provides it
and WHETHER THE PATIENT PAYS. That is precisely what Dr Afiya exists to answer, and it is the only
document found so far that answers it for the whole system rather than one programme.

The catch is that the answer lives in column position. A row reads

    5   Family Planning   Provision of oral contraceptive   X    X    X    X    X    X   Free

and those Xs mean nothing without a header line that the chunker will place in a different chunk.
Embedded as-is, every row becomes a vector for "X X X X X" and matches every other row equally well.
So the geometry is converted to language here, before chunking ever happens.

Things the document does that broke earlier attempts, each fixed below:
  - "Xpert" (the TB test) contains an X. Only standalone X marks count.
  - The payment word is itself split across columns and arrives as "sharing" / "recovery" / "free",
    never as the full phrase. Matched on the final token.
  - Page 52 is a different table (priority ranking) that also uses numbered rows.
  - There is a sixth marked column, "Co", which the document's own legend never defines. It is
    dropped rather than guessed at - inventing "community" would put a fabricated fact in front of a
    patient, which is the one thing this corpus exists to prevent.
"""
import re, collections

CODES = ['HP', 'HC', 'PH', 'GH', 'TH']
LEVELS = ['health posts', 'health centres', 'primary hospitals', 'general hospitals', 'tertiary hospitals']
PAY = {'free': 'free of charge', 'sharing': 'on a cost-sharing basis',
       'recovery': 'on a cost-recovery basis'}
HDR = re.compile(r'\bHP\b.{1,12}\bHC\b.{1,12}\bPH\b.{1,12}\bGH\b.{1,12}\bTH\b')
XMARK = re.compile(r'(?<![A-Za-z])X(?![A-Za-z])')

# Fetch and extract, so this runs from nothing. www.moh.gov.et serves the document too but drops
# roughly one connection in five - retry rather than concluding the site is down, which is the
# mistake that sent this search to the Internet Archive in the first place.
import os, subprocess as sp
URL = 'https://www.uib.no/sites/w3.uib.no/files/attachments/essential_health_service_package_ethiopia_2019_0.pdf'
if not os.path.exists('/root/ehsp.txt'):
    for _ in range(6):
        sp.run(['curl', '-4', '-sL', '--max-time', '180', '-A', 'Mozilla/5.0', '-o', '/root/ehsp.pdf', URL])
        if os.path.exists('/root/ehsp.pdf') and os.path.getsize('/root/ehsp.pdf') > 1_000_000: break
    sp.run(['pdftotext', '-layout', '/root/ehsp.pdf', '/root/ehsp.txt'], check=True)

t = open('/root/ehsp.txt', encoding='utf-8', errors='replace').read()
rows, program, pages_used = [], '', 0

for page in t.split(chr(12)):
    lines = page.split(chr(10))
    hdr = next((l for l in lines if HDR.search(l)), None)
    if not hdr:
        continue
    col = [re.search(r'\b%s\b' % c, hdr).start() for c in CODES]
    if len(set(col)) < 5:
        continue
    pages_used += 1
    for s in (l.rstrip() for l in lines):
        bare = s.strip()
        if not bare or HDR.search(s):
            continue
        # A programme heading is identified by WHERE IT SITS, not by how it reads. Measured in the
        # extracted text: real headings sit at indent 0-8, wrapped intervention text at 29+. The
        # first version judged on length and capitalisation alone and promoted wrapped table text to
        # a programme area — which is how the corpus ended up with interventions labelled
        # "(ACE inhibitors, and mineralocorticoid antagonists; Asthma)". The columns were solved by
        # geometry; the headings should have been too.
        if not re.match(r'^\d{1,4}\s', bare) and not XMARK.search(s):
            col0 = len(s) - len(s.lstrip())
            if col0 <= 8:
                head = re.split(r'\s{3,}', bare)[0].strip()   # cut column bleed sharing the line
                if (re.match(r"^[A-Z][A-Za-z0-9 /&,'.-]{2,57}$", head)
                        and head.count(')') <= head.count('(')   # a tail, not a heading
                        and not head.lower().startswith(
                            ('table', 'annex', 'ic ', 'level', 'pay', 'sub', 'components',
                             'list of', 'contents', 'interventions'))):
                    program = head
            continue
        if not re.match(r'^\s*\d{1,4}\s', s):
            continue
        head = re.sub(r'^\s*\d{1,4}\s+', '', s[:col[0]]).strip()
        parts = [p.strip() for p in re.split(r'\s{3,}', head) if p.strip()]
        if not parts:
            continue
        sub, name = (parts[0], ' '.join(parts[1:])) if len(parts) > 1 else ('', parts[0])
        at = [LEVELS[i] for i, c in enumerate(col) if XMARK.search(s[max(0, c - 2):c + 3])]
        tail = s[col[-1] + 3:].split()
        pay = PAY.get(tail[-1].lower(), '') if tail else ''
        if not at and not pay:
            continue                    # a row from some other table that merely starts with a number
        rows.append({'program': program, 'sub': sub, 'name': name, 'at': at, 'pay': pay})

print('%d interventions from %d table pages' % (len(rows), pages_used))
print('  with facility levels: %d' % sum(1 for r in rows if r['at']))
c = collections.Counter(r['pay'] or 'payment not stated' for r in rows)
print('  ' + ', '.join('%s %d' % (k, v) for k, v in c.most_common()))

def sentence(r):
    a = r['at']
    where = (' is provided at ' + (', '.join(a[:-1]) + ' and ' + a[-1] if len(a) > 1 else a[0])) if a else ''
    pay = (', ' + r['pay']) if r['pay'] else ''
    bits = [b for b in (r['program'], r['sub']) if b and b.lower() != r['name'].lower()]
    return '%s%s%s%s.' % (r['name'], ' (%s)' % '; '.join(bits) if bits else '', where, pay)

head = ('---\n'
 'url: "https://www.moh.gov.et/"\n'
 'title: "Essential Health Services Package of Ethiopia (Ministry of Health, November 2019) - Annex II: which facility provides each service, and who pays"\n'
 'lang: "en"\n'
 'source_note: "Ministry of Health of Ethiopia, Essential Health Services Package, November 2019, Annex II Table 19. Retrieved from the University of Bergen mirror; the ministry site serves it too but drops roughly one connection in five. This file is a CONVERSION, not the original text: the annex is a table whose meaning is carried by column position, so each row has been rewritten as a sentence naming the facility levels in full. The sixth marked column, Co, is omitted because the document defines IC, HP, HC, PH, GH and TH and never defines Co. Payment categories are the document\'s own. Service availability and fees change; confirm with the facility."\n'
 '---\n\n'
 '# Which facility provides each health service in Ethiopia, and whether the patient pays\n\n'
 'From the Essential Health Services Package of Ethiopia (November 2019), Annex II, Table 19.\n'
 'Levels are health post, health centre, primary hospital, general hospital and tertiary hospital.\n')

out, cur = [head], None
for r in rows:
    if r['program'] != cur:
        cur = r['program']; out.append('\n## %s\n' % (cur or 'Interventions'))
    out.append(sentence(r))
open('/root/ehsp_annex.md', 'w', encoding='utf-8').write('\n'.join(out))
print('\n--- sample ---')
for i in (0, 2, 250, 251, 600, 601, 900):
    if i < len(rows): print('  ' + sentence(rows[i])[:168])
