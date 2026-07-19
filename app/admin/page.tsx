import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';

// Honeypot. The real panel moved to /ops - a real user or bookmark never lands
// here. Anyone/anything hitting /admin is either a scanner guessing the obvious
// path or someone probing on purpose - log it (best-effort, never blocks the
// response) and 404 exactly like every other unknown route.
export default async function AdminHoneypot() {
  const h = await headers();
  const ip = h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? 'unknown';
  const ua = h.get('user-agent') ?? 'unknown';

  try {
    await getSupabaseAdmin().from(T.admin_audit_log).insert({
      actor_email: 'anonymous',
      action: 'honeypot_admin_path_hit',
      detail: { ip, ua, path: '/admin' },
    });
  } catch {
    // Best-effort logging - table may not exist yet, or the insert may fail.
    // Never let logging block the 404.
  }

  notFound();
}
