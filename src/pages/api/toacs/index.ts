import type { APIRoute } from 'astro';
import { createToacs } from '../../../server/exams';

// Setup form posts here and lands in the station runner.
export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const f = await request.formData().catch(() => null);
  const count = Number(f?.get('count')), seconds = Number(f?.get('seconds')), group = String(f?.get('group') ?? '').slice(0, 120);
  const id = Number.isInteger(count) && count >= 5 && count <= 30 ? createToacs(locals.user!.id, count, seconds, group) : 'Choose 5 to 30 stations.';
  return redirect(typeof id === 'string' ? `/practice/toacs?error=${encodeURIComponent(id)}` : `/practice/toacs/${id}`, 303);
};
