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

// Afaan Oromoo, added 2026-09-10. Oromo inflects heavily and attaches the definite -n to nouns
// (kutaa yaalaa -> kutaan yaalaa), so these match stems, and the emergency side is deliberately generous:
// a false alarm costs a phone call. NOT yet reviewed by a native speaker.
test('Afaan Oromoo: emergencies are recognised', () => {
  const must = [
    "abbaan koo onneen isaa dhukkuba, hafuura baafachuu hin dandeenye",  // chest pain, cannot breathe
    "mucaan koo of wallaalee hin dammaqu",                                // child unconscious
    "daa'imni hin harganu",                                              // infant not breathing
    "dhiigni hin dhaabbatu baay'ee yaa'aa jira",                         // bleeding will not stop
    "balaan konkolaataa nu qaqqabe",                                     // car accident
    "summii liqimseera",                                                 // swallowed poison
    "ulfa turte dhiigni irraa yaa'aa jira",                              // bleeding in pregnancy
    "of ajjeesuu barbaada",                                              // self-harm
  ];
  assert.deepEqual(must.filter(m => !A.isEmergency(m)), [], 'every one of these must be an emergency');
});

test('Afaan Oromoo: clinical requests are refused, ordinary ones are not', () => {
  for (const m of ["dhukkubni koo maali?", "qoricha maal fudhadhu?", "hangam fudhadhu?",
                   "bu'aan qorannoo koo maal jechuudha?", "cimaadhaa?"]) {
    assert.ok(A.isClinical(m), 'must be refused: ' + m);
  }
  for (const m of ["kutaan yaalaa daa'imaa eessa jira?", "inshuraansiin fayyaa akkam hojjeta?"]) {
    assert.equal(A.isEmergency(m), false, 'not an emergency: ' + m);
    assert.equal(A.isClinical(m), false, 'answerable: ' + m);
  }
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


// Afaan Oromoo negatives conjugate: dhaabbat- becomes "hin dhaabbanne", not "hin dhaabbatu". The gate
// was anchored on the finished form and so missed a real cry for help about bleeding.
test('bleeding that will not stop fires the emergency gate in every Oromo negative form', () => {
  for (const q of [
    'Dhiigni hin dhaabbanne',
    'Dhiigni hin dhaabbatu',
    'Dhiigni hin dhaabne, baay\'ee dhiiga jira',
    'dhiiga baay\'ee dhangala\'aa jira',
  ]) assert.equal(A.isEmergency(q), true, q);
});
