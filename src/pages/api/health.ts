import type { APIRoute } from 'astro';
import { db } from '../../server/db';
import { stats } from '../../lib/data';

export const GET: APIRoute = () => {
  db.prepare('SELECT 1').get();
  return Response.json({ ok: true, facts: stats.facts, data: stats.generatedAt });
};
