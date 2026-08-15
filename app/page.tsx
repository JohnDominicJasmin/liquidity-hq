import LandingSwitch from '@/components/LandingSwitch';
import { en } from '@/lib/i18n/dictionaries';

/* THIS is `/`, not app/[locale]/page.tsx.
 *
 * The landing spec's route map says "`/` -> `app/[locale]/page.tsx`". That is
 * wrong, and wiring only that file left the actual landing page on the old
 * design while `?design=terminal` appeared to do nothing.
 *
 * SUPPORTED_LOCALES is `['ko', 'zh']` — the [locale] segment exists for those
 * two only. English is served from here, so `/en` is a 404 and `/` is the
 * route every visitor and every acceptance criterion actually hits.
 *
 * Both files render LandingSwitch so the flag behaves identically on all three
 * URLs; missing one is how a redesign ships looking untouched. */
export default function LandingPage() {
  return <LandingSwitch dict={en} locale="en" dir="ltr" />;
}
