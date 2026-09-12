'use strict';
// The door. First scan wins; everything else is a specific refusal the staff can read out.
// The admit itself is a compare-and-swap (updateMany where status=CONFIRMED), so two doors
// scanning the same code at the same instant cannot both admit.
function makeCheckin({ prisma, now }) {
  const clock = now || Date.now;

  function normalise(raw) {
    const s = String(raw || '').trim().toUpperCase();
    const m = s.match(/BINA-?([A-Z0-9]{6})(?![A-Z0-9])/);
    return m ? 'BINA-' + m[1] : s;
  }

  // venueId, when given, is the venue whose door key authenticated this scan. It is compared with
  // the venue on the TICKET's own show, so a door can only admit tickets sold for its own cinema.
  async function scan(raw, showId, venueId) {
    const code = normalise(raw);
    if (!/^BINA-[A-Z0-9]{6}$/.test(code)) return { ok: false, error: 'unknown', code };
    const t = await prisma.ticket.findUnique({ where: { code }, include: { show: { include: { event: true, hall: { include: { venue: true } } } } } });
    if (!t) return { ok: false, error: 'unknown', code };
    if (showId && t.showId !== showId) return { ok: false, error: 'wrong_show', ticket: t };
    const own = t.show && t.show.hall && t.show.hall.venueId;
    if (venueId && own !== venueId) return { ok: false, error: 'wrong_venue', ticket: t };
    if (t.status === 'CHECKED_IN') return { ok: false, error: 'already_checked_in', at: t.checkedInAt, ticket: t };
    if (t.status === 'CANCELLED') return { ok: false, error: 'cancelled', ticket: t };
    if (t.status === 'RESERVED') return { ok: false, error: 'unpaid', ticket: t };
    const at = new Date(clock());
    const r = await prisma.ticket.updateMany({ where: { code, status: 'CONFIRMED' }, data: { status: 'CHECKED_IN', checkedInAt: at } });
    if (!r.count) {   // lost a scan race with another door
      const again = await prisma.ticket.findUnique({ where: { code } });
      return { ok: false, error: 'already_checked_in', at: again && again.checkedInAt, ticket: again || t };
    }
    return { ok: true, ticket: { ...t, status: 'CHECKED_IN', checkedInAt: at } };
  }

  return { scan, normalise };
}
module.exports = { makeCheckin };
