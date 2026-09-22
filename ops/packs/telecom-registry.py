# -*- coding: utf-8 -*-
"""Builds knowledge/telecom/sources.json from the telecom harvest's three manifests and the scope decided below.

This is a generator only because the registry needs ~150 named Amharic pages (a page keyed by path AND query
cannot be slugged by rule, see fetch-pack.js NEEDS_NAME_DIR) and one explicit allowPdf entry per regulator PDF.
The output is a plain sources.json, edited and read like banking's; nothing at run time depends on this file.

    python3 ops/packs/telecom-registry.py [--out <path>]

Re-run it when the harvest is refreshed: it re-reads the manifests, re-chooses the Amharic page for each English slug
(the page's own ?lang=am view when the harvest holds it, else the Ethiopic-slug page its hreflang link points at) and
writes the registry again. Scope, the regulator PDF list and every note are edited here, in one place.
"""
import json, os, re, sys, hashlib
from urllib.parse import urlparse, quote

HARVEST = '/root/storage/packs/telecom-manual'
OUT = '/var/www/connectcare/binasmart/knowledge/telecom/sources.json'
if '--out' in sys.argv:
    OUT = sys.argv[sys.argv.index('--out') + 1]


def key_of(url):
    u = urlparse(url)
    p = quote(u.path.rstrip('/') or '/', safe="/:@!$&'()*+,;=-._~%")
    p = re.sub(r'%[0-9A-Fa-f]{2}', lambda m: m.group(0).lower(), p)
    return p + ('?' + u.query if u.query else '')


def manifest(host):
    m = json.load(open(os.path.join(HARVEST, host, 'manifest.json'), encoding='utf-8'))
    return m if isinstance(m, list) else (m.get('items') or m.get('files'))


def alt(items):
    return '|'.join(re.escape(x) for x in items)


# ---------------------------------------------------------------- ethiotelecom.et: English slugs in scope
ET = {
    'packages': [
        'mobile-packages', 'mobile-packages-2', 'package-offers', 'package-offer-new',
        'mobile-data-package-new', 'voice-package-new', 'voice-data-new', 'sms-package-new', 'social-media-packages',
        'long-validity-mobile-package', 'long-validity-package-personal', 'no-expiry-date-mobile-package',
        'micro-packages', 'multiple-validity-package', 'package-extender-packages', 'one-birr-package-new',
        'other-package-new', 'flexi-mobile-package', 'postpaid-mobile-package', 'post-paid-package',
        'postpaid-mobile', 'prepaid-mobile', 'student-package', 'youth-data-package', 'women-package',
        'disability-package', 'friends-family-package', 'good-morning-package-new', 'happy-hour-package',
        'weekend-package', 'birthday-package', 'day-by-day-data-package', 'hourly-and-daily-unlimited-package',
        'priority-access-data-package', 'premium-unlimited-mobile-packages%e2%80%8b', 'create-your-own-package',
        'mobile-share-plan', 'mobile-group-offering-package', 'mobile-recurring-incentive-plan',
        '20-discount-for-20-packages', '5g-mobile-package', '5g-mobile-packages', 'air-time-credit',
        'evdo-packages', 'superapp-special-package', 'telebirr-only-mobile-package', 'crbt',
        'adey-abeba-bulk-gift-package', 'promotional-device-bundled-offer',
        'fixed-line-voice-fixed-broadband-internet-combo',
        'win-back-your-fixed-line-voice-service-get-free-calling-minutes', 'iat-terms',
        'enterprise-starter-package-esp', 'business-mobile-offers', 'business-mobile-packages',
    ],
    'sim': ['esim', 'national-id', 'nid-temporary-registration-center'],
    'roaming': ['international-roaming', 'international-call-sms', 'international-data-services',
                'international-dialing-codes', 'international-services', 'international-vas',
                'international-visitors-plan', 'hajj-roaming'],
    'coverage': ['5g-launch', 'new-ethio-telecom-4g-lte-sites',
                 'fixed-bb-internet', 'fixed-bb-enterprise', 'fixed-line-services',
                 'fixed-line-service-personal', 'fixed-line-service-business', 'wireless-broadband',
                 'basic-internet-usage-guidelines'],
    'help': ['faq', 'contact-us', 'ardi-chat-bot'],
    'fraud': ['fraud-awareness', 'what-are-frequent-fraud-types', 'cyberawareness'],
    'legal': ['privacy-policy', 'app-privacy-policy'],
    'business': ['vpn', 'virtual-number', 'vas', 'mobile-conference-call', 'push-to-talk'],
}
ET_AM_NAMES = {'premium-unlimited-mobile-packages%e2%80%8b': 'premium-unlimited-mobile-packages'}
ET_SECTIONS_AM = {
    'packages': 'የሞባይል ጥቅሎች', 'sim': 'ሲም ካርድና መታወቂያ', 'roaming': 'ዓለም አቀፍና ሮሚንግ',
    'coverage': 'ሽፋንና ኢንተርኔት', 'help': 'እገዛ፣ ጥያቄዎችና አድራሻ', 'fraud': 'ማጭበርበርና ደህንነት',
    'legal': 'የግላዊነት መመሪያ', 'business': 'የንግድ አገልግሎቶች', 'other': 'ሌሎች አገልግሎቶች',
}

