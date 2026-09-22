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
    re: /\b(?:account(ant|ing|s)?|financ|audit|auditor|cashier|budget|tax|treasur|payroll|ifrs|book ?keep|cost control)/i },
  { slug: 'engineering', en: 'Engineering', am: 'ኢንጂነሪንግ',
    re: /\b(?:engineer(ing)?|mechanic(al)?|electric(al|ian)?|civil|surveyor|quantity survey|technician|maintenance|machin|welder|plumb)/i },
  { slug: 'it', en: 'IT & Software', am: 'አይቲና ሶፍትዌር',
    re: /\b(?:it |i\.t\.|software|developer|programm|data ?(base|center|analyst|scien)|network|system admin|cyber|digital|web|devops|erp|oracle|sql)/i },
  { slug: 'health', en: 'Health & Medical', am: 'ጤናና ሕክምና',
    re: /\b(?:nurse|nursing|doctor|physician|medical|health|pharmac|laborator|midwif|dental|clinic|surgeon|radiolog|nutrition|iycf|wash officer)/i },
  { slug: 'education', en: 'Education & Training', am: 'ትምህርትና ሥልጠና',
    re: /\b(?:teacher|lecturer|instructor|tutor|academic|school|kindergarten|preschool|trainer|training officer|curriculum|principal)/i },
  { slug: 'sales', en: 'Sales & Marketing', am: 'ሽያጭና ገበያ',
    re: /\b(?:sales|marketing|brand|merchandis|promot|business development|customer relation|shop keeper|salesperson|distributor)/i },
  { slug: 'ngo', en: 'NGO & Development', am: 'መንግሥታዊ ያልሆኑ ድርጅቶች',
    re: /\b(?:ngo|programme? officer|project officer|monitoring and evaluation|m&e|humanitarian|protection officer|livelihood|gender officer|community mobiliz|donor|grant)/i },
  { slug: 'logistics', en: 'Driving & Logistics', am: 'ትራንስፖርትና ሎጂስቲክስ',
    re: /\b(?:driver|logistic|warehouse|store ?keeper|supply chain|procurement|fleet|dispatch|transport|import|export|custom clearance|forklift)/i },
  { slug: 'admin', en: 'Admin & HR', am: 'አስተዳደርና ሰው ሀብት',
    re: /\b(?:human resource|hr |hr officer|admin|administrat|secretar|receptionist|office (assistant|manager)|clerk|personnel|record officer|data encoder)/i },
  { slug: 'hospitality', en: 'Hotel & Hospitality', am: 'ሆቴልና መስተንግዶ',
    re: /\b(?:hotel|waiter|waitress|chef|cook|barista|housekeep|front office|restaurant|catering|bartender|lifeguard|tour|travel consultant)/i },
  { slug: 'construction', en: 'Construction & Real estate', am: 'ግንባታና ሪል እስቴት',
    re: /\b(?:construction|site (engineer|supervisor)|foreman|architect|real estate|property|contract administrat|tender (and|&) estimation|estimation engineer)/i },
  { slug: 'agriculture', en: 'Agriculture & Food', am: 'ግብርናና ምግብ',
    re: /\b(?:agricultur|agronom|farm|horticultur|irrigation|veterinar|food (technolog|safety|process)|dairy|poultry|seed|coffee)/i },
  { slug: 'legal', en: 'Legal & Compliance', am: 'ሕግና ተገዢነት',
    re: /\b(?:legal|lawyer|attorney|advocate|compliance|contract officer|paralegal|litigation)/i },
  { slug: 'security', en: 'Security & Facilities', am: 'ጥበቃና ንብረት',
    re: /\b(?:security|guard|safety officer|hse|janitor|cleaner|gardener|facility)/i },
  { slug: 'media', en: 'Media & Design', am: 'ሚዲያና ዲዛይን',
    re: /\b(?:graphic|design(er)?|content|media|journalis|photograph|video|editor|communication officer|public relation)/i },
];

const BY_SLUG = new Map(CATEGORIES.map(c => [c.slug, c]));

// The title carries the trade; the summary is the fallback for a generic title ("Vacancy announcement").
function categorise(title, summary) {
  const t = String(title || '');
  for (const c of CATEGORIES) if (c.re.test(t)) return c.slug;
  const s = String(summary || '').slice(0, 400);
  for (const c of CATEGORIES) if (c.re.test(s)) return c.slug;
  return null;
}

const label = (slug, lang) => {
  const c = BY_SLUG.get(slug);
  if (!c) return lang === 'en' ? 'Other' : 'ሌሎች';
  return lang === 'en' ? c.en : c.am;
};

module.exports = { CATEGORIES, BY_SLUG, categorise, label };
