/* The inline markup the Arena's AI read can carry, as pure functions so it can be tested without a render.
 *
 * `ReasoningText` (app/(main)/arena/page.tsx) splits the model's prose on this pattern: **bold**, *emphasis*,
 * `[text](url)` / `[[n]](url)` links, and newlines. Single-asterisk emphasis was missing, so "A *clean* sweep"
 * showed its asterisks to the user (#2166, QA's G4).
 *
 * WHAT COUNTS AS EMPHASIS, narrowly: an opening `*` followed by a non-space, non-asterisk character, text with no
 * asterisk and no newline in it, and a closing `*` preceded by a non-space, non-asterisk character. So
 * "5 * 3", "5 * 3 * 2", a lone "*" and a leading "**unclosed" are all left as the literal text they are, and
 * `**bold**` still takes the first alternative before this one is tried. */
export const REASONING_SPLIT =
  /(\*\*[\s\S]*?\*\*|\*[^\s*](?:[^*\n]*[^\s*])?\*|\[\[?[^\]]*\]?\]\([^)]+\)|\n)/g;

/** The text inside a single-asterisk emphasis segment, or null when the segment is not one. `**x**` is not. */
export function emphasisInner(seg: string): string | null {
  const m = seg.match(/^\*([^\s*](?:[^*\n]*[^\s*])?)\*$/);
  return m ? m[1] : null;
}
