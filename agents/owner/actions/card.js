'use strict';
// What the owner reads about an action: the preview card, the result, a refusal, a toast. Bilingual like every owner
// Telegram message (Amharic · English), built only from the resolver's figures and the delivery plan — never from the
// model's words. Buttons are abstract ({ verb, label }): ride/binaBot.js turns them into Telegram callback buttons
// (oa:<c|x|u>:<id>), public/owner.html into dashboard buttons.
const P = require('./policy');

const etb = n => Number(n || 0).toLocaleString('en-US');
const list = (xs, max = 30) => xs.slice(0, max).join(', ') + (xs.length > max ? ' … (+' + (xs.length - max) + ')' : '');
const pick = (pair, l) => pair[l === 'am' ? 0 : 1];
const both = pair => pair[0] + ' · ' + pair[1];

const TITLE = {
  message: '📢 መልእክት ለተከራዮች · Message to tenants',
  remind_unpaid: '🔔 የክፍያ ማሳሰቢያ · Payment reminders',
  send_invoice: '🧾 ኢንቮይስ መላክ · Send invoices',
  create_invoices: '🗓 የወር ኪራይ ኢንቮይሶች · Create month invoices',
  record_payment: '💵 ክፍያ መመዝገብ · Record a payment',
};
const WRITES = new Set(['create_invoices', 'record_payment']);
const NOTHING_YET = kind => (WRITES.has(kind) ? 'ገና ምንም አልተመዘገበም · nothing recorded yet' : 'ገና ምንም አልተላከም · nothing sent yet');
const NOTHING_DONE = kind => (WRITES.has(kind) ? 'ምንም አልተመዘገበም · nothing was recorded' : 'ምንም አልተላከም · nothing was sent');
const CONFIRM = { message: '✅ ላክ · Confirm', remind_unpaid: '✅ ላክ · Confirm', send_invoice: '✅ ላክ · Confirm',
  create_invoices: '✅ አዘጋጅ · Confirm', record_payment: '✅ መዝግብ · Confirm' };
const CANCEL = { verb: 'cancel', label: '✖ ሰርዝ · Cancel' };
const URGENT = { verb: 'urgent', label: '⚠️ አስቸኳይ ነው — አሁን ላክ' };

function buttons(a, now) {
  if (a.bulk && P.isQuiet(now)) return [URGENT, CANCEL];
  return [{ verb: 'confirm', label: CONFIRM[a.kind] }, CANCEL];
}

// Telegram n · SMS n · not reachable n (units), SMS parts, what is left of the month, the estimate, and the mode.
function deliveryLines(fresh, plan, tb, what) {
  if (!plan) return [];
  const none = plan.rows.map((r, i) => (r.channel === 'none' ? fresh.unitOf[fresh.recipients[i].tenancyId] : null)).filter(Boolean);
  const out = ['📨 ' + what + ' ቴሌግራም · Telegram ' + plan.counts.telegram + ' · SMS ' + plan.counts.sms
    + ' · አይደርስም · not reachable ' + plan.counts.none + (none.length ? ' (' + list([...new Set(none)], 10) + ')' : '')];
  if (plan.smsParts) out.push('💬 SMS ' + plan.smsParts + ' ክፍሎች · parts · በዚህ ወር የቀረው · left this month ' + plan.remaining + '/' + plan.limit + ' · ≈ ' + plan.costEtb + ' ETB');
  if (!tb.real) out.push('🧪 የሙከራ ህንፃ፦ ለተከራዮች ምንም አይደርስም · Test building: nothing reaches tenants');
  else if (plan.mode !== 'live' && plan.counts.sms) out.push('🧪 SMS በሙከራ ላይ ነው፦ በSMS የሚደርሳቸው አያገኙም፤ ቴሌግራም ይላካል · SMS is in test mode: SMS tenants get nothing; Telegram is sent');
  return out;
}

