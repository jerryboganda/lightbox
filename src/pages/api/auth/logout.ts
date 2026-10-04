import type { APIRoute } from 'astro';
import { COOKIE, endSession } from '../../../server/auth';

export const POST: APIRoute = ({ locals, cookies, redirect }) => {
  if (locals.user) endSession(locals.user.sessionId);
  cookies.delete(COOKIE, { path: '/' });
  return redirect('/login', 303);
};
