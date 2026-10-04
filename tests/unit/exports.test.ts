import { beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import zlib from 'node:zlib';
import { createUser } from '../../src/server/auth';
import { db } from '../../src/server/db';
import { checksum, MODEL_ID } from '../../src/server/anki';
import { ankiPackage, exportCards, exportScopes, fileStem, myData, resolveScope, toCsv } from '../../src/server/exports';
import { createCollection, createUserCard, item, saveNote, setCollectionItem, setMark, updateCollection } from '../../src/server/personal';
import { recordAttempt } from '../../src/server/progress';
import { cardByFact, cards, factById, facts, mcqs, topics } from '../../src/lib/data';

let me = 0, other = 0;
const idOf = (u: string) => (db.prepare('SELECT id FROM users WHERE username = ?').get(u) as { id: number }).id;
beforeAll(async () => {
  await createUser(null, 'x-owner', 'Ex Owner', 'member', 'owner-pass-123');
  await createUser(null, 'x-other', 'Ex Other', 'member', 'other-pass-123');
  me = idOf('x-owner'); other = idOf('x-other');
});

// Walks the local file headers, checking each CRC, and confirms the central directory and end record agree.
function unzip(buf: Buffer) {
  const out = new Map<string, Buffer>();
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8), crc = buf.readUInt32LE(p + 14), size = buf.readUInt32LE(p + 18), raw = buf.readUInt32LE(p + 22);
    const n = buf.readUInt16LE(p + 26), x = buf.readUInt16LE(p + 28), start = p + 30 + n + x;
    const data = method === 8 ? zlib.inflateRawSync(buf.subarray(start, start + size)) : buf.subarray(start, start + size);
    expect(data.length).toBe(raw);
    expect(zlib.crc32(data)).toBe(crc);
    out.set(buf.toString('utf8', p + 30, p + 30 + n), data);
    p = start + size;
  }
  const end = buf.length - 22;
  expect(buf.readUInt32LE(end)).toBe(0x06054b50);
  expect(buf.readUInt16LE(end + 10)).toBe(out.size);
  expect(buf.readUInt32LE(end + 16)).toBe(p);
  return out;
}
const open = (pkg: Buffer) => {
  const files = unzip(pkg);
  expect([...files.keys()]).toEqual(['collection.anki2', 'media']);
  expect(files.get('media')!.toString()).toBe('{}');
  return new Database(files.get('collection.anki2')!);
};

