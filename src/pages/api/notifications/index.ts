import type { APIRoute } from 'astro';
import { listNotifications, unreadCount } from '../../../server/class';

// ?limit=0..100 (0 = count only), &unread=1 for unread only.
export const GET: APIRoute = ({ locals, url }) => {
  const uid = locals.user!.id, limit = Math.max(0, Math.min(100, Math.trunc(Number(url.searchParams.get('limit') ?? 15)) || 0));
  return Response.json({ unread: unreadCount(uid), items: limit ? listNotifications(uid, limit, url.searchParams.get('unread') === '1') : [] }, { headers: { 'cache-control': 'no-store' } });
};