et_slugs = [s for v in ET.values() for s in v]
ET_ORPHAN_EXTRAS = {   # Ethiopic-slug pages that no English page links to but that hold something no English page does
    '/ዑምራ-የሮሚንግ-ጥቅል?lang=am': ('am-umrah-roaming-package', 'roaming'),
    '/የታሪፍ-ማሻሻያ-ስለማድረግ?lang=am': ('am-tariff-revision-notice', 'help'),
}
et_all = manifest('www.ethiotelecom.et')
et_ok = [e for e in et_all if e.get('file') and e.get('status') == 200]
et_keys_present = {key_of(e['url']) for e in et_ok}
path_slugs_et = {}
am_allow_keys = []          # exact keys of the Amharic page chosen for each English slug
am_choice = {}
from urllib.parse import unquote as _unq
hreflang_en = {}
for e in et_ok:
    k = key_of(e['url'])
    if e.get('lang') != 'am' or not k.endswith('?lang=am') or re.match(r'^/[A-Za-z0-9_.%-]+(/[A-Za-z0-9_.%-]+)*\?lang=am$', k) and '%' not in k.replace('%e2%80%8b', ''):
        continue
    t = open(os.path.join(HARVEST, 'www.ethiotelecom.et', e['file']), encoding='utf-8', errors='replace').read()
    m_ = re.search(r'hreflang="en" href="([^"]+)"', t)
    if m_:
        hreflang_en.setdefault(_unq(urlparse(m_.group(1)).path.strip('/')), []).append(k)
for s_ in et_slugs:
    k = '/' + s_
    name = ET_AM_NAMES.get(s_, s_)
    if '%' in s_:
        path_slugs_et[k] = name
    # the English slug's own ?lang=am view when it exists and answered 200, else the Ethiopic-slug page its
    # hreflang points at (the canonical Amharic post), else nothing
    view = k + '?lang=am'
    if view in et_keys_present:
        path_slugs_et[view] = 'am-' + name
        am_choice[s_] = view
    else:
        cands = sorted(hreflang_en.get(_unq(s_), []))
        if cands:
            path_slugs_et[cands[0]] = 'am-' + name
            am_choice[s_] = cands[0]
for orig, (slug, sec) in ET_ORPHAN_EXTRAS.items():
    kk = key_of('https://www.ethiotelecom.et' + orig)
    assert kk in et_keys_present, kk
    path_slugs_et[kk] = slug
    am_choice['extra:' + slug] = kk
am_only_keys = sorted(set(v for v in am_choice.values() if not re.match(r'^/[A-Za-z0-9_.-]+\?lang=am$', v)))
allow_et = ['^/(' + alt(et_slugs) + ')(\\?lang=am)?$']
if am_only_keys:
    allow_et.append('^(' + alt(am_only_keys) + ')$')

sections_et = []
for key in ['packages', 'sim', 'roaming', 'coverage', 'help', 'fraud', 'legal', 'business']:
    extra = [am_choice[s_] for s_ in ET[key] if am_choice.get(s_) in am_only_keys]
    extra += [am_choice['extra:' + n_] for o_, (n_, sec_) in ET_ORPHAN_EXTRAS.items() if sec_ == key]
    sections_et.append({'key': key, 'titleAm': ET_SECTIONS_AM[key],
                        'match': '^/(' + alt(ET[key]) + ')(\\?lang=am)?$' + ('|^(' + alt(extra) + ')$' if extra else '')})
sections_et.append({'key': 'other', 'titleAm': ET_SECTIONS_AM['other'], 'match': '^/'})

# ---------------------------------------------------------------- safaricom.et (English only)
SAF = {
    'packages': ['/en/personal/packages/data', '/en/personal/packages/sms', '/en/personal/packages/voice',
                 '/en/personal/bew-wifi-services/bet-wifi', '/en/personal/bew-wifi-services/special-offers',
                 '/en/personal/special-offers/top-deals', '/en/personal/special-offers/device-offers',
                 '/en/personal/special-offers/vo-lte', '/en/personal/getting-started/favorite-packages',
                 '/en/personal/vas/bulk-sms-and-ussd', '/en/personal/vas/games',
                 '/en/personal/vas/infotainment-service'],
    'sim': ['/en/personal/getting-started/get-sim-card'],
    'roaming': ['/en/personal/getting-started/roaming-and-internationals'],
    'business': ['/en/business/mobile-services/postpay', '/en/business/mobile-services/prepay',
                 '/en/business/mobile-services/sponsor-data', '/en/business/vas/enterprise-apn',
                 '/en/business/vas/enterprise-bulk-sms'],
    'coverage': ['/en/business/fixed-service/4g-5g-business-internet', '/en/business/fixed-service/fiber',
                 '/en/business/fixed-service/vpn', '/en/business/fixed-services/airfiber'],
    'help': ['/en/help-and-support/support/contact-us', '/en/help-and-support/faq/business-faq',
             '/en/help-and-support/support/anonymous-report'],
    'legal': ['/en/privacy-policy'],
}
SAF_SECTIONS_AM = {'packages': 'የሞባይል ጥቅሎች', 'sim': 'ሲም ካርድ', 'roaming': 'ዓለም አቀፍና ሮሚንግ',
                   'business': 'የንግድ አገልግሎቶች', 'coverage': 'ኢንተርኔትና ፋይበር', 'help': 'እገዛና አድራሻ',
                   'legal': 'የግላዊነት መመሪያ'}
