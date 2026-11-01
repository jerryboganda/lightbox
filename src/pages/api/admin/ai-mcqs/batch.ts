import type { APIRoute } from 'astro';
import { denied, isAdmin, reply, reviewAiMcqs } from '../../../../server/admin';
import { readBody } from '../../../../server/personal';

// { ids: number[], decision: 'approve' | 'reject', reason? }. Each creator gets one notification for the batch.
export const POST: APIRoute = async ({ request, locals }) => {
  if (!isAdmin(locals.user)) return denied();
  const b = await readBody(request);
  return reply(b ? reviewAiMcqs(locals.user.id, b) : { error: 'Choose questions to review.' });
};