function body(a, fresh, plan, tb) {
  const v = fresh.view;
  switch (a.kind) {
    case 'message': {
      const who = v.target === 'all' ? 'ሁሉም ተከራዮች · all tenants'
        : v.target === 'floor' ? (v.floor === 0 ? 'ምድር ቤት · ground floor' : v.floor + 'ኛ ፎቅ · floor ' + v.floor) : 'ክፍሎች · units';
      return ['👥 ተቀባዮች · Recipients: ' + v.count + ' — ' + who, '🔢 ክፍሎች · Units: ' + list(v.units),
        '', '✉️ ተከራዮች የሚያነቡት · What tenants read:', v.telegramText,
        '(SMS: «' + tb.smsLabel + '፦ » + ' + 'መልእክቱ · the text)', '', ...deliveryLines(fresh, plan, tb, '')];
    }
    case 'remind_unpaid':
      return ['👥 ተከራዮች · Tenants: ' + v.count + ' · ጠቅላላ ያልተከፈለ · total unpaid ' + etb(v.totalEtb) + ' ETB',
        '🔢 ክፍሎች · Units: ' + list(v.units), '(የሚከፈልበት ቀን ያለፈ ወይም በ5 ቀናት ውስጥ · due now or within 5 days)',
        '', '✉️ ምሳሌ፣ ክፍል ' + v.sampleUnit + ' · Example, unit ' + v.sampleUnit + ':', v.sample, '', ...deliveryLines(fresh, plan, tb, '')];
    case 'send_invoice':
      return [...v.rows.map(r => '• ' + r.unit + (r.occupant ? ' — ' + r.occupant : '') + ' — ' + r.type + ' ' + etb(r.totalEtb) + ' ETB — ' + r.dueDate),
        ...(v.skipped.length ? ['⏭ ያልተከፈለ ኢንቮይስ የሌላቸው · No unpaid invoice: ' + list(v.skipped, 10)] : []), '', ...deliveryLines(fresh, plan, tb, '')];
    case 'create_invoices':
      return ['🗓 ወር · Month ' + v.month + ' · የሚከፈልበት · due ' + v.dueDate,
        '🧾 የሚዘጋጁ · To create: ' + v.count + ' · ጠቅላላ · total ' + etb(v.totalEtb) + ' ETB',
        ...v.rows.slice(0, 30).map(r => '• ' + r.unit + ' — ' + etb(r.amount)), ...(v.rows.length > 30 ? ['• … +' + (v.rows.length - 30)] : []),
        '⏭ ቀድሞ ያላቸው · Already invoiced: ' + v.skipped,
        ...(v.zero.length ? ['⚠️ ኪራይ 0 የሆኑ · Rent 0: ' + list(v.zero, 10)] : []),
        '📌 ማዘጋጀት መላክ አይደለም · Creating does not send them.'];
    case 'record_payment':
      return ['🔢 ክፍል · Unit ' + v.unit + (v.occupant ? ' — ' + v.occupant : ''),
        '🧾 ' + v.type + ' · የሚከፈልበት · due ' + v.dueDate + ' · ' + etb(v.totalEtb) + ' ETB',
        '✅ ' + v.statusBefore + ' → PAID · በ · via ' + v.method,
        ...(v.otherOpen ? ['➕ የዚህ ክፍል ሌሎች ያልተከፈሉ · Other unpaid invoices of this unit: ' + v.otherOpen] : []),
        ...deliveryLines(fresh, plan, tb, 'ደረሰኝ · Receipt:'),
        '↩️ ስህተት ከሆነ በዳሽቦርዱ Invoices ↩️ ይመልሱ · If wrong, undo it with ↩️ in the dashboard Invoices tab.'];
    default: return [];
  }
}