saf_paths = [p for v in SAF.values() for p in v]
sections_saf = [{'key': k, 'titleAm': SAF_SECTIONS_AM[k], 'match': '^(' + alt(v) + ')$'} for k, v in SAF.items()]

# ---------------------------------------------------------------- eca.et
eca = manifest('www.eca.et')
ECA_HTML = ['about', 'consumer-affairs', 'services',
            'determination-of-significant-market-power-smp-and-interconnection-rates']
# basename fragment -> (slug, title)
ECA_PDF = [
    ('Communications-service-proclamation-1148-2019', 'communications-service-proclamation-1148-2019',
     'Communications Service Proclamation No. 1148/2019 (Negarit Gazette, 12 August 2019)', 'law'),
    ('personal_data_protection_proclamation_No_1321_2024', 'personal-data-protection-proclamation-1321-2024',
     'Personal Data Protection Proclamation No. 1321/2024 (Negarit Gazette, 24 July 2024)', 'law'),
    ('Universal-Access-Fund-Regulation-No-585-2026-2', 'universal-access-fund-regulation-585-2026',
     'Universal Access Fund Regulation No. 585/2026 (Council of Ministers, Negarit Gazette, 11 February 2026)', 'law'),
    ('SIM-Card-Registration-Directive-No.-799-2021English', 'directive-799-2021-sim-card-registration',
     'SIM Card Registration Directive No. 799/2021 (July 2021)', 'consumer'),
    ('Telecommunications-Consumer-Rights-and-Protection-Directive-No.-832-2021-English', 'directive-832-2021-consumer-rights-and-protection',
     'Telecommunications Consumer Rights and Protection Directive No. 832/2021 (August 2021)', 'consumer'),
    ('Telecommunications-Interconnection-Directive-No.-791-2021-English', 'directive-791-2021-interconnection',
     'Telecommunications Interconnection Directive No. 791/2021 (July 2021)', 'law'),
    ('Telecommunications-Licensing-Directive-No.-792-2021-English.pdf', 'directive-792-2021-licensing',
     'Telecommunications Licensing Directive No. 792/2021 (July 2021)', 'law'),
    ('Telecommunications-Infrastructure-Sharing-and-Collocation-Directive-No.-793-2021English', 'directive-793-2021-infrastructure-sharing',
     'Telecommunications Infrastructure Sharing and Collocation Directive No. 793/2021 (July 2021)', 'law'),
    ('Telecommunications-Quality-of-Service-Directive-No.-794-2021-English', 'directive-794-2021-quality-of-service',
     'Telecommunications Quality of Service Directive No. 794/2021 (July 2021)', 'consumer'),
    ('Telecommunications-Numbering-Directive-No.-795-2021-English', 'directive-795-2021-numbering',
     'Telecommunications Numbering Directive No. 795/2021 (July 2021)', 'law'),
    ('Telecommunications-Dispute-Resolution-Directive-No.-796-2021-English', 'directive-796-2021-dispute-resolution',
     'Telecommunications Dispute Resolution Directive No. 796/2021 (July 2021)', 'consumer'),
    ('Telecommunications-Lawful-Tariffs-Directive-No.-797-2021-English.pdf', 'directive-797-2021-lawful-tariffs',
     'Telecommunications Lawful Tariffs Directive No. 797/2021 (July 2021)', 'consumer'),
    ('Telecommunications-Competition-Directive-No.-798-2021-English', 'directive-798-2021-competition',
     'Telecommunications Competition Directive No. 798/2021 (July 2021)', 'law'),
    ('Telecommunications-Wholesale-National-Roaming-Directive-No.-800-2021-English', 'directive-800-2021-wholesale-national-roaming',
     'Telecommunications Wholesale National Roaming Directive No. 800/2021 (July 2021)', 'law'),
    ('1024-_COMMUNICATIONS_SERVICE_LICENSE_AND_REGULATORY_FEES_DIRECTIVE_NO._1024-2024-1', 'directive-1024-2024-license-and-regulatory-fees',
     'Communications Service License and Regulatory Fees Directive No. 1024/2024 (September 2024)', 'law'),
    ('_1024-2017.pdf', 'am-directive-1024-2017-license-and-regulatory-fees',
     'የኮሙኒኬሽን አገልግሎት ፈቃድ እና የሬጉላቶሪ ክፍያዎች መመሪያ ቁጥር 1024/2017 (መስከረም 2017)', 'law'),
    ('Determination-on-Mobile-and-Fixed-Telecommunications-Operators-with-SMP', 'determination-1-2024-significant-market-power',
     'Determination No. 1 of 2024 on Significant Market Power in relevant markets (April 2024)', 'regulator'),
    ('Determination-on-Mobile-and-Fixed-Termination-Rates', 'determination-2-2024-termination-rates',
     'Determination No. 2 of 2024 on Mobile and Fixed Termination Rates (April 2024)', 'regulator'),
    ('2022-06-22T15-17-24.693ZUniversal-Access-and-Service-Framework', 'universal-access-and-service-framework-2020-12',
     'Universal Access and Service Framework (December 2020 edition)', 'regulator'),
    ('Universal-Access-and-Service-Framework-2', 'universal-access-and-service-framework-2022-04',
     'Universal Access and Service Framework (final, April 2022 edition)', 'regulator'),
    ('FDRE-ICT-POLICY-ENGLISH-Final-Approved', 'national-ict-policy-and-strategy-2017',
     'National Information and Communication Technology Policy and Strategy (September 2017)', 'regulator'),
    ('DRAFT-CONSUMER-RIGHTS-AND-PROTECTION-CODE-OF-CONDUCT-ENG', 'safaricom-draft-consumer-code-of-conduct',
     'DRAFT Consumer Rights and Protection Code of Conduct of Safaricom Ethiopia (for consultation, December 2022)', 'consumer'),
    ('DRAFT-CONSUMER-RIGHTS-AND-PROTECTION-CODE-OF-CONDUCT-AMH', 'am-safaricom-draft-consumer-code-of-conduct',
     'ረቂቅ የደንበኞች መብቶች እና ጥበቃ የስነ ምግባር ደምብ — ሳፋሪኮም ቴሌኮሙኒኬሽን ኢትዮጵያ (ለባለድርሻ አካላት ምክክር የወጣ፣ ታኅሣሥ 2022)', 'consumer'),
]
allow_pdf, path_slugs_eca, pdf_titles = [], {}, {}
by_sha = {}
for e in eca:
    if e.get('contentType') != 'application/pdf':
        continue
    k = key_of(e['url'])
    for frag, slug, title, sec in ECA_PDF:
        if frag.lower() in k.lower():
            allow_pdf.append('^' + re.escape(k) + '$')
            by_sha.setdefault(e['sha256'], []).append((k, slug, title))
            break
