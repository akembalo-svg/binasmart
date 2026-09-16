// better-auth plugin: sign in with Telegram.
//
// Two entrances, one account:
//   - the Login Widget on bina.et in a normal browser  (POST { widget: {...} })
//   - initData inside the Telegram mini app            (POST { initData: "..." })
// Both are verified in auth/telegram-verify.js, then handed to the SAME find-or-create path that
// Google uses (handleOAuthUserInfo), so a Telegram user is an ordinary account with a linked
// provider — not a parallel identity system.
//
// Telegram gives no email. We store a deterministic placeholder on a domain we own; the day the
// person adds a real email or phone, that becomes the thing we contact them on.
import { createAuthEndpoint, formCsrfMiddleware, APIError } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { handleOAuthUserInfo } from 'better-auth/oauth2';
import * as z from 'zod';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tg = require('./telegram-verify.js');

// A cross-site POST is not a sign-in. better-auth hangs originCheckMiddleware on every path, but
// its origin test gives up unless the request carries a Cookie header -- and a cross-site POST
// carries none, because the session cookie is SameSite=Lax. Its own /sign-in/email does not lean
// on that: it carries formCsrfMiddleware, which reads the Origin whether there is a cookie or not.
// This door hands out the same session cookie the phone door does, so it carries the same guard.
// A client with no Origin, no Referer and no Sec-Fetch-* header at all -- curl, a native app -- is
// still let through, and the login page and the mini app are unchanged.
export const telegram = (options = {}) => {
  const botToken = () => options.botToken || process.env.BINA_RIDER_BOT_TOKEN || '';
  return {
    id: 'telegram',
    endpoints: {
      signInTelegram: createAuthEndpoint('/sign-in/telegram', {
        method: 'POST',
        use: [formCsrfMiddleware],
        body: z.object({
          widget: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
          initData: z.string().max(4096).optional(),
          callbackURL: z.string().max(512).optional()
        })
      }, async (ctx) => {
        const token = botToken();
        if (!token) throw new APIError('SERVICE_UNAVAILABLE', { message: 'telegram sign-in is not configured' });

        const b = ctx.body || {};
        const user = b.initData ? tg.verifyInitData(b.initData, token)
          : b.widget ? tg.verifyWidget(b.widget, token)
            : null;
        // One message for every failure: a bad signature and an expired one must not be
        // distinguishable from outside.
        if (!user) throw new APIError('UNAUTHORIZED', { message: 'telegram sign-in could not be verified' });

        const email = tg.placeholderEmail(user.id);
        const result = await handleOAuthUserInfo(ctx, {
          userInfo: {
            id: user.id,
            email,
            emailVerified: false,          // a placeholder address is never a verified one
            name: tg.displayName(user),
            image: user.photoUrl || undefined
          },
          account: { providerId: 'telegram', accountId: user.id },
          callbackURL: b.callbackURL,
          disableSignUp: options.disableSignUp === true
        });
        if (result.error || !result.data) throw new APIError('UNAUTHORIZED', { message: result.error || 'sign-in failed' });

        // Keep the Telegram id on the user row so the ride and pool code can find them without a join.
        try {
          if (result.data.user.telegramId !== user.id) {
            await ctx.context.internalAdapter.updateUser(result.data.user.id, { telegramId: user.id });
            result.data.user.telegramId = user.id;
          }
        } catch (e) { /* the linked account is the source of truth; this column is a convenience */ }

        await setSessionCookie(ctx, result.data);
        return ctx.json({
          ok: true,
          isRegister: !!result.isRegister,
          user: {
            id: result.data.user.id,
            name: result.data.user.name,
            image: result.data.user.image || null,
            telegramId: user.id,
            phone: result.data.user.phone || null
          }
        });
      })
    }
  };
};

export default telegram;
