/* THE DRY-POWDER AI TEXT IS WRITTEN ONCE A DAY BY THE SERVER, NOT BY THE FIRST VISITOR (PM, 2026-11-19, #1651 L103: /research as Pro showed "Preparing the AI read" for about 21 s on every first
 * visit, because the first request of the hour paid for the AI call).
 *
 * The text describes the stablecoin supply figures, which are the same for everyone and move once a day, so one call a day serves every Pro visit: the scheduled market ingest
 * (app/api/market/ingest, every five minutes, CRON_SECRET) calls `ensureDryPowderAnalysis`, which does nothing when today's text is stored and writes it once after the source has
 * updated (02:00 UTC), and /api/dry-powder only READS the stored row (lhq_market_snapshot, key `dry-powder-analysis`). A Pro visit spends nothing and waits for nothing. Same spend as
 * before at its best (one call a day); the old per-visitor usage reservation is gone because no visitor triggers the call any more.
 *
 * COST STAYS IN THE OWNER'S LEDGER (PM audit): the call is logged to ai_call_log with user_id null and source 'system:dry-powder' (migration 20261121a). The per-user dollar cap reads `where user_id = p`,
 * so it never counts these rows; the site-wide sum counts them, as it should. THE VISITOR PATH NEVER CALLS xAI: only the scheduled ingest does, under a claim row that makes a second ingest instance skip (the row is read, then written: not an atomic insert, so two instances reading in the same instant could both call, one extra call a day at worst; the ingest has one scheduler caller). */
import { readSnapshot, writeSnapshot } from './marketSnapshot.ts';
import { getDryPowderNumbers } from './dryPowderSeries.ts';
import { xaiFetch } from './xai.ts';
import { reportHealth } from './apiHealth.ts';
import { recordAiCall } from './aiCallLog.ts';

export const DRY_POWDER_ANALYSIS_KEY = 'dry-powder-analysis';
/** The claim row: written before the AI call, so a second ingest instance that reads it fresh does not call too. */
export const DRY_POWDER_LOCK_KEY = 'dry-powder-analysis-lock';
export const DRY_POWDER_LOCK_MS = 10 * 60_000;
/** The source (DeFi Llama) has posted the day's point well before this UTC hour; before it the previous day's text stands. */
export const DRY_POWDER_REFRESH_HOUR_UTC = 2;
/** A stored text older than this is not served as current (the day's refresh has been failing). */
export const DRY_POWDER_MAX_AGE_MS = 36 * 60 * 60_000;
/** After a failed attempt this instance waits before trying again, so a down provider is not asked every five minutes. */
const RETRY_AFTER_FAIL_MS = 30 * 60_000;
const ANALYSIS_TIMEOUT_MS = 25_000;

export interface StoredDryPowderAnalysis { day: string; analysis: string; current: number; prev30: number; prev90: number; generatedAt: number }

export function buildDryPowderPrompt(current: number, prev30: number, prev90: number): string {
  const chg30 = ((current - prev30) / prev30 * 100).toFixed(1);
  const chg90 = ((current - prev90) / prev90 * 100).toFixed(1);
  return [
    'You are a crypto market liquidity analyst. Analyze the following stablecoin supply data from DeFi Llama and write a short factual summary of it.',
    '',
    'STABLECOIN SUPPLY DATA:',
    `Current total stablecoin market cap: $${(current / 1e9).toFixed(1)}B`,
    `30 days ago: $${(prev30 / 1e9).toFixed(1)}B (${chg30}% change)`,
    `90 days ago: $${(prev90 / 1e9).toFixed(1)}B (${chg90}% change)`,
    '',
    'Rules: state only what the numbers show. No price predictions, no advice, no words like bullish or bearish, no "dry powder" framing, no things to watch.',
    '',
    'Output using EXACTLY these headers:',
    'SIGNAL:',
    '[One of: EXPANDING, CONTRACTING, or NEUTRAL - followed by a colon and a one-sentence reason on the same line, stating the 30-day change]',
    'NARRATIVE:',
    '[2-3 sentences stating how total stablecoin supply changed over the last 30 and 90 days, using the figures above]',
    'KEY_LEVEL:',
    '[The supply 30 days ago and 90 days ago as dollar figures only, for example: 30d ago $X.XB, 90d ago $Y.YB]',
  ].join('\n');
}