# among byte-identical uploads the importer keeps the plainest key (fewest percent escapes, then shortest, then
# alphabetical): name only that one, and check no fragment matched two different documents
for sha, lst in by_sha.items():
    lst.sort(key=lambda t: (1 if re.search(r'%[0-9a-f]{2}', t[0]) else 0, len(t[0]), t[0]))
    k, slug, title = lst[0]
    path_slugs_eca[k] = slug
    pdf_titles[k] = title
slugs_seen = list(path_slugs_eca.values())
assert len(slugs_seen) == len(set(slugs_seen)), 'two PDFs share a slug'
sections_eca = [
    {'key': 'consumer', 'titleAm': 'የተጠቃሚ መብትና ቅሬታ',
     'match': '^/consumer-affairs$|^/wp-content/uploads/.*(SIM-Card-Registration|Consumer-Rights|Quality-of-Service|Dispute-Resolution|Lawful-Tariffs|CONSUMER-RIGHTS)',
     'matchFlags': 'i'},
    {'key': 'regulator', 'titleAm': 'ተቆጣጣሪው ተቋም',
     'match': '^/(about|services|determination-of-significant-market-power-smp-and-interconnection-rates)$|^/wp-content/uploads/.*(Determination|Framework|ICT-POLICY)',
     'matchFlags': 'i'},
    {'key': 'law', 'titleAm': 'አዋጆችና መመሪያዎች', 'match': '^/wp-content/uploads/'},
]

