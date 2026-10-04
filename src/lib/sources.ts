// Server-only: original page text for the source viewer (~600 KB). Never import from a client island.
import pagetextJson from '../data/pagetext.json';

const pagetext = pagetextJson as Record<string, string>;
export const pageText = (file: string, unit: number): string | null => pagetext[`${file}|${unit}`] ?? null;
