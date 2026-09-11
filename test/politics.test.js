'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../assistant/politics');
const lang = require('../assistant/lang');

// Bini declines politics entirely — Ibrahim's decision on 2026-09-11, after he was measured
// withholding the opinion 7 times in 10 and then reporting election logistics (polling hours, voter
// numbers, extensions in Arba Minch) out of crawled Reporter articles. The opinion was withheld; the
// coverage was not.
test('politics is declined, opinion or not', () => {
  for (const q of ['ስለ ምርጫው ምን ታስባለህ?', 'ምርጫው መቼ ነበር?', 'የምርጫ ውጤቱ ምንድን ነው?',
                   'የትኛው ፓርቲ ይሻላል?', 'ተቃዋሚ ፓርቲዎች እነማን ናቸው?', 'ጠቅላይ ሚኒስትሩ ማን ናቸው?',
                   'ስለ ጦርነቱ ምን ታውቃለህ?', 'ሰላማዊ ሰልፍ አለ?', 'ስለ መንግስት ምን ትላለህ?',
                   'what do you think about the election?', 'which political party is best?',
                   'who is the prime minister?', 'tell me about the protests',
                   'Filannoon yoom ture?', 'Paartiin kam caala?'])
    assert.ok(P.isPolitical(q), 'must be declined: ' + q);
});

// The gate is worth nothing if it declines the day job. Government SERVICES are the core business,
// and "መንግስት" sits in both "what do you think of the government" and "which government office".
test('the day job is never mistaken for politics', () => {
  for (const q of ['ሰላም', 'ከመገናኛ ወደ ቦሌ ስንት ብር ነው?', 'የፓስፖርት ክፍያ ስንት ነው?',
                   'የመንግስት አገልግሎት የት አገኛለሁ?', 'ብሔራዊ መታወቂያ እንዴት አወጣለሁ?', 'ፋይዳ መታወቂያ የት ይሰጣል?',
                   'ግብር እንዴት እከፍላለሁ?', 'ንግድ ፈቃድ ለማውጣት ምን ያስፈልጋል?', 'የጉምሩክ ሕግ ምንድን ነው?',
                   'ሚኒስቴር መስሪያ ቤቱ የት ነው?', 'የመንግስት ቢሮ ስንት ሰዓት ይከፈታል?', 'ዲጂታል ኢትዮጵያ ምንድን ነው?',
                   'ሲኒማ ምን አለ?', 'ጨረታ አለ?', 'how do I get a national ID?',
                   'where is the ministry office?', 'how do I pay tax?'])
    assert.ok(!P.isPolitical(q), 'must NOT be declined: ' + q);
});

// \b is defined on ASCII word characters, so it never matches after an Ethiopic one — a trailing \b
// silently killed ምርጫ. And the Amharic definite article REPLACES the final character rather than
// appending: ጦርነ-ት becomes ጦርነ-ቱ, ሚኒስት-ር becomes ሚኒስት-ሩ, so the bare stem is not a substring.
test('the patterns survive Amharic inflection', () => {
  assert.ok(P.isPolitical('ምርጫው'), 'ምርጫ + the definite suffix');
  assert.ok(P.isPolitical('ጦርነቱ ምንድን ነው?'), 'ጦርነት -> ጦርነቱ replaces the final character');
  assert.ok(P.isPolitical('ጠቅላይ ሚኒስትሩ'), 'ሚኒስትር -> ሚኒስትሩ replaces the final character');
});

test('the decline is written in the language that was asked', () => {
  for (const l of ['am', 'en', 'om']) {
    const r = P.politicalReply(l);
    assert.ok(r && r.length > 40, 'missing reply for ' + l);
  }
  assert.notEqual(P.politicalReply('am'), P.politicalReply('en'));
  // A short Oromo question carries one content stem, and detect() needs two markers — question words
  // were added so "Filannoon yoom ture?" is answered in Oromo rather than English.
  assert.equal(lang.detect('Filannoon yoom ture?'), 'om');
});
