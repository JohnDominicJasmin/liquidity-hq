'use client';
import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { GrokUsageInfo, fetchGrokUsage } from '@/lib/grok';
import { useAuth } from '@/components/AuthProvider';

interface GrokUsageCtx {
  usage:    GrokUsageInfo | null;
  setUsage: (u: GrokUsageInfo) => void;
}

const GrokUsageContext = createContext<GrokUsageCtx>({ usage: null, setUsage: () => {} });

export function useGrokUsage() { return useContext(GrokUsageContext); }

const utcDay = () => new Date().toISOString().slice(0, 10);
const msToNextUtcMidnight = () => {
  const n = new Date();
  return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1) - n.getTime();
};

export default function GrokUsageProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;
  const [usage, setUsageState] = useState<GrokUsageInfo | null>(null);

  /* A MERGE, NOT A REPLACE (U5). The Arena's read response carries the Quick/Deep/chat/search/briefing counts but not the tool-pool pair; replacing the whole object with it dropped the pool fields, and the rings hide a ring whose
     limit is missing, so the Tools ring vanished after any Quick or Deep read until a reload. Fields a caller does not send keep their last known value. */
  const setUsage = useCallback((u: GrokUsageInfo) => {
    setUsageState(prev => ({ ...(prev ?? {}), ...u } as GrokUsageInfo));
  }, []);

  // Keyed on the id, not the `user` object - AuthProvider hands back a new
  // object reference up to 3x per page load for the same signed-in user
  // (#1177), and this effect used to re-run once per reference, firing 3
  // independent /api/grok requests for one load (measured on #1171).
  useEffect(() => {
    if (!userId) { setUsageState(null); return; }
    let day = utcDay();
    const load = () => { void fetchGrokUsage().then(u => { if (u) setUsageState(u); }); };
    load();

    /* THE COUNTS ROLL OVER AT 00:00 UTC (U6). They were fetched once per page load, so a tab left open across midnight kept yesterday's used counts and the Quick/Deep buttons stayed disabled (used >= limit) although the
       server had reset. They are read again when the tab becomes visible on a new UTC day, and by a timer at the next midnight (5 s after, so the server's date has certainly changed). */
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const today = utcDay();
      if (today !== day) { day = today; load(); }
    };
    document.addEventListener('visibilitychange', onVisible);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      timer = setTimeout(() => { day = utcDay(); load(); arm(); }, msToNextUtcMidnight() + 5_000);
    };
    arm();
    return () => { document.removeEventListener('visibilitychange', onVisible); if (timer) clearTimeout(timer); };
  }, [userId]);

  return (
    <GrokUsageContext.Provider value={{ usage, setUsage }}>
      {children}
    </GrokUsageContext.Provider>
  );
}
