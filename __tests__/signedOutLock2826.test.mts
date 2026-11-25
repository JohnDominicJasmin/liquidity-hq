/* QA: PR #2826 (#1263 owner item 67). The signed-out signal lock line and its button read labels.
 *   S1 the component shows the two labels, keeps the sign-up address, and prints neither English sentence itself
 *   S2 the shipped English says what the lock copy says, both keys are registered, and all five languages have held rows */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { signalLockCopy } from '../lib/signalCoinGate';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('S1. the signed-out line and button are labelled, and the link is the sign-up one', () => {
  const src = read('components/EMASignal.tsx');
  assert.ok(src.includes("{t('ARENA_SIGNED_OUT_LOCK_LINE')}</span>"));
  assert.ok(src.includes("{t('ARENA_SIGNED_OUT_LOCK_CTA')}</Link>"));
  assert.ok(src.includes('<Link href={copy.href} data-testid="signal-locked-link"'));
  assert.equal(/\{copy\.(text|cta)\}/.test(src), false, 'the untranslated copy is still printed');
  assert.equal(signalLockCopy('signed_out').href, '/login?signup=1&next=/arena');
});

test('S2. English matches, keys registered, five languages held', () => {
  const en = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
  const copy = signalLockCopy('signed_out');
  assert.equal(en.ARENA_SIGNED_OUT_LOCK_LINE, copy.text);
  assert.equal(en.ARENA_SIGNED_OUT_LOCK_CTA, copy.cta);
  const keys = read('lib/labelKeys.ts');
  const sql = read('supabase/migrations/20261130j_labels_signed_out_signal_lock.sql');
  for (const k of ['ARENA_SIGNED_OUT_LOCK_LINE', 'ARENA_SIGNED_OUT_LOCK_CTA']) {
    assert.ok(keys.includes(`'${k}'`), k);
    for (const locale of ['en', 'ko', 'zh', 'ru', 'ar']) assert.equal(sql.split(`('${k}','${locale}',`).length - 1, 2, `${k}/${locale}: PROD and DEV`);
  }
});
