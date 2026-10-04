// Anki 2.1 package writer: a zip of "collection.anki2" (legacy schema 11) and an empty "media" map.
// One note type (fields Front, Back, Source, Status, Fact) and one deck. Fields arrive as HTML; the caller escapes them.
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';

export interface AnkiNote { guid: string; fields: [front: string, back: string, source: string, status: string, fact: string]; sort: string; tags: string[] }

export const MODEL_ID = 1_760_000_000_001; // fixed so re-imports reuse the note type and update notes by guid
const FIELDS = ['Front', 'Back', 'Source', 'Status', 'Fact'];

const QFMT = '<div class="lb"><div class="lb-q">{{Front}}</div></div>';
const AFMT = `<div class="lb"><div class="lb-q">{{Front}}</div><hr id="answer"><div class="lb-a">{{Back}}</div>
{{#Fact}}<div class="lb-fact"><span class="lb-k">Fact</span>{{Fact}}</div>{{/Fact}}
<div class="lb-meta" data-tags="{{Tags}}">{{#Status}}<div class="lb-status">{{Status}}</div>{{/Status}}{{#Source}}<div class="lb-source"><span class="lb-k">Source</span>{{Source}}</div>{{/Source}}</div></div>`;
const CSS = `.card { font-family: "Geist", -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 20px; line-height: 1.55; text-align: left; color: #0f1720; }
.lb { max-width: 40rem; margin: 0 auto; padding: 1.25rem 1rem 2rem; }
.lb-q { font-size: 1.1em; font-weight: 600; letter-spacing: -0.01em; }
hr#answer { border: 0; border-top: 1px solid #dce3ea; margin: 1.1rem 0; }
.lb-a { font-size: 1.05em; }
.lb-k { display: block; margin-bottom: 0.15rem; font-size: 0.72em; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.7; }
.lb-fact { margin-top: 1.1rem; padding: 0.7rem 0.9rem; border-left: 3px solid #0e7490; border-radius: 0 10px 10px 0; background: rgba(14, 116, 144, 0.07); font-size: 0.86em; color: #334155; }
.lb-meta { display: grid; gap: 0.55rem; margin-top: 1.1rem; padding-top: 0.8rem; border-top: 1px dashed #dce3ea; font-size: 0.74em; color: #4a5663; }
.lb-status { font-weight: 600; color: #0e7490; }
.lb-status::before { content: ""; display: inline-block; width: 0.55em; height: 0.55em; margin-right: 0.45em; border-radius: 50%; background: currentColor; vertical-align: 0.05em; }
[data-tags~="cited"] .lb-status { color: #047857; }
[data-tags~="own-card"] .lb-status { color: #9d4c08; }
.lb-source a { color: #0e7490; text-decoration: none; border-bottom: 1px solid rgba(14, 116, 144, 0.35); word-break: break-word; }
.nightMode .card, .card.nightMode, .night_mode .card { color: #e6edf3; }
.nightMode hr#answer, .night_mode hr#answer, .nightMode .lb-meta, .night_mode .lb-meta { border-color: #2c3a49; }
.nightMode .lb-fact, .night_mode .lb-fact { color: #c9d4de; border-color: #22d3ee; background: rgba(34, 211, 238, 0.08); }
.nightMode .lb-meta, .night_mode .lb-meta { color: #8f9cab; }
.nightMode .lb-status, .night_mode .lb-status { color: #22d3ee; }
.nightMode [data-tags~="cited"] .lb-status, .night_mode [data-tags~="cited"] .lb-status { color: #34d399; }
.nightMode [data-tags~="own-card"] .lb-status, .night_mode [data-tags~="own-card"] .lb-status { color: #f5b544; }
.nightMode .lb-source a, .night_mode .lb-source a { color: #22d3ee; }`;

