// The page list for the #1640 regression: every user-facing route with a page.tsx under app/ (git ls-files, 2026-10-21), minus /admin (a honeypot
// that writes an audit row per hit, #1632 item 9), the /ops pages (staff only, outside PM's list) and /auth/callback (a redirect target, tested in the auth step).
export const PAGES = [
  '/', '/ko', '/zh',
  '/login', '/login?signup=1', '/forgot-password', '/reset-password',
  '/dashboard', '/arena', '/briefing', '/scanner', '/markets', '/funding', '/liq', '/correlation', '/econ-calendar', '/news', '/research',
  '/alerts', '/journal', '/calc', '/hours', '/learn', '/playbook', '/upgrade', '/settings', '/backtest', '/live-tracking', '/offline',
  '/about', '/contact', '/faq', '/disclaimer', '/privacy', '/terms', '/refund',
];
