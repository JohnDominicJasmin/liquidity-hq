-- increment_ai_usage takes every cap as an ARGUMENT - p_limit (this user's
-- daily cap), p_pool_limit (the shared one-shot-tool budget) and
-- p_global_limit (the app-wide xAI circuit breaker). 20260807b stopped a
-- caller targeting somebody else's row, but a signed-in user calling the RPC
-- directly still chose all three numbers:
--
--   * p_limit huge          -> walk straight past your own daily cap
--   * p_global_limit huge   -> keep incrementing lhq_global_ai_usage past the
--                              real AI_GLOBAL_DAILY_MAX, then every user is
--                              locked out of AI for the rest of the UTC day
--
-- No argument validation can fix that, because the function has no way to know
-- what the true caps are - they live in lib/limits.ts and a Render env var.
-- The caps are the server's decision, so the RPC belongs to the server.
--
-- lib/aiUsage.ts now calls this with the service-role client instead of the
-- caller's token (same commit). Every one of the 14 AI routes already derived
-- its userId from a verified token rather than the request body, so nothing
-- about who-gets-charged changes - only who is allowed to name the numbers.
--
-- The auth.uid() guard from 20260807b stays as a second line of defense: with
-- service_role, auth.uid() is null and the guard is skipped, so this is belt
-- and braces rather than redundancy - it keeps working if EXECUTE is ever
-- re-granted by a future migration or a Supabase default.
--
-- Run against BOTH projects - identical statements, the function has the same
-- name on each.

revoke execute on function
  increment_ai_usage(uuid, date, text, integer, integer, integer)
  from authenticated;

grant execute on function
  increment_ai_usage(uuid, date, text, integer, integer, integer)
  to service_role;
