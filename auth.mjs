// BinaSmart — Better Auth configuration
import 'dotenv/config';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { PrismaClient } from '@prisma/client';
import { telegram } from './auth/telegram-plugin.mjs';

const prisma = new PrismaClient();

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || 'https://bina.et',
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: ['https://bina.et', 'https://www.bina.et', 'https://connectcare.cc'],
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    // flip to true after owner accounts are created:
    disableSignUp: process.env.AUTH_DISABLE_SIGNUP === '1',
  },
  // Sign in with Google. Off until the two env vars exist, so a missing key can never take the site
  // down — it just means the Google button is not offered.
  socialProviders: (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) ? {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      // Google is the only place a real, verified email reaches us today.
      mapProfileToUser: (p) => ({ name: p.name || p.given_name || 'BinaSmart user' }),
    },
  } : {},
  plugins: [telegram({ botToken: process.env.BINA_RIDER_BOT_TOKEN })],
  user: {
    modelName: 'authUser',
    additionalFields: {
      // ⚠️ 'user', never 'owner'. Anyone can now create an account with Google or Telegram; the two
      // privileged roles ('admin', and 'owner' with a buildingSlug) are granted by hand, not on signup.
      role: { type: 'string', defaultValue: 'user', input: false },
      buildingSlug: { type: 'string', required: false, input: false },
      telegramId: { type: 'string', required: false, input: false },
      phone: { type: 'string', required: false, input: false },
    },
  },
  session: {
    modelName: 'authSession',
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  account: { modelName: 'authAccount' },
  verification: { modelName: 'authVerification' },
  advanced: {
    useSecureCookies: true,
  },
});

// Helper: get session user from a Fastify request (or null)
export async function getSessionUser(req) {
  try {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers.set(k, v);
      else if (Array.isArray(v)) headers.set(k, v.join(', '));
    }
    const session = await auth.api.getSession({ headers });
    return session?.user || null;
  } catch {
    return null;
  }
}

// Helper: convert Fastify req -> Web Request and run better-auth handler
export async function handleAuthRequest(req, reply) {
  const url = new URL(req.url, `https://${req.headers.host || 'bina.et'}`);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(', '));
  }
  const init = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
    init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }
  const webReq = new Request(url.toString(), init);
  const res = await auth.handler(webReq);
  reply.status(res.status);
  res.headers.forEach((value, key) => reply.header(key, value));
  const text = await res.text();
  reply.send(text || null);
}
