import type { APIRoute } from 'astro';
import { chatMessages, deleteChat, getChat, renameChat } from '../../../../server/ai';
import { fail, intId, readBody } from '../../../../server/personal';

export const GET: APIRoute = ({ locals, params }) => {
  const uid = locals.user!.id, id = intId(params.id);
  const chat = getChat(uid, id);
  return chat ? Response.json({ chat, messages: chatMessages(uid, id) }, { headers: { 'cache-control': 'no-store' } }) : fail('Chat not found.', 404);
};

// { title }
export const PATCH: APIRoute = async ({ request, locals, params }) => {
  const b = await readBody(request);
  return b && renameChat(locals.user!.id, intId(params.id), b.title) ? Response.json({ ok: true }) : fail('Give the chat a title of up to 80 characters.');
};

export const DELETE: APIRoute = ({ locals, params }) =>
  deleteChat(locals.user!.id, intId(params.id)) ? Response.json({ ok: true }) : fail('Chat not found.', 404);
