import test from 'node:test';
import assert from 'node:assert/strict';
import { clampMaxTokens, MAX_TOKENS_CEILING } from '../lib/grokTokenClamp.ts';

test('clampMaxTokens', async (t) => {
  await t.test('under ceiling passes through', () => {
    assert.equal(clampMaxTokens(100), 100);
  });

  await t.test('exactly at ceiling passes through', () => {
    assert.equal(clampMaxTokens(MAX_TOKENS_CEILING), MAX_TOKENS_CEILING);
  });

  await t.test('just over ceiling clamps', () => {
    assert.equal(clampMaxTokens(MAX_TOKENS_CEILING + 1), MAX_TOKENS_CEILING);
  });

  await t.test('way over ceiling clamps (the actual attack case)', () => {
    assert.equal(clampMaxTokens(999999), MAX_TOKENS_CEILING);
  });

  await t.test('zero falls back to ceiling', () => {
    assert.equal(clampMaxTokens(0), MAX_TOKENS_CEILING);
  });

  await t.test('negative falls back to ceiling', () => {
    assert.equal(clampMaxTokens(-50), MAX_TOKENS_CEILING);
  });

  await t.test('non-numeric string falls back to ceiling', () => {
    assert.equal(clampMaxTokens('abc'), MAX_TOKENS_CEILING);
  });

  await t.test('undefined falls back to ceiling', () => {
    assert.equal(clampMaxTokens(undefined), MAX_TOKENS_CEILING);
  });

  await t.test('numeric string under ceiling coerces and passes through', () => {
    assert.equal(clampMaxTokens('450'), 450);
  });
});
