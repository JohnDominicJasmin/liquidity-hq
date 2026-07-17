'use client';
import { useEffect, useState, useCallback } from 'react';
import { getSupabase } from '@/lib/supabase';
import Tip from './Tip';

interface MacroData {
  dxy: number;  dxyChg: number;
  vix: number;  vixChg: number;
  gold: number; goldChg: number;
  oil: number;  oilChg: number;
  tnx: number;  tnxChg: number;
  goldOilRatio: number;
  signal:       string;
  analysis:     string;
  implications: string;
  watchLevel:   string;
}

const CACHE_KEY = 'lhq_macro_context';
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

type LoadState = MacroData | null | 'loading' | 'error' | 'unauth';

const SIGNAL_META: Record<string, { col: string; bg: string; bdr: string; label: string }> = {
  RISK_ON:  { col: '#34d399', bg: 'rgba(52,211,153,0.10)',  bdr: 'rgba(52,211,153,0.3)',  label: 'Risk On'  },
  RISK_OFF: { col: '#f87171', bg: 'rgba(248,113,113,0.10)', bdr: 'rgba(248,113,113,0.3)', label: 'Risk Off' },
  NEUTRAL:  { col: '#fbbf24', bg: 'rgba(251,191,36,0.10)',  bdr: 'rgba(251,191,36,0.3)',  label: 'Neutral'  },
};

function parseMacroSection(text: string, key: string): string {
  const keys = ['MACRO_SIGNAL', 'MACRO_ANALYSIS', 'CRYPTO_IMPLICATIONS', 'WATCH_LEVEL'];
  const regex = new RegExp(key + ':\\s*([\\s\\S]*?)(?=' + keys.join(':|') + ':|$)');
  return (text.match(regex)?.[1] ?? '').trim();
}

function chgColor(chg: number, invertBullish = false) {
  const pos = invertBullish ? chg < 0 : chg > 0;
  if (Math.abs(chg) < 0.05) return 'var(--txt3)';
  return pos ? '#34d399' : '#f87171';
}

