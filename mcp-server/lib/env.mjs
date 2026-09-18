import { readFileSync } from 'node:fs';
// Single source of secrets: the main app's .env, read directly rather than through dotenv (this
// process has no dotenv and does not want one).
// Anything else out of the same file, read the same way. The key pepper in particular HAS to be the
// same value in binasmart-api and in this process: it salts the anonymous caller hash that the two
// share in /root/storage/api/usage, and it is half of what a stored keyHash is made of, so a mismatch
// silently splits one allowance in two and makes every issued key unknown on /mcp.
export function envValue(name, envPath = new URL('../../.env', import.meta.url)) {
  try {
    const m = readFileSync(envPath, 'utf8').match(new RegExp('^' + name + '\\s*=\\s*"?([^"\\n]+)"?', 'm'));
    return m ? m[1].trim() : '';
  } catch { return ''; }
}

export function databaseUrl(envPath = new URL('../../.env', import.meta.url)) {
  const env = readFileSync(envPath, 'utf8');
  const m = env.match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
  if (!m) throw new Error('DATABASE_URL not found in .env');
  return m[1].trim().replace(/[?&]schema=[^&]*/, '').replace(/\?$/, ''); // pg does not understand Prisma's ?schema=
}
