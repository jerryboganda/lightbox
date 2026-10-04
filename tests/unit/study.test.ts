import { describe, expect, it } from 'vitest';
import { createUser } from '../../src/server/auth';
import { db } from '../../src/server/db';
import { noteVisit } from '../../src/server/progress';
import { alignSections, compareWith, factContext, MAX_COMPARE, mcqsOnPage, parseCompare, starterPairs } from '../../src/server/study';
import { bestMatch, fileFromSlug, fileOrder, fileSlug, neighbours, pageText, segment, sourceHref, unitsByFile } from '../../src/lib/sources';
import { factById, facts, pages, topicBySlug, topics } from '../../src/lib/data';

describe('source pages', () => {
  it('gives every pilot file a unique readable slug that resolves back', () => {
    const files = [...new Set(pages.map((p) => p.file))];
    const slugs = files.map((f) => fileSlug(f)!);
    expect(new Set(slugs).size).toBe(files.length);
    for (const [i, s] of slugs.entries()) { expect(s).toMatch(/^[a-z0-9-]+$/); expect(fileFromSlug(s)).toBe(files[i]); }
    expect(fileSlug('(FINAL) IMM Feb 2025-2.pdf')).toBe('final-imm-feb-2025-2');
    expect(fileFromSlug('../etc/passwd')).toBeUndefined();
    expect(sourceHref('nope.pdf', 1)).toBeNull();
  });

  it('walks every unit once, across files, in reading order', () => {
    const seq: string[] = [];
    let p = unitsByFile.get(fileOrder[0])![0] as (typeof pages)[number] | undefined;
    while (p) { seq.push(`${p.file}|${p.page}`); p = neighbours(p).next; }
    expect(seq.length).toBe(pages.length);
    expect(new Set(seq).size).toBe(pages.length);
  });

  it('segments text losslessly and keeps long lines tight', () => {
    const text = 'Line one\r\n\r\n' + 'A long sentence about the hilum. '.repeat(12) + '\nend';
    const lines = segment(text);
    expect(lines.length).toBe(4);
    expect(lines.flat().map((s) => s.text).join('')).toBe(text.replace(/\r|\n/g, ''));
    expect(lines[2].length).toBeGreaterThan(1);
    expect(lines.flat().map((s) => s.i)).toEqual(lines.flat().map((_, i) => i));
  });

  it('finds the passage a fact came from', () => {
    const f = factById.get('F-M-001')!;
    const segs = segment(pageText(f.file, f.unit)!).flat().map((s) => s.text);
    const m = bestMatch(f.fact, segs)!;
    expect(m.strong).toBe(true);
    expect(segs.slice(m.start, m.end + 1).join(' ')).toMatch(/right atrial border/);
    expect(m.end - m.start).toBeLessThanOrEqual(2);
  });

  it('says so when nothing on the page matches', () => {
    const segs = ['Question No 13:', 'a.', 'PET Scan'];
    expect(bestMatch('Gadolinium dose for an 80 kg patient is 16 mL', segs)).toBeNull();
    expect(bestMatch('anything', [])).toBeNull();
    expect(bestMatch('', segs)).toBeNull();
  });

  it('matches most facts to some passage on their page', () => {
    const found = facts.filter((f) => bestMatch(f.fact, segment(pageText(f.file, f.unit) ?? '').flat().map((s) => s.text)));
    expect(found.length / facts.length).toBeGreaterThan(0.9);
  });

  it('links MCQs to the page they were printed on', () => {
    const qs = mcqsOnPage('(FINAL) IMM Feb 2025-2.pdf', 10);
    expect(qs.map((q) => q.qid)).toEqual(expect.arrayContaining(['FEB2025-Q13']));
    expect(qs.every((q) => q.unit === 10 && q.file.startsWith('FINAL_IMM_Feb_2025-2__u'))).toBe(true);
    expect(mcqsOnPage('(FINAL) IMM Feb 2025-2.pdf', 1)).toEqual([]);
  });
});

