'use client';
import { useState } from 'react';
import { useMarket, classifyFunding, CoinId, fmtPrice, COIN_DEC } from '@/lib/marketStore';
import { getPHT, getCurrentWindow, isDead } from '@/lib/session';

const COINS_LIST: CoinId[] = ['btc', 'eth', 'sol', 'xrp', 'bnb'];

type Answers = {
  q1?: string; q2?: string; q3?: string; q3fresh?: string;
  conviction?: string; q5?: string; q6?: string;
};

function getSessionOpt(): string {
  const pht = getPHT();
  const win = getCurrentWindow(pht);
  if (win?.name === 'God Tier') return 'godtier';
  if (win?.name === 'Prime') return 'prime';
  if (win?.name === 'London Open') return 'london';
  if (isDead(pht)) return 'dead';
  return 'other';
}

function calcSuggestion(fr: number | null | undefined, longR: number | null | undefined, volRatio: number | null | undefined) {
  if (fr == null) return { text: '—', cls: '' };
  const cls = classifyFunding(fr);
  const lsrBias = longR == null ? 'neutral'
    : longR > 0.60 ? 'tooLong'
    : longR > 0.55 ? 'longLean'
    : (1 - longR) > 0.60 ? 'tooShort'
    : (1 - longR) > 0.55 ? 'shortLean'
    : 'neutral';
  const vol = (volRatio ?? 0) >= 1.4;

  if (cls.rpm === 'pos') {
    const strong = (lsrBias === 'tooLong' || lsrBias === 'longLean') && vol;
    return { text: strong ? 'GO SHORT ▼ STRONG' : 'GO SHORT ▼', cls: 'suggest-short' };
  }
  if (cls.rpm === 'neg') {
    const strong = (lsrBias === 'tooShort' || lsrBias === 'shortLean') && vol;
    return { text: strong ? 'GO LONG ▲ STRONG' : 'GO LONG ▲', cls: 'suggest-long' };
  }
  if (lsrBias === 'tooLong') return { text: 'LEAN SHORT', cls: 'suggest-short' };
  if (lsrBias === 'tooShort') return { text: 'LEAN LONG', cls: 'suggest-long' };
  return { text: 'NEUTRAL', cls: 'suggest-neutral' };
}

