/* Code out of a Markdown code fence (#1631, Pine script export). PURE.
 *
 * The Pine prompt asks for code only, but a model may still answer "```pinescript\n...\n```", sometimes with a sentence before or after.
 * The Copy button copied the answer as-is, and a fence line does not compile in TradingView. So:
 *   - a fenced block anywhere in the text -> the inside of the FIRST block, exactly as written (the fence lines and any prose around it go);
 *   - an opening fence with no closing one -> the text after the opening line;
 *   - no fence -> the text unchanged.
 * Only the fence is removed; nothing inside it is edited. */
export function stripCodeFence(text: string): string {
  const s = text.replace(/\r\n/g, '\n');
  const block = /```[^\n`]*\n([\s\S]*?)\n?```/.exec(s);
  if (block) return block[1].replace(/\s+$/, '');
  const open = /^\s*```[^\n`]*\n/.exec(s);
  if (open) return s.slice(open[0].length).replace(/\s+$/, '');
  return text;
}
