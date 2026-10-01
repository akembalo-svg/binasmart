'use strict';
// Office and professional job titles count as a job search only next to a job word (1 Oct 2026).
const test = require('node:test');
const assert = require('node:assert');
const { isJobTitleSearch, jobTitleArgs } = require('../assistant/force');

test('an accountant / nurse / engineer job search is caught, with its search word', () => {
  for (const [msg, q] of [['ለአካውንታንት የሥራ ማስታወቂያ አለ?', 'accountant'], ['accountant job in Addis', 'accountant'],
    ['የነርስ ስራ አለ?', 'nurse'], ['any engineer vacancy?', 'engineer'], ['የካሸር ሥራ እፈልጋለሁ', 'cashier'], ['teacher jobs Adama', 'teacher']]) {
    assert.strictEqual(isJobTitleSearch(msg), true, msg);
    assert.strictEqual(jobTitleArgs(msg).q, q, msg);
  }
  assert.strictEqual(jobTitleArgs('teacher jobs Adama').city, 'Adama');
});

test('a title alone, an employer, or a fee question is not a job search', () => {
  for (const msg of ['I am an accountant', 'አካውንታንት ነኝ', 'I need to hire an accountant', 'ሰራተኛ እፈልጋለሁ አካውንታንት', 'engineering school fees', 'sales tax in Ethiopia'])
    assert.strictEqual(isJobTitleSearch(msg), false, msg);
});

test('the old hospitality titles still work', () => {
  assert.strictEqual(isJobTitleSearch('ኢንተርናሽናል ሆቴል ወይትረስ'), true);
  assert.strictEqual(jobTitleArgs('waiter job Bole').q, 'waiter');
});
