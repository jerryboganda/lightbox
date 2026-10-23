import type { APIRoute } from 'astro';
import { SYSTEMS, factById, topicBySlug } from '../../../lib/data';
import { fail } from '../../../server/personal';

// ?fact=F-… → the verified statement and its source, to prefill a card, a citation or an Ask AI question.
export const GET: APIRoute = ({ url }) => {
  const f = factById.get(url.searchParams.get('fact') ?? '');
  const t = f && topicBySlug.get(f.topics[0]);
  return f ? Response.json({ id: f.id, fact: f.fact, file: f.file, unit: f.unit, label: f.label, system: SYSTEMS[f.system]?.label ?? '', topic: t ? { slug: t.slug, title: t.title } : null }, { headers: { 'cache-control': 'private, max-age=3600' } }) : fail('Unknown fact.', 404);
};
