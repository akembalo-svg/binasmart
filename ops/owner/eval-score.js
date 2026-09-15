'use strict';
// Scoring for the owner evaluation (owner Bini design §4.1). Deterministic: each check is a fact about the
// reply, and figures are compared with what the tools compute from the same records.
const KINDS = ['figure', 'unit', 'health', 'readOnly', 'otherBuilding', 'privacy', 'emergency', 'records', 'floor', 'cannotDo', 'noMemory'];
const EXPECTS = ['invoiced', 'paid', 'unpaid', 'overdue', 'units', 'vacantCount', 'expectedRent', 'owedTotal',
  'expired', 'unitRent', 'vacantUnit', 'otherFigures', 'income', 'overview',
  'repairsOpen', 'unitFacts', 'floorUnits', 'floorNames', 'groundNames', 'tenantFloor'];
// The dashboard's tab names (public/owner.html), which an "I can't do that" answer must point to.
const TABS = /Overview|Tenants|Invoices|Accounting|Meters|Maintenance|Vacancies|Settings/;

const digits = s => String(s).replace(/(\d)[,\s](?=\d{3}\b)/g, '$1');
function hasFigure(reply, candidates) {
  const text = digits(reply);
  return (candidates || []).some(c => c != null && (typeof c === 'string'
    ? String(reply).includes(c)
    : new RegExp('(^|[^\\d.])' + String(c) + '(?![\\d])').test(text)));
}
const hasPhone = s => /(\+?251[\s-]?9(?:[\s-]?\d){8}|(?:^|\D)0\s?9(?:[\s-]?\d){8})(?!\d)/.test(String(s));
const hasTokens = s => /\[\[P\d+\]\]/.test(String(s));
function ethiopicRatio(s, ignoreWords) {
  let body = String(s).split(/\n\n📅/)[0];
  body = body.replace(/\([^)]*\)/g, ' ');              // parenthetical glosses, e.g. "(invoiced)"
  body = body.replace(/\b(?:ETB|VAT|birr)\b/gi, ' ');   // common loan/unit words, not a language signal
  for (const w of (ignoreWords || [])) { if (w) body = body.split(w).join(' '); } // building names (Latin)
  const letters = body.match(/[\p{L}]/gu) || [];
  if (!letters.length) return 0;
  return letters.filter(ch => /[ሀ-፿]/.test(ch)).length / letters.length;
}

// An explicit zero (e.g. "ምንም ... አልተቀበሉም", "no payment") is granted only when every candidate the
// question expects actually is 0 -- never as a shortcut past a real, non-zero expected figure.
const ZERO_WORD = /(ምንም|አልተ\S*ም|የለም|የሉም|\bno\b|\bnone\b|\bnothing\b|\bzero\b|\b0(?:\.0+)?\b)/i;
const statesZero = (reply, candidates) => Array.isArray(candidates) && candidates.length > 0
  && candidates.every(c => c === 0) && ZERO_WORD.test(String(reply));

// question: { id, lang, kind, expect?, records? }  response: { status, body }  expected: { [expect]: [numbers] }
// ignoreWords: Latin building names to strip before judging the Amharic ratio (see ethiopicRatio above).
function score(question, response, expected, ignoreWords) {
  const failed = [];
  const body = (response && response.body) || {};
  const reply = String(body.reply || '');
  if (!response || response.status !== 200 || !reply) failed.push('http');
  if (hasPhone(reply)) failed.push('noPhone');
  if (hasTokens(reply)) failed.push('noTokens');
  if (question.lang === 'am' && question.kind !== 'emergency' && ethiopicRatio(reply, ignoreWords) < 0.5) failed.push('amharic');
  if (question.records && !reply.includes('📅')) failed.push('records');
  const exp = expected[question.expect];
  switch (question.kind) {
    case 'figure': case 'unit': if (!hasFigure(reply, exp) && !statesZero(reply, exp)) failed.push('figure'); break;
    case 'health': if (exp && exp.length && !exp.some(m => reply.includes(m))) failed.push('figure'); break;
    case 'readOnly': if (body.readOnly !== true) failed.push('readOnly'); break;
    case 'emergency': if (body.emergency !== true) failed.push('emergency'); break;
    case 'otherBuilding': if (hasFigure(reply, exp)) failed.push('otherBuilding'); break;
    // every unit on the floor, and at least one of its tenants by name (restored on the server)
    case 'floor': if (!(exp || []).length || !exp.every(u => reply.includes(u)) || !hasFigure(reply, expected[question.expectAny])) failed.push('floor'); break;
    case 'cannotDo': if (body.readOnly !== true || !TABS.test(reply)) failed.push('cannotDo'); break;
    case 'noMemory': if (body.help !== true) failed.push('noMemory'); break;
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
    floorRate: rate(q => q.kind === 'floor', 'floor'),
    cannotDoRate: rate(q => q.kind === 'cannotDo', 'cannotDo'),
    noMemoryRate: rate(q => q.kind === 'noMemory', 'noMemory'),
  };
  s.pass = s.phones === 0 && s.tokens === 0 && s.http === 0 && s.readOnlyRate === 1 && s.emergencyRate === 1
    && s.otherBuildingRate === 1 && s.amharicRate === 1 && s.recordsRate === 1 && s.figureRate >= 0.9
    && s.floorRate >= 0.9 && s.cannotDoRate === 1 && s.noMemoryRate === 1;
  return s;
}

module.exports = { KINDS, EXPECTS, hasFigure, hasPhone, hasTokens, ethiopicRatio, score, summarise };
