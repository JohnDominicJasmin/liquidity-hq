import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';

export const dynamic = 'force-dynamic';

const MAX_PAGE_SIZE = 100;

interface AuthUserLite {
  id: string;
  email?: string;
  created_at: string;
  last_sign_in_at?: string | null;
  banned_until?: string | null;
}

// Paginated, searchable user list. Supabase's admin listUsers has no email
// filter, so this fetches every auth user (same bounded pagination as the
// overview route), filters/sorts in memory, then slices the requested page -
// fine at this app's scale, and it's the same tradeoff Overview already makes.
export const GET = withAdmin(async (req) => {
  const admin = getSupabaseAdmin();
  const url = new URL(req.url);
  const search = (url.searchParams.get('search') ?? '').trim().toLowerCase();
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
  const perPage = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(url.searchParams.get('perPage') ?? '25') || 25));

  const all: AuthUserLite[] = [];
  for (let p = 1; p <= 50; p++) {
    const { data, error } = await admin.auth.admin.listUsers({ page: p, perPage: 1000 });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    all.push(...data.users.map(u => ({
      id: u.id, email: u.email, created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at, banned_until: u.banned_until,
    })));
    if (data.users.length < 1000) break;
  }

  const filtered = search
    ? all.filter(u => (u.email ?? '').toLowerCase().includes(search))
    : all;
  filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const total = filtered.length;
  const start = (page - 1) * perPage;
  const pageUsers = filtered.slice(start, start + perPage);

  // Enrich just this page's users with their subscription row.
  const ids = pageUsers.map(u => u.id);
  const subsById = new Map<string, { role: string; ls_status: string | null }>();
  if (ids.length) {
    const { data: subs, error: subsErr } = await admin.from(T.user_subscriptions)
      .select('user_id, role, ls_status')
      .in('user_id', ids);
    // A failed lookup here must never silently read as "role: free" for every
    // user on the page - that's a real subscription value, not a safe default
    // to fall back to on error.
    if (subsErr) return NextResponse.json({ error: subsErr.message }, { status: 500 });
    for (const s of subs ?? []) subsById.set(s.user_id, { role: s.role, ls_status: s.ls_status });
  }

  const users = pageUsers.map(u => ({
    id: u.id,
    email: u.email ?? null,
    createdAt: u.created_at,
    lastSignInAt: u.last_sign_in_at ?? null,
    banned: !!(u.banned_until && new Date(u.banned_until).getTime() > Date.now()),
    role: subsById.get(u.id)?.role ?? 'free',
    lsStatus: subsById.get(u.id)?.ls_status ?? null,
  }));

  return NextResponse.json({ users, total, page, perPage });
});
