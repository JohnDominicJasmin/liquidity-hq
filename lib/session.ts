export interface Window {
  name: string;
  label: string;
  color: string;
  bg: string;
}

export function getPHT(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
}

export function isGodTier(pht: Date): boolean {
  const day = pht.getDay();
  const mins = pht.getHours() * 60 + pht.getMinutes();
  return (day === 0 && mins >= 23 * 60) || (day === 1 && mins < 3 * 60);
}

export function isPrime(pht: Date): boolean {
  const mins = pht.getHours() * 60 + pht.getMinutes();
  return mins >= 120 && mins < 300; // 2AM – 5AM PHT
}

export function isMonEvening(pht: Date): boolean {
  const mins = pht.getHours() * 60 + pht.getMinutes();
  return pht.getDay() === 1 && mins >= 1200 && mins < 1380; // Mon 8PM – 11PM PHT
}

export function isLondon(pht: Date): boolean {
  const day = pht.getDay();
  if (day === 0 || day === 6) return false;
  const mins = pht.getHours() * 60 + pht.getMinutes();
  return mins >= 900 && mins < 1080; // 3PM – 6PM PHT (London 7AM–10AM UTC)
}

// Asia/Tokyo session — 7AM–11AM PHT (Tokyo 8AM–12PM, Singapore same zone)
export function isAsia(pht: Date): boolean {
  const day = pht.getDay();
  if (day === 0 || day === 6) return false;
  const mins = pht.getHours() * 60 + pht.getMinutes();
  return mins >= 420 && mins < 660; // 7AM – 11AM PHT
}

// Pre-NY — London close / NY pre-market overlap, 8PM–9:30PM PHT (Tue–Fri only)
// Monday is excluded because Mon Evening already covers Mon 8PM–11PM
export function isPreNY(pht: Date): boolean {
  const day = pht.getDay();
  if (day === 0 || day === 6 || day === 1) return false;
  const mins = pht.getHours() * 60 + pht.getMinutes();
  return mins >= 1200 && mins < 1290; // 8:00PM – 9:30PM PHT
}

// NY Session — 9:30PM–2AM PHT (crosses midnight)
// Monday: Mon Evening covers 8PM–11PM, so NY picks up from 11PM on Mon
export function isNY(pht: Date): boolean {
  const day = pht.getDay();
  if (day === 0 || day === 6) return false;
  const mins = pht.getHours() * 60 + pht.getMinutes();
  if (day === 1) return mins >= 1380 || mins < 120; // Mon: 11PM – 2AM (after Mon Evening)
  return mins >= 1290 || mins < 120;                // Tue–Fri: 9:30PM – 2AM
}

export function isDead(pht: Date): boolean {
  const day = pht.getDay();
  if (day === 0 || day === 6) return false;
  const mins = pht.getHours() * 60 + pht.getMinutes();
  return mins >= 720 && mins < 900; // 12PM – 3PM PHT
}

// Priority order matters — first match wins
export function getCurrentWindow(pht: Date): Window | null {
  if (isGodTier(pht))    return { name: 'God Tier',     label: 'Sun 11PM – Mon 3AM',    color: '#f0c070', bg: '#3d2e00' };
  if (isPrime(pht))      return { name: 'Prime',        label: 'Daily 2AM – 5AM',       color: '#7de0a4', bg: '#152b1e' };
  if (isMonEvening(pht)) return { name: 'Mon Evening',  label: 'Mon 8PM – 11PM',        color: '#b8aeff', bg: '#252040' };
  if (isNY(pht))         return { name: 'NY Session',   label: 'Mon–Fri 9:30PM – 2AM',  color: '#60a5fa', bg: '#0a1929' };
  if (isLondon(pht))     return { name: 'London Open',  label: 'Weekdays 3PM – 6PM',    color: '#7ab8f5', bg: '#0d1e30' };
  if (isPreNY(pht))      return { name: 'Pre-NY',       label: 'Weekdays 8PM – 9:30PM', color: '#94a3b8', bg: '#1a1f2e' };
  if (isAsia(pht))       return { name: 'Asia Session', label: 'Weekdays 7AM – 11AM',   color: '#fbbf24', bg: '#2a1f00' };
  return null;
}

export function getUpcomingWindows(now: Date, count: number): { win: Window; countdown: string }[] {
  const results: { win: Window; countdown: string }[] = [];
  let check = new Date(now.getTime() + 60 * 1000);
  const limit = new Date(now.getTime() + 7 * 24 * 3600000);
  let lastAdded: string | null = null;

  while (check < limit && results.length < count) {
    const pht = new Date(check.toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
    const win = getCurrentWindow(pht);
    if (win && win.name !== lastAdded) {
      let startCheck = new Date(check.getTime() - 15 * 60 * 1000);
      while (startCheck < check) {
        const sp = new Date(startCheck.toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
        const sw = getCurrentWindow(sp);
        if (sw && sw.name === win.name) { check = startCheck; break; }
        startCheck = new Date(startCheck.getTime() + 60 * 1000);
      }
      const diff = check.getTime() - now.getTime();
      const dh = Math.floor(diff / 3600000);
      const dm = Math.floor((diff % 3600000) / 60000);
      const countdown = dh > 0 ? `${dh}h ${dm}m away` : `${dm}m away`;
      results.push({ win, countdown });
      lastAdded = win.name;
      check = new Date(check.getTime() + 3 * 3600000);
    } else {
      check = new Date(check.getTime() + 15 * 60 * 1000);
    }
  }
  return results;
}

export function getSessionName(pht: Date): string {
  const win = getCurrentWindow(pht);
  if (win) return win.name;
  if (isDead(pht)) return 'Dead Zone';
  return 'Off-peak';
}
