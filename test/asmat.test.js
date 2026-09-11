'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../assistant/asmat');
const scope = require('../assistant/scope');
const afiya = require('../assistant/afiya');

test('an urgent legal situation is recognised in the words people really use', () => {
  const must = [
    'ወንድሜ ታሰረ ፖሊስ ወሰደው',                    // brother arrested
    'አሁን ፈርም እያሉኝ ነው',                        // being pressured to sign now
    'ነገ ፍርድ ቤት ቀጠሮ አለኝ',                      // court tomorrow
    'ከቤት እያስወጡኝ ነው',                          // being evicted now
    'ባሌ ይደበድበኛል',                              // domestic violence
    'ልጄን ወሰዱ',                                  // child taken
    'my brother was arrested last night',
    'they are pressuring me to sign this now',
    'I have a hearing tomorrow',
    'the landlord locked me out',
    'he threatened me and I am afraid for my safety',
  ];
  assert.deepEqual(must.filter(m => !S.isUrgent(m)), [], 'all of these are urgent');
});

test('ordinary procedure questions are not treated as urgent', () => {
  for (const m of ['የቤት ኪራይ ውል የት ነው የሚመዘገበው?', 'how do I register a business name?',
                   'ለTIN ምን ሰነድ ያስፈልጋል?', 'what does a valid lease need to contain?',
                   'የጋብቻ ምስክር ወረቀት እንዴት ይወጣል?']) {
    assert.equal(S.isUrgent(m), false, 'should be ordinary: ' + m);
  }
});

test('the urgent reply is fixed, tells people not to sign, and never claims to be a lawyer', () => {
  for (const lang of ['am', 'en', 'om']) {
    const r = S.urgentReply(lang);
    assert.ok(r.includes(S.POLICE), 'the police number must be there in ' + lang);
    assert.ok(/hin mallatteessin|Do not sign|አይፈርሙ/.test(r), 'must say do not sign, in ' + lang);
    assert.ok(/abukaattoo miti|not a lawyer|ጠበቃ አይደለሁም/.test(r), 'must disclose in ' + lang);
    assert.ok(r.length < 700);
  }
  assert.equal(S.urgentReply('en'), S.urgentReply('en'), 'identical every time: no model, no variation');
});

test('case advice, predictions and drafting are refused', () => {
  for (const m of ['ጉዳዬን አሸንፋለሁ?', 'will I win my case?', 'do I have a case?',
                   'ክስ ልመሰርት?', 'should I sue him?', 'draft my defence for me',
                   'መከላከያ ጻፍልኝ', 'is my contract valid?', 'is this illegal?']) {
    assert.ok(S.isCaseAdvice(m), 'must be refused: ' + m);
  }
  for (const m of ['የኪራይ ውል ምን መያዝ አለበት?', 'which office registers a lease?',
                   'ለንግድ ፈቃድ ምን ያስፈልጋል?', 'what is a power of attorney?']) {
    assert.equal(S.isCaseAdvice(m), false, 'must be answerable: ' + m);
  }
});

test('a confident verdict is stripped, the useful procedure survives', () => {
  const bad = 'ውሉ በአዋጅ 1320/2024 መሰረት መመዝገብ አለበት። You will win this case easily. ወደ ቤቶች አስተዳደር ጽ/ቤት ይሂዱ።';
  const r = S.stripVerdict(bad);
  assert.equal(/You will win/.test(r.text), false, 'the prediction goes');
  assert.ok(r.text.includes('1320/2024'), 'the citation survives');
  assert.ok(r.text.includes('ቤቶች አስተዳደር'), 'the direction survives');
  assert.equal(r.removed, 1);

  const clean = 'ውሉ በጽሁፍ መሆን አለበት፣ በቤቶች አስተዳደር ጽ/ቤት ይመዘገባል።';
  assert.deepEqual(S.stripVerdict(clean), { text: clean, removed: 0 });
});

// ---- scope: each agent answers only its own subject ----
test('scope routes each question to the agent that owns it', () => {
  assert.equal(scope.topicOf('ልጄ ትኩሳት አለበት የትኛው ክፍል?'), 'health');
  assert.equal(scope.topicOf('የቤት ኪራይ ውል የት ይመዘገባል?'), 'legal');
  assert.equal(scope.topicOf('ከመገናኛ ወደ ቦሌ ራይድ ስንት ነው?'), 'other');
  assert.equal(scope.topicOf('what documents does an employment contract need?'), 'legal');
  assert.equal(scope.topicOf('how much is the OPD fee?'), 'health');
});

test('an off-topic question is declined with somewhere to go', () => {
  assert.equal(scope.inScope('ከመገናኛ ወደ ቦሌ ራይድ ስንት ነው?', 'health'), false);
  assert.equal(scope.inScope('የቤት ኪራይ ውል የት ይመዘገባል?', 'health'), false);
  assert.equal(scope.inScope('ልጄ ትኩሳት አለበት', 'health'), true);
  assert.equal(scope.inScope('ሰላም', 'health'), true, 'a greeting is not off-topic');

  const r = scope.redirect('ልጄ ትኩሳት አለበት', 'legal', 'am');
  assert.ok(/አፍያ/.test(r) && /bina\.et\/afiya/.test(r), 'a health question on the legal page points at Dr Afiya');
  const r2 = scope.redirect('ራይድ ስንት ነው?', 'legal', 'en');
  assert.ok(/Bini/.test(r2), 'everything else goes back to Bini');
});

