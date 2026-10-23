// "Ask AI" on a highlighted passage: builds the tutor question and hands it to /tutor across the page change.
// The fact id inside the question is what the server pins as grounding (see tutorReply), so keep it in the text.
export interface AskCtx { quote: string; topic?: string | null; section?: string | null; system?: string | null; factId?: string | null; label?: string | null; source?: string | null }

export const ASK_KEY = 'lb:ask';
const MAX = 2000; // CHAT.text on the server
const STALE_MS = 120_000;

export function askPrompt(c: AskCtx, max = MAX) {
  const quote = c.quote.replace(/\s+/g, ' ').trim();
  const where = [c.topic && `Topic: ${c.topic}`, c.section && `Section: ${c.section}`, c.system, c.factId && `Fact ${c.factId}${c.label ? ` (${c.label})` : ''}`, c.source && `Source: ${c.source}`].filter(Boolean).join(' · ');
  const short = quote.split(' ').length <= 4;
  const ask = short
    ? 'What does it mean in this context? Define it, say why it matters for FCPS-II, and how it is examined.'
    : 'Explain this passage: what it means, why it matters for FCPS-II, how it is examined (MCQ or TOACS) and the common traps.';
  const build = (q: string) => `I highlighted this in my notes:\n“${q}”\n\n${where ? `Where it is from: ${where}.\n` : ''}${ask} Answer from the notes and cite the facts you use.`;
  const over = build(quote).length - max;
  return over > 0 ? build(`${quote.slice(0, Math.max(1, quote.length - over - 1)).trimEnd()}…`) : build(quote);
}

export function stashAsk(q: string) {
  try { sessionStorage.setItem(ASK_KEY, JSON.stringify({ q, t: Date.now() })); return true; } catch { return false; }
}

/** The pending question, once: gone after reading, and ignored when old or malformed. */
export function takeAsk(): { q: string } | null {
  try {
    const raw = sessionStorage.getItem(ASK_KEY);
    sessionStorage.removeItem(ASK_KEY);
    const a = raw && JSON.parse(raw);
    return a && typeof a.q === 'string' && a.q.trim() && Date.now() - Number(a.t) < STALE_MS ? { q: a.q.slice(0, MAX) } : null;
  } catch { return null; }
}
