/* QA #1185 item 83 (#1113): the onboarding "Connect Telegram" tick follows the real Telegram link. The provider's own derivation is lifted from components/OnboardingProvider.tsx and RUN.
 *   G1 once the settings row is read: a saved chat id ticks it, no chat id un-ticks it, whatever the old stored tick says
 *   G2 while the row is loading or could not be read: the stored tick stands, an unread link is never shown as "not done"
 *   G3 the other three items are not touched, and "all done" counts the derived tick
 *   G4 what the screens are given is the derived state */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const src = readFileSync(new URL('../components/OnboardingProvider.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const from = src.indexOf('  const telegramLinked = ');
const doneAt = src.indexOf('  const allDone = ', from);
const to = src.indexOf(';\n', doneAt);
assert.ok(from > 0 && doneAt > from && to > doneAt, 'CONTROL: the derivation was not found');
const code = ts.transpileModule(src.slice(from, to + 1), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
type Flags = { telegram: boolean; priceAlert: boolean; grok: boolean; coins: boolean; tourSeen: boolean; profileComplete: boolean };
const derive = new Function('settings', 'settingsLoadStatus', 'state', `${code}\nreturn { derivedState, allDone };`) as (s: { telegram_chat_id?: string | null }, status: string, state: Flags) => { derivedState: Flags; allDone: boolean };
const flags = (extra: Partial<Flags> = {}): Flags => ({ telegram: false, priceAlert: true, grok: true, coins: true, tourSeen: true, profileComplete: true, ...extra });

test('G1. read: the tick is the link', () => {
  for (const stored of [false, true]) {
    for (const id of ['123456789', ' -100200 ']) assert.equal(derive({ telegram_chat_id: id }, 'ready', flags({ telegram: stored })).derivedState.telegram, true, `${id} stored=${stored}`);
    for (const id of ['', '   ', null, undefined]) assert.equal(derive({ telegram_chat_id: id }, 'ready', flags({ telegram: stored })).derivedState.telegram, false, `${JSON.stringify(id)} stored=${stored}`);
  }
});

test('G2. not read: the stored tick stands', () => {
  for (const status of ['loading', 'error', 'idle']) for (const stored of [false, true]) for (const id of ['', '123'])
    assert.equal(derive({ telegram_chat_id: id }, status, flags({ telegram: stored })).derivedState.telegram, stored, `${status} stored=${stored} id=${id}`);
});

test('G3. nothing else moves; all done counts the derived tick', () => {
  const state = flags({ priceAlert: false, tourSeen: false });
  const { derivedState } = derive({ telegram_chat_id: '1' }, 'ready', state);
  assert.deepEqual(derivedState, { ...state, telegram: true });
  assert.equal(state.telegram, false, 'the stored state itself is not rewritten');
  assert.equal(derive({ telegram_chat_id: '1' }, 'ready', flags()).allDone, true);
  assert.equal(derive({ telegram_chat_id: '' }, 'ready', flags({ telegram: true })).allDone, false);
  for (const key of ['priceAlert', 'grok', 'coins'] as const) assert.equal(derive({ telegram_chat_id: '1' }, 'ready', flags({ [key]: false })).allDone, false, key);
});

test('G4. the provider hands out the derived state, and reads the link from the settings it is given', () => {
  assert.ok(src.includes('<CTX.Provider value={{ state: derivedState,'));
  assert.ok(src.includes('const { settings, settingsLoadStatus } = useSettings();'));
});
