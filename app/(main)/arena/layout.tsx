import PageH1 from '@/components/PageH1';
import LabelsSeed from '@/components/LabelsSeed';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { NOINDEX_APP_PAGE } from '@/lib/seo';
import { resolveOfferedLocale } from '@/lib/locales';
import { getLabels } from '@/lib/labelsServer';
import DEFAULT_EN_LABELS from '@/lib/labelDefaults.en.json';

export const metadata: Metadata = { title: 'AI Arena', robots: NOINDEX_APP_PAGE };

/* How long the first byte may wait for the label table. The table is normally held in memory (lib/labelsServer: warmed at boot, stale-while-revalidate), so this is reached only on a cold
   miss; past it the page renders in English and the client swaps the language in, exactly as before this change. */
const SEED_WAIT_MS = 600;

/* /ARENA IS SERVER-RENDERED IN THE VISITOR'S LANGUAGE (#1263, PM: GO on "d2", 2026-11-19). The `lhq_lang` cookie (lib/labels.ts saveLocaleCookie) names the visitor's language; for a non-English
   visitor the page's content renders from that locale's table on the first paint, so the labels do not re-wrap when the language arrives (QA: ru, 360 px, CLS 0.125).
   Reading the cookie makes THIS ROUTE ONLY dynamic. It is not read in a root layout, which would make every page dynamic (app/(intl)/[locale]/layout.tsx records why that was rejected). /arena is a
   signed-in, noindex app page, so it gives up no shared edge cache. English visitors (no cookie) get the page exactly as before. */
export default async function ArenaLayout({ children }: { children: React.ReactNode }) {
  const body = <><PageH1 labelKey="PAGE_H1_ARENA" />{children}</>;
  const locale = resolveOfferedLocale((await cookies()).get('lhq_lang')?.value);
  if (locale === 'en') return body;
  const table = await Promise.race([
    getLabels(locale).then(r => (r.state === 'failed' ? null : r.data)).catch(() => null),
    new Promise<null>(resolve => setTimeout(() => resolve(null), SEED_WAIT_MS)),
  ]);
  if (!table) return body;
  // Only the keys that differ from the English defaults travel in the page (LabelsSeed layers them over those defaults): the full table would add every untranslated key to the HTML for nothing.
  const en = DEFAULT_EN_LABELS as Record<string, string>;
  const diff = Object.fromEntries(Object.entries(table).filter(([k, v]) => en[k] !== v));
  return <LabelsSeed locale={locale} labels={diff}>{body}</LabelsSeed>;
}
