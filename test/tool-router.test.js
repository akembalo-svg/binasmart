'use strict';
// assistant/tool-router.js: trim Bini's tools only when the topic is clear; when unsure, send all of them.
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickTools, GROUPS, ALWAYS } = require('../assistant/tool-router');

const NAMES = [...new Set(ALWAYS.concat(GROUPS.flatMap(g => g.tools)))];
const all = NAMES.map(name => ({ type: 'function', function: { name } }));
const names = (msg, extra = {}) => pickTools(all, { msg, ...extra }).map(t => t.function.name).sort();

test('a ride question gets the ride tools and the three small ones, not cars or companies', () => {
  const n = names('How much is a ride from Megenagna to Bole?');
  for (const t of ['quote_ride', 'request_ride', 'search_places', 'contact_team', 'remember']) assert.ok(n.includes(t), t);
  for (const t of ['search_cars', 'company_request', 'listing_request', 'post_job']) assert.ok(!n.includes(t), t);
});

test('Amharic topics are recognised', () => {
  assert.ok(names('ከመገናኛ ወደ ፒያሳ ራይድ ስንት ነው?').includes('quote_ride'));
  assert.ok(names('ኢንተርናሽናል ሆቴል ወይትረስ').includes('search_jobs'));
  assert.ok(names('ቦሌ አካባቢ ባለ 2 መኝታ ቤት ኪራይ').includes('search_properties'));
  assert.ok(names('ምርጥ 4 ኮከብ ሆቴል በቂርቆስ').includes('search_hotels'));
  assert.ok(names('የግንባታ ጨረታ አለ?').includes('search_tenders'));
});

test('a follow-up keeps the tools of the conversation', () => {
  const hist = [{ role: 'user', content: 'ride from Bole to Piassa' }, { role: 'assistant', content: 'Economy is 260 birr. Shall I book it?' }];
  assert.ok(names('yes please', { hist }).includes('request_ride'));
});

test('unsure means everything', () => {
  assert.equal(pickTools(all, { msg: 'hi' }).length, all.length);
  assert.equal(pickTools(all, { msg: 'ሰላም' }).length, all.length);
  assert.equal(pickTools(all, { msg: 'Who made you?' }).length, all.length);
});

test('a helper mode, or a tool the router does not know, means everything', () => {
  assert.equal(pickTools(all, { msg: 'ride to Bole', special: true }).length, all.length);
  const withNew = all.concat({ type: 'function', function: { name: 'brand_new_tool' } });
  assert.equal(pickTools(withNew, { msg: 'ride to Bole' }).length, withNew.length);
});
