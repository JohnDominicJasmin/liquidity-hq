import test from 'node:test';
import assert from 'node:assert/strict';
import { makeLinkCode, LINK_CODE_ALPHABET, LINK_CODE_LEN } from '../lib/telegramLinkCode.ts';

const AMBIGUOUS = ['0', 'O', '1', 'I', 'L'];

test('makeLinkCode', async (t) => {
  await t.test('alphabet excludes ambiguous characters', () => {
    for (const ch of AMBIGUOUS) {
      assert.ok(!LINK_CODE_ALPHABET.includes(ch), `alphabet should not contain ${ch}`);
    }
  });

  await t.test('every generated code has the expected length', () => {
    for (let i = 0; i < 200; i++) {
      assert.equal(makeLinkCode().length, LINK_CODE_LEN);
    }
  });

  await t.test('every character of every generated code is in the alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = makeLinkCode();
      for (const ch of code) {
        assert.ok(LINK_CODE_ALPHABET.includes(ch), `${ch} in ${code} is outside the alphabet`);
      }
    }
  });

  await t.test('1000 codes are all unique (entropy sanity check)', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i++) codes.add(makeLinkCode());
    assert.equal(codes.size, 1000);
  });

  await t.test('every alphabet character appears at least once over a large sample (distribution sanity check)', () => {
    const seen = new Set<string>();
    // 32-symbol alphabet, 10 chars/code -> 320 draws/code; 200 codes is
    // generous headroom for every symbol to show up if draws are uniform.
    for (let i = 0; i < 200; i++) {
      for (const ch of makeLinkCode()) seen.add(ch);
    }
    for (const ch of LINK_CODE_ALPHABET) {
      assert.ok(seen.has(ch), `${ch} never appeared across the sample`);
    }
  });
});
