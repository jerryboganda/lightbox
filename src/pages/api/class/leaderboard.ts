import type { APIRoute } from 'astro';
import { leaderboard } from '../../../server/class';

// ?board=week|all
export const GET: APIRoute = ({ locals, url }) => {
  const board = url.searchParams.get('board') === 'all' ? 'all' : 'week';
  return Response.json(leaderboard(board).map((r) => ({ ...r, you: r.id === locals.user!.id })));
};
