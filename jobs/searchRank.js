'use strict';
// Order the rows /api/jobs/search found for a keyword (1 Oct 2026). The query matches the title, the summary and
// the employer's name, and used to come back in deadline order only - so "engineers" returned a Receptionist and an
// HR Officer at "HH Consulting Architects Engineering", and "engineer" a Drafts Man and an Accountant. Now a job
// whose TITLE has the word comes first; summary and employer-name matches only fill the list when fewer than
// MIN_TITLE titles match. Within each group the deadline order is kept.

const MIN_TITLE = 3;

// "engineers" -> "engineer", "nurses" -> "nurse"; "business", "sales" and short words stay as they are.
function stem(q) {
  q = String(q || '').trim();
  return q.length > 4 && /[^s]s$/i.test(q) && !/sales$/i.test(q) ? q.slice(0, -1) : q;
}

function rankJobs(rows, q, take) {
  const s = stem(q).toLowerCase();
  if (!s) return rows.slice(0, take);
  const inTitle = j => String(j.title || '').toLowerCase().includes(s) || String(j.titleAm || '').includes(stem(q));
  const title = rows.filter(inTitle), other = rows.filter(j => !inTitle(j));
  return (title.length >= MIN_TITLE ? title : title.concat(other)).slice(0, take);
}

module.exports = { stem, rankJobs, MIN_TITLE };
