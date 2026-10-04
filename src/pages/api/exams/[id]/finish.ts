import type { APIRoute } from 'astro';
import { examHref, finish } from '../../../../server/exams';

export const POST: APIRoute = ({ params, locals }) => {
  const e = finish(locals.user!.id, Number(params.id));
  return e ? Response.json({ ok: true, score: e.score, total: e.total, href: examHref(e) }) : Response.json({ error: 'Session not found.' }, { status: 404 });
};
