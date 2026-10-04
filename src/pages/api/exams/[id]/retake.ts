import type { APIRoute } from 'astro';
import { examHref, own, retake } from '../../../../server/exams';

// Plain form post from the results page: redirect into the new session.
export const POST: APIRoute = ({ params, locals, redirect }) => {
  const uid = locals.user!.id, from = own(uid, Number(params.id));
  if (!from) return redirect('/practice', 303);
  const id = retake(uid, from.id);
  return redirect(typeof id === 'string' ? `${examHref(from)}?error=${encodeURIComponent(id)}` : examHref(own(uid, id)!), 303);
};
