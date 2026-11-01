import type { APIRoute } from 'astro';
import { coachAnswer, follow, sse } from '../../../server/ai';
import { itemsOf, own, toacsStations } from '../../../server/exams';
import { fail, intId, readBody } from '../../../server/personal';

// { exam, item, answer } -> text/event-stream. Marks a private TOACS answer against the station's facts; nothing is saved.
export const POST: APIRoute = async ({ request, locals }) => {
  const b = await readBody(request), uid = locals.user!.id;
  const e = b ? own(uid, intId(b.exam)) : undefined;
  if (!e || e.mode !== 'toacs') return fail('Station not found.', 404);
  const i = itemsOf(e).findIndex((x) => x.q === b!.item);
  if (i < 0) return fail('Station not found.', 404);
  const st = toacsStations(e)[i];
  const ac = follow(request.signal);
  return sse(coachAnswer(uid, st, b!.answer, ac.signal), ac);
};
