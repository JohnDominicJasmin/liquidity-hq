'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { adminFetch, fmtInt, fmtAgo } from '../_client';
import styles from '../ops.module.css';

interface UserRow {
  id: string; email: string | null; createdAt: string; lastSignInAt: string | null;
  banned: boolean; role: 'free' | 'pro'; lsStatus: string | null;
}
interface UsersResp { users: UserRow[]; total: number; page: number; perPage: number }

const PER_PAGE = 25;

export default function UsersListPage() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<UsersResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { setPage(1); }, [debounced]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), perPage: String(PER_PAGE) });
    if (debounced) params.set('search', debounced);
    (async () => {
      const res = await adminFetch(`/api/ops/users?${params}`);
      if (!alive) return;
      if (!res || !res.ok) { setError(res ? `HTTP ${res.status}` : 'Not signed in'); setLoading(false); return; }
      setData(await res.json());
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [page, debounced]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1;

  return (
    <div>
      <div className={styles.cardHead} style={{ marginBottom: 14 }}>
        <span className={styles.cardTitle}>Users {data ? `· ${fmtInt(data.total)}` : ''}</span>
      </div>

      <input
        className={styles.searchInput}
        placeholder="Search by email…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {error && <div className={styles.err} style={{ marginTop: 10 }}>{error === 'HTTP 403' ? 'Not authorized' : error}</div>}
      {loading && !data && <div className={styles.loadingText} style={{ marginTop: 10 }}>Loading…</div>}

      {data && (
        <>
          <div className={styles.rows} style={{ marginTop: 10 }}>
            {data.users.length === 0 && <div className={styles.rowSub}>No users match.</div>}
            {data.users.map(u => (
              <Link href={`/ops/users/${u.id}`} key={u.id} className={styles.userRow}>
                <span className={styles.rowLabel}>
                  <span className={styles.rowName}>{u.email ?? u.id.slice(0, 8)}</span>
                  {u.role === 'pro' && <span className={`${styles.badge} ${styles.badgePro}`}>PRO</span>}
                  {u.banned && <span className={`${styles.badge} ${styles.badgeBad}`}>BANNED</span>}
                </span>
                <span className={styles.rowSub}>
                  joined {fmtAgo(u.createdAt)} · active {fmtAgo(u.lastSignInAt)}
                </span>
              </Link>
            ))}
          </div>

          <div className={styles.pager}>
            <button className={styles.pagerBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
            <span className={styles.rowSub}>Page {data.page} of {totalPages}</span>
            <button className={styles.pagerBtn} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        </>
      )}
    </div>
  );
}
