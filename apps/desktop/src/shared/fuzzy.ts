export interface FuzzyMatch {
  score: number;
  /** UTF-16 indexes into the original text. */
  positions: number[];
}

const boundary = /[\s\-_./\\:()[\]]/;

function isStart(text: string, index: number) {
  if (index === 0) return true;
  const previous = text[index - 1];
  const current = text[index];
  return (
    boundary.test(previous) ||
    (previous === previous.toLowerCase() &&
      current !== current.toLowerCase() &&
      current === current.toUpperCase())
  );
}

function score(text: string, positions: number[], exact: boolean) {
  let total = exact ? 24 : 0;
  for (let i = 0; i < positions.length; i++) {
    const at = positions[i];
    total += 16;
    if (isStart(text, at)) total += 10;
    if (i > 0) {
      const gap = at - positions[i - 1] - 1;
      total += gap === 0 ? 8 : -Math.min(gap, 8);
    }
  }
  // Earlier matches and shorter candidates rank first.
  return total - Math.min(positions[0], 16) * 0.5 - text.length * 0.01;
}

function matchWord(text: string, lower: string, word: string) {
  const exact = lower.indexOf(word);
  if (exact >= 0) {
    // Prefer an occurrence at a word start, e.g. "set" in "Reset settings".
    let at = exact;
    for (let i = exact; i >= 0; i = lower.indexOf(word, i + 1))
      if (isStart(text, i)) {
        at = i;
        break;
      }
    const positions = Array.from({ length: word.length }, (_, i) => at + i);
    return { score: score(text, positions, true), positions };
  }
  // fzf v1: forward scan for the first subsequence end, then tighten backwards.
  let index = 0;
  let end = -1;
  for (let i = 0; i < lower.length && index < word.length; i++)
    if (lower[i] === word[index] && ++index === word.length) end = i;
  if (end < 0) return null;
  const positions: number[] = [];
  index = word.length - 1;
  for (let i = end; i >= 0 && index >= 0; i--)
    if (lower[i] === word[index]) {
      positions.unshift(i);
      index--;
    }
  // Letters scattered across a long title are noise, not a match.
  if (positions[positions.length - 1] - positions[0] >= word.length * 3 + 6)
    return null;
  return { score: score(text, positions, false), positions };
}

/** Space-separated words must all match; each word is a subsequence. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return { score: 0, positions: [] };
  const lower = text.toLowerCase();
  // Case folding that changes length (e.g. "İ") would misalign highlights.
  if (lower.length !== text.length) return null;
  let total = 0;
  const positions = new Set<number>();
  for (const word of words) {
    const match = matchWord(text, lower, word);
    if (!match) return null;
    total += match.score;
    for (const at of match.positions) positions.add(at);
  }
  return { score: total, positions: [...positions].sort((a, b) => a - b) };
}

/** Exact case-insensitive ranges of each term, for content-search snippets. */
export function termRanges(text: string, terms: string[]) {
  const lower = text.toLowerCase();
  const marks = new Array<boolean>(text.length).fill(false);
  if (lower.length !== text.length) return [];
  for (const term of terms) {
    const word = term.toLowerCase();
    if (!word) continue;
    for (let i = lower.indexOf(word); i >= 0; i = lower.indexOf(word, i + 1))
      marks.fill(true, i, i + word.length);
  }
  return marks.flatMap((marked, index) => (marked ? [index] : []));
}

export const MAX_TERMS = 8;
/** Lower-cased, de-duplicated words of a content-search query. */
export function searchTerms(query: string) {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .filter((term) => term.length > 0),
    ),
  ].slice(0, MAX_TERMS);
}
