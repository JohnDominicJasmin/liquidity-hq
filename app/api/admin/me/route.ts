import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-auth';

// Lightweight gate check the /admin layout calls on mount to decide whether to
// render the panel or 404. Returns 200 { admin: true } only for allowlisted
// admins; 401/403 otherwise. No data, just the verdict.
export const GET = withAdmin(async (_req, { user }) =>
  NextResponse.json({ admin: true, email: user.email }));