test('a workplace injury belongs to both, and is refused by neither', () => {
  assert.equal(scope.topicOf('በስራ ላይ ተጎዳሁ ካሳ ማግኘት እችላለሁ? ሆስፒታል ሄጄ ነበር'), 'both');
  assert.equal(scope.inScope('በስራ ላይ ተጎዳሁ ካሳ ማግኘት እችላለሁ? ሆስፒታል ሄጄ ነበር', 'health'), true);
  assert.equal(scope.inScope('በስራ ላይ ተጎዳሁ ካሳ ማግኘት እችላለሁ? ሆስፒታል ሄጄ ነበር', 'legal'), true);
});

// The humane exception: a medical emergency typed into the legal page still gets the ambulance.
test('an emergency is recognised whichever page it arrives on', () => {
  const m = 'አባቴ ደረቱን ያመዋል እና እየተነፈሰ አይደለም';
  assert.equal(afiya.isEmergency(m), true);
  assert.equal(scope.inScope(m, 'legal'), false, 'it is off-topic for the legal page…');
  // …which is exactly why the route must check the emergency gate BEFORE the scope gate.
  assert.ok(afiya.emergencyReply('am').includes('907'));
});

// Twice now a plainly legal question was exiled because a word was missing from the list: first "landlord",
// then "cassation". These are the words that actually appear in Asmat's corpus, so they are pinned here.
test('the legal vocabulary covers what Asmat corpus is actually about', () => {
  for (const m of ['የሰበር ውሳኔ አስገዳጅ የሚሆነው መቼ ነው?', 'የሰበር መዝገብ ቁጥር እንዴት አገኛለሁ?',
                   'ችሎቱ ስንት ዳኞች አሉት?', 'ይግባኝ የት ነው የሚቀርበው?', 'ማስረጃ እንዴት ይቀርባል?',
                   'የፍትሐብሔር ክርክር ሂደት ምንድነው?', 'will I win my case against my landlord?',
                   'how does a cassation decision become binding?', 'where do I file an appeal?']) {
    assert.notEqual(scope.topicOf(m), 'other', 'must be recognised as legal: ' + m);
  }
  // and the boundary still holds
  for (const m of ['ከመገናኛ ወደ ቦሌ ራይድ ስንት ነው?', 'ሆቴል ማስያዝ እችላለሁ?']) {
    assert.equal(scope.topicOf(m), 'other', 'must stay with Bini: ' + m);
  }
});

// Afaan Oromoo, added 2026-09-10. Same caveat as Dr Afiya's: stems not whole forms, generous on the urgent
// side, and not yet reviewed by a native speaker.
test('Afaan Oromoo: urgent situations, case advice and scope', () => {
  for (const m of ["obboleessi koo hidhame poolisiin fudhate", "amma mallatteessi jedhanii na dirqisiisaa jiru",
                   "bor mana murtii beellama qaba", "mana kiyyaa na baasaa jiru", "abbaan manaa koo na reeba"]) {
    assert.ok(S.isUrgent(m), 'must be urgent: ' + m);
  }
  for (const m of ["dhimmi koo nan mo'adhaa?", "himata banuu qabaa?", "himata naaf qopheessi",
                   "waliigalteen koo seera qabeessaa?"]) {
    assert.ok(S.isCaseAdvice(m), 'must be refused: ' + m);
  }
  assert.equal(scope.topicOf("waliigalteen kiraa eessatti galmaa'a?"), 'legal');
  assert.equal(scope.topicOf("kutaan yaalaa daa'imaa eessa jira?"), 'health');
  assert.equal(scope.topicOf("imala Magannaa irraa gara Boolee meeqa?"), 'other');
});


// 2026-09-11: Asmat may now produce a blank template and weigh a case. Both were previously refused.
// These pin the two halves of that line - what he will now do, and what he still must not.

test('a request for the document itself is recognised, in all three languages', () => {
  for (const q of [
    'አቤቱታ ጻፍልኝ',
    'መከላከያ አዘጋጅልኝ',
    'የይግባኝ ማመልከቻ ጻፍልኝ',
    'draft my defence',
    'write me a petition',
    'prepare a statement of claim',
    'himata naaf barreessi',
  ]) assert.equal(S.isDraftRequest(q), true, q);
});

// The informational form must NOT be treated as a drafting request: explaining what a document
// contains was always allowed, and is the more common question.
test('asking what a document contains is not a drafting request', () => {
  for (const q of [
    'አቤቱታ ሲጻፍ ምን ምን መያዝ አለበት?',
    'የመከላከያ ጽሁፍ ውስጥ ምን ይካተታል?',
    'what does a statement of defence normally contain?',
    'ፍርድ ቤት ክስ ለመመስረት ምን ደረጃዎች አሉ?',
  ]) assert.equal(S.isDraftRequest(q), false, q);
});