PACK = {
    'id': 'telecom',
    'generatedBy': 'ops/packs/fetch-pack.js --pack telecom',
    'logPrefix': 'telecom',
    'noteTitle': '📡 Telecom knowledge pack',
    'packFormat': '2',
    '_amHeaders': 'Every ENGLISH document of this pack carries an Amharic title and an Amharic key-fact summary in its header when ops/packs/am-headers.js has written one into knowledge/telecom/am-headers.json; the renderer only reads that file. Ethio telecom publishes an Amharic version of most of its pages and those are their own documents (lang am); Safaricom Ethiopia and the regulator publish English only, apart from three Amharic PDFs.',
    'amHeaders': True,
    '_manual': "The pack is a hand harvest from the owner's laptop (ethiotelecom.et and eca.et are unreachable or flaky from the server). ops/packs/freshness.js reads this block: once a month, on the first Sunday run (day of month 1 to 7), it says so and points at the how-to; every run it fetches the sources named in serverChecks - only safaricom.et answers the server - and compares the text the pack's own reader takes from the live page with the harvested page, reporting a difference and rewriting nothing.",
    'manual': {'reminderDayMax': 7, 'serverChecks': ['safaricom'], 'harvestRoot': '/root/storage/packs/telecom-manual',
               'howTo': 'ops/harvest/telecom/README.md (run the harvest on a laptop, ship it with ship_tel.py, then build the pack)'},
    'disclaimerEn': 'Package prices, validity periods, tariffs, coverage and short codes change, often without notice, and laws and directives can be amended. This is the page or document exactly as the operator or the Ethiopian Communications Authority published it on the date above. Confirm with the operator (its app, USSD menu or shop) or with the Authority before you act on any figure or rule.',
    'disclaimerAm': 'የጥቅል ዋጋ፣ የአገልግሎት ታሪፍ፣ የሽፋን አድማስና አጭር ቁጥሮች ያለማስታወቂያ ይለወጣሉ፤ ሕጎችና መመሪያዎችም ሊሻሻሉ ይችላሉ። ይህ ገጽ ወይም ሰነድ ከላይ በተጠቀሰው ቀን ኦፕሬተሩ ወይም የኢትዮጵያ ኮሙኒኬሽን ባለሥልጣን ባሳተመው መልኩ ነው። በማንኛውም ቁጥር ወይም ደንብ ላይ ከመወሰንዎ በፊት ኦፕሬተሩን (በመተግበሪያው፣ በዩኤስኤስዲ ወይም በሱቅ) ወይም ባለሥልጣኑን ያረጋግጡ።',
    'headerAmTemplate': 'ይህ ገጽ {fromAm} ኦፊሴላዊ ድረ-ገጽ {langWordAm} የተወሰደ ነው። {disclaimerAm}',
    '_ocrNote': 'A document built from OCR text says so in its own header, not only in its front matter. The Authority wrote the regulation; a machine read it off a photograph of paper, and a figure or an article number in it may be one the machine got wrong. {ocrPages} and {ocrQuality} are the page count and the grade the OCR run itself measured.',
    'ocrNoteEn': 'How this page was read: the Ethiopian Communications Authority published it only as a scanned PDF with no text layer, so it was read by OCR on 2026-09-22 (Tesseract 5, 300 dpi, Amharic and English; page images: {ocrPages}) and the transcription was graded {ocrQuality}. The wording is the Authority\'s; the reading is a machine\'s, so check any figure or article number against the PDF itself before you act on it.',
    'ocrNoteAm': 'ይህ ሰነድ ከኢትዮጵያ ኮሙኒኬሽን ባለሥልጣን የተገኘው በስካን (በምስል) መልክ ብቻ ስለሆነ በኦሲአር (OCR) ተነቦ ወደ ጽሑፍ ተቀይሯል፤ የገጽ ብዛት፦ {ocrPages}፤ የንባቡ ጥራት «{ocrQuality}» ተብሎ ተመዝኗል። ቃላቱ የባለሥልጣኑ ናቸው፤ ንባቡ ግን የማሽን ነው፤ ስለዚህ ማንኛውንም ቁጥር ወይም የአንቀጽ ቁጥር ከመጠቀምዎ በፊት ከዋናው ሰነድ ጋር ያመሳክሩ።',
    'maskNoteEn': 'Phone numbers on this page are masked. A personal mobile number is written 251•••••NNNN - only its last four digits - because BinaSmart does not republish mobile numbers in full: a page of them inside a public repository is a harvestable list rather than a page somebody has to visit. Landlines, short codes such as 994 and USSD codes are untouched. The page as the institution published it, every number complete, is at {url}.',
    'maskNoteAm': 'በዚህ ገጽ ላይ ያሉት የሞባይል ስልክ ቁጥሮች ተሸፍነዋል፤ የሚታየው የመጨረሻዎቹ አራት አሃዞች ብቻ ናቸው (251•••••NNNN)። ቢና የሞባይል ቁጥሮችን ሙሉ በሙሉ አያሳትምም። የመደበኛ ስልክ መስመሮች፣ እንደ 994 ያሉ አጭር ቁጥሮችና የዩኤስኤስዲ ኮዶች አልተነኩም። ተቋሙ ባሳተመው መልኩ ሙሉ ቁጥሮች ያሉበት ገጽ በ{url} ይገኛል።',
    'headerEnTemplate': 'Source: {url} (official {siteName} page, {langWord}), fetched {today}. Everything below is that page as the institution wrote it — every price, validity, allowance, code and condition is copied, not restated. Where a table on the original page is a picture, the picture is not reproduced and no figure is supplied for it. {disclaimerEn} BinaSmart is not a telecom operator or a regulator: this page is information, not advice, and nothing here activates a package, registers a SIM card, moves money or files a complaint.',
}

