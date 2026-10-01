'use strict';
// Which of Bini's tools a message can need. The 19 definitions are ~4,400 of the ~14,800 tokens every model call
// sends (measured 29 Sep 2026, ops/ai-cost.js), so a ride question should not carry the car, property, job and
// company-listing manuals. The rule is to trim only when the topic is clear:
//   - three small tools are always there (search_places, remember, contact_team);
//   - a topic is recognised in the message OR the last few turns, so "yes, book it" keeps the ride tools;
//   - nothing recognised, a helper mode (listing / company / hotel owner) or a missing tool name -> ALL tools, as
//     before. Being wrong here costs a missed tool call; being unsure costs a few thousand tokens. Unsure wins.
const ALWAYS = ['search_places', 'remember', 'contact_team'];
const GROUPS = [
  { tools: ['quote_ride', 'request_ride', 'ride_status', 'pool_board'],
    re: /(\bride\b|\brides\b|taxi|\bcab\b|fare|\bpool\b|shared ride|pick me|drop me|airport|driver|bajaj|\bmoto\b|economy|comfort|\bxl\b|\bvan\b|how much from|from .{2,30} to |ራይድ|ታክሲ|ባጃጅ|ሹፌር|ጉዞ|ጋራ|ኤርፖርት|አየር ማረፊያ|ወደ\s*\S|ከ\S+\s+ወደ|ውሰደኝ|አድርሰኝ|ስንት ነው|ዋጋ|\bsint\b|\bwede\b|\bride status|my ride|where is (the|my) (car|driver)|የት ደረሰ)/i },
  { tools: ['search_jobs', 'job_alert', 'post_job'],
    re: /(\bjobs?\b|vacanc|hiring|\bhire\b|recruit|career|\bcv\b|resume|employ|\bwork\b|salary|waiter|waitress|receptionist|\bcooks?\b|\bchefs?\b|guard|cleaner|ስራ|ሥራ|ቅጥር|መቀጠር|ሰራተኛ|ሠራተኛ|ሲቪ|ደመወዝ|ወይትረስ|አስተናጋጅ|ጥበቃ|ዘበኛ|ፅዳት|ጽዳት|\bsira\b|alert|አሳውቀኝ)/i },
  { tools: ['search_properties', 'listing_request'],
    re: /(house|home|apartment|flat|condo|villa|\bland\b|\bplot\b|real estate|property|propert|for rent|for sale|\brent\b|office space|shop space|bedroom|ቤት|አፓርት|ኮንዶ|ቪላ|መሬት|ቦታ|ኪራይ|የሚከራይ|የሚሸጥ|ሽያጭ|መኝታ|ሪል ስቴት)/i },
  { tools: ['search_cars'],
    re: /(\bcars?\b|vehicle|\bsuv\b|pick-?up|toyota|suzuki|hyundai|\bkia\b|nissan|\bbyd\b|honda|volkswagen|mitsubishi|isuzu|ford|mercedes|\bbmw\b|electric car|\bev\b|dealer|መኪና|ተሽከርካሪ)/i },
  { tools: ['search_hotels'],
    re: /(hotel|guest ?house|pension|hostel|motel|lodge|resort|place to stay|stay in|room for|ሆቴል|ፔንሲዮን|እንግዳ ማረፊያ|ማረፊያ|ሎጅ|መኝታ ቤት)/i },
  { tools: ['search_health'],
    re: /(hospital|clinic|dentist|dental|\bdoctors?\b|physician|p(a)?ediatric|gyn(a)?ecolog|obstetric|dermatolog|cardiolog|ophthalm|laborator|\blab\b|blood test|health cent(er|re)|specialist|ሆስፒታል|ክሊኒክ|ሐኪም|ሀኪም|ሃኪም|ዶክተር|ጥርስ|ላብራቶሪ|ላቦራቶሪ|ጤና ጣቢያ|ስፔሻሊስት)/i },
  { tools: ['search_tenders'],
    re: /(tender|\bbid\b|bidding|auction|procurement|\brfq\b|\brfp\b|ጨረታ|caalbaasii)/i },
  { tools: ['shop_post', 'search_shops'],
    re: /(sell my|selling|my shop|my store|post (a |my )?(product|item|offer)|products? (i|we) sell|discount|\boffer\b|ሱቄ|ልሸጥ|እሸጣለሁ|ልለጥፍ|ቅናሽ)/i },
  { tools: ['search_shops'],
    re: /(restaurant|cafe|coffee|pharmacy|drug ?store|\bbank\b|\batm\b|salon|barber|\bgym\b|clinic|hospital|shop|supermarket|market|bakery|printer|repair|ምግብ ቤት|ካፌ|ቡና|ፋርማሲ|መድሃኒት|ባንክ|ሳሎን|ጂም|ክሊኒክ|ሆስፒታል|ሱቅ|ሱፐርማርኬት|ገበያ|ዳቦ)/i },
  { tools: ['cinema_programme', 'watch_channels'],
    re: /(cinema|movie|film|showing|\btv\b|television|radio|channel|series|drama|watch|listen|live stream|ሲኒማ|ፊልም|ቲቪ|ቴሌቪዥን|ራዲዮ|ራድዮ|ቻናል|ድራማ|ተከታታይ)/i },
  { tools: ['bini_browser_lead'],
    re: require('./tools').AGENT_RE },
  { tools: ['company_request'],
    re: /(company|companies|my business|our business|organi[sz]ation|\bclaim\b|list my|add my|register my|ድርጅት|ኩባንያ|ንግዴ|ድርጅቴ|ድርጅታችን)/i },
];

function pickTools(all, { msg, hist, special } = {}) {
  if (special) return all;
  const recent = (hist || []).slice(-3).map(m => String((m && m.content) || '')).join(' \n ');
  const want = new Set(ALWAYS);
  let hit = false;
  for (const g of GROUPS) {
    if (g.re.test(String(msg || '')) || g.re.test(recent)) { hit = true; g.tools.forEach(t => want.add(t)); }
  }
  if (!hit) return all;
  const picked = all.filter(t => want.has(t.function.name));
  // A tool this router names but the build does not have is fine; a build tool no group knows about is not trimmed
  // away silently - an unknown tool means an unknown topic, so send everything.
  const known = new Set(GROUPS.flatMap(g => g.tools).concat(ALWAYS));
  if (all.some(t => !known.has(t.function.name))) return all;
  return picked;
}

module.exports = { pickTools, GROUPS, ALWAYS };