const isStored = (p: unknown): p is StoredDryPowderAnalysis => {
  const o = p as Partial<StoredDryPowderAnalysis> | null;
  return !!o && typeof o.day === 'string' && typeof o.analysis === 'string' && o.analysis.trim().length > 0 && typeof o.generatedAt === 'number';
};

/** The stored text, or null when there is none or it is too old to call current. Never throws. */
export async function readDryPowderAnalysis(nowMs = Date.now()): Promise<StoredDryPowderAnalysis | null> {
  const snap = await readSnapshot(DRY_POWDER_ANALYSIS_KEY);
  if (!snap || !isStored(snap.payload)) return null;
  return nowMs - snap.payload.generatedAt <= DRY_POWDER_MAX_AGE_MS ? snap.payload : null;
}

/** True when a new text should be written now: none stored, or today's not stored yet and the source has had time to post the day's point. */
export function dryPowderRefreshDue(stored: StoredDryPowderAnalysis | null, nowMs: number): boolean {
  if (!stored) return true;
  const now = new Date(nowMs);
  return stored.day !== now.toISOString().slice(0, 10) && now.getUTCHours() >= DRY_POWDER_REFRESH_HOUR_UTC;
}

type EnsureResult = 'fresh' | 'generated' | 'failed' | 'skipped';
let lastFailAt = 0;
let inflight: Promise<EnsureResult> | null = null;

/** Writes today's text when it is due. Safe to call often (a cheap read when nothing is due) and never throws. */
export function ensureDryPowderAnalysis(nowMs = Date.now()): Promise<EnsureResult> {
  inflight ??= (async (): Promise<EnsureResult> => {
    try {
      const stored = await readDryPowderAnalysis(nowMs);
      if (!dryPowderRefreshDue(stored, nowMs)) return 'fresh';
      if (nowMs - lastFailAt < RETRY_AFTER_FAIL_MS) return 'skipped';
      const key = process.env.GROK_API_KEY ?? '';
      if (!key) return 'skipped';
      const lock = await readSnapshot(DRY_POWDER_LOCK_KEY);
      const lockAt = (lock?.payload as { at?: number } | null)?.at;
      if (typeof lockAt === 'number' && nowMs - lockAt < DRY_POWDER_LOCK_MS) return 'skipped';
      await writeSnapshot(DRY_POWDER_LOCK_KEY, { at: nowMs }, 'lock');
      const { current, prev30, prev90 } = await getDryPowderNumbers();
      const res = await xaiFetch('https://api.x.ai/v1/chat/completions', {
        signal: AbortSignal.timeout(ANALYSIS_TIMEOUT_MS),
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: 'grok-4.3', messages: [{ role: 'user', content: buildDryPowderPrompt(current, prev30, prev90) }], max_tokens: 350 }),
      });
      if (!res.ok) throw new Error(`xAI ${res.status}`);
      const data = await res.json() as { choices?: Array<{ message?: { content?: string } }>; model?: string; usage?: unknown };
      /* A 2xx is billed from here: the cost goes to the ledger whatever the text turns out to be. */
      await recordAiCall({ userId: null, source: 'system:dry-powder', callType: 'dry_powder', model: data.model ?? 'grok-4.3', usage: data.usage });
      const analysis = (data.choices?.[0]?.message?.content ?? '').trim();
      if (!analysis) throw new Error('empty analysis');
      const row: StoredDryPowderAnalysis = { day: new Date(nowMs).toISOString().slice(0, 10), analysis, current, prev30, prev90, generatedAt: nowMs };
      await writeSnapshot(DRY_POWDER_ANALYSIS_KEY, row, 'xai');
      reportHealth('xai:dry-powder', 'market', true, 'daily analysis written');
      return 'generated';
    } catch (e) {
      lastFailAt = nowMs;
      reportHealth('xai:dry-powder', 'market', false, (e instanceof Error ? e.message : String(e)).slice(0, 200));
      return 'failed';
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
