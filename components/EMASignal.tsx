'use client';
import { StrategySignal, StrategyVerdict } from '@/lib/useEMAStrategy';
import { CoinId } from '@/lib/marketStore';

const VERDICT_CONFIG: Record<StrategyVerdict, { label: string; color: string; bg: string; border: string }> = {
  LONG_SETUP:     { label: '▲ LONG SETUP',     color: '#34d399', bg: 'rgba(52,211,153,0.08)',  border: 'rgba(52,211,153,0.25)'  },
  SHORT_SETUP:    { label: '▼ SHORT SETUP',    color: '#f87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.25)' },
  TRENDING_LONG:  { label: '↗ TRENDING LONG',  color: '#86efac', bg: 'rgba(134,239,172,0.06)', border: 'rgba(134,239,172,0.2)'  },
  TRENDING_SHORT: { label: '↘ TRENDING SHORT', color: '#fca5a5', bg: 'rgba(252,165,165,0.06)', border: 'rgba(252,165,165,0.2)'  },
  FREEZE:         { label: '⏸ FREEZE',          color: '#6b7280', bg: 'rgba(107,114,128,0.06)', border: 'rgba(107,114,128,0.2)'  },
  LOADING:        { label: '…',                 color: '#555',    bg: 'transparent',             border: 'transparent'            },
};

function fmt(n: number | null, decimals = 2): string {
  if (n == null || isNaN(n)) return '—';
  if (n >= 10000)  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n >= 100)    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1)      return n.toFixed(Math.max(decimals, 3));
  if (n >= 0.001)  return n.toFixed(6);
  return n.toFixed(8);
}

function fireExplain(prompt: string, coin: CoinId) {
  window.dispatchEvent(new CustomEvent('grok-chat', { detail: { coin, prompt } }));
}

function buildSignalPrompt(signal: StrategySignal, coin: CoinId, tf: string, cfg: { label: string }): string {
  const passing = signal.conditions.filter(c => c.pass === true);
  const failing  = signal.conditions.filter(c => c.pass === false);
  const condLines = [
    ...passing.map(c => `  ✓ ${c.label}: ${c.detail}`),
    ...failing.map(c  => `  ✗ ${c.label}: ${c.detail}`),
  ].join('\n');
  const sltp = signal.sl && signal.tp
    ? `Stop loss: $${fmt(signal.sl)} · Take profit: $${fmt(signal.tp)}`
    : '';

  return [
    `Explain this ${coin.toUpperCase()} trading signal to me like I'm a beginner. Use plain English — no jargon.`,
    '',
    `Coin: ${coin.toUpperCase()} · Timeframe: ${tf.toUpperCase()}`,
    `Signal: ${cfg.label}`,
    `What's happening: ${signal.phase}`,
    `Conditions: ${passing.length} passing, ${failing.length} failing out of ${signal.conditions.length}`,
    condLines,
    sltp,
    '',
    'Answer these 3 things simply:',
    '1. What is this signal actually telling me about the market right now?',
    '2. Should I buy, sell, or wait — and exactly why?',
    '3. What would need to change for this to become a clear entry?',
  ].filter(Boolean).join('\n');
}

function buildConditionPrompt(label: string, pass: boolean | null, detail: string, coin: CoinId, tf: string): string {
  const status = pass === true ? 'PASSING' : pass === false ? 'FAILING' : 'NOT YET RELEVANT';
  return [
    `Explain the "${label}" condition to me in plain English. I'm new to trading — avoid jargon.`,
    '',
    `Coin: ${coin.toUpperCase()} · Timeframe: ${tf.toUpperCase()}`,
    `Status: ${status}`,
    `Current value: ${detail}`,
    '',
    'Answer these 3 things:',
    `1. What does "${label}" mean in simple terms?`,
    '2. Why does this condition matter before entering a trade?',
    `3. What does the current status (${status.toLowerCase()}) tell me — should I act or wait?`,
  ].join('\n');
}

interface Props { signal: StrategySignal; tf?: string; coin?: CoinId }

