// Server-only: original page text for the source viewer (~600 KB). Never import from a client island.
import pagetextJson from '../data/pagetext.json';
import { coverage, pages, shortFile, type PageRow } from './data';

const pagetext = pagetextJson as Record<string, string>;
export const pageText = (file: string, unit: number): string | null => pagetext[`${file}|${unit}`] ?? null;

// Stable, readable URL slugs for the pilot files ("(FINAL) IMM Feb 2025-2.pdf" -> "final-imm-feb-2025-2").
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const unitsByFile = new Map<string, PageRow[]>();
for (const p of [...pages].sort((a, b) => a.page - b.page)) (unitsByFile.get(p.file) ?? unitsByFile.set(p.file, []).get(p.file)!).push(p);
const fileOf = new Map<string, string>(), slugOf = new Map<string, string>();
for (const f of unitsByFile.keys()) {
  let s = slugify(shortFile(f)) || 'file';
  if (fileOf.has(s)) s += '-' + slugify(f.split('.').pop() ?? '');
  while (fileOf.has(s)) s += '-x';
  fileOf.set(s, f); slugOf.set(f, s);
}
export const fileSlug = (file: string) => slugOf.get(file);
const kindOf = (file: string) => coverage.find((c) => c.name === file)?.unitKind ?? '';
// Reading order for the source viewer: documents and slide decks first, then single images; prev/next walks it across files.
export const fileOrder = [...unitsByFile.keys()].sort((a, b) => Number(kindOf(a) === 'images') - Number(kindOf(b) === 'images') || a.localeCompare(b));
const sequence = fileOrder.flatMap((f) => unitsByFile.get(f)!);
export const neighbours = (p: PageRow) => { const i = sequence.indexOf(p); return { prev: sequence[i - 1] as PageRow | undefined, next: sequence[i + 1] as PageRow | undefined }; };
export const fileFromSlug = (slug: string) => fileOf.get(slug);
export const sourceHref = (file: string, unit: number) => (slugOf.has(file) ? `/sources/${slugOf.get(file)}/${unit}` : null);

const UNIT: Record<string, string> = { pages: 'Page', slides: 'Slide', parts: 'Part', images: 'Image' };
export const unitWord = (file: string) => UNIT[kindOf(file)] ?? 'Page';
export const isImageFile = (file: string) => kindOf(file) === 'images';
// textSource is '' for slides read from the deck itself, else the text layer or the OCR model used.
export const textLabel = (src: string, text: string) => (!text.trim() ? 'No text' : !src || src === 'text-layer' ? 'Text layer' : 'OCR');

// MCQ units are named like FINAL_IMM_Feb_2025-2__u003.txt; this is the same file's stem.
export const mcqStem = (file: string) => file.replace(/\.[a-z0-9]+$/i, '').replace(/[^A-Za-z0-9-]+/g, '_').replace(/^_+|_+$/g, '');

/** Verbatim page text as lines of segments. Long lines are cut at sentence ends so a highlight stays tight; joining every segment gives the text back (minus \r). */
export function segment(text: string) {
  let i = 0;
  return text.replace(/\r/g, '').split('\n').map((line) =>
    (line.length > 220 ? line.split(/(?<=[.?!;:])(?=\s+\S)/) : [line]).map((t) => ({ i: i++, text: t })));
}

const STOP = new Set('the a an of and or in on at to for with by is are was were be been as from that this these those it its which than then not no but if into onto over under per via vs also may can will has have had do does all any each most more less very only other such so their there they them what when where who whom why how'.split(' '));
const tokens = (s: string) => (s.toLowerCase().match(/[a-z0-9]+(?:\.[0-9]+)?/g) ?? [])
  .filter((w) => (w.length > 1 || /\d/.test(w)) && !STOP.has(w))
  .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));

export interface Match { start: number; end: number; score: number; strong: boolean }

/** Best 1-3 consecutive segments for a statement: share of the statement's words found there, rarer page words counting more.
 *  Facts are reworded and often add checked detail, so a low share can still be the right passage: >= 0.3 is "strong", >= 0.1 "weak", else null.
 *  ponytail: plain word overlap, no synonyms or abbreviations (CXR vs chest radiograph); add an alias list if matches need to be sharper. */
export function bestMatch(statement: string, segs: string[]): Match | null {
  const want = [...new Set(tokens(statement))];
  if (!want.length || !segs.length) return null;
  const sets = segs.map((s) => new Set(tokens(s)));
  const df = new Map<string, number>();
  for (const s of sets) for (const t of s) df.set(t, (df.get(t) ?? 0) + 1);
  const w = (t: string) => Math.log(1 + (segs.length + 1) / ((df.get(t) ?? 0) + 0.5));
  const total = want.reduce((a, t) => a + w(t), 0);
  let best: (Match & { hits: number }) | null = null;
  for (let a = 0; a < segs.length; a++) {
    if (!sets[a].size) continue;
    const got = new Set<string>();
    for (let b = a; b < Math.min(a + 3, segs.length); b++) {
      for (const t of sets[b]) got.add(t);
      if (!sets[b].size) continue;
      const hits = want.filter((t) => got.has(t));
      const score = hits.reduce((x, t) => x + w(t), 0) / total - 0.04 * (b - a);
      if (!best || score > best.score) best = { start: a, end: b, score, hits: hits.length, strong: score >= 0.3 && hits.length >= Math.min(3, want.length) };
    }
  }
  if (!best || best.score < 0.1 || best.hits < Math.min(2, want.length)) return null;
  const { hits: _, ...m } = best;
  return m;
}
