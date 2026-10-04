import type { APIRoute } from 'astro';
import { cards, facts, mcqs } from '../../../lib/data';

const SETS: Record<string, unknown> = { facts, anki: cards, mcqs };
const cache = new Map<string, string>();

export const GET: APIRoute = ({ params }) => {
  const name = params.name!.replace(/\.json$/, '');
  if (!(name in SETS)) return new Response('Not found', { status: 404 });
  if (!cache.has(name)) cache.set(name, JSON.stringify(SETS[name]));
  return new Response(cache.get(name), { headers: { 'content-type': 'application/json', 'cache-control': 'private, max-age=600' } });
};
