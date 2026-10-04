import type { APIRoute } from 'astro';
import type { Grade } from 'ts-fsrs';
import { srsReview } from '../../../server/progress';

// Accepts one review or a batch (the offline outbox flushes several at once).
export const POST: APIRoute = async ({ request, locals }) => {
  const body = await request.json().catch(() => null);
  const items = (Array.isArray(body) ? body : [body]).filter(Boolean).slice(0, 500);
  let ok = 0;
  for (const r of items) {
    const rating = Number(r.rating);
    if (![1, 2, 3, 4].includes(rating)) continue;
    if (srsReview(locals.user!.id, String(r.factId), rating as Grade, Number(r.reviewedAt) || Date.now(), String(r.clientId || '').slice(0, 64))) ok++;
  }
  return Response.json({ ok });
};
