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


// 2026-09-11. Amharic writes one sound with several characters - ሀ ሐ ኀ are all "ha", ሰ/ሠ, አ/ዐ and
// ጸ/ፀ likewise - and no spelling is wrong. The clinical gate had been written with one of them, so
// three everyday spellings of "medicine" walked past it. Separately the gate only knew the patient
// asking for themselves (ልውሰድ, "should I take") and not the caregiver asking for a child (ልስጠው,
// "should I give him") - Amharic marks the object on the verb, so they share no stem.
// A parent asking a child's dose is where a wrong number does the most harm. Both are pinned here.
test('the clinical gate hears every spelling of "medicine"', () => {
  for (const q of ['ምን መድሃኒት ልውሰድ?', 'ምን መድኃኒት ልውሰድ?', 'ምን መድሀኒት ልውሰድ?'])
    assert.ok(A.isClinical(q), 'must be caught: ' + q);
});

test('the dose gate hears a caregiver asking for a child, not only a patient asking for themselves', () => {
  for (const q of ['ለልጄ መድኃኒት ስንት ልስጠው?', 'ለ2 ዓመት ልጄ ፓራሲታሞል ስንት ልስጠው?', 'ለሴት ልጄ ስንት ልስጣት?',
                   'how much should I give my child?', 'hangam kennuufii qaba?'])
    assert.ok(A.isClinical(q), 'must be caught: ' + q);
});

test('folding does not make the gate fire on navigation questions', () => {
  for (const q of ['ሰላም', 'የጥርስ ሕክምና ክፍያ ስንት ነው?', 'ለቀጠሮ ምን ይዤ ልምጣ?', 'የቤተሰብ ምጣኔ አገልግሎት የት አገኛለሁ?'])
    assert.ok(!A.isClinical(q), 'must NOT be caught: ' + q);
});

test('the emergency gate survives the same letter variants', () => {
  for (const q of ['ልጄ ራሱን ሥቶ አልነቃም', 'ደም አይቆምም በጣም ይፈሣል', 'አባቴ ደረቱን ያመዋል እና እየተነፈሰ አይደለም'])
    assert.ok(A.isEmergency(q), 'must be an emergency: ' + q);
});

test('a pattern written with any spelling still matches input written with any other', () => {
  // Folding only the input would BREAK working patterns: several emergency patterns contain ህፃን, and
  // folded input arrives as ህጻን, so they would match nothing. Patterns are folded at construction for
  // that reason. This asserts both sides end up in the same space, whichever spelling either one uses.
  const { foldEthiopic } = require('../assistant/lang');
  assert.equal(foldEthiopic('ህፃኑ'), foldEthiopic('ህጻኑ'), 'ፃ and ጻ must fold together');
  assert.equal(foldEthiopic('ሐኪም'), foldEthiopic('ሀኪም'), 'ሐ and ሀ must fold together');
  assert.equal(foldEthiopic('መድኃኒት'), foldEthiopic('መድሃኒት'), 'ኃ and ሃ must fold together');
  assert.notEqual(foldEthiopic('ሰላም'), foldEthiopic('ሶላም'), 'folding must not flatten different vowels');
  for (const q of ['ህፃኑ አይተነፍስም', 'ህጻኑ አይተነፍስም', 'ሕጻኑ አይተነፍስም'])
    assert.ok(A.isEmergency(q), 'must still be an emergency: ' + q);
});
