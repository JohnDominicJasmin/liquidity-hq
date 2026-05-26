'use client';
import { useState, useEffect, useCallback } from 'react';
import { getSupabase, Cluster } from '@/lib/supabase';
import { useMarket, fmtPrice, COIN_DEC, CoinId } from '@/lib/marketStore';

const COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'HYPE', 'NEAR', 'ZEC'];

function getAge(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h >= 48) return h + 'h ago (expired)';
  if (h > 0) return h + 'h ' + m + 'm ago';
  return m + 'm ago';
}

export default function Clusters() {
  const { store } = useMarket();
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [coin, setCoin] = useState('BTC');
  const [level, setLevel] = useState('');
  const [side, setSide] = useState<'above' | 'below'>('above');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [supaOk, setSupaOk] = useState(true);

  const load = useCallback(async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) { setSupaOk(false); setLoading(false); return; }
    try {
      const { data, error } = await getSupabase()!.from('clusters').select('*').order('added_at', { ascending: false });
      if (error) { setSupaOk(false); return; }
      setClusters(data as Cluster[]);
    } catch { setSupaOk(false); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* Auto-check clusters against live prices */
  useEffect(() => {
    if (!supaOk || clusters.length === 0) return;
    const pending = clusters.filter(c => c.status === 'pending');
    pending.forEach(async cl => {
      const coinId = cl.coin.toLowerCase() as CoinId;
      const livePrice = store.coins[coinId]?.price;
      if (!livePrice) return;
      const dist = Math.abs(livePrice - cl.level) / cl.level * 100;
      if (dist <= 0.3) {
        await getSupabase()!.from('clusters').update({ status: 'raided', raided_at: new Date().toISOString() }).eq('id', cl.id!);
        load();
      }
      /* auto-expire after 48h */
      if (cl.added_at && Date.now() - new Date(cl.added_at).getTime() > 48 * 3600000) {
        await getSupabase()!.from('clusters').update({ status: 'expired' }).eq('id', cl.id!);
        load();
      }
    });
  }, [store.coins]); // eslint-disable-line react-hooks/exhaustive-deps

  const addCluster = async () => {
    const lv = parseFloat(level);
    if (!lv || isNaN(lv)) { alert('Enter a valid price level'); return; }
    const row: Cluster = { coin, level: lv, side, note: note || undefined, status: 'pending' };
    if (supaOk) {
      const { error } = await getSupabase()!.from('clusters').insert(row);
      if (!error) { setLevel(''); setNote(''); load(); }
    }
  };

  const deleteCluster = async (id: number) => {
    await getSupabase()!.from('clusters').delete().eq('id', id);
    load();
  };

  const markRaided = async (id: number) => {
    await getSupabase()!.from('clusters').update({ status: 'raided', raided_at: new Date().toISOString() }).eq('id', id);
    load();
  };

  const total = clusters.length;
  const raided = clusters.filter(c => c.status === 'raided').length;
  const pending = clusters.filter(c => c.status === 'pending').length;
  const settled = raided + clusters.filter(c => c.status === 'expired').length;
  const accuracy = settled > 0 ? Math.round(raided / settled * 100) : null;

  if (!supaOk) return (
    <div>
      <div style={{ padding: '1rem 0 0.75rem', fontSize: 20, fontWeight: 700, color: '#e8e8e8' }}>Cluster Tracker</div>
      <div className="rbox"><div className="rt">Supabase not configured</div><div className="rb">Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to your environment to enable cluster persistence.</div></div>
    </div>
  );

  return (
    <div>
      <div style={{ padding: '1rem 0 0.5rem' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#e8e8e8', marginBottom: 2 }}>Cluster Tracker</div>
        <div style={{ fontSize: 12, color: '#606060', marginBottom: 14 }}>Log liquidation clusters — auto-detects raids</div>
      </div>

      {/* Stats */}
      <div className="ct-stats">
        <div className="ct-stat"><div className="ct-stat-num">{total}</div><div className="ct-stat-lbl">Total</div></div>
        <div className="ct-stat"><div className="ct-stat-num" style={{ color: '#7de0a4' }}>{raided}</div><div className="ct-stat-lbl">Raided</div></div>
        <div className="ct-stat"><div className="ct-stat-num" style={{ color: '#b8aeff' }}>{pending}</div><div className="ct-stat-lbl">Pending</div></div>
      </div>
      <div className="ct-accuracy">
        {accuracy != null ? `Accuracy: ${accuracy}% (${raided} raided / ${settled} settled) — ${pending} still pending` : 'Track clusters to build your accuracy score.'}
      </div>

      {/* Add form */}
      <div className="ct-form">
        <div className="lbl">Add cluster</div>
        <div className="ct-form-row">
          <select className="ct-select" value={coin} onChange={e => setCoin(e.target.value)}>
            {COINS.map(c => <option key={c}>{c}</option>)}
          </select>
          <input className="ct-input" placeholder="Price level e.g. 98500" value={level} onChange={e => setLevel(e.target.value)} type="number" />
          <select className="ct-select" value={side} onChange={e => setSide(e.target.value as 'above' | 'below')}>
            <option value="above">▲ Above</option>
            <option value="below">▼ Below</option>
          </select>
        </div>
        <div className="ct-form-row">
          <input className="ct-input" placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} />
          <button className="ct-add-btn" onClick={addCluster}>+ Add</button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div style={{ fontSize: 13, color: '#606060', textAlign: 'center', padding: '1rem' }}>Loading clusters...</div>
      ) : clusters.length === 0 ? (
        <div className="ct-empty">No clusters tracked yet. Add your first cluster above.</div>
      ) : (
        [...clusters].sort((a, b) => {
          const o = { pending: 0, raided: 1, expired: 2 } as Record<string, number>;
          return (o[a.status] ?? 0) - (o[b.status] ?? 0) || new Date(b.added_at!).getTime() - new Date(a.added_at!).getTime();
        }).map(cl => (
          <div key={cl.id} className={`ct-item status-${cl.status}`}>
            <div className="ct-item-header">
              <span className="ct-coin">{cl.coin}</span>
              <span className="ct-price">${cl.level.toLocaleString()}</span>
              <span className={`ct-dir ${cl.side === 'above' ? 'ct-dir-above' : 'ct-dir-below'}`}>
                {cl.side === 'above' ? '▲ Above' : '▼ Below'}
              </span>
              <span className="ct-status">
                {cl.status === 'pending' ? 'PENDING' : cl.status === 'raided' ? '✓ RAIDED' : 'EXPIRED'}
              </span>
            </div>
            {cl.note && <div style={{ fontSize: 11, color: '#a0a0a0', marginBottom: 6 }}>{cl.note}</div>}
            <div className="ct-item-meta">
              <span className="ct-age">Added {getAge(cl.added_at!)}{cl.raided_at ? ' · Raided ' + getAge(cl.raided_at) : ''}</span>
              {cl.status === 'pending' && (
                <button onClick={() => markRaided(cl.id!)} style={{ fontSize: 11, color: '#7de0a4', cursor: 'pointer', padding: '2px 8px', borderRadius: 4, border: '0.5px solid #266038', background: '#0f1f14' }}>
                  Mark raided
                </button>
              )}
              <button className="ct-delete" onClick={() => deleteCluster(cl.id!)}>✕ remove</button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
