import { describe, expect, it } from 'vitest';
import { askPrompt } from '../../src/lib/askAi';

describe('askPrompt', () => {
  const ctx = { quote: 'Inverse square law: 100 cm → 200 cm quartered intensity', topic: 'Radiation protection', section: 'Distance', system: 'Physics and safety', factId: 'F-AUG-024', label: 'cited', source: 'AUG p12' };

  it('carries the passage, its topic, section, fact and source', () => {
    const p = askPrompt(ctx);
    for (const s of [ctx.quote, 'Topic: Radiation protection', 'Section: Distance', 'Physics and safety', 'Fact F-AUG-024 (cited)', 'Source: AUG p12', 'Explain this passage']) expect(p).toContain(s);
  });

  it('asks for a definition when only a term is selected, and works without context', () => {
    const p = askPrompt({ quote: ' half\n  value   layer ' });
    expect(p).toContain('“half value layer”');
    expect(p).toContain('Define it');
    expect(p).not.toContain('Where it is from');
  });

  it('never exceeds the question limit', () => {
    const p = askPrompt({ ...ctx, quote: 'word '.repeat(600) }, 500);
    expect(p.length).toBeLessThanOrEqual(500);
    expect(p).toContain('…”');
    expect(p).toContain('F-AUG-024');
  });
});
