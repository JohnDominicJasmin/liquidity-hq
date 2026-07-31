// SERVER ONLY. Pulls in lib/apiHealth, which pulls in supabase-admin and the
// service-role key - never import this from a client component.
//
// The one place the app notices xAI stopping. It deliberately does NOT live in
// lib/grok.ts: that module is imported by Arena, KLineProChart, UsageRings and
// GrokUsageProvider, so anything it imports lands in a client bundle.
//
// The failure this exists for has already happened - a credit outage in July
// 2026 that was found by going looking, not by being told. That arrives as a
// non-2xx, which is why transport status is the signal worth having and why
// every caller already throws on it.
//
// Known limit: a 2xx carrying empty text still counts as healthy. Judging that
// would mean parsing each endpoint's differently-shaped body in here, and the
// callers already check their own parse results. This answers "is xAI
// answering us", not "was the answer any good".
import { reportHealth, healthError } from '@/lib/apiHealth';

const XAI_SOURCE = 'xai:grok';

/**
 * Drop-in replacement for `fetch` against api.x.ai. Returns the Response
 * untouched and rethrows transport errors, so existing `if (!res.ok)` handling
 * at every call site keeps working exactly as before.
 */
export async function xaiFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    const res = await fetch(url, init);
    reportHealth(XAI_SOURCE, 'ai', res.ok, res.ok ? 'ok' : `HTTP ${res.status}`);
    return res;
  } catch (e) {
    reportHealth(XAI_SOURCE, 'ai', false, healthError(e));
    throw e;
  }
}
