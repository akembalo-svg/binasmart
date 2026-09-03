// Same rules as ride/routes.js normPhone: 09XXXXXXXX | 251XXXXXXXXX | +251XXXXXXXXX → +251XXXXXXXXX
export function normPhone(s) {
  s = String(s || '').replace(/[^\d+]/g, '');
  if (/^0\d{9}$/.test(s)) s = '+251' + s.slice(1);
  if (/^251\d{9}$/.test(s)) s = '+' + s;
  return /^\+251\d{9}$/.test(s) ? s : null;
}

export function maskPhone(s) {
  if (!s) return '-';
  s = String(s);
  return s.slice(0, 4) + '•'.repeat(Math.max(0, s.length - 7)) + s.slice(-3);
}
