'use strict';
// Home/land/shop to buy or rent must reach search_properties first; a car to rent, a school or a bank never.
const test = require('node:test');
const assert = require('node:assert');
const { shouldForceTool } = require('../assistant/force');
const cases = [
  ['2 bedroom apartment for rent in Bole', true], ['ቦሌ አካባቢ የሚከራይ ቤት እፈልጋለሁ', true],
  ['ባለ 3 መኝታ ኮንዶሚኒየም ስንት ነው', true], ['I want to buy a house in Addis', true], ['office for rent near Kazanchis', true],
  ['መኪና ኪራይ', false], ['car for rent', false], ['telebirr ስንት ያስከፍላል', false], ['ትምህርት ቤት የት ነው', false], ['what is VAT', false],
];
for (const [msg, want] of cases) test('property force: ' + msg, () => assert.strictEqual(shouldForceTool(msg), want));

// Buying a car reaches search_cars; a trip that mentions a car stays a ride.
const { isCarBuying } = require('../assistant/force');
const carCases = [
  ['used Toyota for sale', true], ['SUV price in Addis', true], ['የሚሸጥ መኪና አለ?', true], ['ኤሌክትሪክ መኪና ዋጋ', true],
  ['I want to buy a car', true], ['BYD electric cars', true], ['Toyota Corolla price', true],
  ['car to Bole price', false], ['መኪና ወደ ቦሌ ስንት ነው', false], ['ride to Piassa', false], ['2 bedroom apartment for rent', false],
];
for (const [msg, want] of carCases) test('car buying: ' + msg, () => assert.strictEqual(isCarBuying(msg), want));

// A place to stay reaches search_hotels; a trip to a hotel stays a ride, a hotel job stays a job.
const { isHotelSearch } = require('../assistant/force');
const hotelCases = [
  ['hotel in Bole', true], ['cheap guest house near Piassa', true], ['ቦሌ አካባቢ ሆቴል', true], ['4 star hotel in Addis', true],
  ['I want to book a hotel in Bole', true], ['where can I stay in Kazanchis? I need to find a pension', true],
  ['ኢንተርናሽናል ሆቴል ወይትረስ', false], ['waitress job at a hotel in Bole', false], ['ሆቴል ውስጥ አስተናጋጅ', false],
  ['take me to Sheraton hotel', false], ['I want to go to Hilton hotel', false], ['hotel jobs in Addis', false], ['ሆቴል ውስጥ ሥራ', false], ['used Toyota for sale', false],
];
for (const [msg, want] of hotelCases) test('hotel search: ' + msg, () => assert.strictEqual(isHotelSearch(msg), want));

// A job title is a job search; a second-meaning word needs a job word next to it; an employer, a CV, a fee is not.
const { isJobTitleSearch, jobTitleArgs } = require('../assistant/force');
const jobCases = [
  ['ኢንተርናሽናል ሆቴል ወይትረስ', true], ['ሆቴል ውስጥ ምግብ አብሳይ ስራ አለ?', true], ['receptionist job in Bole', true], ['የጥበቃ ስራ አዲስ አበባ', true],
  ['የፋይናንስ ደንበኛ ጥበቃ መመሪያ', false], ['how to cook shiro', false], ['የከተማ ፅዳት', false], ['I need a waiter for my cafe', false],
  ['ሰራተኛ መቅጠር እፈልጋለሁ ለሆቴሌ', false], ['ስራ ለማግኘት ክፍያ ተጠየቅኩ ወይትረስ', false], ['take me to the Chef restaurant', false],
];
for (const [msg, want] of jobCases) test('job title search: ' + msg, () => assert.strictEqual(isJobTitleSearch(msg), want));
test('job title args', () => {
  assert.deepStrictEqual(jobTitleArgs('ቦሌ አካባቢ ወይትረስ'), { q: 'waiter', field: 'hospitality', city: 'Addis Ababa' });
  assert.deepStrictEqual(jobTitleArgs('የጥበቃ ስራ አዳማ'), { q: 'guard', field: 'security', city: 'Adama' });
});
