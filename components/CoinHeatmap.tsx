'use client';
import { useState } from 'react';
import { useMarket, COINS, CoinId } from '@/lib/marketStore';

type Cat = 'all' | 'majors' | 'alts' | 'defi' | 'meme';

const CAT: Record<Cat, readonly CoinId[]> = {
  all:    COINS,
  majors: ['btc', 'eth', 'sol', 'xrp', 'bnb', 'ltc', 'bch', 'ada'],
  alts:   ['near', 'sui', 'avax', 'link', 'dot', 'atom', 'arb', 'op', 'apt', 'sei', 'inj', 'tia', 'trx', 'xlm', 'etc', 'fil', 'stx'],
  defi:   ['hype', 'aave', 'uni', 'ldo', 'rune', 'gmx', 'crv', 'jup', 'wld', 'render', 'tao', 'fet', 'ondo', 'pyth', 'ena', 'dydx', 'xau', 'spx'],
  meme:   ['doge', 'pepe', 'wif', 'bonk', 'gmt', 'sand', 'mana'],
};

const CAT_LABELS: Record<Cat, string> = {
  all: 'All', majors: 'Majors', alts: 'Alts', defi: 'DeFi/AI', meme: 'Meme',
};

function changeColor(chg: number | null): { bg: string; text: string } {
  if (chg == null) return { bg: 'rgba(255,255,255,0.04)', text: '#444' };
  if (chg >=  10) return { bg: 'rgba(52,211,153,0.30)',  text: '#34d399' };
  if (chg >=   5) return { bg: 'rgba(52,211,153,0.22)',  text: '#6ee7b7' };
  if (chg >=   2) return { bg: 'rgba(52,211,153,0.13)',  text: '#86efac' };
  if (chg >=   0) return { bg: 'rgba(52,211,153,0.07)',  text: '#4ade80' };
  if (chg >= -2)  return { bg: 'rgba(248,113,113,0.07)', text: '#fca5a5' };
  if (chg >= -5)  return { bg: 'rgba(248,113,113,0.15)', text: '#f87171' };
  if (chg >= -10) return { bg: 'rgba(248,113,113,0.25)', text: '#ef4444' };
  return              { bg: 'rgba(248,113,113,0.38)',     text: '#dc2626' };
}

function fmtPrice(p: number): string {
  if (p >= 1000)  return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 1)     return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 0.01)  return p.toFixed(4);
  return p.toFixed(6);
}

export default function CoinHeatmap() {
  const { store } = useMarket();
  const [cat, setCat] = useState<Cat>('all');

  const coins = [...(CAT[cat] as CoinId[])]
    .map(c => ({ c, coin: store.coins[c] }))
    .sort((a, b) => {
      const ca = a.coin?.change ?? -999;
      const cb = b.coin?.change ?? -999;
      return cb - ca;
    });

  const positiveCount = coins.filter(x => x.coin?.change != null && x.coin.change >= 0).length;
  const negativeCount = coins.filter(x => x.coin?.change != null && x.coin.change < 0).length;

  return (
    <div style={{
      background: 'var(--bg1)', border: '0.5px solid var(--bdr)',
      borderRadius: 14, overflow: 'hidden', marginBottom: 12,
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 14px 10px',
        borderBottom: '0.5px solid var(--bdr)',
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.07em', textTransform: 'uppercase', flex: 1 }}>
          Market Heatmap · 24 Hour
        </span>
        {positiveCount > 0 && (
          <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20, color: '#34d399', background: 'rgba(52,211,153,0.1)', border: '0.5px solid rgba(52,211,153,0.25)' }}>
            ↑ {positiveCount}
          </span>
        )}
        {negativeCount > 0 && (
          <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20, color: '#f87171', background: 'rgba(248,113,113,0.1)', border: '0.5px solid rgba(248,113,113,0.25)' }}>
            ↓ {negativeCount}
          </span>
        )}
      </div>

      {/* Category filter */}
      <div style={{ padding: '8px 12px 6px', display: 'flex', gap: 4 }}>
        {(Object.keys(CAT) as Cat[]).map(c => (
          <button
            key={c}
            onClick={() => setCat(c)}
            style={{
              fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 20, cursor: 'pointer',
              border: `0.5px solid ${cat === c ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.07)'}`,
              background: cat === c ? 'rgba(255,255,255,0.1)' : 'transparent',
              color: cat === c ? 'var(--txt)' : '#444',
              transition: 'all .15s',
            }}
          >
            {CAT_LABELS[c]}
          </button>
        ))}
      </div>

      {/* Heatmap grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
        gap: 4, padding: '0 12px 12px',
      }}>
        {coins.map(({ c, coin }) => {
          const chg = coin?.change ?? null;
          const { bg, text } = changeColor(chg);
          const sign = chg == null ? '' : chg >= 0 ? '+' : '';
          return (
            <div
              key={c}
              style={{
                background: bg,
                borderRadius: 8,
                padding: '10px 8px',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                border: `0.5px solid ${text}22`,
                transition: 'background .2s',
                cursor: 'default',
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 800, color: text, letterSpacing: '.04em' }}>
                {c.toUpperCase()}
              </span>
              {coin?.price != null && (
                <span style={{ fontSize: 9, color: text + 'aa', fontVariantNumeric: 'tabular-nums' }}>
                  ${fmtPrice(coin.price)}
                </span>
              )}
              <span style={{
                fontSize: 13, fontWeight: 700, color: text,
                fontVariantNumeric: 'tabular-nums', lineHeight: 1,
              }}>
                {chg != null ? `${sign}${chg.toFixed(1)}%` : '—'}
              </span>
            </div>
          );
        })}
      </div>

      {/* Color scale legend */}
      <div style={{
        padding: '5px 14px 8px', borderTop: '0.5px solid rgba(255,255,255,0.05)',
        display: 'flex', alignItems: 'center', gap: 3,
      }}>
        <span style={{ fontSize: 9, color: '#333', marginRight: 4 }}>Scale:</span>
        {[
          { label: '>+10%', c: '#34d399' }, { label: '+5%', c: '#6ee7b7' },
          { label: '+2%', c: '#86efac' },   { label: '0', c: '#555' },
          { label: '-2%', c: '#fca5a5' },   { label: '-5%', c: '#f87171' },
          { label: '<-10%', c: '#dc2626' },
        ].map(({ label, c }) => (
          <span key={label} style={{ fontSize: 8, color: c, fontWeight: 600 }}>{label}</span>
        ))}
      </div>
    </div>
  );
}
