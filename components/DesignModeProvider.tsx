'use client';
import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import {
  resolveDesignMode, designAttribute, DESIGN_STORAGE_KEY, type DesignMode,
} from '@/lib/designMode';

/* Sets data-design on <html> so the terminal tokens and typeface apply (#413).
 *
 * Reads ?design=terminal, remembers it, and re-applies on every navigation.
 * Default is the current design - see lib/designMode.ts for why this is a
 * runtime flag rather than a branch.
 */

const DesignModeContext = createContext<DesignMode>('current');

/** Whether the terminal redesign is active. Components use this to render the
 *  new chrome without deleting the old one while both have to coexist. */
export function useDesignMode(): DesignMode {
  return useContext(DesignModeContext);
}

/* The mode is read as an EXTERNAL STORE, not held in state.
 *
 * The obvious version - useState plus an effect that setStates the resolved
 * mode - trips react-hooks/set-state-in-effect and re-renders on every
 * navigation. It was also the only new lint warning this branch produced,
 * which was a good signal it was the wrong shape.
 *
 * NOT useSearchParams() either. That hook forces the tree into a Suspense
 * boundary during prerender and it broke `next build`:
 *
 *     Error occurred prerendering page "/_not-found"
 *
 * Reading window.location.search inside the client snapshot keeps this out of
 * the prerender path; getServerSnapshot is what static generation sees.
 *
 * `subscribe` is a no-op: nothing else writes this key, and a `storage`
 * listener would only fire for OTHER tabs - flipping the design under a
 * reviewer mid-session, which nobody asked for.
 */
const noopSubscribe = () => () => {};

/** Both inputs as one JSON string, because useSyncExternalStore compares
 *  snapshots by identity - returning an object would rebuild it every render
 *  and loop. JSON rather than a delimiter: a query string can contain any
 *  character a separator might pick. */
function readSnapshot(): string {
  /* Storage throws in private mode, with site data blocked, or over quota -
     the same class of failure that made a stuck `loading` grant Pro access on
     #377. A flag that cannot be read is simply the default design. */
  let stored: string | null = null;
  try { stored = localStorage.getItem(DESIGN_STORAGE_KEY); } catch {}
  return JSON.stringify([window.location.search, stored]);
}
const SERVER_SNAPSHOT = JSON.stringify(['', null]);

export default function DesignModeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const snapshot = useSyncExternalStore(noopSubscribe, readSnapshot, () => SERVER_SNAPSHOT);
  const [search, stored] = JSON.parse(snapshot) as [string, string | null];
  const mode = resolveDesignMode(search, stored);

  useEffect(() => {
    /* PERSIST ONLY WHAT THE QUERY PARAM ASKED FOR.
     *
     * Writing `mode` unconditionally looked equivalent and was not: on a reload
     * WITHOUT the param, the first commit renders from getServerSnapshot, where
     * stored is null and the mode is therefore 'current'. This effect then ran
     * with that value and overwrote a stored 'terminal' before the client
     * snapshot was ever read - so the flag un-stuck itself on the next reload.
     *
     * QA measured it on #417: set the param, reload without it, stored had
     * flipped to 'current'. The param is now the only thing that writes; a
     * stored value is only ever read. */
    const asked = new URLSearchParams(search).get('design');
    if (asked === 'terminal' || asked === 'current') {
      try { localStorage.setItem(DESIGN_STORAGE_KEY, asked); } catch {}
    }

    const attr = designAttribute(mode);
    if (attr) document.documentElement.setAttribute('data-design', attr);
    else      document.documentElement.removeAttribute('data-design');
    // pathname re-asserts the attribute across client-side navigation.
  }, [mode, pathname, search]);

  return (
    <DesignModeContext.Provider value={mode}>{children}</DesignModeContext.Provider>
  );
}
