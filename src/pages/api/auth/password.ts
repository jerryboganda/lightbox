import type { APIRoute } from 'astro';
import { changePassword } from '../../../server/auth';

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const f = await request.formData().catch(() => new FormData());
  const current = String(f.get('current') || ''), next = String(f.get('next') || ''), confirm = String(f.get('confirm') || '');
  const first = locals.user!.mustChange;
  const back = (q: string) => redirect(`/account?${first ? 'first=1&' : ''}${q}#password`, 303);
  if (next !== confirm) return back(`pwerror=${encodeURIComponent('The new passwords do not match.')}`);
  const err = await changePassword(locals.user!.id, current, next, locals.user!.sessionId);
  if (err) return back(`pwerror=${encodeURIComponent(err)}`);
  return first ? redirect('/?welcome=1', 303) : back('pwdone=1');
};