common_deny_html = ['_files/', r'\.(pdf|jpg|jpeg|png|gif|svg|zip|docx?|xlsx?|mp4|mp3)$']

sites = [
    {
        'id': 'ethiotelecom', 'name': 'Ethio telecom', 'nameAm': 'ኢትዮ ቴሌኮም', 'host': 'www.ethiotelecom.et',
        'slugPrefix': 'telecom-ethiotelecom',
        'maskPhones': True,
        'fetch': 'dir', 'dir': 'www.ethiotelecom.et', 'harvestedAt': '2026-09-21/22', 'crawlDelaySeconds': 5,
        'lang': 'en', 'hasAmharic': True,
        'titleSuffix': r'\s*[-–|]\s*Ethio telecom\s*$',
        'langOverrides': [{'match': r'\?lang=am$', 'lang': 'am'}],
        'langNote': 'The language is in the query string, exactly as in the banking pack: /esim is English and /esim?lang=am is Amharic, and they are two documents. A page whose ?lang=am body holds under 300 Ethiopic characters is recorded as English by the importer\'s own measurement.',
        'maxPages': 400,
        'dedupAgainstPacks': ['banking'],
        'dedupNote': 'A paragraph of 80 characters or more that a live banking document already holds word for word is taken out of these pages (Ethio telecom general FAQ, Amharic, embeds the whole telebirr FAQ that the banking pack holds as ethiotelecom-am-telebirr-faq).',
        'htmlPrep': [{'match': '(?<![0-9])([1-9])(0[79][0-9]{8})(?![0-9])', 'flags': 'g', 'replace': '$1 $2'}],
        'htmlPrepNote': 'The Virtual Number page gives a dialling example: a prefix digit followed directly by a full local mobile number, eleven digits with no space. maskPhones does not mask a number with a digit in front of it (an identifier is not a phone), so the example is given its space back and the mask then reads it as the number it is. Nothing else is changed.',
        'minChars': 150,
        'amFloor': 80,
        'amFloorNote': 'The pack-wide floor of 300 Ethiopic characters called 18 Amharic price pages English (a table of numbers under a short Amharic label); 80 keeps a page that is really untranslated English (5g-launch, create-your-own-package) recorded as English.',
        'minCharsNote': 'A telecom price list is a five-row table and two lines of terms; the pack-wide 400-character floor called 19 real package pages thin. 150 characters of page text (after the mega-menu is stripped) still refuses an empty shell.',
        'reach': 'unreachable from this server',
        'checked': '2026-09-22',
        'why': 'www.ethiotelecom.et answers inside Ethiopia and not from this VPS (measured 2026-09-16 for the banking pack, three https probes and one http probe, no bytes). The pages were harvested from Ibrahim\'s laptop on 2026-09-21/22 (Python stdlib fetcher, 5 s pacing, robots respected, every file sha256-verified) and copied to /root/storage/packs/telecom-manual/www.ethiotelecom.et. The harvest holds 517 HTML pages: 183 English, 319 Amharic, 13 Oromo, 1 Somali, 1 Tigrinya.',
        'costsUs': 'The pack holds the consumer-facing package, SIM, roaming, coverage, fixed-line and FAQ pages in English and in Amharic. It does not hold the package price tables that the site draws as pictures (the documents say so where it happens), the app, or the Oromo, Somali and Tigrinya pages.',
        'workaround': 'Re-probe on every freshness run: the day www.ethiotelecom.et answers from this server this entry can become fetch: sitemap.',
        'allow': allow_et,
        'deny': common_deny_html + [r'\?lang=(Tig|om|so)$'],
        'denyNote': 'Oromo, Somali and Tigrinya variants stay on disk in the harvest and are NOT indexed yet (Oromo comes later). The telebirr, mobile-money, credit and saving pages (telebirr, mela, wabi, sinq, enderas, adrash, sanduq, endekise, virtual-visa-card, remittance-telebirr, airtime-top-up, international-airtime-top-up, monthly-telecom-bill-payment-options, getting-started and everything under /telebirr/) belong to the banking pack and are not allowed here: a page lives in one pack only. Enterprise IT solutions, news, investor relations, careers, galleries, promotions and the site map are out of scope by not being named in allow.',
        'pathSlugs': path_slugs_et,
        'pathSlugsNote': 'Every Amharic page is named am-<the English slug it shares>, because ?lang=am is not a readable file name. premium-unlimited-mobile-packages carries a zero-width space in its address, which is why its escape is named by hand.',
        'sections': sections_et,
    },
    {
        'id': 'safaricom', 'name': 'Safaricom Ethiopia', 'nameAm': 'ሳፋሪኮም ኢትዮጵያ', 'host': 'www.safaricom.et',
        'slugPrefix': 'telecom-safaricom',
        'maskPhones': True,
        'fetch': 'dir', 'dir': 'www.safaricom.et', 'harvestedAt': '2026-09-21', 'crawlDelaySeconds': 5,
        'lang': 'en', 'hasAmharic': False,
        'titleFrom': 'heading',
        'pageTitles': {
            '/en/personal/packages/data': 'Data packages (prepaid)',
            '/en/personal/packages/sms': 'SMS packages (prepaid)',
            '/en/personal/packages/voice': 'Voice packages (prepaid)',
            '/en/personal/getting-started/get-sim-card': 'Get a Safaricom SIM card',
            '/en/personal/getting-started/roaming-and-internationals': 'Roaming and international calls',
            '/en/personal/special-offers/vo-lte': 'VoLTE (voice over 4G)',
            '/en/help-and-support/support/contact-us': 'Contact Safaricom Ethiopia (customer care)',
            '/en/business/mobile-services/postpay': 'Business postpaid mobile',
            '/en/business/mobile-services/prepay': 'Business prepaid mobile',
        },
        'htmlPrep': [{'match': '</p></div></div><div class="text-white text-xl font-light "><div class="revertListsStyle"><p>',
                      'flags': 'g', 'replace': ' — '}],
        'htmlPrepNote': 'A Safaricom package card is one <p> for the allowance and a second <p> for the price, and read as text they are two unrelated lines. The two are joined with an em dash so the row reads "100 MB — 5 ETB". No word or figure is added or changed.',
        'keepNumericParagraphs': True,
        'keepNumericParagraphsNote': 'Safaricom draws its packages as cards ("1 GB", "45 ETB") and the same card text recurs across the data, voice and SMS pages; the pack-wide rule that a paragraph repeated on 15 percent of the site pages is template deleted the prices. A paragraph with a digit in it is never template on this site.',
        'maxPages': 60,
        'dedupAgainstPacks': ['banking'],
        'minChars': 150,
        'reach': 'up',
        'checked': '2026-09-22',
        'why': 'Harvested from Ibrahim\'s laptop on 2026-09-21 with the same fetcher as the Ethio telecom pages; 31 HTML pages, English only (the /am/ paths answer 200 with the text "Page data not found"). Six sitemap pages answer 200 with that same text and were dropped by the harvester: /en/help-and-support, /en/help-and-support/faq, /en/help-and-support/terms-and-privacy and the three /en/whats-new pages.',
        'costsUs': 'The M-PESA pages are in the banking pack (source m-pesa.safaricom.et) and are not fetched here. Careers, leadership, investor and tender pages are out of scope.',
        'workaround': 'None needed for the pages held. The host DOES answer this server (checked 2026-09-22), so ops/packs/freshness.js compares its live pages with the harvest every week (pack.manual.serverChecks) and reports a difference; it never rewrites a page, a re-harvest does.',
        'allow': ['^(' + alt(saf_paths) + ')$'],
        'deny': common_deny_html,
        'denyNote': 'Only the named consumer and business pages are allowed. /en/about and /en/about/our-leadership are company pages, the six soft-404 pages hold nothing.',
        'sections': sections_saf,
    },
    {
        'id': 'eca', 'name': 'Ethiopian Communications Authority', 'nameAm': 'የኢትዮጵያ ኮሙኒኬሽን ባለሥልጣን', 'host': 'www.eca.et',
        'slugPrefix': 'telecom-eca',
        'maskPhones': True,
        'fetch': 'dir', 'dir': 'www.eca.et', 'harvestedAt': '2026-09-21', 'crawlDelaySeconds': 5,
        'lang': 'en', 'hasAmharic': True,
        'titleSuffix': r'\s*[-–|]\s*ECA\s*$',
        'langOverrides': [],
        'maxPages': 40, 'maxPdfs': 60,
        'minChars': 200,
        'keepNumericParagraphs': True,
        'pdfSplit': True,
        'pdfLangFromText': True,
        'pdfCrop': [
            {'match': 'communications-service-proclamation-1148-2019', 'x': 316, 'y': 30, 'W': 296, 'H': 740},
            {'match': 'personal_data_protection_proclamation_no_1321_2024', 'x': 316, 'y': 30, 'W': 296, 'H': 740},
        ],
        'pdfCropNote': 'Proclamation 1148/2019 and Proclamation 1321/2024 are bilingual Negarit Gazette pages, Amharic on the left and English on the right. The 2019 gazette sets its Amharic in a pre-Unicode font that pdftotext returns as noise, so both are read as the English right-hand column only (pdftotext -x 316 -y 30 -W 296 -H 740). Measured on 1148/2019: 4,902 of the 4,926 English words of a whole-page reading survive the crop (the 24 lost are the masthead); on 1321/2024, 5,842 of 5,847. The Amharic column of 1321/2024 has a good text layer and is a known gap in this pack (the law source holds an Amharic summary of it).',
        'reach': 'up',
        'checked': '2026-09-22',
        'why': 'www.eca.et is a WordPress site whose public REST endpoints list every page and PDF. The bytes here were harvested from Ibrahim\'s laptop on 2026-09-21 (17 HTML, 46 PDF, 3 REST JSON indexes) and copied to /root/storage/packs/telecom-manual/www.eca.et. Universal Access Fund Regulation 585/2026 is a scan with no text layer and was read by OCR on this server (ops/packs/ocr-pdfs.py, sidecar in www.eca.et/ocr/).',
        'costsUs': 'The wholesale offers (Ethio telecom and Safaricom RIO and RISO, 100 to 250 thousand characters each) are not consumer material and are not in the pack; the 2023 draft fee directives are superseded by 1024/2024 and 1024/2017; press releases, licence-B RFQ notices, the organogram and stakeholder-consultation notice pages are not law. The statistics and FAQ pages are plugin shortcodes with no text in the HTML.',
        'workaround': 'None: every instrument named in the harvest README is here except the ones listed above.',
        'allow': ['^/(' + alt(ECA_HTML) + ')$'],
        'deny': ['_files/', r'\.(jpg|jpeg|png|gif|svg|zip|docx?|xlsx?|mp4|mp3)$'],
        'allowPdf': allow_pdf,
        'allowPdfNote': 'Every entry is a named PDF, not a pattern. Byte-identical uploads (four copies of Directive 797/2021, two of 792/2021, two of the ICT policy, two of the Safaricom draft code) are one document; the importer keeps the plainest address.',
        'pdfTitles': pdf_titles,
        'pathSlugs': path_slugs_eca,
        'sections': sections_eca,
    },
]

