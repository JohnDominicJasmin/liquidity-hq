import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'About' };

export default function About() {
  return (
    <div>
      <div style={{ padding: '1rem 0 0.5rem' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>About</div>
        <div style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 14 }}>Liquidity Hunter HQ - private trading intelligence tool</div>
      </div>

      <div className="card">
        <div className="lbl">What this is</div>
        <div style={{ fontSize: 13, color: 'var(--txt2)', lineHeight: 1.7 }}>
          A personal crypto trading intelligence tool built around one core belief: the market is a machine for hunting stop losses.
          This app helps you read the liquidation map, identify the highest-probability raid setups, and time your entries around institutional windows.
        </div>
      </div>

      <div className="card">
        <div className="lbl">Data sources</div>
        {[
          ['Prices', 'Binance WebSocket + REST - 50 coins (majors, alts, memes)'],
          ['HYPE / PEPE / BONK', 'Bybit REST API'],
          ['Funding & Open Interest', 'Bybit Public API'],
          ['Long/Short Ratio', 'Bybit Account Ratio'],
          ['Fear & Greed', 'Alternative.me'],
          ['BTC Dominance', 'CoinMarketCap'],
          ['Breaking News', 'Finnhub WebSocket'],
          ['Crypto News', 'Finnhub + RSS (Reuters/AP/CoinDesk)'],
          ['Econ Calendar', 'Finnhub Calendar API'],
          ['AI Signal', 'LiquidityAI (xAI)'],
        ].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '0.5px solid var(--bdr)', fontSize: 12 }}>
            <span style={{ color: 'var(--txt3)' }}>{k}</span>
            <span style={{ color: 'var(--txt2)', textAlign: 'right', maxWidth: '60%' }}>{v}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="lbl">How to use</div>
        <div style={{ fontSize: 13, color: 'var(--txt2)', lineHeight: 1.8 }}>
          1. <strong style={{ color: 'var(--txt)' }}>Open the Liquidation Map</strong> - 24h window. Find the brightest, tightest cluster.<br />
          2. <strong style={{ color: 'var(--txt)' }}>Check the Raid Meter</strong> - needs at least 60/100 to be worth trading.<br />
          3. <strong style={{ color: 'var(--txt)' }}>Run the Scanner</strong> - 7-question system. If it says NO, stay flat.<br />
          4. <strong style={{ color: 'var(--txt)' }}>Check Best Hours</strong> - God Tier or Prime window only.<br />
          5. <strong style={{ color: 'var(--txt)' }}>Run LiquidityAI Arena</strong> - confirms news sentiment aligns with setup.<br />
          6. <strong style={{ color: 'var(--txt)' }}>Enter 0.8–1.5% before the cluster.</strong> Exit the second it touches. Never hold.
        </div>
      </div>

      <div className="card">
        <div className="lbl">Reminder</div>
        <div className="pbox">
          <div className="pt">This is a private tool - not financial advice</div>
          <div className="pb">Built for one trader. No warranties. No signals service. All decisions are yours. The market does not care about your analysis.</div>
        </div>
      </div>
    </div>
  );
}
