import { readFileSync } from 'node:fs';
// Single source of secrets: the main app's .env. Only DATABASE_URL is read.
export function databaseUrl(envPath = new URL('../../.env', import.meta.url)) {
  const env = readFileSync(envPath, 'utf8');
  const m = env.match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
  if (!m) throw new Error('DATABASE_URL not found in .env');
  return m[1].trim().replace(/[?&]schema=[^&]*/, '').replace(/\?$/, ''); // pg does not understand Prisma's ?schema=
}