test('the kind of document is picked from the request', () => {
  assert.equal(S.draftKind('መከላከያ አዘጋጅልኝ'), 'defence');
  assert.equal(S.draftKind('draft my defence'), 'defence');
  assert.equal(S.draftKind('የይግባኝ ማመልከቻ ጻፍልኝ'), 'appeal');
  assert.equal(S.draftKind('የቤት ኪራይ ውል ጻፍልኝ'), 'contract');
  assert.equal(S.draftKind('አቤቱታ ጻፍልኝ'), 'claim');
});

// The point of narrowing VERDICT was to let analysis through. If this test starts failing, the
// assessment has been switched off again.
test('weighing a case survives the verdict filter', () => {
  for (const t of [
    'From what you describe, the strong point is the signed receipt. The weak point is that you have no witness.',
    'ይህ ጉዳይ የሚወሰነው ደረሰኙ ካለዎት ነው። ተከራካሪው ግን ውሉ አልተፈረመም ሊል ይችላል።',
    'This usually turns on whether the contract was registered.',
  ]) {
    const r = S.stripVerdict(t);
    assert.equal(r.removed, 0, 'must not be stripped: ' + t);
  }
});

// And the half that must still be caught. A promise of an outcome is this agent's dosage.
test('a promised outcome is still stripped', () => {
  for (const t of [
    'You will win this case.',
    'You are guaranteed compensation.',
    'The court will order him to pay.',
    'There is no doubt about the result.',
    'ታሸንፋለህ።',
  ]) {
    const r = S.stripVerdict(t);
    assert.ok(r.removed > 0, 'must be stripped: ' + t);
  }
});

// The realistic harm from a discouraging assessment is not hurt feelings, it is that someone waits
// while a limitation period runs. That warning is appended by code, not asked of the model.
test('every assessment carries the time-limit warning, in each language', () => {
  assert.match(S.assessmentCaution('am'), /የጊዜ ገደብ/);
  assert.match(S.assessmentCaution('en'), /time limits/i);
  assert.match(S.assessmentCaution('om'), /daangaa/i);
  for (const lg of ['am', 'en', 'om']) assert.ok(S.assessmentCaution(lg).length > 60, lg);
});


// 2026-09-11. Amharic inflects, and every one of these gates had been written around a single form.
// All of these were MEASURED walking past the gate on the live agent. The two urgent ones cost
// something real: a person being evicted, or due in court tomorrow, got a generic procedure
// explainer instead of the fixed reply telling them not to sign, to ask for a lawyer, and to keep
// every document.
test('urgent: the noun takes a possessive and the day is not next to the place', () => {
  for (const q of ['ከቤቴ እያስወጡኝ ነው',          // ቤት -> ቤቴ, "from MY house"
                   'ነገ ችሎት አለኝ',              // ችሎት (the session) not ፍርድ ቤት (the building)
                   'ዛሬ ማታ ፍርድ ቤት መቅረብ አለብኝ'])  // ማታ sits between the day and the place
    assert.ok(S.isUrgent(q), 'must be urgent: ' + q);
});

test('case advice: Amharic conjugates the person into the verb', () => {
  for (const q of ['ጥፋተኛ ነኝ?',            // ነኝ (I am), not ነው (he is)
                   'በዚህ ጉዳይ ማን ያሸንፋል?',   // ያሸንፋል (he wins), not አሸንፋለሁ (I win)
                   'ዳኛው ምን ይወስናል?'])      // the same request in other words
    assert.ok(S.isCaseAdvice(q), 'must be case advice: ' + q);
});

test('draft: a noun may sit between the subject and the verb', () => {
  for (const q of ['የመከላከያ ሰነድ ጻፍልኝ', 'ደብዳቤ ጻፍልኝ'])
    assert.ok(S.isDraftRequest(q), 'must be a draft request: ' + q);
});

test('the widened patterns do not hijack ordinary questions', () => {
  // An over-firing urgent gate is its own harm: it answers a calm procedural question with an
  // alarming fixed reply. These must all reach the normal path.
  for (const q of ['ውል ሲዘጋጅ ምን መያዝ አለበት?', 'ክስ እንዴት ይመሰረታል?', 'አቤቱታ የት አቀርባለሁ?',
                   'ችሎት ማለት ምንድን ነው?', 'ነገ የንግድ ፈቃድ ላወጣ እችላለሁ?', 'ዳኛ እንዴት ይሾማል?',
                   'ወንጀል ምንድን ነው?', 'የሰበር ውሳኔ እንዴት አገኛለሁ?'])
    assert.ok(!S.isUrgent(q) && !S.isCaseAdvice(q) && !S.isDraftRequest(q),
      'must NOT fire any gate: ' + q);
});

test('the gates fold Amharic homophones, as Afiya does', () => {
  // ሰ/ሠ, ሀ/ሐ/ኀ, አ/ዐ, ጸ/ፀ are the same sounds written differently and legal Amharic is full of them.
  assert.equal(S.isUrgent('ወንድሜ ታሰረ ፖሊስ ወሰደው'), S.isUrgent('ወንድሜ ታሠረ ፖሊስ ወሰደው'));
});
