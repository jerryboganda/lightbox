import type { APIRoute } from 'astro';
import { COOKIE, login } from '../../../server/auth';

const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/');

export const POST: APIRoute = async ({ request, cookies, clientAddress, redirect }) => {
  const form = await request.formData();
  const username = String(form.get('username') || '').trim();
  const password = String(form.get('password') || '');
  const next = safeNext(String(form.get('next') || ''));
  const back = (msg: string) => redirect(`/login?error=${encodeURIComponent(msg)}&u=${encodeURIComponent(username)}${next !== '/' ? `&next=${encodeURIComponent(next)}` : ''}`, 303);
  if (!username || !password) return back('Enter your username and password.');
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0].trim() || clientAddress;
  const r = await login(username, password, ip, request.headers.get('user-agent') || '');
  if ('error' in r) return back(r.error!);
  cookies.set(COOKIE, r.session.token, { httpOnly: true, secure: import.meta.env.PROD, sameSite: 'lax', path: '/', expires: new Date(r.session.expiresAt) });
  return redirect(next, 303);
};
