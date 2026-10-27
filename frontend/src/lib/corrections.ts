export interface Correction {
  /** Text as it was transcribed */
  from: string;
  /** What it should be */
  to: string;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches `from` as whole words, ignoring case. */
function wholeWords(from: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(from)}(?![\\p{L}\\p{N}])`, 'giu');
}

/** Replaces `from` with `to` where it stands as whole words; returns the text and the count. */
export function replaceWords(text: string, from: string, to: string): { text: string; count: number } {
  let count = 0;
  const out = text.replace(wholeWords(from), () => {
    count += 1;
    return to;
  });
  return { text: out, count };
}

// The changed part shorter than this is too likely to match elsewhere on its own.
const MIN_CORE_CHARS = 4;

/**
 * Narrows a correction to the words that actually changed, so the rule also
 * catches the same mishearing in other phrases: "visa chemified mission" ->
 * "Visa gamified mission" becomes "chemified" -> "gamified". Falls back to the
 * whole phrase when the changed part is too short to be a safe rule.
 */
export function deriveCorrection(selected: string, corrected: string): Correction {
  const from = selected.trim().split(/\s+/);
  const to = corrected.trim().split(/\s+/);
  let head = 0;
  while (head < from.length && head < to.length && from[head].toLowerCase() === to[head].toLowerCase()) head++;
  let tail = 0;
  while (
    tail < from.length - head &&
    tail < to.length - head &&
    from[from.length - 1 - tail].toLowerCase() === to[to.length - 1 - tail].toLowerCase()
  ) tail++;

  const coreFrom = from.slice(head, from.length - tail).join(' ');
  const coreTo = to.slice(head, to.length - tail).join(' ');
  if (coreFrom.replace(/[^\p{L}\p{N}]/gu, '').length < MIN_CORE_CHARS) {
    return { from: selected.trim(), to: corrected.trim() };
  }
  return { from: coreFrom, to: coreTo };
}

// Everyday words: a rule made only of these would rewrite ordinary speech everywhere.
const COMMON_WORDS = new Set((
  'a an the and or but if then so to of in on at by for with from up down out over under ' +
  'is are was were be been am do does did have has had will would can could should may might must ' +
  'i you he she it we they me him her us them my your his its our their this that these those ' +
  'what which who when where why how all any some no not yes yeah ok okay oh just very really ' +
  'here there now one two end start go get got make made say said see know think like well right'
).split(' '));

/** True when every word of `phrase` is an everyday word. */
export function isCommonPhrase(phrase: string): boolean {
  const words = phrase.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  return words.length > 0 && words.every(w => COMMON_WORDS.has(w));
}

/** Replaces only the last whole-word occurrence of `from`. */
export function replaceLastWords(text: string, from: string, to: string): { text: string; count: number } {
  const matches = [...text.matchAll(wholeWords(from))];
  const last = matches[matches.length - 1];
  if (!last || last.index === undefined) return { text, count: 0 };
  return { text: text.slice(0, last.index) + to + text.slice(last.index + last[0].length), count: 1 };
}
