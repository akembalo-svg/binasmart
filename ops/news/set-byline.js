#!/usr/bin/env node
'use strict';
// Put a named person's byline on an article, or take it off.
//
//   node --env-file=.env ops/news/set-byline.js <slug> "Name" <https url>
//   node --env-file=.env ops/news/set-byline.js <slug> --desk        back to the house byline
//
// Why this exists (owner, 23 September 2026): he writes the Amharic, we check the facts and publish it
// under his name with his own page linked — so the credit is checkable and Google records a Person
// rather than the organisation (server.js builds the JSON-LD author from authorUrl).
//
// The rule that goes with it: a byline belongs only on a piece that person actually wrote. Articles
// written at this desk keep the desk name. A byline on everything is worth nothing.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DESK = 'ቢና ዜና ዴስክ';
const [slug, name, url] = process.argv.slice(2);

(async () => {
  if (!slug) { console.error('usage: set-byline.js <slug> "Name" <url>   |   <slug> --desk'); process.exit(1); }
  const post = await prisma.newsPost.findUnique({ where: { slug } });
  if (!post) { console.error('no article with slug: ' + slug); process.exit(1); }

  const desk = name === '--desk';
  if (!desk && !name) { console.error('give a name, or --desk'); process.exit(1); }
  // A byline that links nowhere is not a credit, it is just a word.
  if (!desk && url && !/^https:\/\/[\w.-]+\//.test(url)) { console.error('the url must be a full https link'); process.exit(1); }

  const data = desk ? { author: DESK, authorUrl: null } : { author: name, authorUrl: url || null };
  const r = await prisma.newsPost.update({ where: { slug }, data });
  console.log('byline: ' + r.author + (r.authorUrl ? ' -> ' + r.authorUrl : ' (no link)'));
  console.log('https://bina.et/news/' + r.slug);
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
