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
