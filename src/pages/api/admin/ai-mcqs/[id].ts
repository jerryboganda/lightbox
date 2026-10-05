import type { APIRoute } from 'astro';
import { denied, editAiMcq, isAdmin, reply, reviewAiMcq } from '../../../../server/admin';
import { intId, readBody } from '../../../../server/personal';

// { stem, options: string[2..6], key: 'A'.., explanation }
export const PATCH: APIRoute = async ({ request, locals, params }) => {
  if (!isAdmin(locals.user)) return denied();
  const b = await readBody(request);
  return reply(b ? editAiMcq(locals.user.id, intId(params.id), b) : { error: 'Nothing to save.' });
};

// { decision: 'approve' | 'reject', reason?, edits? }. The creator is notified.
export const POST: APIRoute = async ({ request, locals, params }) => {
  if (!isAdmin(locals.user)) return denied();
  const b = await readBody(request);
  return reply(b ? reviewAiMcq(locals.user.id, intId(params.id), b) : { error: 'Approve or reject.' });
};
