import { SkeletonPage, SkeletonCard } from './Skeleton';

/** Shared loading placeholder (SYS-6 / item #16) - pages used to each
    hand-roll their own: /funding and /correlation had near-identical card
    styling but /upgrade used a completely different full-page div with a
    hardcoded grey (#888, ignores theme) instead of a token. One component,
    one visual language, still themed correctly in both modes.

    Renders a skeleton shimmer, not plain text - `message` becomes an sr-only
    status announcement instead of visible copy. Because every page's loading
    fallback already funnels through this one component, this single change
    gives the whole app (desktop + mobile, every screen alike) a real loading
    skeleton with no per-page work. */
export default function LoadingState({ message, fullPage }: { message: string; fullPage?: boolean }) {
  return fullPage ? <SkeletonPage label={message} /> : <SkeletonCard label={message} />;
}