// opts: { now, tb (the delivery layer's building: real, smsLabel), changed, staff }
function preview(a, fresh, plan, { now, tb, changed = false, staff = false }) {
  const lines = ['👀 ቅድመ እይታ — ' + NOTHING_YET(a.kind), TITLE[a.kind], '🏢 ' + tb.name, '', ...body(a, fresh, plan, tb)];
  if (changed) lines.unshift('🔄 ከቅድመ እይታው በኋላ መዝገቡ ተቀይሯል፤ ይህ አዲሱ ነው · The records changed since the last preview; this is the new one.', '');
  if (a.bulk && P.isQuiet(now)) lines.push('🌙 ከምሽቱ 3 እስከ ጠዋቱ 1 ሰዓት (21:00–07:00) ለብዙ ተከራዮች አይላክም። አስቸኳይ ከሆነ ብቻ ⚠️ ይጫኑ፤ ካልሆነ ከ07:00 በኋላ እንደገና ይጠይቁ። · Quiet hours (21:00–07:00 Addis): bulk sends wait. Press ⚠️ only if it is urgent; otherwise ask again after 07:00.');
  if (staff) lines.push('👤 በሰራተኛ የተዘጋጀ፤ ማረጋገጥ የሚችለው ባለቤቱ ነው · Prepared by staff; only the owner can confirm.');
  lines.push('⏳ እስከ ' + P.addisClock(a.expiresAt) + ' (አዲስ አበባ) · Valid until ' + P.addisClock(a.expiresAt) + ' Addis time');
  return { text: lines.join('\n').replace(/\n{3,}/g, '\n\n'), buttons: buttons(a, now) };
}

// What the staff member who prepared it reads: no buttons.
const sentToOwner = previewText => ({ text: '📨 ቅድመ እይታው ለባለቤቱ ተልኳል፤ የሚፈጸመው ባለቤቱ ✅ ሲጫኑ ብቻ ነው · The preview went to the owner; it runs only when the owner presses ✅.\n\n' + previewText, buttons: [] });

function counts(c) {
  return 'ቴሌግራም · Telegram ' + (c.telegram || 0) + ' · SMS ' + (c.sms || 0) + ' · ቻናል የሌላቸው · no channel ' + (c.none || 0);
}

function resultLine(a, r) {
  r = r || {};
  if (r.error === 'sms_limit') return '❌ የወሩ SMS ገደብ ስለሚያልፍ ' + NOTHING_DONE(a.kind) + ' · over this month\'s SMS limit';
  if (r.error === 'already_paid') return '⏭ ኢንቮይሱ ቀድሞ ተከፍሏል · The invoice was already paid; ' + NOTHING_DONE(a.kind);
  switch (a.kind) {
    case 'create_invoices':
      return '✅ ' + (r.created || 0) + ' ኢንቮይሶች ተዘጋጅተዋል (' + (r.skipped || 0) + ' ቀድሞ ነበሩ)፤ ገና አልተላኩም · ' + (r.created || 0) + ' invoices created (' + (r.skipped || 0) + ' already existed); not sent yet.';
    case 'record_payment': {
      const rc = r.receipt;
      const receipt = !rc ? 'ደረሰኝ አልተላከም · no receipt'
        : rc.status === 'sent' || rc.status === 'delivered' ? 'ደረሰኝ በ' + rc.channel + ' ተልኳል · receipt sent by ' + rc.channel
        : rc.status === 'test' ? 'ደረሰኝ በሙከራ ተመዝግቧል፣ አልተላከም · receipt recorded in test mode, not sent'
        : 'ደረሰኝ አልደረሰም · receipt not delivered (' + (rc.errorKind || rc.channel) + ')';
      return '✅ ክፍያ ተመዝግቧል · Payment recorded — ' + r.unit + ' · ' + etb(r.totalEtb) + ' ETB · PAID\n📨 ' + receipt;
    }
    default: {
      const c = r.counts || {};
      const head = c.sent ? '✅ ተልኳል · Sent ' + c.sent : (c.test ? '🧪 በሙከራ ተመዝግቧል፣ ለማንም አልተላከም · Recorded in test mode, nothing sent' : '❌ አልተላከም · Not sent');
      return head + (c.sent && c.test ? ' · 🧪 test ' + c.test : '') + (c.failed ? ' · ❌ ' + c.failed : '') + '\n' + counts(c)
        + (r.notReached && r.notReached.length ? '\n📵 ያልደረሳቸው · Not delivered: ' + list(r.notReached, 15) : '');
    }
  }
}

