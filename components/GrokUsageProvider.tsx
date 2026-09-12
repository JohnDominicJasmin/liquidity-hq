'use client';
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { GrokUsageInfo, fetchGrokUsage } from '@/lib/grok';
import { useAuth } from '@/components/AuthProvider';

interface GrokUsageCtx {
  usage:    GrokUsageInfo | null;
  setUsage: (u: GrokUsageInfo) => void;
}

const GrokUsageContext = createContext<GrokUsageCtx>({ usage: null, setUsage: () => {} });

export function useGrokUsage() { return useContext(GrokUsageContext); }

export default function GrokUsageProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;
  const [usage, setUsage] = useState<GrokUsageInfo | null>(null);

  // Keyed on the id, not the `user` object - AuthProvider hands back a new
  // object reference up to 3x per page load for the same signed-in user
  // (#1177), and this effect used to re-run once per reference, firing 3
  // independent /api/grok requests for one load (measured on #1171).
  useEffect(() => {
    if (!userId) { setUsage(null); return; }
    fetchGrokUsage().then(u => { if (u) setUsage(u); });
  }, [userId]);

  return (
    <GrokUsageContext.Provider value={{ usage, setUsage }}>
      {children}
    </GrokUsageContext.Provider>
  );
}
