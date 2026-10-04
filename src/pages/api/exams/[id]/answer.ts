import type { APIRoute } from 'astro';
import { saveAnswer, type Save } from '../../../../server/exams';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const id = Number(params.id);
  const b = await request.json().catch(() => null);
  if (!Number.isSafeInteger(id) || !b || typeof b.item !== 'string' || b.item.length > 120) return Response.json({ error: 'Bad request.' }, { status: 400 });
  const s: Save = { item: b.item };
  if (b.choice === null || (typeof b.choice === 'string' && b.choice.length <= 8)) s.choice = b.choice;
  if (typeof b.flagged === 'boolean') s.flagged = b.flagged;
  if (typeof b.ms === 'number' && Number.isFinite(b.ms)) s.ms = b.ms;
  if (Number.isInteger(b.pos)) s.pos = b.pos;
  const r = saveAnswer(locals.user!.id, id, s);
  return 'error' in r ? Response.json(r, { status: r.status }) : Response.json(r);
};