export default function EMASignal({ signal, tf = '4h', coin }: Props) {
  const v   = signal.verdict;
  const cfg = VERDICT_CONFIG[v];
  const isSetup = v === 'LONG_SETUP' || v === 'SHORT_SETUP';
  const canExplain = coin && !signal.loading && signal.verdict !== 'LOADING';

  return (
    <div style={{
      background: 'var(--bg1)',
      border: '0.5px solid var(--bdr)',
      borderRadius: 10,
      padding: '12px 14px',
      marginBottom: 10,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 3 }}>
            EMA Ribbon Strategy
          </div>
          <div style={{ fontSize: 10, color: '#444' }}>
            3 moving averages (fast/mid/slow) · {tf.toUpperCase()} chart · daily trend filter
          </div>
        </div>
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '.04em',
          padding: '4px 12px', borderRadius: 20,
          color: cfg.color, background: cfg.bg, border: `0.5px solid ${cfg.border}`,
          whiteSpace: 'nowrap',
        }}>
          {signal.loading ? '…' : cfg.label}
        </span>
      </div>

      {/* Phase */}
      {!signal.loading && signal.verdict !== 'LOADING' && (
        <div style={{ fontSize: 12, color: 'var(--txt2)', marginBottom: 10, lineHeight: 1.4 }}>
          {signal.phase}
        </div>
      )}

      {/* Conditions grid — each chip clickable to explain */}
      {signal.conditions.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 5,
          marginBottom: isSetup ? 10 : 0,
        }}>
          {signal.conditions.map((c, i) => {
            const pass = c.pass;
            const col  = pass === true ? '#34d399' : pass === false ? '#f87171' : '#555';
            const bg   = pass === true ? 'rgba(52,211,153,0.07)' : pass === false ? 'rgba(248,113,113,0.07)' : 'rgba(255,255,255,0.02)';
            const icon = pass === true ? '✓' : pass === false ? '✗' : '—';
            return (
              <div
                key={i}
                title={canExplain ? `Click to explain "${c.label}" in plain English` : c.detail}
                onClick={canExplain ? () => fireExplain(buildConditionPrompt(c.label, c.pass, c.detail, coin!, tf), coin!) : undefined}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 8px', borderRadius: 6,
                  background: bg, border: `0.5px solid ${col}22`,
                  cursor: canExplain ? 'pointer' : 'default',
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={e => { if (canExplain) (e.currentTarget as HTMLDivElement).style.opacity = '0.75'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.opacity = '1'; }}
              >
                <span style={{ fontSize: 11, fontWeight: 700, color: col, flexShrink: 0 }}>{icon}</span>
                <span style={{ fontSize: 11, color: pass === null ? '#444' : 'var(--txt2)', lineHeight: 1.2 }}>
                  {c.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* SL / TP — only for actionable setups */}
      {isSetup && signal.sl && signal.tp && (
        <div style={{
          display: 'flex', gap: 8, flexWrap: 'wrap',
          padding: '8px 10px',
          background: 'rgba(255,255,255,0.02)',
          border: '0.5px solid var(--bdr)',
          borderRadius: 7,
        }}>
          <span style={{ fontSize: 11, color: 'var(--txt3)', marginRight: 4 }}>Levels:</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#f87171' }}>
            SL ${fmt(signal.sl)}
          </span>
          <span style={{ fontSize: 11, color: '#333' }}>·</span>
          <span style={{ fontSize: 11, color: 'var(--txt2)' }}>
            Entry ~${fmt(signal.ema20_4h)} (20 EMA)
          </span>
          <span style={{ fontSize: 11, color: '#333' }}>·</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#34d399' }}>
            TP ${fmt(signal.tp)} (2:1)
          </span>
        </div>
      )}

      {/* EMA / SMA values strip */}
      {!signal.loading && signal.ema9_4h != null && (
        <div style={{
          display: 'flex', gap: 14, flexWrap: 'wrap',
          marginTop: 10,
          paddingTop: 8,
          borderTop: '0.5px solid var(--bdr)',
        }}>
          <span style={{ fontSize: 11, color: 'var(--txt3)' }}>Fast avg <b style={{ color: '#fbbf24' }}>${fmt(signal.ema9_4h)}</b></span>
          <span style={{ fontSize: 11, color: 'var(--txt3)' }}>Mid avg <b style={{ color: '#60a5fa' }}>${fmt(signal.ema20_4h ?? null)}</b></span>
          <span style={{ fontSize: 11, color: 'var(--txt3)' }}>Slow avg <b style={{ color: '#f97316' }}>${fmt(signal.ema50_4h ?? null)}</b></span>
          <span style={{ fontSize: 11, color: 'var(--txt3)' }}>Daily trend <b style={{ color: '#a78bfa' }}>${fmt(signal.sma200_1d ?? null)}</b></span>
        </div>
      )}

      {/* Explain This Signal button */}
      {canExplain && (
        <button
          onClick={() => fireExplain(buildSignalPrompt(signal, coin!, tf, cfg), coin!)}
          style={{
            marginTop: 10,
            width: '100%',
            padding: '7px 0',
            background: 'rgba(184,174,255,0.06)',
            border: '0.5px solid rgba(184,174,255,0.2)',
            borderRadius: 7,
            fontSize: 12,
            fontWeight: 600,
            color: '#b8aeff',
            cursor: 'pointer',
            letterSpacing: '.02em',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(184,174,255,0.12)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(184,174,255,0.06)'; }}
        >
          ✦ Explain this signal in plain English
        </button>
      )}

      {signal.error && (
        <div style={{ fontSize: 11, color: '#f87171', marginTop: 6 }}>{signal.error}</div>
      )}
    </div>
  );
}
