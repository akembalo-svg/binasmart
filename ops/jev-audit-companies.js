// Jev check of the Addis companies directory (ops/places/companies-build.js): is each entry really a real estate
// company or a car seller? READ-ONLY - it proposes; /root/storage/directory/exclude.json is edited by a person.
//   node --env-file=.env ops/jev-audit-companies.js     results cached in /root/storage/directory/jev-companies.json
// Judged on P(the expected kind), not the top choice - the lesson from the jobs gate (27 Sep 2026).
// Sent to Jev: the public name, map tag, sub-city, website domain. No phones.
const fs = require('fs');
const API = process.env.JEV_API_URL, MODEL = process.env.JEV_MODEL, KEY = process.env.JEV_API_KEY;
const IN = '/root/storage/directory/addis-companies.json', OUT = '/root/storage/directory/jev-companies.json';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const Q = { kind: { type: 'choice', instructions: 'This business in Addis Ababa, Ethiopia is listed in a directory. Judging by its name and details, what does it mainly do?',
  criteria: {
    real_estate_company: 'Develops, sells, rents or manages property: a real estate developer, a property agency or broker, or a property management company.',
    car_seller: 'Sells vehicles to the public: a car dealer or brand distributor, a car importer or trader, a used-car showroom or car market, or a vehicle assembler that sells cars.',
    other_business: 'Something else: a garage, car wash, rental, inspection or driving school; a factory, shop or service in another trade; a building or apartment block; a government office; a person\'s name only.' } } };
async function ask(state) {
  for (let i = 0; i < 9; i++) {
    const r = await fetch(API, { method: 'POST', headers: { authorization: 'Bearer ' + KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, state, questions: Q }) });
    const d = await r.json().catch(() => null);
    if (r.status === 200 && d && d.answers) return d.answers.kind;
    if (!(r.status === 429 || r.status >= 500)) throw new Error('HTTP ' + r.status + ' ' + JSON.stringify(d).slice(0, 120));
    await sleep(Math.min(30000, 2500 * Math.pow(1.7, i)));
  }
  throw new Error('gave up');
}
(async () => {
  const list = JSON.parse(fs.readFileSync(IN, 'utf8')).companies;
  let done = {}; try { done = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { /* first run */ }
  for (const c of list) {
    if (done[c.key]) continue;
    let site = ''; try { site = c.website ? new URL(/^https?:/.test(c.website) ? c.website : 'https://' + c.website).hostname.replace(/^www\./, '') : ''; } catch (e) {}
    const state = ['Name: ' + c.name, c.nameAm && 'Amharic name: ' + c.nameAm, c.tag && 'Map tag: ' + c.tag, c.sub && 'Sub-city: ' + c.sub,
      site && 'Website: ' + site, c.type && 'Described as: ' + c.type, c.brands && 'Brands: ' + c.brands, c.branches && 'Also listed as: ' + c.branches.join('; ')].filter(Boolean).join('\n');
    try {
      const a = await ask(state); const pr = a.probabilities || {};
      const expected = c.kind === 'real_estate' ? 'real_estate_company' : 'car_seller';
      done[c.key] = { name: c.name, kind: c.kind, top: a.choice, pExpected: +(pr[expected] ?? (a.choice === expected ? a.confidence : 0)).toFixed(3) };
      console.log(done[c.key].pExpected.toFixed(2).padStart(5) + '  ' + c.kind.padEnd(11) + ' ' + String(a.choice).padEnd(20) + ' ' + c.name);
      fs.writeFileSync(OUT, JSON.stringify(done, null, 1));
    } catch (e) { console.log('  !! ' + c.name + ' ' + e.message.slice(0, 80)); }
    await sleep(150);
  }
  const low = Object.values(done).filter(x => x.pExpected < 0.5);
  console.log('\n' + Object.keys(done).length + ' checked · ' + low.length + ' below 0.5 (review these): ' + low.map(x => x.name).join(' | '));
})().catch(e => { console.error('[jev-companies] ' + e.message); process.exit(1); });
