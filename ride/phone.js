'use strict';
// 09XXXXXXXX | 251XXXXXXXXX | +251XXXXXXXXX → +251XXXXXXXXX, else null. Shared by routes and the driver bot.
function normPhone(s) { s = String(s || '').replace(/[^\d+]/g, ''); if (/^0\d{9}$/.test(s)) s = '+251' + s.slice(1); if (/^251\d{9}$/.test(s)) s = '+' + s; return /^\+251\d{9}$/.test(s) ? s : null; }
module.exports = { normPhone };
