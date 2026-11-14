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
