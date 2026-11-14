/* A REQUEST BODY WITH A SIZE CAP (security audit #1413, G7). No route read content-length, so a caller could send a body of any size.
 * This helper counts the bytes of a body as it streams in, so it covers both a declared size and a request with no content-length (chunked), on the routes that call it.
 * A cap for EVERY /api route would need proxy.ts to run on /api, which QA's N4 pin and #1434 forbid today; that is a separate decision, listed on #1413. */

export const MAX_API_BODY_BYTES = 1_000_000;

/** The body as text, or null when it is larger than `maxBytes` (declared or actually streamed). */
export async function readCappedText(req: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel().catch(() => {}); return null; }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

/** Per-route caps (bytes), chosen from each route's own text limits at the worst case of 4 bytes a character, rounded up (security audit #1413, PM). */
export const BODY_CAPS = {
  settings: 65_536,          // strategy_params and a watchlist are a few KB; 64 KB is generous
  priceAlerts: 4_096,        // coin, price, direction, a 200-char note
  hypothesis: 65_536,        // title 300 + hypothesis 4000 + 10 criteria of 500, at 4 bytes a character
  evidence: 32_768,          // content 4000 + source 2000
  alertPrefs: 4_096,         // { key, muted }
  pushSubscribe: 8_192,      // endpoint 2048 + two keys
  aiShort: 32_768,           // strategy-research description (4000 chars)
  aiThesis: 65_536,          // thesis 4000 + 20 assumptions of 500
  aiPine: 131_072,           // description 4000 + analysis 20000 chars
} as const;

/** Reads and parses a JSON body with a size cap. `tooLarge` when over the cap (declared or streamed); `value` is null when the body is empty or not valid JSON. */
export async function readJsonCapped(req: Request, maxBytes: number): Promise<{ tooLarge: boolean; value: unknown }> {
  const text = await readCappedText(req, maxBytes);
  if (text === null) return { tooLarge: true, value: null };
  try { return { tooLarge: false, value: JSON.parse(text) }; } catch { return { tooLarge: false, value: null }; }
}
