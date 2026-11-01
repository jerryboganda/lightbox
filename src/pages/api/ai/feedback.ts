import type { APIRoute } from 'astro';
import { setFeedback } from '../../../server/ai';
import { fail, readBody } from '../../../server/personal';

// { kind: 'tutor' | 'explain' | 'mistake' | 'aid' | 'coach', ref, vote: 1 | -1 | 0 }. 0 clears the vote.
export const POST: APIRoute = async ({ request, locals }) => {
  const b = await readBody(request);
  if (!b) return fail('Invalid request.');
  const err = setFeedback(locals.user!.id, b.kind, b.ref, b.vote);
  return err ? fail(err) : Response.json({ ok: true });
};
