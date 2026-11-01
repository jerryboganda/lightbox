import type { APIRoute } from 'astro';
import { CONFIDENCE, recordAttempt, type Confidence } from '../../../server/progress';
import { db } from '../../../server/db';

// confidence (optional): 'sure' | 'unsure' | 'guess'. A right answer that was a guess still joins the mistake bank.
export const POST: APIRoute = async ({ request, locals }) => {
  const { qid, choice, ms, confidence } = await request.json().catch(() => ({}));
  const conf = CONFIDENCE.includes(confidence) ? (confidence as Confidence) : null;
  const r = recordAttempt(locals.user!.id, String(qid || '').slice(0, 40), String(choice || '').slice(0, 4), typeof ms === 'number' ? ms : null, 'bank', conf);
  return r ? Response.json(r) : Response.json({ error: 'Unknown question or option.' }, { status: 400 });
};

// Latest attempt per question for this user.
export const GET: APIRoute = ({ locals }) => {
  const rows = db.prepare(`SELECT qid, choice, correct FROM mcq_attempts a WHERE user_id = ?
                           AND id = (SELECT MAX(id) FROM mcq_attempts b WHERE b.user_id = a.user_id AND b.qid = a.qid)`).all(locals.user!.id);
  return Response.json(rows);
};
