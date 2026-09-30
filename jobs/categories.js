'use strict';
// What field is this vacancy in?
//
// Rules, not a model. A category is a navigation label and a search-engine landing page, and it must be
// the same tomorrow as today for the same advert - a classifier that reshuffles the board every night
// breaks the very pages we want to rank. It is also free, instant, and auditable: when a job lands in
// the wrong place, the fix is one word in a list rather than a prompt nobody can reason about.
//
// Order matters. The first category whose pattern matches wins, so the specific sits above the general:
// "Credit Analyst" is banking before it is analysis, "Sales Engineer" is sales before engineering.
// Anything unmatched stays null and shows under "Other" - an honest gap we can read and close, rather
// than a wrong label that quietly sends a nurse to the construction page.

const CATEGORIES = [
  { slug: 'banking', en: 'Banking & Insurance', am: 'ባንክና መድን',
    re: /\b(?:bank|banking|branch manager|teller|credit analyst|loan|insuranc|underwrit|actuar|claims?|bancassur|micro ?financ|customer service officer)/i },
  { slug: 'accounting', en: 'Accounting & Finance', am: 'ሒሳብና ፋይናንስ',
    re: /\b(?:account(ant|ing|s)?\b|financ|audit|auditor|cashier|budget|tax|treasur|payroll|ifrs|book ?keep|cost control)/i,
    reAm: /ካሸር|ገንዘብ ያዥ/ },
  // IT sits above engineering deliberately (23 September 2026 audit). The engineering pattern
  // matches 'engineer' and 'technician', so with engineering first a Software Engineer, a DevOps
  // Engineer, a Network Technician and an IT Technician were all filed under Engineering - 45 of
  // them. The specific must sit above the general, which is the rule this list already states.
  { slug: 'it', en: 'IT & Software', am: 'አይቲና ሶፍትዌር',
    re: /\b(?:it |i\.t\.|software|developer|programm|data ?(base|center|analyst|scien)|network|system admin|cyber|web|devops|erp|oracle|sql)/i },
  { slug: 'engineering', en: 'Engineering', am: 'ኢንጂነሪንግ',
    re: /\b(?:engineer(ing)?|mechanic(al)?|electric(al|ian)?|civil|surveyor|quantity survey|technician|maintenance|machin|welder|plumb|drafts? ?(man|person)|driller|hydrogeolog|crusher|quarry|tyre ?man)/i,
    reAm: /መሐንዲስ|መሀንዲስ|ኳንቲቲ ሰርቬየር|ክሬሸር/ },
  { slug: 'health', en: 'Health & Medical', am: 'ጤናና ሕክምና',
    re: /\b(?:nurse|nursing|doctor|physician|medical|health|pharmac|laborator|midwif|dental|clinic|surgeon|radiolog|nutrition|iycf|wash officer|physiotherap|microbiolog)/i,
    reAm: /ማይክሮባዮሎጂ|ነርስ|ፋርማሲ/ },
  { slug: 'education', en: 'Education & Training', am: 'ትምህርትና ሥልጠና',
    re: /\b(?:teacher|lecturer|instructor|tutor|academic|school|kindergarten|preschool|trainer|training officer|curriculum|principal|scholarship|scolarship)/i },
  { slug: 'sales', en: 'Sales & Marketing', am: 'ሽያጭና ገበያ',
    re: /\b(?:sales|marketing|brand|merchandis|promot|business development|customer relation|shop keeper|salesperson|distributor)/i },
  { slug: 'ngo', en: 'NGO & Development', am: 'መንግሥታዊ ያልሆኑ ድርጅቶች',
    re: /\b(?:ngo|programme? officer|project officer|monitoring and evaluation|monitoring,? evaluation|\\(meal\\)|accountability and learning|rapid response|community (worker|mobiliz|facilitat)|m&e|humanitarian|protection officer|livelihood|gender officer|community mobiliz|donor|grant)/i },
  { slug: 'logistics', en: 'Driving & Logistics', am: 'ትራንስፖርትና ሎጂስቲክስ',
    re: /\b(?:driver|logistic|warehouse|store ?keeper|supply chain|procurement|fleet|dispatch|transport|import|export|custom clearance|forklift|motorist|expeditor|transitor|purchas|strategic sourcing)/i,
    reAm: /ሹፌር|የመኪኖች ስምሪት/ },
  { slug: 'admin', en: 'Admin & HR', am: 'አስተዳደርና ሰው ሀብት',
    re: /\b(?:human resource|hr |hr officer|admin|administrat|secretar|receptionist|office (assistant|manager)|clerk|personnel|record officer|data encoder|messenger|reception\b|secretery|personal assistant|liaison officer|registrar|call (cent(er|re) )?operator|telecaller)/i,
    reAm: /ተላላኪ|ሴክሬተሪ|ፀኃፊ|ጸሐፊ|ጉዳይ አስፈ|የግል ረዳት|ሰራተኛ አስተዳደር|ሪሰፕሽኒስት/ },
  { slug: 'hospitality', en: 'Hotel & Hospitality', am: 'ሆቴልና መስተንግዶ',
    re: /\b(?:hotel|waiter|waitress|chef|cook|barista|housekeep|front office|restaurant|catering|bartender|lifeguard|tour|travel consultant|cafe?teria|cafteria|laundry)/i,
    reAm: /የመኝታ አገልግሎት|አስተናጋጅ|ምግብ አብሳይ/ },
  { slug: 'construction', en: 'Construction & Real estate', am: 'ግንባታና ሪል እስቴት',
    re: /\b(?:construction|site (engineer|supervisor)|foreman|architect|real estate|property|contract administrat|tender (and|&) estimation|estimation engineer|site manager)/i,
    reAm: /ኮንስትራክሽን/ },
  { slug: 'agriculture', en: 'Agriculture & Food', am: 'ግብርናና ምግብ',
    re: /\b(?:agricultur|agronom|farm|horticultur|irrigation|veterinar|food (technolog|safety|process)|dairy|poultry|seed|coffee)/i,
    reAm: /ቡና|ግብርና/ },
  { slug: 'legal', en: 'Legal & Compliance', am: 'ሕግና ተገዢነት',
    re: /\b(?:legal|lawyer|attorney|advocate|compliance|contract officer|paralegal|litigation)/i },
  { slug: 'security', en: 'Security & Facilities', am: 'ጥበቃና ንብረት',
    re: /\b(?:security|guard|safety officer|hse|janitor|cleaner|gardener|facility)/i,
    reAm: /ጽዳት|ፅዳት|ክሊነር|ፋሲሊቲ|ጥበቃ/ },
  { slug: 'media', en: 'Media & Design', am: 'ሚዲያና ዲዛይን',
    re: /\b(?:graphic|design(er)?|content|media|journalis|photograph|video|editor|communication officer|public relation)/i },
];

const BY_SLUG = new Map(CATEGORIES.map(c => [c.slug, c]));

// Amharic needs its own list. `\b` is a boundary between Latin word characters and anything else, so
// before an Ethiopic letter it never fires: /\b(?:ሹፌር)/ cannot match «ከባድ መኪና ሹፌር», and every
// Amharic-only title fell through to Other (24 September 2026: 33 of the 207 left there). The `reAm`
// patterns carry no boundary and are specific enough not to need one.
const hit = (c, text) => c.re.test(text) || (c.reAm ? c.reAm.test(text) : false);

// The title carries the trade; the summary is the fallback for a generic title ("Vacancy announcement").
function categorise(title, summary) {
  const t = String(title || '');
  for (const c of CATEGORIES) if (hit(c, t)) return c.slug;
  const s = String(summary || '').slice(0, 400);
  for (const c of CATEGORIES) if (hit(c, s)) return c.slug;
  return null;
}

const label = (slug, lang) => {
  const c = BY_SLUG.get(slug);
  if (!c) return lang === 'en' ? 'Other' : 'ሌሎች';
  return lang === 'en' ? c.en : c.am;
};

module.exports = { CATEGORIES, BY_SLUG, categorise, label };
