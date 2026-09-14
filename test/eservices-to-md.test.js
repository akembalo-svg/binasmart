'use strict';
// The eServices directory generator (ops/knowledge/eservices-to-md.js) and the `eservices` source it feeds.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildDocs, writeDocs, descLang, usefulDescription, applyLink } = require('../ops/knowledge/eservices-to-md');
const { readSources } = require('../knowledge/index');

const svc = (o) => Object.assign({ ID: 1, Name: 'Service', Description: 'Service', HasRedirectURL: false, OrganizationName: 'Ministry of Justice',
  OrganizationType: 'Ministry', EstimatedFee: -1, EstimatedProcessingTimeString: 'N/A', ServiceProviders: [], Subtopics: '' }, o);

const FIXTURE = { Count: 9, data: [
  svc({ ID: 1, Name: 'Application for pardon grant', Description: 'The Granting Pardon for Prisoners service allows for the conditional release of prisoners.' }),
  svc({ ID: 2, Name: 'Home Sale Contract', Description: 'Home Sale Contract', HasRedirectURL: true, RedirectURL: 'https://www.dars.gov.et:8086/Pages/Sales/GeneralHomeSales', OrganizationName: 'Document Authentication And Registration Service' }),
  svc({ ID: 3, Name: 'iRegister', Description: 'iRegister', HasRedirectURL: true, RedirectURL: 'https://www.eris.efda.gov.et/', OrganizationName: 'የኢትዮጵያ ምግብና መድሀኒት ቁጥጥር ባለስልጣን' }),
  svc({ ID: 4, Name: 'I-Register', Description: 'online application which import apply for recieve medices', HasRedirectURL: true, RedirectURL: 'https://www.eris.efda.gov.et/', OrganizationName: 'Ethiopian Food and Drug Authority' }),
  svc({ ID: 5, Name: 'Support service for payment', Description: 'Verification Service within support', EstimatedFee: 50, EstimatedProcessingTimeString: '16 hours', OrganizationName: 'System(E-service)  Support Center' }),
  svc({ ID: 6, Name: 'Tajaajila Heyyama Mana Maxxansaa', Description: 'Tajaajilli kuni kennamuuf qaama heyyama mana maxxansaa barbaadeefi.', HasRedirectURL: true, RedirectURL: 'https://eservice.adamacity.gov.et/service/description/9', OrganizationName: 'Adama City Administration' }),
  svc({ ID: 7, Name: 'Broken link service', Description: 'Something the office does for people.', HasRedirectURL: true, RedirectURL: 'https://', OrganizationName: 'Adama City Administration' }),
  svc({ ID: 8, Name: 'Registration of directives', Description: 'Registers directives.', EstimatedFee: 120, EstimatedProcessingTimeString: '3 days' }),
  svc({ ID: 9, Name: 'EPA Payment test service', Description: 'EPA Payment test service', OrganizationName: 'Ministry of Justice' }),
] };

