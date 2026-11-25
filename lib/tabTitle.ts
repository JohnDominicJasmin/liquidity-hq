/* WHICH LABEL NAMES A PAGE'S BROWSER TAB (#1185). The server titles are English (they are what search engines read); a reader on another
 * language gets the page's own translated name. Exact paths only: a coin or article page keeps its specific server title. */
import type { LabelKey } from './labelKeys.ts';

const TAB_TITLE_KEYS: Readonly<Record<string, LabelKey>> = {
  '/dashboard': 'NAV_DASHBOARD', '/arena': 'NAV_ARENA', '/briefing': 'NAV_BRIEFING', '/markets': 'NAV_MARKETS',
  '/scanner': 'NAV_SETUP_SCANNER', '/liq': 'NAV_LIQUIDATION_MAP', '/funding': 'NAV_FR_HISTORY', '/correlation': 'NAV_CORRELATION',
  '/backtest': 'NAV_BACKTEST', '/live-tracking': 'NAV_LIVE_TRACKING', '/journal': 'NAV_JOURNAL', '/research': 'NAV_RESEARCH',
  '/calc': 'NAV_POSITION_SIZER', '/econ-calendar': 'NAV_ECON_CALENDAR', '/alerts': 'NAV_ALERTS', '/hours': 'NAV_BEST_HOURS',
  '/playbook': 'NAV_PLAYBOOK', '/news': 'NAV_NEWS', '/learn': 'NAV_GLOSSARY', '/settings': 'NAV_SETTINGS_LABEL', '/about': 'NAV_ABOUT',
  '/faq': 'FAQ_PAGE_TITLE', '/help': 'HELP_PAGE_TITLE', '/privacy': 'PRIVACY_PAGE_TITLE', '/terms': 'TERMS_PAGE_TITLE',
  '/refund': 'REFUND_PAGE_TITLE', '/disclaimer': 'DISCLAIMER_PAGE_TITLE', '/security': 'SECURITY_PAGE_TITLE',
  '/changelog': 'CHANGELOG_PAGE_TITLE', '/status': 'STATUS_PAGE_TITLE', '/offline': 'OFFLINE_PAGE_TITLE',
};

export function tabTitleKey(pathname: string | null): LabelKey | null {
  return pathname && Object.hasOwn(TAB_TITLE_KEYS, pathname) ? TAB_TITLE_KEYS[pathname] : null;
}

/** The tab's text: the page name without a heading's closing full stop, then the brand. */
export function tabTitle(name: string): string {
  return `${name.replace(/[.。]$/, '')} - LiquidityHQ`;
}