const SCHEMA = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn ON notes (usn); CREATE INDEX ix_cards_usn ON cards (usn); CREATE INDEX ix_revlog_usn ON revlog (usn);
CREATE INDEX ix_cards_nid ON cards (nid); CREATE INDEX ix_cards_sched ON cards (did, queue, due); CREATE INDEX ix_revlog_cid ON revlog (cid); CREATE INDEX ix_notes_csum ON notes (csum);`;

const sha1 = (s: string) => createHash('sha1').update(s, 'utf8').digest('hex');
/** Anki's duplicate-check checksum: the first 8 hex digits of sha1 of the plain sort field. */
export const checksum = (plain: string) => parseInt(sha1(plain).slice(0, 8), 16);
/** Stable deck id from its name, so the same scope lands in the same deck. */
export const deckId = (name: string) => parseInt(sha1(`deck:${name}`).slice(0, 12), 16) + 2;

const deck = (id: number, name: string, desc: string, mod: number) => ({
  id, name, desc, mod, usn: -1, conf: 1, dyn: 0, collapsed: false, browserCollapsed: false, extendNew: 10, extendRev: 50,
  newToday: [0, 0], revToday: [0, 0], lrnToday: [0, 0], timeToday: [0, 0],
});

/** Builds the .apkg bytes in memory (no temp files). */
export function buildApkg(deckName: string, deckDesc: string, notes: AnkiNote[], t = Date.now()) {
  const s = Math.floor(t / 1000), did = deckId(deckName);
  const model = {
    id: MODEL_ID, name: 'Lightbox (verified card)', type: 0, mod: s, usn: -1, sortf: 0, did, tags: [], vers: [], req: [[0, 'any', [0]]],
    flds: FIELDS.map((name, ord) => ({ name, ord, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] })),
    tmpls: [{ name: 'Card 1', ord: 0, qfmt: QFMT, afmt: AFMT, bqfmt: '', bafmt: '', did: null }],
    css: CSS, latexsvg: false, latexPost: '\\end{document}',
    latexPre: '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
  };
  const conf = { activeDecks: [did], curDeck: did, newSpread: 0, collapseTime: 1200, timeLim: 0, estTimes: true, dueCounts: true, curModel: String(MODEL_ID), nextPos: notes.length + 1, sortType: 'noteFld', sortBackwards: false, addToCur: true };
  const dconf = { 1: {
    id: 1, name: 'Default', mod: 0, usn: 0, maxTaken: 60, autoplay: true, timer: 0, replayq: true, dyn: false,
    new: { bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 20, separate: true },
    rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 200 },
    lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
  } };
  const decks = { 1: deck(1, 'Default', '', s), [did]: deck(did, deckName, deckDesc, s) };

  const col = new Database(':memory:');
  try {
    col.exec(SCHEMA);
    col.prepare('INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, ?)')
      .run(Math.floor(t / 86_400_000) * 86_400, t, t, JSON.stringify(conf), JSON.stringify({ [MODEL_ID]: model }), JSON.stringify(decks), JSON.stringify(dconf), '{}');
    const note = col.prepare("INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, '')");
    const card = col.prepare("INSERT INTO cards VALUES (?, ?, ?, 0, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, '')");
    col.transaction(() => notes.forEach((n, i) => {
      note.run(t + i, n.guid, MODEL_ID, s, ` ${n.tags.join(' ')} `, n.fields.join('\x1f'), n.sort, checksum(n.sort));
      card.run(t + i, t + i, did, s, i + 1);
    }))();
    return zip([['collection.anki2', col.serialize()], ['media', Buffer.from('{}')]], t);
  } finally { col.close(); }
}

/** Minimal deflate zip writer (no zip64; fine for a few MB). */
export function zip(files: [string, Buffer][], t = Date.now()) {
  const d = new Date(t);
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const local: Buffer[] = [], central: Buffer[] = [];
  let off = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name, 'utf8'), z = zlib.deflateRawSync(data), crc = zlib.crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8); h.writeUInt16LE(time, 10); h.writeUInt16LE(date, 12);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(z.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10); c.writeUInt16LE(time, 12); c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(z.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    local.push(h, n, z); central.push(c, n);
    off += 30 + n.length + z.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...local, cd, end]);
}
