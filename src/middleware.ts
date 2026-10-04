import { defineMiddleware } from 'astro:middleware';
import { bootstrapAdmin, COOKIE, readSession } from './server/auth';
import { db, now } from './server/db';

const PUBLIC = [/^\/login$/, /^\/api\/auth\/login$/, /^\/api\/health$/, /^\/_astro\//, /^\/(favicon|manifest|sw\.js|icons\/|offline)/];
const MUST_CHANGE_OK = [/^\/account/, /^\/api\/auth\//];
const SECURITY: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

let booted: Promise<void> | null = null;
const lastSeen = new Map<number, number>();

export const onRequest = defineMiddleware(async (ctx, next) => {
  booted ??= bootstrapAdmin();
  await booted;
  const path = ctx.url.pathname;
  const user = readSession(ctx.cookies.get(COOKIE)?.value);
  ctx.locals.user = user;

  const done = async (res: Response) => {
    for (const [k, v] of Object.entries(SECURITY)) res.headers.set(k, v);
    return res;
  };

  if (user) {
    if ((lastSeen.get(user.id) ?? 0) < now() - 5 * 60_000) {
      lastSeen.set(user.id, now());
      db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now(), user.id);
    }
    ctx.cookies.set(COOKIE, ctx.cookies.get(COOKIE)!.value, { httpOnly: true, secure: import.meta.env.PROD, sameSite: 'lax', path: '/', expires: new Date(user.expiresAt) });
  }

  if (!PUBLIC.some((r) => r.test(path))) {
    if (!user) {
      if (path.startsWith('/api/')) return done(Response.json({ error: 'Sign in first.' }, { status: 401 }));
      return done(ctx.redirect(`/login${path === '/' ? '' : `?next=${encodeURIComponent(path + ctx.url.search)}`}`));
    }
    if (user.mustChange && !MUST_CHANGE_OK.some((r) => r.test(path))) {
      if (path.startsWith('/api/')) return done(Response.json({ error: 'Set a new password first.' }, { status: 403 }));
      return done(ctx.redirect('/account?first=1'));
    }
    if ((path.startsWith('/admin') || path.startsWith('/api/admin')) && user.role !== 'admin') {
      return done(path.startsWith('/api/') ? Response.json({ error: 'Admins only.' }, { status: 403 }) : ctx.redirect('/'));
    }
  }
  return done(await next());
});
