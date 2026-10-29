'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { adminFetch, fmtInt, fmtAgo } from '../_client';
import styles from '../ops.module.css';
import { useLabels } from '@/lib/labels';

interface UserRow {
  id: string; email: string | null; createdAt: string; lastSignInAt: string | null;
  banned: boolean; role: 'free' | 'pro'; lsStatus: string | null;
}
interface UsersResp { users: UserRow[]; total: number; page: number; perPage: number }

const PER_PAGE = 25;

export default function UsersListPage() {
  const { t } = useLabels();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<UsersResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
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
      if (!res || !res.ok) { setError(res ? `HTTP ${res.status}` : t('OPS_USERS_ERR_NOT_SIGNED_IN')); setLoading(false); return; }
      setData(await res.json());
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [page, debounced, t]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1;

  return (
    <div>
      <div className={styles.cardHead} style={{ marginBottom: 14 }}>
        <span className={styles.cardTitle}>{t('OPS_USERS_PAGE_TITLE')} {data ? `· ${fmtInt(data.total)}` : ''}</span>
      </div>

      <input
        className={styles.searchInput}
        placeholder={t('OPS_USERS_SEARCH_PLACEHOLDER')}
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {error && <div className={styles.err} style={{ marginTop: 10 }}>{error === 'HTTP 403' ? t('OPS_USERS_ERR_NOT_AUTHORIZED') : error}</div>}
      {loading && !data && <div className={styles.loadingText} style={{ marginTop: 10 }}>{t('OPS_USERS_LOADING')}</div>}

      {data && (
        <>
          <div className={styles.rows} style={{ marginTop: 10 }}>
            {data.users.length === 0 && <div className={styles.rowSub}>{t('OPS_USERS_EMPTY')}</div>}
            {data.users.map(u => (
              <Link href={`/ops/users/${u.id}`} key={u.id} className={styles.userRow}>
                <span className={styles.rowLabel}>
                  <span className={styles.rowName}>{u.email ?? u.id.slice(0, 8)}</span>
                  {u.role === 'pro' && <span className={`${styles.badge} ${styles.badgePro}`}>{t('OPS_USERS_PRO_BADGE')}</span>}
                  {u.banned && <span className={`${styles.badge} ${styles.badgeBad}`}>{t('OPS_USERS_BANNED_BADGE')}</span>}
                </span>
                <span className={styles.rowSub}>
                  {t('OPS_USERS_JOINED_ACTIVE', { joined: fmtAgo(u.createdAt), active: fmtAgo(u.lastSignInAt) })}
                </span>
              </Link>
            ))}
          </div>

          <div className={styles.pager}>
            <button className={styles.pagerBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t('OPS_USERS_PREV')}</button>
            <span className={styles.rowSub}>{t('OPS_USERS_PAGE_OF', { page: data.page, total: totalPages })}</span>
            <button className={styles.pagerBtn} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>{t('OPS_USERS_NEXT')}</button>
          </div>
        </>
      )}
    </div>
  );
}
