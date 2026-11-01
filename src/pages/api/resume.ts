import type { APIRoute } from 'astro';
import { savePos } from '../../server/progress';
import { fail, readBody } from '../../server/personal';

// { kind: 'topic', ref: '/study/…', pos: 0..1 } → remembers how far down the page the reader got.
export const POST: APIRoute = async ({ request, locals }) => {
  const b = await readBody(request);
  const ref = typeof b?.ref === 'string' ? b.ref.slice(0, 300) : '';
  if (b?.kind !== 'topic' || !/^\/study\/[\w-]+\/[\w-]+$/.test(ref) || typeof b.pos !== 'number') return fail('Send a topic path and a position.');
  return savePos(locals.user!.id, 'topic', ref, b.pos) ? new Response(null, { status: 204 }) : fail('Open the page first.', 404);
};