describe('fact context', () => {
  it('collects neighbours, topics, same-page facts and the card', () => {
    const f = factById.get('F-M-014')!;
    const c = factContext(f);
    expect(c.prev?.id).toBe(facts[facts.indexOf(f) - 1].id);
    expect(c.next?.id).toBe(facts[facts.indexOf(f) + 1].id);
    expect(c.topics.map((t) => t.slug)).toEqual(f.topics);
    expect(c.samePage.every((x) => x.file === f.file && x.unit === f.unit && x !== f)).toBe(true);
    expect(c.sameTopic.some((x) => c.samePage.includes(x) || x === f)).toBe(false);
    expect(c.mcqs.map((q) => q.qid)).toContain('FEB2025-Q13');
    expect(factContext(facts[0]).prev).toBeUndefined();
  });
});

describe('comparison', () => {
  it('accepts only known topics, dedupes and caps at four', () => {
    const s = topics.slice(0, 6).map((t) => t.slug);
    expect(parseCompare(`${s[0]},${s[0]},<script>,${s[1]}`).map((t) => t.slug)).toEqual([s[0], s[1]]);
    expect(parseCompare(s.join(',')).length).toBe(MAX_COMPARE);
    expect(parseCompare(null)).toEqual([]);
    expect(parseCompare('x'.repeat(5000))).toEqual([]);
    expect(parseCompare(s[0], topics[3].title.toUpperCase()).map((t) => t.slug)).toEqual([s[0], topics[3].slug]);
    expect(parseCompare(s[0], 'no such topic').map((t) => t.slug)).toEqual([s[0]]);
  });

  it('aligns sections by heading with key points first and open items last', () => {
    const a = topicBySlug.get('lobe-collapse-silhouette-signs')!, b = topicBySlug.get('cavitating-lung-lesions')!;
    const rows = alignSections([a, b]);
    const heads = rows.map((r) => r.heading);
    expect(heads[0]).toMatch(/^Key points/);
    expect(new Set(heads)).toEqual(new Set([...a.sections, ...b.sections].map((s) => s.heading)));
    expect(heads.indexOf('Unconfirmed (do not trust)')).toBe(heads.length - 1);
    for (const r of rows) {
      expect(r.cells).toHaveLength(2);
      expect(r.cells[0]).toEqual(a.sections.filter((s) => s.heading === r.heading).flatMap((s) => s.bullets));
    }
  });

  it('suggests siblings from the same system', () => {
    const t = topicBySlug.get('bremsstrahlung')!;
    const peers = compareWith(t);
    expect(peers.length).toBe(3);
    expect(peers.every((p) => p.system === t.system && p.slug !== t.slug)).toBe(true);
    for (const [a, b] of starterPairs()) { expect(a.system).toBe(b.system); expect(a.sections.some((s) => s.heading === 'Differentials')).toBe(true); }
  });
});

describe('history', () => {
  it('records fact and source visits for the right user only', async () => {
    await createUser(null, 'study-a', 'Study A', 'member', 'study-pass-123');
    await createUser(null, 'study-b', 'Study B', 'member', 'study-pass-123');
    const id = (u: string) => (db.prepare('SELECT id FROM users WHERE username = ?').get(u) as any).id as number;
    noteVisit(id('study-a'), 'fact', '/facts/F-M-001', 'F-M-001 · first');
    noteVisit(id('study-a'), 'fact', '/facts/F-M-001', 'F-M-001 · again');
    noteVisit(id('study-a'), 'source', '/sources/final-imm-feb-2025-2/3', 'page 3');
    const rows = db.prepare('SELECT kind, title FROM visits WHERE user_id = ? ORDER BY kind').all(id('study-a')) as any[];
    expect(rows).toEqual([{ kind: 'fact', title: 'F-M-001 · again' }, { kind: 'source', title: 'page 3' }]);
    expect(db.prepare('SELECT COUNT(*) n FROM visits WHERE user_id = ?').get(id('study-b'))).toEqual({ n: 0 });
  });
});