test('one document per office, with front matter the law/health loader understands', () => {
  const { docs, total } = buildDocs(FIXTURE, { fetched: '2026-09-14' });
  assert.equal(total, 9);
  const slugs = docs.map(d => d.slug);
  assert.deepEqual(slugs, ['adama-city-administration', 'document-authentication-and-registration-service', 'ethiopian-food-and-drug-authority', 'ministry-of-justice']);
  const moj = docs.find(d => d.slug === 'ministry-of-justice').markdown;
  assert.match(moj, /^---\ntitle: "Ministry of Justice \(የፍትሕ ሚኒስቴር\) — services on eservices\.gov\.et"\n/);
  assert.match(moj, /\nsource_name: "Ethiopian Government eServices portal/);
  assert.match(moj, /\nurl: "https:\/\/www\.eservices\.gov\.et\/en\/services"\n/);
  assert.match(moj, /\nlang: "en"\n/);
  assert.match(moj, /\nfetched: "2026-09-14"\n/);
  assert.match(moj, /በአማርኛ፦/, 'a short Amharic note so Amharic questions can reach it');
});

test('never prints -1 or N/A as a fee or time, and prints a stated fee as the portal gives it', () => {
  const { docs } = buildDocs(FIXTURE, { fetched: '2026-09-14' });
  const all = docs.map(d => d.markdown).join('\n');
  assert.equal(/-1\b/.test(all), false);
  assert.equal(/N\/A/.test(all), false);
  const moj = docs.find(d => d.slug === 'ministry-of-justice').markdown;
  const block = moj.split('### Registration of directives')[1];
  assert.match(block, /Estimated fee, as the portal lists it: 120/);
  assert.match(block, /Estimated processing time, as the portal lists it: 3 days/);
  const pardon = moj.split('### Application for pardon grant')[1].split('###')[0];
  assert.equal(/fee|processing time/i.test(pardon), false);
});

test('where to apply: on the portal, or at the office link; a broken link is not printed', () => {
  const { docs } = buildDocs(FIXTURE, { fetched: '2026-09-14' });
  const dars = docs.find(d => d.slug === 'document-authentication-and-registration-service').markdown;
  assert.match(dars, /### Home Sale Contract\n\nApply: on the office's own system, linked from eservices\.gov\.et: https:\/\/www\.dars\.gov\.et:8086\/Pages\/Sales\/GeneralHomeSales/);
  assert.equal(/### Home Sale Contract\n\nHome Sale Contract/.test(dars), false, 'a description that repeats the name is skipped');
  const moj = docs.find(d => d.slug === 'ministry-of-justice').markdown;
  assert.match(moj, /### Application for pardon grant\n\nThe Granting Pardon.*\nApply: on eservices\.gov\.et itself/);
  const adama = docs.find(d => d.slug === 'adama-city-administration').markdown;
  assert.match(adama, /### Broken link service\n\nSomething the office does for people\.\nApply: the portal sends applicants to the office's own system but gives no working link; ask the office\./);
  assert.equal(applyLink({ HasRedirectURL: true, RedirectURL: 'https://' }), '');
  assert.equal(applyLink({ HasRedirectURL: false, RedirectURL: 'https://www.youtube.com/x' }), null);
});

test('Afaan Oromoo descriptions are kept and labelled, not passed off as English', () => {
  assert.equal(descLang('Tajaajilli kuni kennamuuf qaama heyyama mana maxxansaa barbaadeefi.'), 'om');
  assert.equal(descLang('The Granting Pardon for Prisoners service allows release.'), 'en');
  assert.equal(descLang('ይህ ቅሬታ በየደረጃው ያለ አባል የሚያቀርበው ነው።'), 'am');
  const { docs } = buildDocs(FIXTURE, { fetched: '2026-09-14' });
  const adama = docs.find(d => d.slug === 'adama-city-administration').markdown;
  assert.match(adama, /Description \(in Afaan Oromoo, as the portal lists it\): Tajaajilli kuni/);
});

test('the Amharic-named EFDA entry folds into EFDA, duplicate services collapse, test entries and the support centre are dropped', () => {
  const { docs, skipped } = buildDocs(FIXTURE, { fetched: '2026-09-14' });
  const efda = docs.find(d => d.slug === 'ethiopian-food-and-drug-authority');
  assert.equal(efda.count, 1, 'iRegister and I-Register are one service');
  assert.match(efda.markdown, /online application which import apply/, 'the entry that says more is kept');
  assert.match(efda.markdown, /The portal lists this office as: .*የኢትዮጵያ ምግብና መድሀኒት ቁጥጥር ባለስልጣን/);
  const all = docs.map(d => d.markdown).join('\n');
  assert.equal(/Support service for payment|payment test/i.test(all), false);
  assert.ok(skipped >= 3);
  assert.equal(usefulDescription('Home Sale Contract', 'home sale contract.'), false);
});

test('writeDocs replaces the directory it owns and the eservices source reads it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bina-es-'));
  const out = path.join(root, 'knowledge', 'eservices');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'office-that-left.md'), '---\ntitle: "x"\n---\nold');
  const { docs } = buildDocs(FIXTURE, { fetched: '2026-09-14' });
  const removed = writeDocs(docs, out);
  assert.deepEqual(removed, ['office-that-left.md']);
  const read = readSources(root, ['eservices']);
  assert.equal(read.length, 4);
  const moj = read.find(d => d.slug === 'ministry-of-justice');
  assert.equal(moj.source, 'eservices');
  assert.equal(moj.lang, 'en');
  assert.equal(moj.url, 'https://www.eservices.gov.et/en/services');
  assert.match(moj.title, /^Ministry of Justice \(የፍትሕ ሚኒስቴር\) — services on eservices\.gov\.et$/);
  assert.equal(moj.text.startsWith('---'), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('the income tax calculator page is indexed with the 1395/2025 brackets', () => {
  const docs = readSources(path.join(__dirname, '..'), ['guide']);
  const calc = docs.find(d => d.slug === 'ethiopia-income-tax-calculator');
  assert.ok(calc, 'guide/ethiopia-income-tax-calculator is read');
  assert.equal(calc.url, 'https://bina.et/ethiopia-income-tax-calculator');
  assert.match(calc.text, /1395/);
  assert.match(calc.text, /35%/);
});

test('law and health are read exactly as before by the shared loader', () => {
  const docs = readSources(path.join(__dirname, '..'), ['law', 'health']);
  const con = docs.find(d => d.slug === 'fdre-constitution');
  assert.ok(con && con.source === 'law' && con.text.length > 80000, 'the Constitution is indexed whole');
  assert.ok(docs.some(d => d.source === 'health'));
  assert.equal(docs.some(d => d.slug.startsWith('overseas-employment-923')), false, 'the superseded overseas-employment files are gone');
});