function chgStr(chg: number) {
  return (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
}

export default function GlobalMacroContext() {
  const [state,  setState]  = useState<LoadState>('loading');
  const [errMsg, setErrMsg] = useState('');

  const fetchData = useCallback(async () => {
    setState('loading');
    try {
      const db    = getSupabase();
      const token = db ? (await db.auth.getSession()).data.session?.access_token : undefined;
      if (!token) { setState('unauth'); return; }

      const res  = await fetch('/api/macro-context', { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json() as {
        dxy?: number; dxyChg?: number; vix?: number; vixChg?: number;
        gold?: number; goldChg?: number; oil?: number; oilChg?: number;
        tnx?: number; tnxChg?: number; goldOilRatio?: number;
        analysis?: string; error?: string;
      };

      if (!res.ok) { setErrMsg(json.error ?? 'Failed'); setState('error'); return; }

      const text = json.analysis ?? '';
      const signal      = parseMacroSection(text, 'MACRO_SIGNAL').replace(/[^A-Z_]/g, '');
      const analysis    = parseMacroSection(text, 'MACRO_ANALYSIS');
      const implications = parseMacroSection(text, 'CRYPTO_IMPLICATIONS');
      const watchLevel  = parseMacroSection(text, 'WATCH_LEVEL');

      const data: MacroData = {
        dxy:  json.dxy  ?? 0, dxyChg:  json.dxyChg  ?? 0,
        vix:  json.vix  ?? 0, vixChg:  json.vixChg  ?? 0,
        gold: json.gold ?? 0, goldChg: json.goldChg ?? 0,
        oil:  json.oil  ?? 0, oilChg:  json.oilChg  ?? 0,
        tnx:  json.tnx  ?? 0, tnxChg:  json.tnxChg  ?? 0,
        goldOilRatio: json.goldOilRatio ?? 0,
        signal, analysis, implications, watchLevel,
      };
      setState(data);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch { /* ignore */ }
    } catch (e) {
      setErrMsg(String(e));
      setState('error');
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const { ts, data } = JSON.parse(raw) as { ts: number; data: MacroData };
        if (Date.now() - ts < CACHE_TTL) { setState(data); return; }
      }
    } catch { /* ignore */ }
    fetchData();
  }, [fetchData]);

  const signalKey = typeof state === 'object' && state !== null
    ? (state.signal.match(/^(RISK_ON|RISK_OFF|NEUTRAL)/)?.[1] ?? 'NEUTRAL')
    : 'NEUTRAL';
  const sm = SIGNAL_META[signalKey] ?? SIGNAL_META.NEUTRAL;

  return (
    <div style={{ padding: '12px 14px' }}>
      <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--txt3)', marginBottom: 4 }}>
        <Tip width={320} text="Live DXY, VIX, Gold, Oil, and 10Y Treasury data from Yahoo Finance. Grok classifies the composite macro backdrop and gives crypto positioning implications. Updates every 2 hours.">
          Global Macro Context
        </Tip>
      </div>

      {state === 'loading' && (
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', padding: '10px 0' }}>Fetching macro data…</div>
      )}
      {state === 'unauth' && (
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', padding: '8px 0' }}>Sign in to view macro context.</div>
      )}
      {state === 'error' && (
        <div style={{ padding: '8px 0' }}>
          <div style={{ fontSize: 'var(--fs-caption)', color: '#f87171', marginBottom: 6 }}>{errMsg}</div>
          <button onClick={fetchData} style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', background: 'transparent', border: '0.5px solid var(--bdr)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' }}>Retry</button>
        </div>
      )}

      {typeof state === 'object' && state !== null && (() => {
        const d = state;
        const rows: { label: string; value: string; chg: number; invertBullish?: boolean }[] = [
          { label: 'DXY',       value: d.dxy.toFixed(2),  chg: d.dxyChg,  invertBullish: true },
          { label: 'VIX',       value: d.vix.toFixed(1),  chg: d.vixChg,  invertBullish: true },
          { label: 'Gold',      value: '$' + d.gold.toLocaleString('en-US', { maximumFractionDigits: 0 }), chg: d.goldChg },
          { label: 'Oil (WTI)', value: '$' + d.oil.toFixed(1),  chg: d.oilChg  },
          { label: '10Y Yield', value: d.tnx.toFixed(2) + '%',  chg: d.tnxChg, invertBullish: true },
          { label: 'Gold/Oil',  value: d.goldOilRatio.toFixed(1) + 'x', chg: 0 },
        ];
        return (
          <>
            {/* Signal badge */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, marginBottom: 8, background: sm.bg, border: `0.5px solid ${sm.bdr}` }}>
              <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 800, color: sm.col, letterSpacing: '0.05em' }}>{sm.label}</span>
            </div>

            {/* Data grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px 8px', marginBottom: 10 }}>
              {rows.map(r => (
                <div key={r.label} style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 1 }}>{r.label}</span>
                  <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--txt)', fontFamily: 'var(--font-mono), monospace' }}>{r.value}</span>
                  {r.chg !== 0 && (
                    <span style={{ fontSize: 'var(--fs-caption)', color: chgColor(r.chg, r.invertBullish), fontFamily: 'var(--font-mono), monospace' }}>{chgStr(r.chg)}</span>
                  )}
                </div>
              ))}
            </div>

            {/* Analysis */}
            {d.analysis && (
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', lineHeight: 1.55, marginBottom: 8 }}>
                {d.analysis}
              </div>
            )}

            {/* Crypto implications */}
            {d.implications && (
              <div style={{ borderTop: '0.5px solid var(--bdr)', paddingTop: 7, marginBottom: 6 }}>
                <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--txt3)', marginBottom: 4 }}>Crypto Implications</div>
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{d.implications}</div>
              </div>
            )}

            {/* Watch level */}
            {d.watchLevel && (
              <div style={{ borderTop: '0.5px solid var(--bdr)', paddingTop: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', fontWeight: 600 }}>Watch: </span>
                <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{d.watchLevel}</span>
              </div>
            )}

            <button onClick={fetchData} style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
              Refresh (2h cache)
            </button>
          </>
        );
      })()}
    </div>
  );
}