export default function Scanner() {
  const { store, selectCoin } = useMarket();
  const { coins, selectedCoin } = store;
  const [answers, setAnswers] = useState<Answers>({});
  const [cvChecks, setCvChecks] = useState([false, false, false]);
  const [result, setResult] = useState<{ cls: string; title: string; body: string } | null>(null);

  const pick = (key: keyof Answers, val: string) => setAnswers(a => ({ ...a, [key]: val }));

  const convictionVal = () => {
    const n = cvChecks.filter(Boolean).length;
    if (n === 3) return 'all3';
    if (n === 2) return 'two';
    if (n === 1) return 'one';
    return 'none';
  };

  const runScan = () => {
    const a = { ...answers, conviction: convictionVal() };
    if (!a.q1 || !a.q2 || !a.q3 || !a.q3fresh || !a.q5 || !a.q6) {
      setResult({ cls: 'res-wait', title: 'Answer all questions first', body: 'Every condition matters. Missing one = garbage output.' });
      return;
    }
    const conv = a.conviction;
    let score = 0; const msgs: string[] = []; let verdict = '';

    if (conv === 'none') { verdict = 'no'; msgs.push('0 of 3 conviction checks. Do not trade.'); }
    else if (conv === 'one') { score -= 5; msgs.push('Only 1 of 3 conviction. Very low confidence.'); }
    else if (conv === 'two') score += 5;
    else if (conv === 'all3') score += 10;

    if (a.q3fresh === 'touched') { verdict = 'no'; msgs.push('Cluster already touched — likely cleaned. Ghost liquidity.'); }
    else if (a.q3fresh === 'old') { score -= 4; msgs.push('Cluster 2+ days old — treat as ghost.'); }
    else if (a.q3fresh === 'fresh') score += 3;

    if (a.q1 === 'dark') { verdict = 'no'; msgs.push('No bright cluster = no trade. Iron rule.'); }
    else if (a.q1 === 'medium' && a.q2 === 'far') { verdict = 'no'; msgs.push('Cluster too faint and too far.'); }
    else {
      if (a.q1 === 'bright') score += 3; else score += 1;
      if (a.q2 === 'close') score += 3;
      else if (a.q2 === 'approach') score += 1;
      else if (a.q2 === 'touch') { score -= 3; msgs.push('Already touching — you are the liquidity now.'); }
      else if (a.q2 === 'far') { score -= 2; msgs.push('>4% away. Not in range yet.'); }
      if (a.q3 === 'tight') score += 2;
      else if (a.q3 === 'spread') { score -= 2; msgs.push('Spread cluster is weak.'); }
      const coin = coins[selectedCoin];
      const fr = coin?.fundingRate;
      if (fr != null) { const cls = classifyFunding(fr); if (cls.rpm !== 'neu') score += 2; }
      if (a.q5 === 'yes') score += 2;
      else if (a.q5 === 'grinding') { score += 1; msgs.push('Slow grind = possible silent killer. Watch for acceleration.'); }
      else { score -= 1; msgs.push('No sprint yet. Wait for acceleration.'); }
      if (a.q6 === 'godtier') score += 3;
      else if (a.q6 === 'prime') score += 2;
      else if (a.q6 === 'london') score += 1;
      else if (a.q6 === 'dead') { score -= 3; msgs.push('Dead zone. High probability of chop. Avoid.'); }
      if (score >= 10) verdict = 'go';
      else if (score >= 6) verdict = 'wait';
      else verdict = 'no';
    }

    if (verdict === 'go') {
      const coin = coins[selectedCoin];
      const fr = coin?.fundingRate;
      let cond = 'Funding is neutral. Direction based on cluster location.';
      if (fr != null) {
        const cls = classifyFunding(fr);
        if (cls.rpm === 'pos') cond = 'Funding heavily positive = longs overcrowded. Go SHORT — look for bright cluster BELOW price.';
        if (cls.rpm === 'neg') cond = 'Funding heavily negative = shorts overcrowded. Go LONG — look for bright cluster ABOVE price.';
      }
      setResult({ cls: 'res-go', title: 'Setup is valid — prepare to enter', body: cond + ' Enter when price is 0.8–1.5% from the zone and sprinting with volume. Exit the moment it touches.' + (msgs.length ? '\n\nNotes: ' + msgs.join(' ') : '') });
    } else if (verdict === 'wait') {
      setResult({ cls: 'res-wait', title: 'Setup is forming — not ready yet', body: msgs.join(' ') + ' Check heatmap every 30 mins. Wait for more conviction.' });
    } else {
      setResult({ cls: 'res-no', title: 'No trade — stay in cash', body: msgs.length ? msgs.join(' ') : 'Conditions do not align. Do not force a trade. Sit on your hands.' });
    }
  };

  const q6Auto = getSessionOpt();
  const coin = coins[selectedCoin];

  function Q({ id, label, opts, children }: { id: keyof Answers; label: string; opts: { val: string; lbl: string }[]; children?: React.ReactNode }) {
    return (
      <div className="scanner">
        <div className="s-label">{label}</div>
        <div className="s-opts">
          {opts.map(o => (
            <div key={o.val} className={`s-opt${answers[id] === o.val ? ' sel' : ''}`} onClick={() => pick(id, o.val)}>{o.lbl}</div>
          ))}
        </div>
        {children}
      </div>
    );
  }

  return (
    <div>
      <div style={{ padding: '1rem 0 0.5rem' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#e8e8e8', marginBottom: 2 }}>Trade Scanner</div>
        <div style={{ fontSize: 12, color: '#606060', marginBottom: 14 }}>7-question GO / NO-GO filter system</div>
      </div>

      {/* Coin selector + live mini-ticker */}
      <div className="scanner-fund-box">
        <div className="scanner-fund-coin">Select coin</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {COINS_LIST.map(id => (
            <div key={id} className={`s-opt${selectedCoin === id ? ' sel' : ''}`} onClick={() => selectCoin(id)}>
              {id.toUpperCase()}
              {coins[id]?.price ? ' $' + fmtPrice(coins[id]!.price, COIN_DEC[id]) : ''}
            </div>
          ))}
        </div>
        {coin?.fundingRate != null && (() => {
          const fc = classifyFunding(coin.fundingRate!);
          const pct = (coin.fundingRate! >= 0 ? '+' : '') + (coin.fundingRate! * 100).toFixed(4) + '%';
          const suggest = calcSuggestion(coin.fundingRate, coin.longRatio, coin.volRatio);
          return (
            <>
              <div className="scanner-fund-coin">{selectedCoin.toUpperCase()} / USDT — Bybit Funding Rate</div>
              <div className={`scanner-fund-rate ${fc.cls}`}>{pct}</div>
              <div className={`scanner-fund-label ${fc.cls}`}>{fc.label}</div>
              <div className="scanner-fund-note">{fc.note}</div>
              {suggest.text !== '—' && <div className={`suggest-badge ${suggest.cls}`}>{suggest.text}</div>}
            </>
          );
        })()}
      </div>

      <Q id="q1" label="Q1: How bright is the nearest significant cluster?" opts={[
        { val: 'bright', lbl: 'Very bright (yellow/white)' },
        { val: 'medium', lbl: 'Medium (orange)' },
        { val: 'dark', lbl: 'Dark / no cluster' },
      ]} />

      <Q id="q2" label="Q2: How far is price from the cluster?" opts={[
        { val: 'close', lbl: '0.8%–2.5% away' },
        { val: 'approach', lbl: '2.5%–4% approaching' },
        { val: 'far', lbl: 'More than 4% away' },
        { val: 'touch', lbl: 'Already touching' },
      ]} />

      <Q id="q3" label="Q3: How tight is the cluster range?" opts={[
        { val: 'tight', lbl: 'Tight (1–2%)' },
        { val: 'medium', lbl: 'Medium (2–5%)' },
        { val: 'spread', lbl: 'Spread (5%+)' },
      ]} />

      <Q id="q3fresh" label="Q4: How fresh is the cluster?" opts={[
        { val: 'fresh', lbl: 'Fresh (0–18h)' },
        { val: 'day', lbl: '18–48h old' },
        { val: 'old', lbl: '2+ days old' },
        { val: 'touched', lbl: 'Already touched once' },
      ]} />

      {/* Q5 conviction */}
      <div className="scanner">
        <div className="s-label">Q5: Conviction check (tick all that apply)</div>
        {[
          'Price is aggressively moving toward the cluster (not crabbing)',
          'Funding rate is extreme (+ve or -ve), matching direction',
          'Volume is above average (15m ratio ≥ 1.4x)',
        ].map((lbl, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={cvChecks[i]}
              onChange={e => setCvChecks(v => { const n = [...v]; n[i] = e.target.checked; return n; })}
              style={{ marginTop: 2, accentColor: '#b8aeff', width: 14, height: 14, flexShrink: 0 }}
            />
            <span style={{ fontSize: 13, color: '#a0a0a0', lineHeight: 1.5 }}>{lbl}</span>
          </div>
        ))}
        <div style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, marginTop: 4,
          background: cvChecks.filter(Boolean).length >= 2 ? '#152b1e' : cvChecks.filter(Boolean).length === 1 ? '#2a1f00' : '#2e1515',
          color: cvChecks.filter(Boolean).length >= 2 ? '#7de0a4' : cvChecks.filter(Boolean).length === 1 ? '#f5cc7a' : '#ff9a92',
        }}>
          {(() => {
            const n = cvChecks.filter(Boolean).length;
            if (n === 3) return '3 of 3 ✓ — Maximum conviction. Green light.';
            if (n === 2) return '2 of 3 — Sufficient conviction. You can trade.';
            if (n === 1) return '1 of 3 — Low conviction. Consider skipping.';
            return '0 of 3 — No conviction. Do not trade.';
          })()}
        </div>
      </div>

      <Q id="q5" label="Q6: Is price sprinting toward the cluster?" opts={[
        { val: 'yes', lbl: 'Yes — strong momentum' },
        { val: 'grinding', lbl: 'Slow grind' },
        { val: 'no', lbl: 'Not moving toward it' },
      ]} />

      <Q id="q6" label="Q7: Current time window (auto-detected)" opts={[
        { val: 'godtier', lbl: 'God Tier (Sun 11PM–Mon 3AM)' },
        { val: 'prime', lbl: 'Prime (2AM–5AM)' },
        { val: 'london', lbl: 'London (3PM–6PM)' },
        { val: 'dead', lbl: 'Dead Zone (12PM–3PM)' },
        { val: 'other', lbl: 'Off-peak' },
      ]}>
        <button style={{ fontSize: 11, color: '#606060', marginTop: 8, padding: '3px 8px', borderRadius: 6, border: '0.5px solid rgba(255,255,255,0.1)', background: 'none', cursor: 'pointer' }}
          onClick={() => pick('q6', q6Auto)}>
          Auto-detect current session
        </button>
      </Q>

      <button className="scan-btn" onClick={runScan}>Run Scanner →</button>

      {result && (
        <div className={`result-box ${result.cls}`} style={{ display: 'block', whiteSpace: 'pre-wrap' }}>
          <div className="res-title">{result.title}</div>
          <div className="res-body">{result.body}</div>
        </div>
      )}
    </div>
  );
}
