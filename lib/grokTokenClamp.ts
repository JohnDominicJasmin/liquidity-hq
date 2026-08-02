// Extracted from app/api/grok-chat/route.ts so it's independently testable.
// A modified client can shrink max_tokens but never raise it past the real
// ceiling - the cap is what actually bounds cost per call.
export const MAX_TOKENS_CEILING = 600;

export function clampMaxTokens(requested: unknown): number {
  const n = Number(requested);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_TOKENS_CEILING) : MAX_TOKENS_CEILING;
}
