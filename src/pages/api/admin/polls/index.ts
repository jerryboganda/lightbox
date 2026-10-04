import type { APIRoute } from 'astro';
import { createPoll, denied, isAdmin, listPolls, reply } from '../../../../server/admin';
import { readBody } from '../../../../server/personal';

export const GET: APIRoute = ({ locals }) => (isAdmin(locals.user) ? reply({ polls: listPolls() }) : denied());

// { question, options: string[2..6], closesAt?: epoch ms, announce?: boolean }
export const POST: APIRoute = async ({ request, locals }) => {
  if (!isAdmin(locals.user)) return denied();
  const b = await readBody(request);
  return reply(b ? createPoll(locals.user.id, b) : { error: 'Send a question and options.' }, 201);
};
