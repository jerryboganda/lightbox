// Shared by the AI server code (telemetry) and the AI islands (badges): did an answer stand on Lightbox facts?
export type Grounded = 'grounded' | 'not-covered' | 'unsourced';
export const NOT_COVERED = 'Not covered in Lightbox notes yet';

/** grounded: cites at least one fact it was given; not-covered: says the notes do not cover it; unsourced: neither, so treat it with care. */
export const grounding = (text: string, cites: number): Grounded =>
  cites > 0 ? 'grounded' : text.toLowerCase().includes(NOT_COVERED.toLowerCase()) ? 'not-covered' : 'unsourced';
