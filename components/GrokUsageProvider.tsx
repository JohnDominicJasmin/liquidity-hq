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
  const [usage, setUsage] = useState<GrokUsageInfo | null>(null);

  useEffect(() => {
    if (!user) { setUsage(null); return; }
    fetchGrokUsage().then(u => { if (u) setUsage(u); });
  }, [user]);

  return (
    <GrokUsageContext.Provider value={{ usage, setUsage }}>
      {children}
    </GrokUsageContext.Provider>
  );
}
