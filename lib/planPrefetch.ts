/* THE SUBSCRIPTION READ, STARTED BEFORE HYDRATION (plan-read A, #1185 / #1651).
 *
 * WHY. A signed-in page waited for: hydration, then supabase-js starting up and resolving the session, THEN the user_subscriptions read (157 to 392 ms on a good connection, seconds on a slow one,
 * measured by QA). Until the read answered, "who is this and what plan" was unknown, which is the window the "Checking your plan..." state exists to cover. Everything the read needs is already in
 * localStorage before the page paints: the stored session holds the user id and the access token. So a small inline script starts the read at the top of the page, and AuthProvider takes the
 * answer from it instead of asking again once the session has resolved. The read's own time moves off the critical path; hydration and session start-up still cost what they cost.
 *
 * WHAT IT NEVER DOES (the rules that keep this honest).
 *  - It reads ONLY with the visitor's own stored access token, which RLS already scopes to their own row. No new access, no service key, nothing about anyone else.
 *  - A token that is expired (or within a minute of it) is NOT used: the prefetch is skipped and AuthProvider reads the normal way, after supabase-js has refreshed the session.
 *  - Only a clean 200 counts. Any other answer (401 from a rejected token, a network error, a timeout, a malformed body) is "no prefetch": AuthProvider falls back to its normal read with the
 *    normal retries. A failed prefetch NEVER becomes "not entitled": unknown is not no.
 *  - The answer is used ONCE, and only for the same user id the stored session named. A different user signing in, a sign-out and back in, or a manual retry all read normally.
 *  - A clean 200 with no row means "no subscription row", exactly what maybeSingle() reports for a free account, so it reads as free the same way the normal read does.
 *
 * This file has the script text and the one function AuthProvider calls. The script is a string because it must run before React exists. */

export interface PlanRow { role?: string; trial_ends_at?: string | null; current_period_end?: string | null }
export type PlanPrefetchResult = { ok: true; row: PlanRow | null } | { ok: false };

/** The global the inline script sets. Declared in one place so the script and the reader cannot drift on the name. */
export const PLAN_PREFETCH_GLOBAL = '__lhqPlan';
/** The longest the prefetch request may run before it is abandoned (the normal read then takes over). */
export const PLAN_PREFETCH_TIMEOUT_MS = 8000;
/** The stored access token must have at least this long left to be used. */
export const PLAN_PREFETCH_MIN_TOKEN_LIFE_MS = 60_000;

/** The inline script. `url` is the Supabase project URL, `anonKey` its public anon key (both NEXT_PUBLIC_, already in every page's JS), `table` the environment's user_subscriptions table. */
export function planPrefetchScript(url: string, anonKey: string, table: string): string {
  const base = url.replace(/\/+$/, '');
  return `(function(){try{` +
    `var ls=window.localStorage,tok=null,uid=null,exp=0;` +
    `for(var i=0;i<ls.length;i++){var k=ls.key(i);` +
      `if(!k||k.indexOf('sb-')!==0||k.slice(-11)!=='-auth-token')continue;` +
      `try{var j=JSON.parse(ls.getItem(k)||'null');if(j&&j.access_token&&j.user&&j.user.id){tok=j.access_token;uid=j.user.id;exp=Number(j.expires_at)||0;break;}}catch(e){continue;}}` +
    `if(!tok||!uid||!exp||exp*1000<Date.now()+${PLAN_PREFETCH_MIN_TOKEN_LIFE_MS})return;` +
    `var c=new AbortController(),tm=setTimeout(function(){c.abort();},${PLAN_PREFETCH_TIMEOUT_MS});` +
    `var u=${JSON.stringify(base)}+'/rest/v1/'+${JSON.stringify(table)}+'?select=role,trial_ends_at,current_period_end&limit=1&user_id=eq.'+encodeURIComponent(uid);` +
    `window.${PLAN_PREFETCH_GLOBAL}={uid:uid,p:fetch(u,{headers:{apikey:${JSON.stringify(anonKey)},Authorization:'Bearer '+tok,Accept:'application/json'},signal:c.signal})` +
      `.then(function(r){clearTimeout(tm);if(r.status!==200)return{ok:false};return r.json().then(function(a){return Array.isArray(a)?{ok:true,row:a[0]||null}:{ok:false};});})` +
      `.catch(function(){return{ok:false};})};` +
    `}catch(e){}})();`;
}

interface Stash { uid: string; p: Promise<PlanPrefetchResult> }

/** What AuthProvider calls once, at the start of its first entitlements read. Returns the prefetched answer for THIS user, or { ok: false } (nothing stashed, another user, still running past
 *  `budgetMs`, or the request failed), in which case the caller reads normally. Clears the stash either way, so the answer can never be used twice. */
export async function takePlanPrefetch(userId: string, budgetMs: number): Promise<PlanPrefetchResult> {
  if (typeof window === 'undefined') return { ok: false };
  const w = window as unknown as Record<string, Stash | undefined>;
  const stash = w[PLAN_PREFETCH_GLOBAL];
  if (!stash) return { ok: false };
  w[PLAN_PREFETCH_GLOBAL] = undefined;
  if (stash.uid !== userId) return { ok: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      stash.p,
      new Promise<PlanPrefetchResult>(resolve => { timer = setTimeout(() => resolve({ ok: false }), Math.max(0, budgetMs)); }),
    ]);
  } catch {
    return { ok: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
