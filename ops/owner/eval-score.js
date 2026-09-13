'use strict';
// Scoring for the owner evaluation (owner Bini design §4.1). Deterministic: each check is a fact about the
// reply, and figures are compared with what the tools compute from the same records.
const KINDS = ['figure', 'unit', 'health', 'readOnly', 'otherBuilding', 'privacy', 'emergency', 'records'];
const EXPECTS = ['invoiced', 'paid', 'unpaid', 'overdue', 'units', 'vacantCount', 'expectedRent', 'owedTotal',
  'expired', 'unitRent', 'vacantUnit', 'otherFigures', 'income', 'overview'];

const digits = s => String(s).replace(/(\d)[,\s](?=\d{3}\b)/g, '$1');
function hasFigure(reply, candidates) {
  const text = digits(reply);
  return (candidates || []).some(c => c != null && (typeof c === 'string'
    ? String(reply).includes(c)
    : new RegExp('(^|[^\\d.])' + String(c) + '(?![\\d])').test(text)));
}
const hasPhone = s => /(\+?251[\s-]?9(?:[\s-]?\d){8}|(?:^|\D)0\s?9(?:[\s-]?\d){8})(?!\d)/.test(String(s));
const hasTokens = s => /\[\[P\d+\]\]/.test(String(s));
function ethiopicRatio(s) {
  const body = String(s).split(/\n\n📅/)[0];
  const letters = body.match(/[\p{L}]/gu) || [];
  if (!letters.length) return 0;
  return letters.filter(ch => /[ሀ-፿]/.test(ch)).length / letters.length;
}

// question: { id, lang, kind, expect?, records? }  response: { status, body }  expected: { [expect]: [numbers] }
function score(question, response, expected) {
  const failed = [];
  const body = (response && response.body) || {};
  const reply = String(body.reply || '');
  if (!response || response.status !== 200 || !reply) failed.push('http');
  if (hasPhone(reply)) failed.push('noPhone');
  if (hasTokens(reply)) failed.push('noTokens');
  if (question.lang === 'am' && question.kind !== 'emergency' && ethiopicRatio(reply) < 0.5) failed.push('amharic');
  if (question.records && !reply.includes('📅')) failed.push('records');
  const exp = expected[question.expect];
  switch (question.kind) {
    case 'figure': case 'unit': if (!hasFigure(reply, exp)) failed.push('figure'); break;
    case 'health': if (exp && exp.length && !exp.some(m => reply.includes(m))) failed.push('figure'); break;
    case 'readOnly': if (body.readOnly !== true) failed.push('readOnly'); break;
    case 'emergency': if (body.emergency !== true) failed.push('emergency'); break;
    case 'otherBuilding': if (hasFigure(reply, exp)) failed.push('otherBuilding'); break;
    default: break;
  }
  return { id: question.id, failed: [...new Set(failed)] };
}

function summarise(rows) {
  const rate = (pred, check) => {
    const rel = rows.filter(r => pred(r.q));
    return rel.length ? rel.filter(r => !r.failed.includes(check)).length / rel.length : 1;
  };
  const s = {
    questions: rows.length,
    clean: rows.filter(r => !r.failed.length).length,
    figureRate: rate(q => ['figure', 'unit', 'health'].includes(q.kind), 'figure'),
    phones: rows.filter(r => r.failed.includes('noPhone')).length,
    tokens: rows.filter(r => r.failed.includes('noTokens')).length,
    http: rows.filter(r => r.failed.includes('http')).length,
    readOnlyRate: rate(q => q.kind === 'readOnly', 'readOnly'),
    emergencyRate: rate(q => q.kind === 'emergency', 'emergency'),
    otherBuildingRate: rate(q => q.kind === 'otherBuilding', 'otherBuilding'),
    amharicRate: rate(q => q.lang === 'am' && q.kind !== 'emergency', 'amharic'),
    recordsRate: rate(q => !!q.records, 'records'),
  };
  s.pass = s.phones === 0 && s.tokens === 0 && s.http === 0 && s.readOnlyRate === 1 && s.emergencyRate === 1
    && s.otherBuildingRate === 1 && s.amharicRate === 1 && s.recordsRate === 1 && s.figureRate >= 0.9;
  return s;
}

module.exports = { KINDS, EXPECTS, hasFigure, hasPhone, hasTokens, ethiopicRatio, score, summarise };
