repo: JohnDominicJasmin/liquidity-hq
branch: main

## Last sync
date: 2026-08-14T00:00:00Z

### Updated in this project
- Monochrome terminal direction: 31 screens across four files, desktop + mobile each.
- Nav collapsed from 25 routes to five destinations; scanners and tools became in-page tabs.
- Liquidation map rebuilt as a density heatmap with live threshold, palette and refresh controls.
- App logo placed in every nav bar and mobile header.
- Nav collapsed from 25 routes to five destinations; scanners/tools become in-page tabs.
- Coin sidebar replaced by a dense table; color reserved for firing signals only.

## Screen map
| Project screen | Repo files |
|---|---|
| Monochrome Terminal · Arena (1a) | app/arena/page.tsx, components/NavDrawer.tsx, components/icons.tsx |
| Monochrome Terminal · Desk (2a) | app/dashboard/page.tsx, components/MarketRead.tsx, components/GlobalMacroContext.tsx |
| Monochrome Terminal · Markets (3a) | app/markets/page.tsx, lib/marketStore.ts |
| Monochrome Terminal · Liquidation map (3b) | app/liq/page.tsx |
| Monochrome Terminal · News (3c) | app/news/page.tsx, components/NewsTicker.tsx |
| Monochrome Terminal · Login + forgot password (3d) | app/login/page.tsx, app/forgot-password/page.tsx |
| Monochrome Terminal · Upgrade + paywall (3e) | app/upgrade/page.tsx, lib/entitlements.ts, docs/PRICING_AND_LIMITS.md |
| Monochrome Terminal · Setup scanner (4a) | app/scanner/page.tsx, lib/confluence.ts |
| Monochrome Terminal · Funding + correlation (4b) | app/funding/page.tsx, app/correlation/page.tsx |
| Monochrome Terminal · Econ calendar (4c) | app/econ-calendar/page.tsx, components/EconCalendarWidget.tsx |
| Monochrome Terminal · Briefing (4d) | app/briefing/page.tsx |
| Monochrome Terminal · Journal (5a) | app/journal/page.tsx, components/HypothesisTracker.tsx |
| Monochrome Terminal · Alerts (5b) | app/alerts/page.tsx, lib/alertOutcomes.ts |
| Monochrome Terminal · Calculators (5c) | app/calc/page.tsx, components/DcaCalc.tsx, components/FundingCostCalc.tsx |
| Monochrome Terminal · Settings (5d) | app/settings/page.tsx, lib/settings.ts |
| Monochrome Terminal · Landing (6a) | app/[locale]/page.tsx, components/LandingContent.tsx |
| Tools · Trading hours (1a) | app/hours/page.tsx, lib/session.ts |
| Tools · Playbook (1b) | app/playbook/page.tsx |
| Tools · Research (1c) | app/research/page.tsx, components/HypothesisTracker.tsx |
| Static · About (1a) | app/about/page.tsx |
| Static · FAQ (1b) | app/faq/page.tsx |
| Static · Learn / glossary (1c) | app/learn/page.tsx, lib/glossary.ts |
| Static · Terms (2a) | app/terms/page.tsx |
| Static · Privacy (2b) | app/privacy/page.tsx |
| Static · Refunds (2c) | app/refund/page.tsx |
| Static · Disclaimer (3a) | app/disclaimer/page.tsx |
| States · Reset password (1a) | app/reset-password/page.tsx |
| States · Onboarding (1b) | components/OnboardingProvider.tsx, components/OnboardingGate.tsx, components/SetupChecklist.tsx |
| States · 404 (1c) | app/not-found.tsx |
| States · Offline (1d) | app/offline/page.tsx, public/sw.js |
| States · Maintenance (1e) | components/MaintenanceScreen.tsx, lib/useAppConfig.ts |

## Not designed
Internal /ops console and /admin (user's call). Backtest and live-tracking redirect to dashboard; /[locale] is a wrapper; /auth/callback is a spinner.
