import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-auth';

// Lightweight gate check the /ops layout calls on mount to decide whether to
// render the panel (and whether to show the owner-only Team link). Returns 200
// with the role only for admins; 401/403 otherwise. No data, just the verdict.
export const GET = withAdmin(async (_req, { user, role }) =>
  NextResponse.json({ admin: true, email: user.email, role }));
