// BinaSmart — Better Auth configuration
import 'dotenv/config';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { PrismaClient } from '@prisma/client';

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
  user: {
    modelName: 'authUser',
    additionalFields: {
      role: { type: 'string', defaultValue: 'owner', input: false },
      buildingSlug: { type: 'string', required: false, input: false },
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
