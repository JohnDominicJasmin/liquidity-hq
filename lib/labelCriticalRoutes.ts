import { offeredLocaleFromPath } from './locales.ts';
import routesJson from './labelCriticalRoutes.json';

/* THE ROUTES THAT PAINT FROM THE SMALL "CRITICAL" LABEL TABLE (lib/labelDefaults.critical.json) instead of the whole English table (#1185 slow-3G, option B, DRAFT).
 *
 * LabelsProvider seeds its map with a table. The whole English table is 226 KB raw / 71 KB gzip and used to travel in every page's JavaScript. A route in this list renders its first paint, on the server and on
 * the client, from the critical subset: exactly the keys that appear as string literals in the import closure of the shell (app/(main)/layout.tsx, which carries AppShell, the nav, the footer, the cookie
 * banner) and of each page in the list (scripts/gen-critical-labels.mjs writes the file and `--check` fails when it drifts). The rest of the English table loads after the first paint and is merged in.
 *
 * ANY OTHER ROUTE needs keys the subset does not hold, so its provider waits for the whole table before it renders (React `use`, in LabelsProvider): the server HTML is the same complete English as before,
 * and no route ever prints a raw key because a table was not there yet.
 *
 * The list lives in a JSON file so the generator and this check read one copy. Adding a public route here without re-running the generator would paint raw keys: run `npm run labels:critical`. */
const ROUTES = new Set<string>(routesJson.routes);

export function isCriticalLabelRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (ROUTES.has(p)) return true;
  // /ko and /zh: the translated landing (app/(intl)/[locale]/page.tsx), one segment, an offered locale.
  return p.split('/').length === 2 && offeredLocaleFromPath(p) !== null;
}
