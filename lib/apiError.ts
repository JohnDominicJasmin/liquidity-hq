import { NextResponse } from 'next/server';

// Returns a GENERIC client-facing error while logging the real cause
// server-side. Routes previously returned raw `error.message` / `String(e)`
// straight to the caller, which leaks Supabase/PostgREST internals (table and
// column names, constraint text, SQL fragments), upstream-API error bodies,
// and internal hostnames. Callers see only `clientMessage`; the operator sees
// the real detail in the server logs, tagged by route.
//
// Use ONLY for internal/unexpected failures. Do NOT wrap intentional
// user-facing messages (rate-limit "Daily limit…", validation errors,
// "Sign in required") - those are not leaks and should stay as-is.
export function apiError(
  tag: string,
  cause: unknown,
  status = 500,
  clientMessage = 'Something went wrong. Please try again.',
): NextResponse {
  const detail = cause instanceof Error ? cause.message : String(cause);
  console.error(`[${tag}] ${detail}`);
  return NextResponse.json({ error: clientMessage }, { status });
}
