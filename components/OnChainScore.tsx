'use client';
import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { LockedFeatureCard } from './UpgradeGateModal';
import { useMarket } from '@/lib/marketStore';
import { getSupabase } from '@/lib/supabase';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';

interface OnChainData {
  mvrv: number | null;
  mvrv_source: string;
  sopr: number | null;
  sopr_source: string;
  nvt: number | null;
  nvt_source: string;
  exchange_flow: 'INFLOW' | 'OUTFLOW' | 'NEUTRAL';
  exchange_flow_note: string;
  active_addresses: number | null;
  valuation_score: number;
  activity_score: number;
  capital_flow_score: number;
  whale_score: number;
  composite_score: number;
  verdict: 'BULLISH' | 'NEUTRAL' | 'BEARISH';
  verdict_reasoning: string;
  timestamp: string;
}

const CACHE_KEY = 'lhq_onchain_cache';
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

function loadCache(): OnChainData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw) as { data: OnChainData; ts: number };
    if (Date.now() - ts > CACHE_TTL) return null;
    return data;
  } catch { return null; }
}

function saveCache(data: OnChainData) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() })); } catch {}
}

function ScoreBar({ value, label, weight }: { value: number; label: string; weight: string }) {
  const col = value >= 65 ? 'var(--green-2)' : value <= 40 ? 'var(--red)' : 'var(--amber)';
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: 'var(--fs-micro)', fontWeight: 600, color: 'var(--txt)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {label}
        </span>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{weight}</span>
          <span style={{ fontSize: 'var(--fs-data)', fontWeight: 800, color: col, fontFamily: 'var(--font-mono)' }}>{value}</span>
        </span>
      </div>
      <div style={{ height: 4, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${value}%`, background: col, borderRadius: 2, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  );
}

function MetricPill({ label, value, source }: { label: string; value: number | null; source?: string }) {
  const { t } = useLabels();
  return (
    <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', display: 'flex', gap: 4, alignItems: 'center' }}>
      <span style={{ color: 'var(--txt)', fontWeight: 600 }}>{label}:</span>
      <span style={{ fontFamily: 'var(--font-mono)' }}>
        {value !== null ? value.toFixed(2) : '-'}
      </span>
      {source && <span style={{ opacity: 0.5 }}>{t('ON_CHAIN_SCORE_METRIC_VIA', { source })}</span>}
    </div>
  );
}

export default function OnChainScore() {
  const { t } = useLabels();
  const router = useRouter();
  const { user, entitled, loading: authLoading } = useAuth();
  const { store } = useMarket();
  const btcPrice = store.coins['btc']?.price ?? 0;

  const [data, setData] = useState<OnChainData | null>(() => loadCache());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const analyze = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const sb = getSupabase();
      const session = sb ? (await sb.auth.getSession()).data.session : null;
      const token = session?.access_token ?? '';

      const res = await fetch(`/api/onchain?price=${btcPrice}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({})) as { error?: string };
        // Sentinel, not a message. Anything the server actually said is passed
        // through verbatim; REQUEST_FAILED means it said nothing useful and the
        // render path should supply the wording. Keeping t() out of here is
        // what lets this callback declare its dependencies honestly - it could
        // not include `t`, so the strings it built were stuck in whichever
        // language was active on first render.
        throw new Error(e.error ?? 'REQUEST_FAILED');
      }
      const result = await res.json() as OnChainData;
      setData(result);
      saveCache(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'FETCH_ERROR');
    } finally {
      setLoading(false);
    }
  }, [user, btcPrice]);

  const verdictCol = data?.verdict === 'BULLISH' ? 'var(--green-2)' : data?.verdict === 'BEARISH' ? 'var(--red)' : 'var(--amber)';
  const compositeCol = (data?.composite_score ?? 50) >= 65 ? 'var(--green-2)' : (data?.composite_score ?? 50) <= 40 ? 'var(--red)' : 'var(--amber)';

  const flowIcon = data?.exchange_flow === 'OUTFLOW' ? '↓' : data?.exchange_flow === 'INFLOW' ? '↑' : '→';
  const flowCol = data?.exchange_flow === 'OUTFLOW' ? 'var(--green-2)' : data?.exchange_flow === 'INFLOW' ? 'var(--red)' : 'var(--amber)';

  return (
    <div style={{
      background: 'var(--bg2)',
      border: '0.5px solid var(--bdr)',
      borderRadius: 10,
      overflow: 'hidden',
      marginBottom: 12,
    }}>
      {!authLoading && !entitled ? (
        <div style={{ padding: '10px 14px' }}>
          <LockedFeatureCard
            title={t('ON_CHAIN_SCORE_TITLE')}
            description={t('ON_CHAIN_SCORE_LOCKED_DESC')}
            onUnlock={() => router.push('/upgrade')}
          />
        </div>
      ) : (
      <>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '0.5px solid var(--bdr)',
      }}>
        <div>
          <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--txt)' }}>{t('ON_CHAIN_SCORE_TITLE')}</div>
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginTop: 1 }}>
            {data
              ? t('ON_CHAIN_SCORE_UPDATED', { time: new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
              : t('ON_CHAIN_SCORE_SUBTITLE')}
          </div>
        </div>
        <button
          onClick={analyze}
          disabled={loading || !user}
          style={{
            background: loading ? 'rgba(26,122,255,0.15)' : 'rgba(26,122,255,0.2)',
            border: '0.5px solid rgba(26,122,255,0.4)',
            borderRadius: 6,
            padding: '5px 11px',
            fontSize: 'var(--fs-caption)',
            fontWeight: 700,
            color: 'var(--accent)',
            cursor: loading || !user ? 'default' : 'pointer',
            opacity: !user ? 0.5 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          {loading ? t('ON_CHAIN_SCORE_ANALYZING') : data ? t('ON_CHAIN_SCORE_REANALYZE') : t('ON_CHAIN_SCORE_ANALYZE')}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: '8px 14px', fontSize: 'var(--fs-caption)', color: 'var(--red)', background: 'rgba(248,113,113,0.06)' }}>
          {/* The two sentinels set by the fetch above resolve to labels here;
              anything else is a real message from the server and is shown as-is. */}
          {error === 'REQUEST_FAILED' ? t('ON_CHAIN_SCORE_REQUEST_FAILED')
            : error === 'FETCH_ERROR' ? t('ON_CHAIN_SCORE_FETCH_ERROR')
            : error}
        </div>
      )}

      {!data && !loading && (
        <div style={{ padding: '20px 14px', textAlign: 'center', color: 'var(--txt3)', fontSize: 'var(--fs-caption)' }}>
          {t('ON_CHAIN_SCORE_EMPTY_STATE')}
        </div>
      )}

      {loading && (
        <div style={{ padding: '12px 14px' }} role="status" aria-live="polite">
          <span className="sr-only">{t('ON_CHAIN_SCORE_LOADING_SR')}</span>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14,
            padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8,
            border: '0.5px solid var(--bdr)',
          }}>
            <SkeletonBar width={52} height={32} radius={6} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <SkeletonBar width="35%" height={11} radius={4} style={{ marginBottom: 6 }} />
              <SkeletonBar width="85%" height={10} radius={4} />
            </div>
          </div>
          {[0, 1, 2, 3].map(i => (
            <SkeletonBar key={i} height={10} radius={4} style={{ marginBottom: 10, opacity: 1 - i * 0.1 }} />
          ))}
        </div>
      )}

      {data && !loading && (
        <div style={{ padding: '12px 14px' }}>
          {/* Composite score + verdict */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            marginBottom: 14,
            padding: '10px 12px',
            background: 'rgba(255,255,255,0.03)',
            borderRadius: 8,
            border: '0.5px solid var(--bdr)',
          }}>
            <div style={{ textAlign: 'center', minWidth: 52 }}>
              <div style={{
                fontSize: '1.75rem',
                fontWeight: 900,
                fontFamily: 'var(--font-mono)',
                color: compositeCol,
                lineHeight: 1,
              }}>
                {data.composite_score}
              </div>
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginTop: 2, letterSpacing: '0.06em' }}>/ 100</div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 'var(--fs-caption)',
                fontWeight: 800,
                color: verdictCol,
                marginBottom: 4,
                letterSpacing: '0.04em',
              }}>
                {data.verdict}
              </div>
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', lineHeight: 1.5 }}>
                {data.verdict_reasoning}
              </div>
            </div>
          </div>

          {/* Sub-scores */}
          <ScoreBar value={data.valuation_score}    label={t('ON_CHAIN_SCORE_VALUATION')}     weight="30%" />
          <ScoreBar value={data.activity_score}     label={t('ON_CHAIN_SCORE_ACTIVITY')}      weight="25%" />
          <ScoreBar value={data.capital_flow_score} label={t('ON_CHAIN_SCORE_CAPITAL_FLOW')}  weight="25%" />
          <ScoreBar value={data.whale_score}        label={t('ON_CHAIN_SCORE_WHALE')}         weight="20%" />

          {/* Raw metrics */}
          <div style={{
            marginTop: 12,
            paddingTop: 10,
            borderTop: '0.5px solid var(--bdr)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}>
            <MetricPill label={t('ON_CHAIN_SCORE_MVRV')} value={data.mvrv} source={data.mvrv_source} />
            <MetricPill label={t('ON_CHAIN_SCORE_SOPR')} value={data.sopr} source={data.sopr_source} />
            <MetricPill label={t('ON_CHAIN_SCORE_NVT')}  value={data.nvt}  source={data.nvt_source}  />
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ color: 'var(--txt)', fontWeight: 600 }}>{t('ON_CHAIN_SCORE_EXCHANGE_FLOW_LABEL')}:</span>
              <span style={{ color: flowCol, fontWeight: 700 }}>{flowIcon} {data.exchange_flow}</span>
              <span style={{ opacity: 0.6 }}>- {data.exchange_flow_note}</span>
            </div>
            {data.active_addresses && (
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>
                <span style={{ color: 'var(--txt)', fontWeight: 600 }}>{t('ON_CHAIN_SCORE_ACTIVE_ADDRESSES_LABEL')}:</span>{' '}
                <span style={{ fontFamily: 'var(--font-mono)' }}>{data.active_addresses.toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
