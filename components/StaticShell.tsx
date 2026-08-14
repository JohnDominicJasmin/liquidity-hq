'use client';
import Link from 'next/link';
import { useLabels } from '@/lib/labels';
import BrandMark from './BrandMark';

/* LEARN_CONTENT_* rather than new keys: /learn already renders this exact bar
   (components/LearnContent.tsx uses .lp-nav-inner) and its labels are the ones
   translated for it. A new key pair would need translations in every locale to
   say what these already say. */

/* The 56px MARKETING nav for the static pages (#413, #430).
 *
 * The handoff describes two shells and the app only had one. README:167:
 *
 *   "Shared static shell: 56px marketing nav, 264px page index rail (active
 *    item has a 2px amber left border), content column, right rail."
 *
 * `/disclaimer` and its six siblings render inside AppShell, so they inherited
 * the APP bar - 44px, five app destinations - on pages a signed-out visitor
 * reads before they have an account. QA's structure spec asserts 56 and was
 * merged red against this.
 *
 * MEASURED FROM THE FRAME, not the prose (Static.dc.html, disclaimer frame,
 * 1440x900):
 *
 *   bar            1438 x 56
 *   wordmark       13px mono 700, letter-spacing .16em, --txt
 *   nav links      11px mono, letter-spacing .12em, --txt2, gap 24
 *   spacer         flex 1
 *   SIGN IN        11px mono, .12em, --txt2
 *   START FREE     11px mono 700, amber fill
 *
 * THE MIDDLE LINKS ARE DELIBERATELY ABSENT. The prototype renders them from a
 * `marketingNav` list that its template never resolves - the frame shows the
 * literal `{{ n.label }}` with a five-item placeholder hint. So the design
 * specifies that five links exist and does not say what they are. Inventing
 * five is how a redesign quietly acquires navigation nobody designed; this is
 * filed for the owner instead.
 */

export default function StaticShell() {
  const { t } = useLabels();

  return (
    <nav className="sshell" aria-label="Site">
      {/* README:197 - "logo.png ... used at 18-26px in every nav bar and mobile
          header, with no border radius change". The first version of this shell
          shipped the wordmark alone; the reading pass found the line.
          BrandMark, not the handoff's logo.png: the repo already has the mark
          as a component, and adding the binary would import a BLUE asset into a
          gold palette - the open question QA raised for the owner. Swapping the
          source later is one line; the slot and its size are what the design
          specifies. */}
      <Link href="/" className="sshell-brand">
        <BrandMark size={22} tone="dark" />
        LIQUIDITYHQ
      </Link>

      {/* marketingNav renders here once its labels exist - see the note above */}

      <div className="sshell-spacer" />

      <Link href="/login" className="sshell-signin">{t('LEARN_CONTENT_NAV_SIGN_IN')}</Link>
      <Link href="/login?signup=1" className="sshell-cta" data-testid="sshell-cta">
        {t('LEARN_CONTENT_NAV_GET_STARTED')}
      </Link>
    </nav>
  );
}
