import type { APIRoute } from 'astro';
import { recordAttempt } from '../../../server/progress';
import { db } from '../../../server/db';

export const POST: APIRoute = async ({ request, locals }) => {
  const { qid, choice, ms } = await request.json().catch(() => ({}));
  const r = recordAttempt(locals.user!.id, String(qid || '').slice(0, 40), String(choice || '').slice(0, 4), typeof ms === 'number' ? ms : null, 'bank');
  return r ? Response.json(r) : Response.json({ error: 'Unknown question or option.' }, { status: 400 });
};

// Latest attempt per question for this user.
export const GET: APIRoute = ({ locals }) => {
  const rows = db.prepare(`SELECT qid, choice, correct FROM mcq_attempts a WHERE user_id = ?
                           AND id = (SELECT MAX(id) FROM mcq_attempts b WHERE b.user_id = a.user_id AND b.qid = a.qid)`).all(locals.user!.id);
  return Response.json(rows);
};
