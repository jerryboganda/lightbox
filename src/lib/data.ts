import factsJson from '../data/facts.json';
import topicsJson from '../data/topics.json';
import ankiJson from '../data/anki.json';
import mcqsJson from '../data/mcqs.json';
import imagesJson from '../data/images.json';
import coverageJson from '../data/coverage.json';
import pagesJson from '../data/pages.json';
import unreadableJson from '../data/unreadable.json';
import statsJson from '../data/stats.json';

export type Label = 'cited' | 'agreed' | 'unchecked' | 'disputed';
export interface Fact { id: string; file: string; unit: number; fact: string; kind: string; status: string; basis: string; label: Label; sources: string[]; sourceText: string; edition: string; accessDate: string; note: string; paperDiffers: string; topics: string[]; system: string; tag: string }
export interface Bullet { text: string; ids: string[]; label?: Label | null }
export interface Topic { slug: string; system: string; title: string; oneLiner: string; sections: { heading: string; bullets: Bullet[] }[] }
export interface Card { factId: string; front: string; back: string; tags: string; sourceFile: string; page: number; evidence: string }
export interface Mcq { qid: string; paper: string; file: string; unit: number; stem: string; options: Record<string, string>; key: string; keyEvidence: string; myAnswer: string; confidence: string; reason: string; verdict: string; basis: string; evidence: string; note: string; notBlind: boolean; notBlindReason: string }
export interface Img { file: string; sourceFile: string; page: number; caption: string }
export interface CoverageRow { name: string; type: string; size: number; units: number; unitKind: string; duplicateOf: string; inPilot: boolean; done: number; total: number }
export interface PageRow { file: string; page: number; status: string; textSource: string; factCount: number; note: string }

export const facts = factsJson as Fact[];
export const topics = topicsJson as Topic[];
export const cards = ankiJson as Card[];
export const mcqs = mcqsJson as Mcq[];
export const images = imagesJson as Img[];
export const coverage = coverageJson as CoverageRow[];
export const pages = pagesJson as PageRow[];
export const unreadable = unreadableJson as string[];
export const stats = statsJson;

export const factById = new Map(facts.map((f) => [f.id, f]));
export const topicBySlug = new Map(topics.map((t) => [t.slug, t]));
export const cardByFact = new Map(cards.map((c) => [c.factId, c]));

export const SYSTEMS: Record<string, { label: string; icon: string; blurb: string }> = {
  neuro: { label: 'Neuroradiology', icon: 'Brain', blurb: 'Brain, spine, vessels and haemorrhage' },
  chest: { label: 'Chest', icon: 'Wind', blurb: 'Lungs, mediastinum, pleura and heart' },
  abdomen: { label: 'Abdomen and GI', icon: 'Soup', blurb: 'Liver, bowel and contrast studies' },
  gu: { label: 'Genitourinary', icon: 'Droplets', blurb: 'Kidneys, adrenals, bladder and testes' },
  'gyn-obs': { label: 'Gynae and obstetrics', icon: 'Venus', blurb: 'Pelvis, ovary and pregnancy' },
  breast: { label: 'Breast', icon: 'Ribbon', blurb: 'Mammography, MRI and BI-RADS' },
  msk: { label: 'Musculoskeletal', icon: 'Bone', blurb: 'Bones, joints and positioning' },
  pediatrics: { label: 'Paediatrics', icon: 'Baby', blurb: 'Neonatal, NAI and paediatric pearls' },
  ent: { label: 'Head and neck', icon: 'Ear', blurb: 'Temporal bone, sinuses and skull base' },
  vascular: { label: 'Vascular', icon: 'Waypoints', blurb: 'Venous, arterial and venography' },
  'nuclear-med': { label: 'Nuclear medicine', icon: 'Radiation', blurb: 'Isotopes, generators and scans' },
  physics: { label: 'Physics and safety', icon: 'Atom', blurb: 'X-ray, CT, MRI, US and protection' },
  procedures: { label: 'Procedures', icon: 'Syringe', blurb: 'Technique, contrast and labelling' },
  other: { label: 'Other', icon: 'Shapes', blurb: 'Not yet filed under a system' },
};
export const systemOrder = Object.keys(SYSTEMS).filter((s) => s !== 'other');

export const LABELS: Record<Label | 'edition', { text: string; hint: string }> = {
  cited: { text: 'Cited', hint: 'Verified against a cited source' },
  agreed: { text: 'Agreed', hint: 'Descriptive fact; source and textbook knowledge agree' },
  unchecked: { text: 'Unchecked', hint: 'No source found; do not treat as verified' },
  disputed: { text: 'Disputed', hint: 'Sources disagree; both positions kept' },
  edition: { text: 'Edition clash', hint: 'Older text and newer guideline differ; both kept' },
};

export const isEditionClash = (f: Fact) => / vs |Paper:|Published Graf|AS PRINTED/.test(f.edition);
export const shortFile = (name: string) => name.replace(/\.(pdf|pptx?|docx|jpe?g)$/i, '').replace(/compiled by .*$/i, '').replace(/\s+/g, ' ').trim();
