import test from 'node:test';
import assert from 'node:assert/strict';
import { safeNextPath } from '../lib/safeNext.ts';

const FALLBACK = '/dashboard';

test('safeNextPath', async (t) => {
  await t.test('simple valid path', () => {
    assert.equal(safeNextPath('/arena', FALLBACK), '/arena');
  });

  await t.test('valid path with query string', () => {
    assert.equal(safeNextPath('/arena?tf=1h', FALLBACK), '/arena?tf=1h');
  });

  await t.test('valid path with fragment', () => {
    assert.equal(safeNextPath('/journal#stats', FALLBACK), '/journal#stats');
  });

  await t.test('root path alone', () => {
    assert.equal(safeNextPath('/', FALLBACK), '/');
  });

  await t.test('nested valid path', () => {
    assert.equal(safeNextPath('/a/b/c/d', FALLBACK), '/a/b/c/d');
  });

  await t.test('protocol-relative double-slash attack falls back', () => {
    assert.equal(safeNextPath('//evil.com', FALLBACK), FALLBACK);
  });

  await t.test('backslash-after-leading-slash attack falls back (the actual CVE)', () => {
    assert.equal(safeNextPath('/\\evil.com', FALLBACK), FALLBACK);
  });

  await t.test('backslash with no leading slash falls back', () => {
    assert.equal(safeNextPath('\\evil.com', FALLBACK), FALLBACK);
  });

  await t.test('no leading slash at all falls back', () => {
    assert.equal(safeNextPath('evil.com', FALLBACK), FALLBACK);
  });

  await t.test('empty string falls back', () => {
    assert.equal(safeNextPath('', FALLBACK), FALLBACK);
  });

  await t.test('null falls back', () => {
    assert.equal(safeNextPath(null, FALLBACK), FALLBACK);
  });

  await t.test('undefined falls back', () => {
    assert.equal(safeNextPath(undefined, FALLBACK), FALLBACK);
  });

  await t.test('control character (tab) injection falls back', () => {
    assert.equal(safeNextPath('/a\tb', FALLBACK), FALLBACK);
  });
});
