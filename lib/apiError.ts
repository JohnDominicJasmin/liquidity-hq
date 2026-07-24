import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

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
//
// Also reports to GlitchTip (Sentry SDK, see instrumentation.ts) - this was
// the actual reason failures here (e.g. Global Macro Context) went
// unnoticed: Sentry.captureRequestError only fires on errors that escape
// UNHANDLED to Next.js's own error boundary, and every apiError() call by
// design catches its own error and returns a normal JSON response, so
// GlitchTip never saw any of them across all ~25 routes using this helper.
// One fix here covers every call site, not just this one route.
export function apiError(
  tag: string,
  cause: unknown,
  status = 500,
  clientMessage = 'Something went wrong. Please try again.',
): NextResponse {
  const detail = cause instanceof Error ? cause.message : String(cause);
  console.error(`[${tag}] ${detail}`);
  Sentry.captureException(cause instanceof Error ? cause : new Error(detail), { tags: { route: tag } });
  return NextResponse.json({ error: clientMessage }, { status });
}
