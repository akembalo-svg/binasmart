'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const A = require('../assistant/afiya');

// Amharic conjugates inside the verb, not just at the end: ደረቱን ያመዋል (his chest hurts him) but ደረቷን ያማታል
// (hers), and አልቻለም rather than አልቻል. Every one of these was written the way a frightened relative types.
test('an emergency is recognised in Amharic and English, in the words people really use', () => {
  const must = [
    'አባቴ ደረቱን ያመዋል እና እየተነፈሰ አይደለም',   // father: chest pain, not breathing
    'እናቴ ደረቷን ያማታል',                        // mother: chest pain (feminine)
    'ደረቴን ያመኛል',                              // me: chest pain
    'መተንፈስ አልቻለም',                           // cannot breathe
    'ልጄ ራሱን ስቶ አልነቃም',                      // child unconscious
    'ህፃኑ አይተነፍስም',                            // infant not breathing
    'ደም አይቆምም በጣም ይፈሳል',                 // bleeding will not stop
    'የመኪና አደጋ ደረሰ',                           // car accident
    'ተመረዘ ብዙ ክኒን ወሰደ',                       // poisoning / overdose
    'ነፍሰ ጡር ናት ደም እየፈሰሳት ነው',              // bleeding in pregnancy
    'ራሴን ማጥፋት እፈልጋለሁ',                      // self-harm
    'my father has chest pain and cannot breathe',
    'she is unconscious and not waking',
    'the baby is not breathing',
    'he collapsed and is unresponsive',
    'I want to kill myself',
  ];
  assert.deepEqual(must.filter(m => !A.isEmergency(m)), [], 'every one of these must be an emergency');
});

// Known gap, stated rather than hidden: Afaan Oromoo emergency phrasing is not covered and needs a native
// speaker before Dr Afiya is offered in that language. Until then the language must not be advertised.
test('the Afaan Oromoo gap is real and documented', () => {
  assert.equal(A.isEmergency("namni kun of wallaalee hin dammaqu"), false,
    'if this ever starts passing, remove this test and the warning that goes with it');
});

test('ordinary health-system questions are NOT treated as emergencies', () => {
  for (const m of ['የልብ ሕክምና ክፍል በስንት ሰዓት ይከፈታል?', 'how much is the general OPD fee?',
                   'ለቀጠሮ ምን ይዤ ልምጣ?', 'what documents do I need for health insurance?',
                   'የጥርስ ሕክምና የት ነው?', 'ደም ምርመራ ስንት ብር ነው?']) {
    assert.equal(A.isEmergency(m), false, 'should be ordinary: ' + m);
  }
});

test('the emergency reply is fixed, carries the ambulance number, and never poses as a clinician', () => {
  for (const lang of ['am', 'en', 'om']) {
    const r = A.emergencyReply(lang);
    assert.ok(r.includes('907'), 'ambulance number must be present in ' + lang);
    assert.ok(r.length < 500, 'short enough to act on');
    assert.ok(/not a medical professional|ogeessa fayyaa miti|የህክምና ባለሙያ አይደለሁም/.test(r), 'must disclose in ' + lang);
  }
  assert.equal(A.emergencyReply('en'), A.emergencyReply('en'), 'identical every time: no model, no variation');
});

test('requests to diagnose, prescribe or reassure are refused', () => {
  for (const m of ['ምን በሽታ ነው ያለብኝ?', 'what disease do I have?', 'ምን መድሃኒት ልውሰድ?',
                   'which antibiotic should I take?', 'ስንት ልውሰድ?', 'what does my lab result mean?',
                   'is it serious?', 'do I have cancer?']) {
    assert.ok(A.isClinical(m), 'must be refused: ' + m);
  }
  for (const m of ['የህፃናት ክፍል የት ፎቅ ላይ ነው?', 'what are the OPD opening hours?', 'ለቀጠሮ ምን ያስፈልጋል?']) {
    assert.equal(A.isClinical(m), false, 'must be answerable: ' + m);
  }
});

test('a dosage instruction is removed however it arrived', () => {
  const bad = 'ወደ አጠቃላይ ህክምና ክፍል ይሂዱ። ፓራሲታሞል 500 mg በቀን 3 ጊዜ ይውሰዱ። ክፍያው 300 ብር ነው።';
  const r = A.stripDosage(bad);
  assert.equal(/500\s*mg/.test(r.text), false, 'the dose must be gone');
  assert.ok(r.text.includes('አጠቃላይ ህክምና'), 'the useful direction survives');
  assert.ok(r.text.includes('300 ብር'), 'a fee is not a dose');
  assert.equal(r.removed, 1);

  assert.equal(A.stripDosage('Take 2 tablets twice a day.').text, '', 'English dosing also goes');
  const clean = 'ወደ የልብ ሕክምና ክፍል ይሂዱ፣ ክፍያው 600 ብር ነው።';
  assert.deepEqual(A.stripDosage(clean), { text: clean, removed: 0 });
});

test('every refusal points somewhere, and the disclosure exists in three languages', () => {
  for (const lang of ['am', 'en', 'om']) {
    assert.ok(A.disclosure(lang).length > 20);
    assert.ok(/ክፍል|department|kutaa/i.test(A.clinicalNudge(lang)), 'a refusal must offer the next step in ' + lang);
  }
});

test('the system prompt refuses the roles it must refuse', () => {
  for (const rule of [/not a doctor|NOT a doctor/, /Never name a medicine/, /Never interpret a laboratory/,
                      /Never say whether something is serious/, /title "Dr" is part of the product name/]) {
    assert.ok(rule.test(A.SYSTEM), 'system prompt must contain: ' + rule);
  }
});