reg = {
    'version': 1,
    '_about': 'Official sources for the BinaSmart telecom knowledge pack (the fourth sector pack, after travel, banking and business). ops/packs/fetch-pack.js --pack telecom reads this file and nothing else. All three sites are `fetch: dir`: they answer inside Ethiopia and not from this VPS, so their pages were harvested by hand from a machine where they answer and copied to /root/storage/packs/telecom-manual/<host>/, and `ops/packs/fetch-pack.js --pack telecom --from-dir /root/storage/packs/telecom-manual` builds them through exactly the same extract, boilerplate strip, header and writer as a fetched site, taking the url and the date from the harvest manifest. The harvest is never committed; only the documents. This pack INFORMS ONLY: no login, account, payment or registration page is ever taken, because Bini must never look like a way to activate a package, register a SIM or file a complaint.',
    'pack': PACK,
    'sites': sites,
    'references': [
        {'id': 'banking-telebirr', 'name': 'telebirr, mobile money, credit and saving pages of ethiotelecom.et', 'url': 'https://www.ethiotelecom.et/telebirr', 'fetch': 'none',
         'note': 'Already in the banking pack (source banking, slugs ethiotelecom-*, built from /root/storage/packs/banking-manual/www.ethiotelecom.et). This pack does not take them: a page lives in one pack only.'},
        {'id': 'banking-mpesa', 'name': 'M-PESA (m-pesa.safaricom.et)', 'url': 'https://m-pesa.safaricom.et/', 'fetch': 'none',
         'note': 'Already in the banking pack (source m-pesa.safaricom.et, built from its own harvest); this pack fetches only www.safaricom.et.'},
        {'id': 'law-eca-consumer-complaint', 'name': 'How to file a complaint against a telecom operator (hand-written summary)', 'url': 'https://eca.et/consumer-affairs/', 'fetch': 'none',
         'note': 'knowledge/law/telecom-consumer-complaint-eca-directive-832-2021.md is an owner-written summary in source law. It is not a copy of a page and stays; this pack adds the consumer-affairs page itself and Directive 832/2021 in full.'},
        {'id': 'law-stolen-phone', 'name': 'What to do when a phone is stolen (hand-written guide)', 'url': 'https://www.ethiotelecom.et/faq/', 'fetch': 'none',
         'note': 'knowledge/law/stolen-phone-police-report-sim-block.md, source law, hand-written from the Ethio telecom FAQ and police pages. It stays; this pack adds the FAQ page itself.'},
        {'id': 'law-pdp', 'name': 'Personal Data Protection Proclamation 1321/2024 (abridged, Ministry of Justice text)', 'url': 'https://justice.gov.et/en/law/personal-data-protection-proclamation/', 'fetch': 'none',
         'note': 'knowledge/law/personal-data-protection-proclamation-1321-2024.md, source law, 13 KB, from justice.gov.et. This pack holds the full English text from the Authority\'s own copy of the gazette (245 KB layout text, 108 KB as the English column) as a different document. Overlap is deliberate and reported.'},
        {'id': 'eservices-ethio-telecom', 'name': 'Ethio telecom services on eservices.gov.et', 'url': 'https://www.eservices.gov.et/en/services', 'fetch': 'none',
         'note': 'knowledge/eservices/ethio-telecom.md lists 20 services from the government portal. Different publisher, different page.'},
    ],
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(reg, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('wrote', OUT, len(json.dumps(reg)), 'bytes;', len(allow_pdf), 'pdf allow entries;', len(path_slugs_et), 'et pathSlugs')
