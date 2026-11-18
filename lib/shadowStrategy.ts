/* The Shadow Account "shadow strategy" fallback, shared by the prompt (app/api/shadow-account) and the page (components/TradeJournal). PURE.
 *
 * When no trade type has enough closed trades, the prompt tells the AI to write exactly this sentence instead of shadow stats. In that case no
 * trade type was picked, so the page must not show the hindsight note, which says a pick was made (QA review of #2586, tracker #1631). */
export const SHADOW_NO_PICK_TEXT = 'Not enough trades per type to compare.';

/** True when the SHADOW_STRATEGY section holds a pick of trade types, false when it is empty or is the no-pick fallback (case and the final full stop ignored). */
export function shadowPickMade(section: string): boolean {
  const s = section.trim();
  if (!s) return false;
  return !s.toLowerCase().includes(SHADOW_NO_PICK_TEXT.slice(0, -1).toLowerCase());
}