describe('anki package', () => {
  it('is a valid schema 11 collection with one deck, one note type and a card per verified fact', () => {
    const s = resolveScope(me, 'all')!;
    const col = open(ankiPackage(s.label, exportCards(me, s.refs)));
    const row = col.prepare('SELECT ver, models, decks, dconf FROM col').get() as { ver: number; models: string; decks: string; dconf: string };
    expect(row.ver).toBe(11);
    const model = JSON.parse(row.models)[MODEL_ID];
    expect(model.flds.map((f: { name: string }) => f.name)).toEqual(['Front', 'Back', 'Source', 'Status', 'Fact']);
    expect(model.tmpls[0].afmt).toContain('{{Source}}');
    const decks = Object.values(JSON.parse(row.decks)) as { id: number; name: string }[];
    const deck = decks.find((d) => d.name === 'Lightbox::All verified cards')!;
    expect(deck).toBeTruthy();
    expect(JSON.parse(row.dconf)['1']).toBeTruthy();
    for (const t of ['notes', 'cards']) expect((col.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n).toBe(cards.length);
    expect(cards.length).toBe(420);
    expect(col.prepare('SELECT COUNT(*) n FROM cards WHERE did != ? OR type != 0 OR queue != 0').get(deck.id)).toEqual({ n: 0 });
    for (const t of ['revlog', 'graves']) expect(col.prepare(`SELECT COUNT(*) n FROM ${t}`).get()).toEqual({ n: 0 });

    const c = cards.find((x) => factById.get(x.factId)!.label === 'cited' && factById.get(x.factId)!.sources.length)!;
    const n = col.prepare('SELECT guid, mid, tags, flds, sfld, csum FROM notes WHERE guid = ?').get(`lightbox:${c.factId}`) as { guid: string; mid: number; tags: string; flds: string; sfld: string; csum: number };
    const f = factById.get(c.factId)!;
    const [front, back, source, status, fact] = n.flds.split('\x1f');
    expect(n.mid).toBe(MODEL_ID);
    expect(n.sfld).toBe(c.front);
    expect(n.csum).toBe(checksum(c.front));
    expect(n.tags).toBe(` lightbox ${f.system} cited `);
    expect(front).toBe(c.front.replace(/&/g, '&#38;').replace(/</g, '&#60;').replace(/>/g, '&#62;').replace(/"/g, '&#34;').replace(/'/g, '&#39;'));
    expect(back.length).toBeGreaterThan(0);
    expect(source).toContain(`href="https://lightbox.polytronx.com/facts/${f.id}"`);
    expect(source).toContain(`href="${f.sources[0].replace(/&/g, '&#38;')}"`);
    expect(status).toMatch(/^Cited: verified against a cited source/);
    expect(fact.length).toBeGreaterThan(0);
    col.close();
  });

  it('keeps guids stable across exports and scopes, so re-imports update instead of duplicate', () => {
    const guids = (scope: string) => {
      const s = resolveScope(me, scope)!, col = open(ankiPackage(s.label, exportCards(me, s.refs)));
      const g = (col.prepare('SELECT guid FROM notes ORDER BY guid').all() as { guid: string }[]).map((r) => r.guid);
      col.close();
      return g;
    };
    const a = guids('all');
    expect(guids('all')).toEqual(a);
    expect(new Set(a).size).toBe(a.length);
    const chest = guids('system:chest');
    expect(chest.length).toBe(cards.filter((c) => factById.get(c.factId)!.system === 'chest').length);
    expect(chest.every((g) => a.includes(g))).toBe(true);
  });

  it('escapes own cards and labels them unverified', () => {
    const id = createUserCard(me, { front: '<b>Ring</b> & "halo"\nsign', back: "It's <script>x</script>", factId: facts[0].id })!;
    const s = resolveScope(me, 'mine')!;
    expect(s.refs).toContain(`U${id}`);
    const col = open(ankiPackage(s.label, exportCards(me, s.refs)));
    const n = col.prepare('SELECT tags, flds, sfld FROM notes WHERE guid = ?').get(`lightbox:U${id}`) as { tags: string; flds: string; sfld: string };
    const [front, back, , status] = n.flds.split('\x1f');
    expect(front).toBe('&#60;b&#62;Ring&#60;/b&#62; &#38; &#34;halo&#34;<br>sign');
    expect(back).not.toContain('<script>');
    expect(n.sfld).toBe('<b>Ring</b> & "halo"sign');
    expect(status).toContain('not verified');
    expect(n.tags).toContain('own-card');
    expect(col.prepare('SELECT decks FROM col').pluck().get()).toContain('"Lightbox::My cards"');
    col.close();
    expect(exportCards(other, [`U${id}`])).toEqual([]); // never someone else's card
  });
});

describe('scopes', () => {
  it('validates the scope and counts each one', () => {
    for (const bad of ['', 'everything', 'system:', 'system:constructor', 'system:__proto__', 'collection:abc', 'collection:999999', 'collection:1e0', 'collection:01', 'system:chest:x', 42, null, 'x'.repeat(41)]) expect(resolveScope(me, bad)).toBeNull();
    const list = exportScopes(me);
    expect(list[0]).toEqual({ scope: 'all', label: 'All verified cards', count: 420 });
    expect(list.filter((s) => s.scope.startsWith('system:')).reduce((a, s) => a + s.count, 0)).toBe(420);
    expect(fileStem('system:gyn-obs')).toBe('lightbox-system-gyn-obs');
  });

  it('exports marked facts that have cards and marked own cards, nothing else', () => {
    const withCard = facts.find((f) => cardByFact.has(f.id))!, without = facts.find((f) => !cardByFact.has(f.id))!;
    setMark(me, item(me, 'fact', withCard.id)!, 'weak', true);
    setMark(me, item(me, 'fact', without.id)!, 'weak', true);
    const own = createUserCard(me, { front: 'Own front', back: 'Own back' })!;
    setMark(me, item(me, 'card', `U${own}`)!, 'weak', true);
    expect(resolveScope(me, 'weak')!.refs).toEqual([withCard.id, `U${own}`]);
    expect(resolveScope(other, 'weak')!.refs).toEqual([]);
    expect(exportScopes(me).find((s) => s.scope === 'weak')!.count).toBe(2);
  });

  it('exports a collection to its owner, or to anyone once shared; topics bring their facts', () => {
    const made = createCollection(me, 'Viva::cards');
    if ('error' in made) throw new Error(made.error);
    const topic = topics.find((t) => t.sections.some((s) => s.bullets.some((b) => b.ids.some((id) => cardByFact.has(id)))))!;
    const fact = facts.find((f) => cardByFact.has(f.id) && !f.topics.includes(topic.slug))!;
    setCollectionItem(me, made.id, item(me, 'fact', fact.id)!, true);
    setCollectionItem(me, made.id, item(me, 'topic', topic.slug)!, true);
    const scope = `collection:${made.id}`, s = resolveScope(me, scope)!;
    const fromTopic = [...new Set(topic.sections.flatMap((x) => x.bullets.flatMap((b) => b.ids)))].filter((id) => cardByFact.has(id));
    expect(s.refs).toEqual([fact.id, ...fromTopic.filter((id) => id !== fact.id)]);
    expect(exportScopes(me).find((x) => x.scope === scope)).toEqual({ scope, label: 'Viva::cards', count: s.refs.length });
    expect(resolveScope(other, scope)).toBeNull();
    expect(resolveScope(me, `collection:0${made.id}`)).toBeNull(); // only the canonical id, since the scope names the file
    updateCollection(me, made.id, { shared: true });
    expect(resolveScope(other, scope)!.refs).toEqual(s.refs);
    expect(exportScopes(other).some((x) => x.scope === scope)).toBe(false); // only own collections are listed

    const col = open(ankiPackage(s.label, exportCards(me, s.refs)));
    expect((Object.values(JSON.parse((col.prepare('SELECT decks FROM col').get() as { decks: string }).decks)) as { name: string }[]).map((d) => d.name)).toContain('Lightbox::Viva:cards');
    col.close();
  });
});

describe('csv', () => {
  it('has a BOM, a header, quoted cells and no live formulas', () => {
    const own = createUserCard(me, { front: '=HYPERLINK("x")', back: 'Line one\nline "two"' })!;
    const csv = toCsv(exportCards(me, [cards[0].factId, `U${own}`]));
    expect(csv.startsWith('﻿"Front","Back","Source","Status","Fact"\r\n')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[1]).toContain(`"${cards[0].factId} · `);
    expect(csv).toContain(`"'=HYPERLINK(""x"")","Line one\nline ""two"""`);
  });
});

describe('my data', () => {
  it('contains only the caller\'s own records and no secrets', () => {
    saveNote(me, item(me, 'topic', topics[0].slug)!, 'My mnemonic');
    saveNote(other, item(other, 'topic', topics[0].slug)!, 'Their secret');
    const q = mcqs.find((m) => Object.keys(m.options).length)!;
    recordAttempt(me, q.qid, Object.keys(q.options)[0]);
    const d = myData(me), json = JSON.stringify(d);
    expect(d.mcqAttempts).toEqual([expect.objectContaining({ qid: q.qid, source: 'bank' })]);
    expect(d.profile).toEqual(expect.objectContaining({ username: 'x-owner', displayName: 'Ex Owner', role: 'member' }));
    expect(d.notes.map((n) => n.body)).toEqual(['My mnemonic']);
    expect(d.collections.find((c) => c.name === 'Viva::cards')!.items.length).toBe(2);
    expect(d.cards.length).toBeGreaterThanOrEqual(3);
    expect(d.marks.length).toBe(3);
    expect(json).not.toContain('Their secret');
    expect(json).not.toMatch(/password|"sessions?"|x-other/i);
    expect(Object.keys(d)).toEqual(['app', 'exportedAt', 'times', 'profile', 'goals', 'marks', 'collections', 'notes', 'highlights', 'cards', 'flashcardReviews', 'mcqAttempts', 'exams', 'studySessions', 'comments', 'votes', 'reports', 'pollVotes', 'aiChats']);
  });
});
