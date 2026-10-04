import type { APIRoute } from 'astro';
import { facts, images, mcqs, topics } from '../../lib/data';

let cache: string | null = null;
const clip = (s: string, n = 140) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export const GET: APIRoute = () => {
  cache ??= JSON.stringify([
    ...topics.map((t) => ({ id: `topic:${t.slug}`, type: 'topic', title: t.title, text: [t.oneLiner, ...t.sections.flatMap((s) => s.bullets.map((b) => b.text))].join(' '), href: `/study/${t.system}/${t.slug}` })),
    ...facts.map((f) => ({ id: f.id, type: 'fact', title: clip(f.fact, 120), text: `${f.id} · ${f.file} p${f.unit}`, href: `/facts?id=${f.id}`, label: f.label })),
    ...mcqs.map((m) => ({ id: m.qid, type: 'mcq', title: clip(m.stem, 120), text: `${m.qid} · ${Object.values(m.options).join(' · ')}`, href: `/practice/mcq?q=${m.qid}` })),
    ...images.map((i) => ({ id: `img:${i.file}`, type: 'image', title: clip(i.caption.split('\n')[0] || i.file, 100), text: `${i.sourceFile} · ${clip(i.caption.replace(/\s+/g, ' '), 160)}`, href: `/atlas?img=${encodeURIComponent(i.file)}` })),
  ]);
  return new Response(cache, { headers: { 'content-type': 'application/json', 'cache-control': 'private, max-age=3600' } });
};
