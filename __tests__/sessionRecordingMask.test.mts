import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  maskText,
  MASK_TEXT_SELECTOR,
  UNMASK_TEXT_SELECTOR,
  SESSION_RECORDING,
} from '../lib/sessionRecording.ts';

/* Session replay is on in production and records real users. The masking it
   replaced was a list of five class names, which had already leaked once - a
   trade's notes, thesis and P&L captured in the clear - and would leak again on
   the next field added to TradeJournal, silently, with no error and no failing
   test.

   These tests exist because that failure has no symptom. The output is a video
   in PostHog nobody watches, so the only place it can be caught is here. */

/* rrweb hands maskTextFn the text node's PARENT element, and only for text it
   has already decided to mask. The one thing the function does is ask whether
   that element sits inside an opted-in subtree, so a fake with closest() is a
   faithful stand-in - no DOM needed. */
const el = (optedIn: boolean) =>
  ({ closest: (sel: string) => (optedIn && sel === UNMASK_TEXT_SELECTOR ? {} : null) }) as unknown as HTMLElement;

test('session replay masking', async (t) => {
  await t.test('private text is masked', () => {
    assert.equal(maskText('BTC long, thesis: liquidity sweep', el(false)),
                          '*** ***** ******* ********* *****');
    assert.equal(maskText('-$1,240.55', el(false)), '**********');
  });

  /* Word shape and whitespace survive so a masked recording still shows layout.
     Matches rrweb's own default replacement, /[\S]/g -> '*'. */
  await t.test('whitespace is preserved, everything else is not', () => {
    const masked = maskText('a b  c', el(false));
    assert.equal(masked, '* *  *');
    assert.ok(!/[a-z0-9]/i.test(masked));
  });

  await t.test('an explicitly opted-in subtree is returned verbatim', () => {
    assert.equal(maskText('Take Profit', el(true)), 'Take Profit');
  });

  /* The important direction. Every unrecognised case must mask, because the
     cases we did not think of are exactly the ones this replaced. */
  await t.test('fails closed on a missing or unusable element', () => {
    assert.equal(maskText('secret', undefined), '******');
    assert.equal(maskText('secret', null), '******');
    assert.equal(maskText('secret', {} as unknown as HTMLElement), '******');
  });

  await t.test('config keys posthog.init() depends on are all present', () => {
    assert.equal(SESSION_RECORDING.maskAllInputs, true);
    assert.equal(SESSION_RECORDING.maskTextSelector, MASK_TEXT_SELECTOR);
    assert.ok(MASK_TEXT_SELECTOR.length > 0);
    // Dropping maskTextFn fails closed rather than open, so it is not dangerous
    // - but it silently removes the exception mechanism entirely.
    assert.equal(typeof SESSION_RECORDING.maskTextFn, 'function');
  });

  /* QA's assertion, and the one that survives longest. After the inversion the
     danger is no longer a forgotten mask - it is someone widening the exception
     to make a recording readable, which looks like a small helpful change.

     The exception is an ATTRIBUTE for this reason: opting an element in is a
     visible edit to that element. Anything class-shaped appearing here means
     the allow-list has started growing. */
  await t.test('the exception list cannot be widened into a class list', () => {
    assert.equal(UNMASK_TEXT_SELECTOR, '[data-ph-safe]');
    assert.ok(!UNMASK_TEXT_SELECTOR.includes('.'), 'no class selector may appear in the unmask list');
  });
});

/* The mask is a container class, so removing that class from a component
   unmasks everything in it - the same silent failure in a new place. #108
   fixed only the classes a failing test named and missed two more, so this
   enumerates the surfaces rather than sampling them.

   Every component here renders the user's own financial data as TEXT.
   maskAllInputs covers what is typed; it does not cover a computed result
   rendered back out, which is why the calculators are in this list. */
const PRIVATE_SURFACES = [
  'components/TradeJournal.tsx',      // notes, thesis, P&L, R, prices
  'components/HypothesisTracker.tsx', // the user's own written hypotheses
  'components/PnLCalc.tsx',           // computed P&L
  'components/PositionSizer.tsx',     // account size, risk, position size
  'components/DcaCalc.tsx',           // entered ladder and averages
];

test('every private surface still declares the mask container', async (t) => {
  for (const file of PRIVATE_SURFACES) {
    await t.test(file, () => {
      const src = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
      assert.ok(
        src.includes('className="lhq-private"'),
        `${file} renders user-private text but no longer carries lhq-private - ` +
        `session replay would capture it in the clear`,
      );
    });
  }
});

/* Guards the deletion this replaced. The old deny-list is gone; if it comes
   back it means someone re-anchored masking to class names, which is the
   fail-open shape the whole change exists to remove. */
test('masking is not re-anchored to TradeJournal class names', () => {
  const src = readFileSync(new URL('../components/PostHogProvider.tsx', import.meta.url), 'utf8');
  assert.ok(!/maskTextSelector\s*:/.test(src),
    'PostHogProvider should take the config from lib/sessionRecording.ts, not spell it out');
  assert.ok(!src.includes('.tj-'),
    'a per-class mask list has reappeared - it fails open on the next field added');
});
