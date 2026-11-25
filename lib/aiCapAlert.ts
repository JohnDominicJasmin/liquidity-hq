// SERVER ONLY. Emails the owner the first time each UTC day that a site-wide AI cap starts refusing calls (#1632).
//
// A cap that blocks silently is found by a user. Once per day per cap: an in-process mark stops a burst of refused requests from sending a burst of
// mail, and a mark in app_config keeps a restart or a second instance from sending it again. Never throws, and a caller never waits on it.
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { sendAiCapAlertEmail } from '@/lib/email';

/** `global_free`: free and trial reached their share of the daily call cap. `global`: the whole daily call cap. `fuse`: the daily dollar fuse. */
export type AiCapKind = 'global_free' | 'global' | 'fuse';

const STATE_KEY = 'ai_cap_alert_state';
/** After a send that did not go out, the next attempt waits this long. */
const RETRY_MS = 10 * 60_000;

const done = new Map<AiCapKind, string>();
const tryAfter = new Map<AiCapKind, number>();

export async function alertAiCapTrip(kind: AiCapKind, nowMs: number = Date.now()): Promise<void> {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  if (done.get(kind) === day || nowMs < (tryAfter.get(kind) ?? 0)) return;
  if (!process.env.BREVO_API_KEY || !process.env.BREVO_SENDER_EMAIL) return; // mail not configured: nothing to send, nothing to read
  tryAfter.set(kind, nowMs + RETRY_MS);
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.from(T.app_config).select('value').eq('key', STATE_KEY).maybeSingle();
    const state = ((!error && data?.value) || {}) as Partial<Record<AiCapKind, string>>;
    if (state[kind] === day) { done.set(kind, day); return; }
    if (!(await sendAiCapAlertEmail({ kind, day }))) return;
    done.set(kind, day);
    await admin.from(T.app_config).upsert({ key: STATE_KEY, value: { ...state, [kind]: day } }, { onConflict: 'key' });
  } catch (e) {
    console.warn('[aiCapAlert] alert failed:', e instanceof Error ? e.message : e);
  }
}
