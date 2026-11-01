import type { APIRoute } from 'astro';
import { summary } from '../../../server/push';

// The service worker asks this what a (contentless) push should say.
export const GET: APIRoute = ({ locals }) => {
  const s = summary(locals.user!.id);
  return Response.json({ title: s.title, body: s.body, url: s.url }, { headers: { 'cache-control': 'no-store' } });
};
