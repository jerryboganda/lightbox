// Reads the pipeline output (read-only) and writes the site's data files.
// Usage: node scripts/export-content.mjs [path-to-_output]
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2] || process.env.LIGHTBOX_SRC || 'D:/Radiology Exam Material/_output';
const OUT = path.resolve('src/data');
const ATLAS = path.resolve('src/assets/atlas');
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8').replace(/^\uFEFF/, '');
const jsonl = (p) => read(p).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

function csv(p) {
  const s = read(p), rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.length > 1 || r[0]);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const urls = (s) => (s.match(/https?:\/\/[^\s;,'"\]]+/g) || []).map((u) => u.replace(/[.,)]+$/, ''));
const label = (f) => f.status === 'disputed' ? 'disputed' : f.status === 'unchecked' ? 'unchecked' : f.basis === 'cited' ? 'cited' : 'agreed';

// ---------- topics (one markdown note per entity)
const TAG = /\[([^\]]*F-(?:M|AUG|TFC)-[^\]]*)\]\s*$/;
const ID = /F-(?:M|AUG|TFC)-\d+(?:\/\d+)*[a-z]?/g;
const expand = (tok) => {
  const m = tok.match(/^(F-(?:M|AUG|TFC)-)(\d+(?:\/\d+)*)([a-z]?)$/);
  const nums = m[2].split('/');
  return nums.map((n, i) => m[1] + n + (i === nums.length - 1 ? m[3] : ''));
};
const topics = [];
for (const system of fs.readdirSync(path.join(SRC, 'topics')).sort()) {
  const dir = path.join(SRC, 'topics', system);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const fn of fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const lines = fs.readFileSync(path.join(dir, fn), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
    const t = { slug: fn.replace(/\.md$/, ''), system, title: '', oneLiner: '', sections: [] };
    let sec = null;
    for (const l of lines) {
      if (l.startsWith('# ')) t.title = l.slice(2).trim();
      else if (l.startsWith('## ')) { sec = { heading: l.slice(3).trim(), bullets: [] }; t.sections.push(sec); }
      else if (/^\s*[-*] /.test(l)) {
        if (!sec) { sec = { heading: 'Key points', bullets: [] }; t.sections.push(sec); }
        let text = l.replace(/^\s*[-*] /, '').trim(), ids = [], lab = null;
        const m = text.match(TAG);
        if (m) {
          ids = [...new Set((m[1].match(ID) || []).flatMap(expand))];
          lab = (m[1].match(/verified\/cited|verified\/agreed|DISPUTED|UNCHECKED/) || [null])[0];
          text = text.replace(TAG, '').trim();
        } else if (/no fact id, UNCHECKED|\(no fact\)/.test(text)) {
          lab = 'UNCHECKED'; text = text.replace(/\[no fact id, UNCHECKED\]|\(no fact\)/, '').trim();
        }
        sec.bullets.push({ text, ids, label: lab && { 'verified/cited': 'cited', 'verified/agreed': 'agreed', DISPUTED: 'disputed', UNCHECKED: 'unchecked' }[lab] });
      } else if (l.trim() && !t.oneLiner && t.title && !sec) t.oneLiner = l.trim();
    }
    t.sections = t.sections.filter((s) => s.bullets.length);
    topics.push(t);
  }
}
const topicOf = {};
for (const t of topics) for (const s of t.sections) for (const b of s.bullets) for (const id of b.ids) (topicOf[id] ||= []).includes(t.slug) || topicOf[id].push(t.slug);
const systemOf = Object.fromEntries(topics.map((t) => [t.slug, t.system]));

// ---------- facts
const rawFacts = jsonl('facts.jsonl');
const facts = rawFacts.map((f) => ({
  id: f.id, file: f.file, unit: Number(f.unit), fact: f.fact, kind: f.kind || 'descriptive',
  status: f.status, basis: f.basis || '', label: label(f), sources: urls(f.source || ''), sourceText: f.source || '',
  edition: f.edition || '', accessDate: f.access_date || '', note: f.note || '', paperDiffers: f.paper_differs || '',
  topics: topicOf[f.id] || [], system: systemOf[(topicOf[f.id] || [])[0]] || 'other', tag: f.topic || '',
}));

// ---------- anki
const anki = csv('anki.csv').map((r) => ({ factId: r.fact_id, front: r.front, back: r.back, tags: r.tags, sourceFile: r.source_file, page: Number(r.page) || 0, evidence: r.evidence }));

// ---------- MCQs
const qs = jsonl('mcq/questions.jsonl'), keys = Object.fromEntries(jsonl('mcq/keys.jsonl').map((k) => [k.qid, k]));
const ans = Object.fromEntries(jsonl('mcq/answers.jsonl').map((a) => [a.qid, a]));
const verd = Object.fromEntries(csv('mcq/verdicts.csv').map((v) => [v.qid, v]));
const nb = Object.fromEntries(csv('mcq/not_blind.csv').map((v) => [v.qid, v]));
const mcqs = qs.map((q) => {
  const k = keys[q.qid] || {}, a = ans[q.qid] || {}, v = verd[q.qid] || {};
  return {
    qid: q.qid, paper: q.qid.split('-')[0], file: q.file, unit: Number(q.unit), stem: q.question_text, options: q.options || {},
    key: (k.key_letter || '').trim(), keyEvidence: k.key_evidence || '', myAnswer: v.my_answer || a.my_answer || '', confidence: a.confidence || '',
    reason: a.reason || '', verdict: v.verdict || '', basis: v.basis || '', evidence: v.evidence || '', note: v.note || '',
    notBlind: Boolean(nb[q.qid]), notBlindReason: nb[q.qid]?.reason || '',
  };
});

// ---------- images (copied so Astro can optimise them)
const images = csv('images.csv').map((r) => ({ file: r.image_file, sourceFile: r.source_file, page: Number(r.page_or_slide) || 0, caption: r.caption_verbatim }));
fs.mkdirSync(ATLAS, { recursive: true });
for (const im of images) fs.copyFileSync(path.join(SRC, 'images', im.file), path.join(ATLAS, im.file));

// ---------- ledgers
const coverage = csv('coverage.csv').map((r) => ({ name: r.name, type: r.type, size: Number(r.size_bytes), units: Number(r.units) || 0, unitKind: r.unit, duplicateOf: r.duplicate_of, inPilot: r.in_pilot === 'yes', done: Number(r.pages_done) || 0, total: Number(r.pages_total) || 0 }));
const pages = csv('pages.csv').map((r) => ({ file: r.file, page: Number(r.page), status: r.status, textSource: r.text_source, factCount: Number(r.fact_count), note: r.note }));
const dmd = read('disputed.md');
const unreadable = (dmd.split(/^## 7\..*$/m)[1] || '').split(/^## /m)[0].split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim());

const stats = {
  generatedAt: new Date().toISOString().slice(0, 10),
  facts: facts.length, verified: facts.filter((f) => f.status === 'verified').length,
  cited: facts.filter((f) => f.label === 'cited').length, agreed: facts.filter((f) => f.label === 'agreed').length,
  unchecked: facts.filter((f) => f.status === 'unchecked').length, disputed: facts.filter((f) => f.status === 'disputed').length,
  anki: anki.length, topics: topics.length, images: images.length, mcqs: mcqs.length,
  mcqVerdicts: Object.fromEntries(['KEY CORRECT', 'KEY WRONG', 'DISPUTED', 'NO KEY'].map((k) => [k, mcqs.filter((m) => m.verdict === k).length])),
  notBlind: Object.keys(nb).length, files: coverage.length, pilotFiles: coverage.filter((c) => c.total > 0).length,
  units: pages.length, unitsWithFacts: pages.filter((p) => p.status === 'facts').length,
  duplicates: coverage.filter((c) => c.duplicateOf).length,
  pdfPages: coverage.filter((c) => c.type === 'pdf').reduce((a, c) => a + c.units, 0),
  slides: coverage.filter((c) => c.type === 'pptx').reduce((a, c) => a + c.units, 0),
};

// sanity: every source row made it through
const expect = { facts: rawFacts.length, anki: csv('anki.csv').length, images: csv('images.csv').length, mcqs: qs.length };
for (const [k, v] of Object.entries(expect)) if (stats[k] !== v) throw new Error(`count mismatch for ${k}: ${stats[k]} vs ${v}`);
const orphan = anki.filter((a) => !facts.find((f) => f.id === a.factId));
if (orphan.length) throw new Error(`anki rows without a fact: ${orphan.length}`);

fs.mkdirSync(OUT, { recursive: true });
const w = (n, d) => fs.writeFileSync(path.join(OUT, n), JSON.stringify(d, null, 0) + '\n');
w('facts.json', facts); w('anki.json', anki); w('topics.json', topics); w('mcqs.json', mcqs); w('images.json', images);
w('coverage.json', coverage); w('pages.json', pages); w('unreadable.json', unreadable); w('stats.json', stats);
console.log(JSON.stringify(stats));
