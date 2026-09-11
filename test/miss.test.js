'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isMiss } = require('../assistant/memory');

// The miss flag is the only operational metric, and until 2026-09-12 it fired hardest when the
// system worked. It tested the REPLY for "I don't have" / "I don't know" / the WhatsApp link, so a
// correct clinical refusal, a complaint successfully handed to a human, and "ሰላም" all counted as
// failures. Reading the week's ten "unanswered" conversations, one was a real gap.
//
// A miss now means the one thing worth acting on: someone asked and we could not answer.
test('behaving correctly is not a miss', () => {
  assert.equal(isMiss('ዶ/ር አፍያ ነኝ። እኔ ሐኪም አይደለሁም፤ መድሃኒት ልነግርዎ አልችልም። ወደ ጤና ጣቢያ ይሂዱ።',
    { tools: ['afiya'], message: 'ምን መድሃኒት ልውሰድ?' }), false, 'a clinical refusal');
  assert.equal(isMiss('አይዞዎት። ወደ ቡድናችን አሳልፈዋለሁ። https://wa.me/251911244344',
    { tools: ['handover'], message: 'ሹፌሩ ከተስማማነው በላይ ጠየቀኝ' }), false, 'a complaint reaching a human');
  assert.equal(isMiss('ስለ ፖለቲካ የምናገረው ነገር የለም።',
    { tools: ['politics_declined'], message: 'ምርጫው መቼ ነበር?' }), false, 'politics declined by design');
  assert.equal(isMiss('⚠️ አምቡላንስ ይደውሉ፦ 907',
    { tools: ['emergency'], message: 'አባቴ አይተነፍስም' }), false, 'an emergency answered');
  assert.equal(isMiss('I am not a lawyer and cannot predict the outcome.',
    { tools: ['asmat'], message: 'will I win?' }), false, 'a legal refusal in English');
});

test('nothing was asked, so nothing was missed', () => {
  for (const g of ['ሰላም', 'hello', 'Akkam', 'hi!'])
    assert.equal(isMiss('ሰላም! ቢኒ ነኝ። እንዴት ልረዳዎት?', { tools: [], message: g }), false, g);
});

test('a real gap is still a miss', () => {
  assert.equal(isMiss('ይቅርታ፣ ስለዚህ መረጃ የለኝም። በ WhatsApp ያግኙን https://wa.me/251911244344',
    { tools: [], message: 'የቪዛ ክፍያ ስንት ነው?' }), true, 'could not answer a fee question');
  assert.equal(isMiss('ይቅርታ አላውቅም።', { tools: [], message: 'ስንት ሰዓት ይከፈታል?' }), true, 'plain do-not-know');
  assert.equal(isMiss("I don't have that information.", { tools: [], message: 'when does it open?' }),
    true, 'could not answer in English');
});
