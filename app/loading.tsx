import LoadingState from '@/components/LoadingState';

// App-wide Next.js route-transition fallback - fires while a route segment's
// code/RSC payload is loading, so navigating to any page that doesn't define
// its own loading.tsx (e.g. app/funding/loading.tsx) shows this skeleton
// instead of a blank flash. Most of this app fetches data client-side after
// mount (not via RSC), so each page's own `loading` state + LoadingState
// still owns the "waiting on data" skeleton - this covers the narrower
// route/navigation gap, with the same shared skeleton visual either way.
export default function Loading() {
  return <LoadingState message="Loading…" fullPage />;
}
