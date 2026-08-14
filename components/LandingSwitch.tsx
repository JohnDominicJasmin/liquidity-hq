'use client';
import type { LandingDict, Locale } from '@/lib/i18n/dictionaries';
import { useDesignMode } from '@/components/DesignModeProvider';
import LandingContent from '@/components/LandingContent';
import LandingTerminal from '@/components/LandingTerminal';

/* Which landing design renders (#413).
 *
 * A CLIENT BOUNDARY, because app/[locale]/page.tsx is a server component and
 * the design flag is per-browser - it reads a query param and localStorage,
 * neither of which exists during a server render. /disclaimer did not need one
 * of these because its page.tsx is already 'use client'.
 *
 * Both children are client components, so this adds a file rather than a
 * render cost. It exists so the branch lives in one obvious place instead of
 * being threaded through a 337-line component, and so deleting it at the end
 * of the migration is a one-file change.
 *
 * The props are passed straight through and stay serialisable - dict is plain
 * data from getDictionary(), so the server can still prerender everything above
 * this boundary and only the choice is deferred to the client.
 */

interface Props {
  dict:   LandingDict;
  locale: Locale;
  dir:    'ltr' | 'rtl';
}

export default function LandingSwitch(props: Props) {
  if (useDesignMode() === 'terminal') return <LandingTerminal {...props} />;
  return <LandingContent {...props} />;
}
