'use client';
import { useEffect, useState } from 'react';

export interface AppConfig {
  maintenanceMode: boolean;
  announcementBanner: { text: string; link: string | null } | null;
  featureFlags: { grok: boolean; telegram: boolean };
}

// Polls the public /api/config so maintenance mode + the announcement banner
// can change without requiring a hard refresh. The app has no server session/
// middleware (see lib/admin-auth.ts) so this is the only way a client picks up
// an admin-side config change; /api/config itself is short-TTL cached server
// side, so this poll is cheap.
const POLL_MS = 60_000;

export function useAppConfig(): AppConfig | null {
  const [config, setConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch('/api/config', { cache: 'no-store' });
        if (!alive || !res.ok) return;
        setConfig(await res.json());
      } catch { /* keep last known config on transient failure */ }
    }
    load();
    const id = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return config;
}
