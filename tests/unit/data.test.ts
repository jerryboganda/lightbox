import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { cards, facts, factById, images, mcqs, stats, topics } from '../../src/lib/data';

describe('exported content', () => {
  it('matches the counts recorded at export time', () => {
    expect(facts.length).toBe(stats.facts);
    expect(cards.length).toBe(stats.anki);
    expect(topics.length).toBe(stats.topics);
    expect(images.length).toBe(stats.images);
    expect(mcqs.length).toBe(stats.mcqs);
    expect(stats.cited + stats.agreed + stats.unchecked + stats.disputed).toBe(stats.facts);
  });

  it('only turns verified facts into flashcards', () => {
    for (const c of cards) expect(factById.get(c.factId)?.status).toBe('verified');
    expect(new Set(cards.map((c) => c.factId)).size).toBe(facts.filter((f) => f.status === 'verified').length);
  });

  it('gives every cited fact a URL', () => {
    for (const f of facts.filter((x) => x.label === 'cited')) expect(f.sources.length, f.id).toBeGreaterThan(0);
  });

  it('links topic bullets only to known facts, with the fact status', () => {
    for (const t of topics) for (const s of t.sections) for (const b of s.bullets) for (const id of b.ids) expect(factById.has(id), `${t.slug} ${id}`).toBe(true);
  });

  it('ships every atlas image', () => {
    for (const i of images) expect(fs.existsSync(`src/assets/atlas/${i.file}`), i.file).toBe(true);
  });
});