const FINAL = {
  cancelled: a => '✖ ተሰርዟል — ' + NOTHING_DONE(a.kind),
  expired: a => '⌛ ጊዜው አልፏል (10 ደቂቃ) — ' + NOTHING_DONE(a.kind) + '። እንደገና ቢኒን ይጠይቁ · Expired after 10 minutes. Ask Bini again.',
  running: () => '⏳ በሂደት ላይ · In progress',
  replaced: () => '🔄 መዝገቡ ተቀይሯል፤ አዲሱን ቅድመ እይታ ይመልከቱ · The records changed; see the new preview.',
  failed: a => '❌ አልተሳካም · Failed' + (a.result && a.result.counts ? '\n' + counts(a.result.counts) : ''),
  refused: a => '⛔ ' + both(say(a.result || {})),
  done: a => resultLine(a, a.result),
};
// The preview as it was confirmed, and what happened, in one message.
function final(a) {
  const line = (FINAL[a.status] || FINAL.failed)(a);
  return { text: (a.cardText ? a.cardText.replace(/\n⏳ [^\n]*$/, '') + '\n\n' : '') + line, buttons: [] };
}

// Refusals, from the prepare tools and at confirm. Returned as [Amharic, English].
const SAY = {
  no_building: () => ['ይህ ህንፃ በመዝገብዎ ውስጥ አልተገኘም።', 'That building is not among yours.'],
  which_building: () => ['የትኛው ህንፃ? ስሙን ከትእዛዙ ጋር ይጻፉ።', 'Which building? Write its name with the request.'],
  target_required: () => ['ለማን ልላክ? «ለሁሉም ተከራዮች»፣ «ለ2ኛ ፎቅ» ወይም «ለ211» ብለው ይጻፉ።', 'To whom? Write "all tenants", "floor 2" or "unit 211".'],
  units_required: () => ['የትኞቹ ክፍሎች? ቁጥራቸውን ይጻፉ።', 'Which units? Write their numbers.'],
  text_required: () => HELP.message,
  text_tokens: () => ['መልእክቱ የተከራይ ስም ምልክት ይዟል፤ መልእክቱን ራስዎ ይጻፉ።', 'The text contains a name placeholder; please write the message yourself.'],
  text_too_long: () => ['መልእክቱ ከ' + P.NOTICE_MAX + ' ፊደላት በላይ ነው (አንድ SMS)፤ ያሳጥሩት።', 'The message is longer than ' + P.NOTICE_MAX + ' characters (one SMS); please shorten it.'],
  floor_unknown: r => ['ያንን ፎቅ በመዝገቡ አላገኘሁትም። ያሉት ፎቆች፦ ' + (r.floors || []).join(', '), 'I could not find that floor. Floors in the records: ' + (r.floors || []).join(', ')],
  no_recipients: () => ['በዚህ ምርጫ ንቁ ተከራይ የለም።', 'No active tenant matches that.'],
  unit_unknown: r => ['እነዚህ ክፍሎች በመዝገቡ የሉም፦ ' + (r.units || []).join(', '), 'These units are not in the records: ' + (r.units || []).join(', ')],
  unit_vacant: r => ['እነዚህ ክፍሎች ተከራይ የላቸውም፦ ' + (r.units || []).join(', '), 'These units have no tenant: ' + (r.units || []).join(', ')],
  too_many_units: r => ['በአንድ ጊዜ እስከ ' + (r.max || P.MAX_UNITS) + ' ክፍሎች ብቻ።', 'At most ' + (r.max || P.MAX_UNITS) + ' units at once.'],
  one_unit: () => ['ክፍያ የሚመዘገበው ለአንድ ክፍል በአንድ ጊዜ ነው።', 'A payment is recorded for one unit at a time.'],
  nothing_unpaid: () => ['የሚያስታውሱት ያልተከፈለ ክፍያ የለም (የሚከፈልበት ቀን ያለፈ ወይም በ5 ቀናት ውስጥ የሆነ)።', 'No unpaid invoice is due now or within 5 days.'],
  no_open_invoice: r => ['ያልተከፈለ ኢንቮይስ የለም፦ ክፍል ' + (r.units || []).join(', '), 'No unpaid invoice for unit ' + (r.units || []).join(', ') + '.'],
  bad_amount: () => ['መጠኑ አልተረዳኝም፤ በብር ቁጥር ይጻፉ፣ ለምሳሌ 12,500።', 'I did not understand the amount; write it in birr, e.g. 12,500.'],
  amount_mismatch: r => ['የክፍል ' + r.unit + ' ያልተከፈሉ ኢንቮይሶች፦ ' + (r.totals || []).map(etb).join(' · ') + ' ብር። ' + etb(r.amount) + ' ብር ከአንዳቸውም ጋር አይገጥምም፤ ከፊል ክፍያ በዚህ ስሪት መመዝገብ አይቻልም።',
    'Unit ' + r.unit + '\'s unpaid invoices: ' + (r.totals || []).map(etb).join(' · ') + ' ETB. ' + etb(r.amount) + ' ETB matches none of them; a part payment cannot be recorded in this version.'],
  bad_method: () => ['የክፍያ መንገድ፦ CASH፣ TELEBIRR፣ CBE_BIRR ወይም BANK_TRANSFER።', 'Payment method must be CASH, TELEBIRR, CBE_BIRR or BANK_TRANSFER.'],
  bad_month: () => ['ኢንቮይስ የሚዘጋጀው ካለፉት 3 ወራት እስከ ሚቀጥለው ወር ነው፤ ወሩን እንደ 2026-10 ይጻፉ።', 'Invoices can be created from 3 months back to next month; write the month like 2026-10.'],
  nothing_to_create: r => ['የ' + r.month + ' ኪራይ ኢንቮይስ ለሁሉም ንቁ ተከራዮች ቀድሞ አለ (' + (r.skipped || 0) + ')።', 'Every active tenant already has a rent invoice for ' + r.month + ' (' + (r.skipped || 0) + ').'],
  bulk_limit: () => ['ዛሬ ለብዙ ተከራዮች ' + P.BULK_PER_DAY + ' ጊዜ ተልኳል፤ ይህ የቀኑ ገደብ ነው። ነገ እንደገና ይሞክሩ።', P.BULK_PER_DAY + ' bulk sends already went out today, the daily limit. Try again tomorrow.'],
  sms_limit: r => ['ይህ መላክ ' + r.needed + ' የSMS ክፍሎች ይፈልጋል፤ በዚህ ወር የቀረው ' + r.remaining + ' ነው። ምንም አልተዘጋጀም፤ ገደቡን ለመጨመር BinaSmartን ያነጋግሩ።',
    'This send needs ' + r.needed + ' SMS parts; ' + r.remaining + ' are left this month. Nothing was prepared; contact BinaSmart to raise the limit.'],
  no_owner_chat: () => ['ይህን ማረጋገጥ ያለበት ባለቤቱ ነው፤ ነገር ግን ባለቤቱ በቴሌግራም አልተገናኘም።', 'The owner must confirm this, but no owner is linked on Telegram.'],
  one_action: () => ['በአንድ መልእክት አንድ ተግባር ብቻ ነው የማዘጋጀው።', 'I prepare one action per message.'],
  error: () => ['ይቅርታ፣ አሁን ማዘጋጀት አልተቻለም። እባክዎ እንደገና ይሞክሩ።', 'Sorry, that could not be prepared just now. Please try again.'],
};
const say = r => (SAY[r && r.error] || SAY.error)(r || {});

