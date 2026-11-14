import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { logHoneypotHit } from '@/lib/honeypot';

// Honeypot. The real panel moved to /ops - a real user or bookmark never lands
// here. Anyone/anything hitting /admin is either a scanner guessing the obvious
// path or someone probing on purpose - record one bounded line in the server log
// (lib/honeypot.ts; never the admin audit log) and 404 exactly like every other
// unknown route.
export default async function AdminHoneypot() {
  const h = await headers();
  logHoneypotHit('admin_page', {
    method: 'GET',
    path: '/admin',
    ip: (h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? 'unknown').split(',').pop()?.trim(),
    ua: h.get('user-agent'),
  });
  notFound();
}
