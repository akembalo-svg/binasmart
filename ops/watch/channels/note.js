'use strict';
// The daily note (design §5.9). One Telegram message, and only on a day there is something to say.
//
// It goes through sendTgReal in ops/packs/freshness.js — the same bot and the same admin chats every other
// operational note uses. No new bot, no new token, and no test send: the standing rule is written into that
// file's own comment, and the first real morning with a real item is the proof.
//
// A day on which the offices published nothing sends NOTHING. Not a heartbeat, not a "0 items" line. The
// survey says that will be most days — fifteen office channels posting between 0.02 and 4 times a day, of
// which 73 % is excluded by rule — and an alert that arrives every morning is an alert nobody reads.
//
// Every line in the note is numbered in one continuous sequence across all three sections, so that a reply of
// `pull 4` is unambiguous whichever section item 4 is in:
//   pull N  — fetch that item's linked document on the next run (for the hosts that time out from this VPS)
//   drop N  — blacklist that item and the pattern behind it
// The replies are read by the existing owner-Bini Telegram path, not by a new bot.

const TITLE = '📣 Channel watch';
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MAX_ITEMS = 12;          // a note longer than this is a classifier fault, not a busy morning
const LINE = 140;

function longDate(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  return (y && m && d) ? d + ' ' + EN_MONTHS[m - 1] + ' ' + y : String(iso || '');
}
function oneLine(s, n = LINE) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n - 1).replace(/\s\S*$/, '') + '…';
}
const nameOf = x => String((x && x.source && x.source.name) || (x && x.office) || '?');
const postOf = x => String((x && x.post && x.post.url) || '');
const textOf = x => oneLine((x && x.post && x.post.text) || (x && x.title) || '');

// written:   [{ item, file, meta }]  — the documents this run wrote
// pending:   [{ item, url, why }]    — the documents it could not fetch (design §5.6)
// unsettled: [item]                  — what neither rule settled and the model was not asked, or would not say
// -> { text, items: [{ n, kind, item }], count }  and text === '' when there is nothing to say.
function buildNote({ written = [], pending = [], unsettled = [], today, dryRun = false } = {}) {
  const items = [];
  let n = 0;
  const lines = [];
  if (written.length) {
    lines.push(written.length + ' item(s) written to the watch:');
    for (const w of written.slice(0, MAX_ITEMS)) {
      const it = w.item || w;
      items.push({ n: ++n, kind: 'written', item: it });
      lines.push(n + '. ' + nameOf(it) + ' — ' + textOf(it));
      const url = postOf(it);
      if (url) lines.push('   ' + url);
      if (it.pendingDocument) lines.push('   (its document is in the list below)');
    }
    if (written.length > MAX_ITEMS) lines.push('   … and ' + (written.length - MAX_ITEMS) + ' more, all on disk');
  }
  if (pending.length) {
    if (lines.length) lines.push('');
    lines.push('⏳ ' + pending.length + ' document(s) this server could not fetch:');
    for (const p of pending.slice(0, MAX_ITEMS)) {
      const it = p.item || p;
      items.push({ n: ++n, kind: 'pending', item: it, url: p.url });
      lines.push(n + '. ' + nameOf(it) + ' — ' + p.url + '  (' + p.why + ')');
    }
    lines.push('   The announcement is already written; only the file is missing. The laptop route can fetch it.');
  }
  if (unsettled.length) {
    if (lines.length) lines.push('');
    lines.push('❓ ' + unsettled.length + ' item(s) the rules could not settle:');
    for (const u of unsettled.slice(0, MAX_ITEMS)) {
      items.push({ n: ++n, kind: 'unsettled', item: u });
      lines.push(n + '. ' + nameOf(u) + ' — ' + textOf(u));
      const url = postOf(u);
      if (url) lines.push('   ' + url);
    }
    lines.push('   Nothing was guessed: none of these is in the index.');
  }
  if (!items.length) return { text: '', items: [], count: 0 };
  const head = TITLE + ' — ' + longDate(today || new Date().toISOString().slice(0, 10))
    + (dryRun ? '  [DRY RUN — not sent]' : '');
  const foot = 'Reply `pull N` to fetch that item\'s document on the next run, or `drop N` to blacklist it.';
  return { text: head + '\n\n' + lines.join('\n') + '\n\n' + foot, items, count: items.length };
}

// One message, or none. sendTg is injected in the tests; in production it is the same sendTgReal that every
// other operational note uses, so there is one place to change where operational news goes.
async function sendNote(note, { sendTg, log = m => console.log(m), dryRun = false } = {}) {
  if (!note || !note.text) { log('[watch] nothing was written and nothing failed — no note sent, which is the point'); return { sent: false, reason: 'empty' }; }
  if (dryRun) { log('[watch] would have sent:\n' + note.text); return { sent: false, reason: 'dry-run' }; }
  const send = sendTg || require('../../packs/freshness').sendTgReal;
  const ok = await send(note.text);
  return { sent: !!ok, reason: ok ? 'sent' : 'no-delivery-route' };
}

module.exports = { buildNote, sendNote, oneLine, longDate, TITLE, MAX_ITEMS };