// A request Bini recognised as an action, where nothing was prepared (the model called no prepare tool).
const HELP = {
  message: ['መልእክቱን ከትእዛዙ ጋር በአንድ መልእክት ይጻፉ፤ ለምሳሌ «ለሁሉም ተከራዮች መልእክት ላክ፦ ነገ ከጠዋቱ 3 እስከ 6 ሰዓት ውሃ ይቋረጣል»፣ «ለ2ኛ ፎቅ ተከራዮች …»፣ «ለክፍል 211 …» ወይም «ያልከፈሉትን አስታውስ»። ከመላኩ በፊት ቅድመ እይታ አሳይዎታለሁ፤ የሚላከው ✅ ሲጫኑ ብቻ ነው።',
    'Write the message together with the request, e.g. "Send all tenants: water is off tomorrow 9 to 12", "floor 2 tenants: …", "unit 211: …" or "remind the tenants who have not paid". I show you a preview first; nothing is sent until you press ✅.'],
  invoice: ['ለምሳሌ «የክፍል 211ን ኢንቮይስ ላክ» ወይም «ለሁሉም የ2026-10 ኪራይ ኢንቮይስ አዘጋጅ» ብለው ይጻፉ። ቅድመ እይታ አሳይዎታለሁ፤ የሚፈጸመው ✅ ሲጫኑ ብቻ ነው።',
    'Write e.g. "send the invoice of unit 211" or "create the rent invoices for 2026-10". I show you a preview first; nothing happens until you press ✅.'],
  paid: ['ለምሳሌ «ክፍል 211 ከፍሏል 12,500 በጥሬ ገንዘብ» ብለው ይጻፉ። ቅድመ እይታ አሳይዎታለሁ፤ የሚመዘገበው ✅ ሲጫኑ ብቻ ነው።',
    'Write e.g. "unit 211 paid 12,500 in cash". I show you a preview first; nothing is recorded until you press ✅.'],
};
const help = (kind, l) => pick(HELP[kind] || HELP.message, l);

