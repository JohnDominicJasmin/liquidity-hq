/* The stablecoin supply series behind /api/dry-powder, kept apart from the AI text so the numbers can be answered on their own (#research slow: the card waited ~20 s because the series read and the AI call ran
 * one after the other behind a single one-hour cache). DeFi Llama's series only moves once a day, so it is cached for a day, and the server warms it at start (instrumentation.ts) so the first visitor does not pay for it. */
import { cached } from './apiCache.ts';

export const DRY_POWDER_SERIES_TTL_MS = 24 * 60 * 60_000;

interface LlamaEntry { date: string; totalCirculatingUSD: Record<string, number> }

async function fetchStablecoinSeries(): Promise<number[]> {
  const res = await fetch('https://stablecoins.llama.fi/stablecoincharts/all', {
    headers: { 'User-Agent': 'LiquidityHQ/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`DeFi Llama ${res.status}`);
  const data = (await res.json()) as LlamaEntry[];
  return data.slice(-91).map(d => d.totalCirculatingUSD?.peggedUSD ?? 0);
}

export interface DryPowderNumbers { current: number; prev30: number; prev90: number; series: number[] }

/** The last 91 daily totals reduced to the figures the card shows. Throws 'Insufficient stablecoin data' when the series is too short to read a 30-day change. */
export async function getDryPowderNumbers(): Promise<DryPowderNumbers> {
  /* failTtlMs: a DeFi Llama outage is held for a minute instead of every card refetching a multi-MB body it cannot get. */
  const series = await cached('dry-powder-series', DRY_POWDER_SERIES_TTL_MS, fetchStablecoinSeries, { failTtlMs: 60_000 });
  if (series.length < 32) throw new Error('Insufficient stablecoin data');
  return {
    current: series[series.length - 1],
    prev30: series[Math.max(0, series.length - 31)],
    prev90: series[0],
    series: series.slice(-30),
  };
}

/** Fills the series cache at server start. Never throws. */
export function warmDryPowderSeries(): void {
  void getDryPowderNumbers().catch(() => { /* a cold cache is only slower */ });
}
