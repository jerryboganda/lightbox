import type { APIRoute } from 'astro';
import { db } from '../../../server/db';

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const name = String((await request.formData()).get('displayName') || '').trim().slice(0, 60);
  if (name.length >= 2) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, locals.user!.id);
  return redirect('/account?namedone=1', 303);
};