const TOAST = {
  done: '✅', cancelled: '✖ ተሰርዟል · Cancelled', expired: '⌛ ጊዜው አልፏል · Expired', running: '⏳ በሂደት ላይ · In progress',
  replaced: '🔄 ተቀይሯል · Replaced by a newer preview', refused: '⛔ አልተፈጸመም · Not done', failed: '❌ አልተሳካም · Failed',
  not_allowed: '⛔ ይህን ማረጋገጥ የሚችለው የህንፃው ባለቤት ብቻ ነው · Only the building owner can confirm this',
  gone: 'ይህ ቅድመ እይታ አልተገኘም · This preview no longer exists',
  quiet: '🌙 21:00–07:00 — አስቸኳይ ከሆነ ⚠️ ይጫኑ · Quiet hours: press ⚠️ if urgent',
  changed: '🔄 መዝገቡ ተቀይሯል · Records changed: check the new preview',
};
const toast = code => TOAST[code] || TOAST.failed;

// What the model is told after a successful prepare: enough to know it worked, nothing to act on.
const forModel = (a, fresh) => ({ prepared: true, kind: a.kind, recipients: fresh.recipients.length, units: (fresh.view.units || []).slice(0, 20),
  note: 'The owner now sees a preview with ✅ and ✖. Nothing has been sent or recorded, and you must not say it was.' });

// For the building's audit log: kind, channel, counts, batch ids. Never the notice text.
function auditDetail(a, extra) {
  const r = extra || {};
  const parts = [a.kind, a.channel];
  if (r.recipients != null) parts.push(r.recipients + ' recipients');
  if (r.plan) parts.push('tg ' + r.plan.counts.telegram + ' sms ' + r.plan.counts.sms + ' none ' + r.plan.counts.none + ' parts ' + r.plan.smsParts);
  if (r.counts) parts.push('sent ' + (r.counts.sent || 0) + ' test ' + (r.counts.test || 0) + ' failed ' + (r.counts.failed || 0));
  if (r.created != null) parts.push('created ' + r.created + ' skipped ' + (r.skipped || 0));
  if (r.invoiceId) parts.push('invoice ' + r.invoiceId);
  if (r.batchIds && r.batchIds.length) parts.push('batch ' + r.batchIds.join(','));
  if (r.urgent) parts.push('urgent');
  if (r.reason) parts.push(r.reason);
  parts.push('id ' + a.id);
  return parts.join(' · ').slice(0, 200);
}

module.exports = { TITLE, CONFIRM, buttons, preview, sentToOwner, final, resultLine, say, help, toast, forModel, auditDetail, SAY, HELP, both, pick };
