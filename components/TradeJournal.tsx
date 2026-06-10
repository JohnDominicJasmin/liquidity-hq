'use client';
import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { COINS, CoinId } from '@/lib/marketStore';
import { getPHT, getSessionName } from '@/lib/session';
import { getSupabase } from '@/lib/supabase';
import AuthGate from './AuthGate';
import { track } from '@/lib/analytics';

type Direction = 'LONG' | 'SHORT';
type TradeResult = 'OPEN' | 'WIN' | 'LOSS' | 'BE';
type SetupType = 'Squeeze' | 'Breakout' | 'Reversal' | 'Range' | 'News' | 'Other';

interface Trade {
  id?: string;
  created_at?: string;
  coin: string;
  direction: Direction;
  setup_type: string;
  entry_price: number;
  exit_price?: number | null;
  stop_loss: number;
  take_profit?: number | null;
  position_size_usd?: number | null;
  risk_usd?: number | null;
  leverage?: number | null;
  result: TradeResult;
  pnl_usd?: number | null;
  pnl_r?: number | null;
  notes?: string;
  session?: string;
}

const SETUPS: SetupType[] = ['Squeeze', 'Breakout', 'Reversal', 'Range', 'News', 'Other'];

function fmtUSD(v: number | null | undefined, showSign = true) {
  if (v == null) return '—';
  const sign = showSign && v >= 0 ? '+' : '';
  return sign + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(s: string) {
  const d = new Date(s);
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
}

/* ── inner component (needs useSearchParams) ── */
function Inner() {
  const sp     = useSearchParams();
  const router = useRouter();

  const [tab,       setTab]       = useState<'log' | 'history' | 'stats'>('log');
  const [trades,    setTrades]    = useState<Trade[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [exitInput, setExitInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ result: TradeResult; exit_price: string; pnl_usd: string; notes: string }>(
    { result: 'OPEN', exit_price: '', pnl_usd: '', notes: '' }
  );
  const [noDb,      setNoDb]      = useState(false);

  /* Form state — pre-fill from URL params (from Position Sizer) */
  const [coin,      setCoin]      = useState<CoinId>((sp.get('coin') as CoinId) || 'btc');
  const [direction, setDirection] = useState<Direction>((sp.get('dir') as Direction) || 'LONG');
  const [setup,     setSetup]     = useState<SetupType>('Squeeze');
  const [entry,     setEntry]     = useState(sp.get('entry') || '');
  const [stopLoss,  setStopLoss]  = useState(sp.get('stop') || '');
  const [tpPrice,   setTpPrice]   = useState(sp.get('tp') || '');
  const [posUSD,    setPosUSD]    = useState('');
  const [leverage,  setLeverage]  = useState(8);
  const [notes,     setNotes]     = useState('');

  /* Auto risk_usd if coming from Position Sizer */
  const autoRiskUSD = useMemo(() => {
    const acc  = sp.get('acc');
    const risk = sp.get('risk');
    return acc && risk ? parseFloat(acc) * (parseFloat(risk) / 100) : null;
  }, [sp]);

  /* Load trades */
  const loadTrades = async () => {
    const db = getSupabase();
    if (!db) { setNoDb(true); return; }
    setLoading(true);
    const { data, error } = await db
      .from('trades')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (!error && data) setTrades(data as Trade[]);
    setLoading(false);
  };

  useEffect(() => { loadTrades(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Go to log tab if pre-filled from calc */
  useEffect(() => { if (sp.get('entry')) setTab('log'); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Save new trade */
  const saveTrade = async () => {
    const db = getSupabase();
    if (!db) return;
    const entryNum = parseFloat(entry);
    const stopNum  = parseFloat(stopLoss);
    if (!entryNum || !stopNum) return;

    const pht     = getPHT();
    const session = getSessionName(pht);

    setSaving(true);
    const payload = {
      coin, direction, setup_type: setup,
      entry_price: entryNum, stop_loss: stopNum,
      exit_price:       null,
      take_profit:      tpPrice ? parseFloat(tpPrice) : null,
      position_size_usd: posUSD ? parseFloat(posUSD) : null,
      risk_usd:         autoRiskUSD,
      leverage,
      result:           'OPEN',
      pnl_usd:          null,
      pnl_r:            null,
      notes, session,
    };

    let { error } = await db.from('trades').insert(payload);

    // Graceful fallback: if leverage column doesn't exist yet, retry without it
    if (error && error.message?.includes('leverage')) {
      const { leverage: _lev, ...payloadNoLev } = payload;
      const res2 = await db.from('trades').insert(payloadNoLev);
      error = res2.error;
    }

    if (!error) {
      track.journalSaved('OPEN');
      await loadTrades();
      setEntry(''); setStopLoss(''); setTpPrice(''); setPosUSD(''); setLeverage(8); setNotes('');
      setTab('history');
      router.replace('/journal');
    }
    setSaving(false);
  };

  /* Close an open trade */
  const closeTrade = async (trade: Trade) => {
    const db = getSupabase();
    if (!db || !trade.id) return;
    const exitNum = parseFloat(exitInput);
    if (!exitNum) return;

    const dir = trade.direction === 'LONG' ? 1 : -1;
    let pnl_usd: number | null = null;
    let pnl_r:   number | null = null;

    if (trade.position_size_usd && trade.entry_price) {
      const units = trade.position_size_usd / trade.entry_price;
      pnl_usd = (exitNum - trade.entry_price) * units * dir;
      if (trade.risk_usd && trade.risk_usd > 0) pnl_r = pnl_usd / trade.risk_usd;
    }

    let result: TradeResult;
    if (pnl_usd != null) {
      result = pnl_usd > 0.01 ? 'WIN' : pnl_usd < -0.01 ? 'LOSS' : 'BE';
    } else {
      const profitable = (exitNum > trade.entry_price) === (trade.direction === 'LONG');
      result = exitNum === trade.entry_price ? 'BE' : profitable ? 'WIN' : 'LOSS';
    }

    await db.from('trades').update({ exit_price: exitNum, result, pnl_usd, pnl_r }).eq('id', trade.id);
    setClosingId(null);
    setExitInput('');
    await loadTrades();
  };

  const deleteTrade = async (id: string) => {
    const db = getSupabase();
    if (!db) return;
    if (!confirm('Delete this trade?')) return;
    await db.from('trades').delete().eq('id', id);
    setTrades(prev => prev.filter(t => t.id !== id));
  };

  const startEdit = (trade: Trade) => {
    setEditDraft({
      result:     trade.result,
      exit_price: trade.exit_price?.toString() ?? '',
      pnl_usd:    trade.pnl_usd?.toString()   ?? '',
      notes:      trade.notes                  ?? '',
    });
    setEditingId(trade.id ?? null);
  };

  const saveEdit = async (trade: Trade) => {
    const db = getSupabase();
    if (!db || !trade.id) return;
    await db.from('trades').update({
      result:     editDraft.result,
      exit_price: editDraft.exit_price ? parseFloat(editDraft.exit_price) : null,
      pnl_usd:    editDraft.pnl_usd    ? parseFloat(editDraft.pnl_usd)    : null,
      notes:      editDraft.notes || null,
    }).eq('id', trade.id);
    setEditingId(null);
    await loadTrades();
  };

  /* Stats */
  const stats = useMemo(() => {
    const closed = trades.filter(t => t.result !== 'OPEN');
    const wins   = closed.filter(t => t.result === 'WIN').length;
    const losses = closed.filter(t => t.result === 'LOSS').length;
    const winRate   = closed.length ? (wins / closed.length) * 100 : 0;
    const totalPnL  = closed.reduce((s, t) => s + (t.pnl_usd ?? 0), 0);
    const rTrades   = closed.filter(t => t.pnl_r != null);
    const avgR      = rTrades.length ? rTrades.reduce((s, t) => s + (t.pnl_r ?? 0), 0) / rTrades.length : 0;

    const byCoin: Record<string, { total: number; wins: number; pnl: number }> = {};
    closed.forEach(t => {
      if (!byCoin[t.coin]) byCoin[t.coin] = { total: 0, wins: 0, pnl: 0 };
      byCoin[t.coin].total++;
      if (t.result === 'WIN') byCoin[t.coin].wins++;
      byCoin[t.coin].pnl += t.pnl_usd ?? 0;
    });

    const bySetup: Record<string, { total: number; wins: number }> = {};
    closed.forEach(t => {
      const s = t.setup_type || 'Other';
      if (!bySetup[s]) bySetup[s] = { total: 0, wins: 0 };
      bySetup[s].total++;
      if (t.result === 'WIN') bySetup[s].wins++;
    });

    return { winRate, totalPnL, avgR, total: trades.length, closed: closed.length, wins, losses, byCoin, bySetup };
  }, [trades]);

  /* No Supabase */
  if (noDb) return (
    <div style={{ padding: '2rem 0', textAlign: 'center', color: '#606060', fontSize: 13 }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>🔌</div>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Supabase not configured</div>
      <div>Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable the trade journal.</div>
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div style={{ padding: '1rem 0 0.75rem' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#e8e8e8', marginBottom: 2 }}>📓 Trade Journal</div>
        <div style={{ fontSize: 12, color: '#606060' }}>Log every trade · track results · build discipline</div>
      </div>

      {/* Tabs */}
      <div className="tj-tabs">
        {(['log', 'history', 'stats'] as const).map(t => (
          <button key={t} className={`tj-tab${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>
            {t === 'log' ? '+ Log Trade' : t === 'history' ? `History (${trades.length})` : '📊 Stats'}
          </button>
        ))}
      </div>

      {/* ──────── LOG TAB ──────── */}
      {tab === 'log' && (
        <div>
          {/* Coin + Direction */}
          <div className="tj-card">
            <div className="tj-card-lbl">Coin & Direction</div>
            <div className="tj-coins">
              {COINS.map(c => (
                <button key={c} className={`tj-coin${coin === c ? ' on' : ''}`} onClick={() => setCoin(c)}>
                  {c.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="tj-dir-row">
              <button className={`tj-dir-btn${direction === 'LONG' ? ' tj-long' : ''}`} onClick={() => setDirection('LONG')}>▲ LONG</button>
              <button className={`tj-dir-btn${direction === 'SHORT' ? ' tj-short' : ''}`} onClick={() => setDirection('SHORT')}>▼ SHORT</button>
            </div>
          </div>

          {/* Setup type */}
          <div className="tj-card">
            <div className="tj-card-lbl">Setup Type</div>
            <div className="tj-setups">
              {SETUPS.map(s => (
                <button key={s} className={`tj-setup-btn${setup === s ? ' on' : ''}`} onClick={() => setSetup(s)}>{s}</button>
              ))}
            </div>
          </div>

          {/* Price levels */}
          <div className="tj-card">
            <div className="tj-card-lbl">Price Levels</div>
            <div className="tj-price-grid">
              <div className="tj-field">
                <label className="tj-lbl">Entry *</label>
                <div className="tj-irow"><span className="tj-affix">$</span>
                  <input className="tj-inp" type="number" placeholder="0.00" value={entry} onChange={e => setEntry(e.target.value)} />
                </div>
              </div>
              <div className="tj-field">
                <label className="tj-lbl">Stop Loss *</label>
                <div className="tj-irow"><span className="tj-affix">$</span>
                  <input className="tj-inp tj-inp-stop" type="number" placeholder="0.00" value={stopLoss} onChange={e => setStopLoss(e.target.value)} />
                </div>
              </div>
              <div className="tj-field">
                <label className="tj-lbl">Take Profit</label>
                <div className="tj-irow"><span className="tj-affix">$</span>
                  <input className="tj-inp tj-inp-tp" type="number" placeholder="0.00" value={tpPrice} onChange={e => setTpPrice(e.target.value)} />
                </div>
              </div>
              <div className="tj-field">
                <label className="tj-lbl">Position Size ($)</label>
                <div className="tj-irow"><span className="tj-affix">$</span>
                  <input className="tj-inp" type="number" placeholder="from calc" value={posUSD} onChange={e => setPosUSD(e.target.value)} />
                </div>
              </div>
            </div>
            {autoRiskUSD != null && (
              <div className="tj-autofill">✓ Risk: ${autoRiskUSD.toFixed(2)} (auto from Position Sizer)</div>
            )}
          </div>

          {/* Leverage */}
          {(() => {
            const levColor = leverage >= 25 ? '#f87171' : leverage >= 10 ? '#fbbf24' : '#34d399';
            const levPct   = ((leverage - 1) / (125 - 1)) * 100;
            const trackBg  = `linear-gradient(to right, ${levColor} 0%, ${levColor} ${levPct}%, rgba(255,255,255,0.08) ${levPct}%, rgba(255,255,255,0.08) 100%)`;
            return (
              <div className="tj-card">
                <div className="tj-card-lbl" style={{ margin: '0 0 14px' }}>Leverage</div>

                {/* Slider */}
                <div className="tj-lev-slider-wrap">
                  <input
                    type="range"
                    className="tj-lev-slider"
                    min={1} max={125} step={1}
                    value={leverage}
                    onChange={e => setLeverage(Number(e.target.value))}
                    style={{ background: trackBg, color: levColor }}
                  />
                  <div className="tj-lev-ticks">
                    {['1×', '25×', '50×', '75×', '100×', '125×'].map(t => (
                      <span key={t}>{t}</span>
                    ))}
                  </div>
                </div>

                {/* Preset chips + number input */}
                <div className="tj-lev-row">
                  <div className="tj-lev-presets">
                    {[1, 3, 5, 10, 20, 50, 75, 100, 125].map(v => (
                      <button
                        key={v}
                        className={`tj-lev-preset${leverage === v ? ' on' : ''}`}
                        style={leverage === v ? { background: levColor + '18', color: levColor, borderColor: levColor + '44' } : {}}
                        onClick={() => setLeverage(v)}
                      >
                        {v}×
                      </button>
                    ))}
                  </div>
                  <input
                    type="number"
                    className="tj-lev-num"
                    min={1} max={125}
                    value={leverage}
                    onChange={e => setLeverage(Math.max(1, Math.min(125, parseInt(e.target.value) || 1)))}
                  />
                </div>

                {/* Risk warning */}
                {leverage >= 25 && (
                  <div className="tj-lev-warn" style={{ color: levColor }}>
                    {leverage >= 75
                      ? '⚠ Liquidation risk is extreme — positions can vanish instantly'
                      : leverage >= 50
                      ? '⚠ Very high leverage — use micro position sizes only'
                      : '⚠ High leverage — ensure your stop loss is tight'}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Notes */}
          <div className="tj-card">
            <div className="tj-card-lbl">Notes</div>
            <textarea
              className="tj-notes"
              rows={3}
              placeholder="Why you took this trade, market context, setup quality…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          <button className="tj-submit" onClick={saveTrade} disabled={saving || !entry || !stopLoss}>
            {saving ? 'Saving…' : '📓 Log Trade'}
          </button>
        </div>
      )}

      {/* ──────── HISTORY TAB ──────── */}
      {tab === 'history' && (
        <div>
          {loading && <div className="tj-loading">Loading trades…</div>}
          {!loading && trades.length === 0 && (
            <div className="tj-empty-state">No trades logged yet — start tracking your trades!</div>
          )}
          {trades.map(trade => (
            <div key={trade.id} className={`tj-trade tj-trade-${trade.result.toLowerCase()}`}>
              <div className="tj-trade-top">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className="tj-trade-coin">{trade.coin.toUpperCase()}</span>
                  <span className={`tj-trade-dir-tag ${trade.direction === 'LONG' ? 'tj-long' : 'tj-short'}`}>
                    {trade.direction === 'LONG' ? '▲' : '▼'} {trade.direction}
                  </span>
                  {trade.leverage != null && trade.leverage > 1 && (
                    <span className="tj-lev-tag" style={{
                      color:       trade.leverage >= 25 ? '#f87171' : trade.leverage >= 10 ? '#fbbf24' : '#34d399',
                      background:  (trade.leverage >= 25 ? '#f87171' : trade.leverage >= 10 ? '#fbbf24' : '#34d399') + '14',
                      borderColor: (trade.leverage >= 25 ? '#f87171' : trade.leverage >= 10 ? '#fbbf24' : '#34d399') + '40',
                    }}>
                      {trade.leverage}×
                    </span>
                  )}
                  <span className="tj-trade-setup-tag">{trade.setup_type}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className={`tj-result-badge tj-rb-${trade.result.toLowerCase()}`}>{trade.result}</span>
                  <button className="tj-edit-btn" title="Edit" onClick={() => editingId === trade.id ? setEditingId(null) : startEdit(trade)}>✎</button>
                  <button className="tj-del-btn" onClick={() => trade.id && deleteTrade(trade.id)}>✕</button>
                </div>
              </div>

              <div className="tj-trade-prices">
                <div className="tj-tp"><span className="tj-tp-lbl">Entry</span><span className="tj-tp-val">${trade.entry_price.toLocaleString()}</span></div>
                <div className="tj-tp"><span className="tj-tp-lbl">Stop</span><span className="tj-tp-val" style={{ color: '#f87171' }}>${trade.stop_loss.toLocaleString()}</span></div>
                {trade.take_profit != null && (
                  <div className="tj-tp"><span className="tj-tp-lbl">TP</span><span className="tj-tp-val" style={{ color: '#34d399' }}>${trade.take_profit.toLocaleString()}</span></div>
                )}
                {trade.exit_price != null && (
                  <div className="tj-tp"><span className="tj-tp-lbl">Exit</span><span className="tj-tp-val">${trade.exit_price.toLocaleString()}</span></div>
                )}
                {trade.pnl_usd != null && (
                  <div className="tj-tp">
                    <span className="tj-tp-lbl">P&amp;L</span>
                    <span className="tj-tp-val" style={{ color: trade.pnl_usd >= 0 ? '#34d399' : '#f87171' }}>
                      {fmtUSD(trade.pnl_usd)}
                    </span>
                  </div>
                )}
                {trade.pnl_r != null && Math.abs(trade.pnl_r) >= 0.005 && (
                  <div className="tj-tp">
                    <span className="tj-tp-lbl">R</span>
                    <span className="tj-tp-val" style={{ color: trade.pnl_r >= 0 ? '#34d399' : '#f87171' }}>
                      {trade.pnl_r >= 0 ? '+' : ''}{trade.pnl_r.toFixed(2)}R
                    </span>
                  </div>
                )}
              </div>

              {trade.notes && <div className="tj-trade-notes">{trade.notes}</div>}

              <div className="tj-trade-meta">
                {trade.created_at && <span>{fmtDate(trade.created_at)}</span>}
                {trade.session && <span> · {trade.session}</span>}
              </div>

              {/* Close trade */}
              {trade.result === 'OPEN' && (
                closingId === trade.id ? (
                  <div className="tj-close-row">
                    <div className="tj-irow" style={{ flex: 1 }}>
                      <span className="tj-affix">$</span>
                      <input
                        className="tj-inp"
                        type="number"
                        placeholder="Exit price"
                        value={exitInput}
                        onChange={e => setExitInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && closeTrade(trade)}
                        autoFocus
                      />
                    </div>
                    <button className="tj-confirm-btn" onClick={() => closeTrade(trade)}>✓ Close</button>
                    <button className="tj-cancel-btn" onClick={() => { setClosingId(null); setExitInput(''); }}>Cancel</button>
                  </div>
                ) : (
                  <button className="tj-close-btn" onClick={() => setClosingId(trade.id ?? null)}>
                    Close Trade →
                  </button>
                )
              )}

              {/* Inline edit form */}
              {editingId === trade.id && (
                <div className="tj-edit-form">
                  <div className="tj-edit-row">
                    <div className="tj-edit-field">
                      <label className="tj-lbl">Result</label>
                      <select
                        className="tj-edit-select"
                        value={editDraft.result}
                        onChange={e => setEditDraft(p => ({ ...p, result: e.target.value as TradeResult }))}
                      >
                        {(['OPEN','WIN','LOSS','BE'] as TradeResult[]).map(r => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </div>
                    <div className="tj-edit-field">
                      <label className="tj-lbl">Exit Price</label>
                      <div className="tj-irow"><span className="tj-affix">$</span>
                        <input className="tj-inp" type="number" placeholder="0.00"
                          value={editDraft.exit_price}
                          onChange={e => setEditDraft(p => ({ ...p, exit_price: e.target.value }))} />
                      </div>
                    </div>
                    <div className="tj-edit-field">
                      <label className="tj-lbl">P&amp;L ($)</label>
                      <div className="tj-irow"><span className="tj-affix">$</span>
                        <input className="tj-inp" type="number" placeholder="0.00"
                          value={editDraft.pnl_usd}
                          onChange={e => setEditDraft(p => ({ ...p, pnl_usd: e.target.value }))} />
                      </div>
                    </div>
                  </div>
                  <div className="tj-edit-field" style={{ marginTop: 8 }}>
                    <label className="tj-lbl">Notes</label>
                    <textarea className="tj-notes" rows={2}
                      value={editDraft.notes}
                      onChange={e => setEditDraft(p => ({ ...p, notes: e.target.value }))} />
                  </div>
                  <div className="tj-edit-btns">
                    <button className="tj-confirm-btn" onClick={() => saveEdit(trade)}>Save</button>
                    <button className="tj-cancel-btn" onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ──────── STATS TAB ──────── */}
      {tab === 'stats' && (
        <div>
          {stats.closed === 0 ? (
            <div className="tj-empty-state">Close at least one trade to see stats</div>
          ) : (
            <>
              <div className="tj-stats-grid">
                <div className="tj-stat">
                  <div className="tj-stat-lbl">Win Rate</div>
                  <div className="tj-stat-val" style={{ color: stats.winRate >= 50 ? '#34d399' : '#f87171' }}>
                    {stats.winRate.toFixed(0)}%
                  </div>
                </div>
                <div className="tj-stat">
                  <div className="tj-stat-lbl">Total P&amp;L</div>
                  <div className="tj-stat-val" style={{ color: stats.totalPnL >= 0 ? '#34d399' : '#f87171' }}>
                    {fmtUSD(stats.totalPnL)}
                  </div>
                </div>
                <div className="tj-stat">
                  <div className="tj-stat-lbl">Avg R/Trade</div>
                  <div className="tj-stat-val" style={{ color: stats.avgR >= 0 ? '#34d399' : '#f87171' }}>
                    {stats.avgR >= 0 ? '+' : ''}{stats.avgR.toFixed(2)}R
                  </div>
                </div>
                <div className="tj-stat">
                  <div className="tj-stat-lbl">Record</div>
                  <div className="tj-stat-val">
                    <span style={{ color: '#34d399' }}>{stats.wins}W</span>
                    <span style={{ color: '#606060' }}> · </span>
                    <span style={{ color: '#f87171' }}>{stats.losses}L</span>
                  </div>
                </div>
              </div>

              {Object.keys(stats.byCoin).length > 0 && (
                <div className="tj-breakdown">
                  <div className="tj-breakdown-title">Performance by Coin</div>
                  {Object.entries(stats.byCoin).sort(([,a],[,b]) => b.pnl - a.pnl).map(([c, d]) => {
                    const wr = d.total > 0 ? (d.wins / d.total) * 100 : 0;
                    return (
                    <div key={c} className="tj-breakdown-row">
                      <span className="tj-breakdown-name">{c.toUpperCase()}</span>
                      <div className="tj-breakdown-bar-wrap">
                        <div className="tj-breakdown-bar" style={{ width: `${wr}%` }} />
                      </div>
                      <span className="tj-breakdown-sub">{wr.toFixed(0)}% · {d.wins}/{d.total}</span>
                      <span className="tj-breakdown-pnl" style={{ color: d.pnl >= 0 ? '#34d399' : '#f87171' }}>{fmtUSD(d.pnl)}</span>
                    </div>
                    );
                  })}
                </div>
              )}

              {Object.keys(stats.bySetup).length > 0 && (
                <div className="tj-breakdown">
                  <div className="tj-breakdown-title">Performance by Setup</div>
                  {Object.entries(stats.bySetup).sort(([,a],[,b]) => (b.wins/b.total) - (a.wins/a.total)).map(([s, d]) => (
                    <div key={s} className="tj-breakdown-row">
                      <span className="tj-breakdown-name">{s}</span>
                      <span className="tj-breakdown-sub">{d.wins}/{d.total} trades</span>
                      <span className="tj-breakdown-pnl" style={{ color: (d.wins/d.total) >= 0.5 ? '#34d399' : '#f87171' }}>
                        {((d.wins/d.total)*100).toFixed(0)}% WR
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* Suspense wrapper required for useSearchParams in App Router */
export default function TradeJournal() {
  return (
    <AuthGate
      title="Sign in to access your Journal"
      desc="Your trade history, P&amp;L stats, and setups are private to your account."
    >
      <Suspense fallback={<div style={{ padding: '2rem', color: '#444', textAlign: 'center', fontSize: 13 }}>Loading…</div>}>
        <Inner />
      </Suspense>
    </AuthGate>
  );
}
