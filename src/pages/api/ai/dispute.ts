import type { APIRoute } from 'astro';
import { follow, sse, summariseDispute } from '../../../server/ai';
import { fail, readBody } from '../../../server/personal';

// { itemType: 'mcq' | 'fact', itemId } -> text/event-stream, from the item's recorded fields only.
export const POST: APIRoute = async ({ request, locals }) => {
  const b = await readBody(request);
  if (!b || (b.itemType !== 'mcq' && b.itemType !== 'fact') || typeof b.itemId !== 'string' || b.itemId.length > 40) return fail('Unknown item.');
  const ac = follow(request.signal);
  return sse(summariseDispute(locals.user!.id, b.itemType, b.itemId, ac.signal), ac);
};
