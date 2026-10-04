import type { APIRoute } from 'astro';
import { factById } from '../../../lib/data';
import { fail } from '../../../server/personal';

// ?fact=F-… → the verified statement and its source, to prefill a card or a citation.
export const GET: APIRoute = ({ url }) => {
  const f = factById.get(url.searchParams.get('fact') ?? '');
  return f ? Response.json({ id: f.id, fact: f.fact, file: f.file, unit: f.unit, label: f.label }, { headers: { 'cache-control': 'private, max-age=3600' } }) : fail('Unknown fact.', 404);
};
