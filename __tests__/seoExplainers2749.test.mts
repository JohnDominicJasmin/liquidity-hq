/* QA: PRs #2749 + #2750 + #2755 (held, v2026.11.24), #1185 SEO strategic item 1: a server-rendered explainer (150-300 words) and an FAQ (4 items, FAQPage structured data) under the terminal on eight pages: /liq /funding /scanner /calc /hours /econ-calendar /markets /news. The pin reads whatever topics lib/seoExplainers.ts holds on the head it runs on, so it applies at each level of the stack (#2749 has two topics, #2750 six, #2755 eight).
 *
 * THE WRITTEN RULE (the PR bodies): each topic = a title, two paragraphs of 150-300 words together, and 4 question / answer pairs; the FAQPage JSON-LD is built from the SAME English defaults as the visible text, with `<` escaped for the script tag; facts only (no accuracy or advice claim, no AI vendor name, no outlet the code does not read: Reuters and AP are out); the text is in the server HTML (the route is a server component and renders the explainer + the script); the held migrations carry the same English text and a ko / zh / ru row for every key, in a PROD block (lhq_labels) and a DEV block (lhq_dev_labels).
 *   X1  STRUCTURE: every topic has a title, two paragraphs of 150-300 words together, four questions ending in "?" with non-empty answers, every key a non-empty English default with no placeholder braces
 *   X2  THE JSON-LD: parses, is a FAQPage, carries the topic's four questions and answers equal to the defaults character for character, and has no raw `<` (script-safe)
 *   X3  COPY RULES: no AI vendor or model name, no Reuters / AP / Bloomberg, no promise wording
 *   X4  WIRING: each topic is rendered by exactly one route file as <SeoExplainer topic="T" /> next to a JSON-LD script built for the SAME topic, in a file that is not a client component; the terminal / page is still rendered; no topic is unrouted and no route renders an unknown topic
 *   X5  THE HELD MIGRATIONS: each key has en / ko / zh / ru once in the PROD block and once in the DEV block; the en value is the default, character for character; ko / zh / ru differ from English; together the files cover every SEO_* default and invent none; each says NOT YET APPLIED
 *   X6  CONTROLS: the word counter, the apostrophe un-escaper and the key census are exercised on known inputs, so a green above is not an artefact
 * WHAT THIS CANNOT PROVE: how the page looks (a browser cell on a deployed build), that the rows are applied before the release deploy (PM's step), or the quality of the ko / zh / ru drafts (AI-drafted, not native-reviewed, as the PRs say). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { EXPLAINERS, faqJsonLd, type ExplainerTopic } from '../lib/seoExplainers.ts';
import { appPath } from './_appPath.mts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const EN = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
const TOPICS = Object.keys(EXPLAINERS) as ExplainerTopic[];
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const unSql = (s: string) => s.replace(/''/g, "'");
const ROUTE: Record<string, string> = { liq: 'app/liq/page.tsx', funding: 'app/funding/page.tsx', scanner: 'app/scanner/layout.tsx', calc: 'app/calc/layout.tsx', hours: 'app/hours/layout.tsx', econ: 'app/econ-calendar/layout.tsx', markets: 'app/markets/layout.tsx', news: 'app/news/layout.tsx' };
const MIGS = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((f) => /^20261129[a-z]?_labels_seo_explainers/.test(f)).sort();

test('X6. controls: the word counter and the key census', () => {
  assert.equal(words('  one two   three\nfour '), 4); assert.equal(unSql("it''s"), "it's"); assert.ok(TOPICS.length >= 2, 'CONTROL: fewer than two topics found'); assert.ok(MIGS.length >= 1, 'CONTROL: no held migration found');
  assert.ok(Object.keys(EN).filter((k) => k.startsWith('SEO_')).length >= 23, 'CONTROL: the SEO_ defaults are missing');
});

test('X1. every topic has a title, 150-300 words of explainer and four question / answer pairs', () => {
  const counts: string[] = [];
  for (const t of TOPICS) {
    const e = EXPLAINERS[t]; for (const k of [e.title, ...e.paras, ...e.faq.flatMap((f) => [f.q, f.a])]) { assert.ok(typeof EN[k] === 'string' && EN[k].trim().length > 0, `${t}: ${k} has no English default`); assert.ok(!/[{}]/.test(EN[k]), `${t}: ${k} has a placeholder brace`); }
    assert.equal(e.paras.length, 2, `${t}: paragraphs`); const w = e.paras.reduce((n, k) => n + words(EN[k]), 0); counts.push(`${t}:${w}`); assert.ok(w >= 150 && w <= 300, `${t}: the explainer is ${w} words`);
    assert.equal(e.faq.length, 4, `${t}: FAQ items`); for (const f of e.faq) assert.ok(/\?$/.test(EN[f.q].trim()), `${t}: "${EN[f.q]}" is not a question`);
  }
  console.log(`[X1] explainer words ${counts.join(' ')}`);
});

test('X2. the FAQPage JSON-LD equals the visible English text and is script-safe', () => {
  /* the shipped text has no `<` today, so the output check below cannot see the escape; pin the escape in the code that has to do it */
  const lib = read('lib/seoExplainers.ts'); const body = lib.slice(lib.indexOf('export function faqJsonLd')); assert.ok(body.includes('JSON.stringify(data)') && body.includes('.replace(/</g,'), 'faqJsonLd no longer escapes `<` after JSON.stringify'); assert.ok(body.includes('u003c'), 'the escape is not \\u003c');
  for (const t of TOPICS) {
    const s = faqJsonLd(t); assert.ok(!s.includes('<'), `${t}: a raw < is in the script body`); const j = JSON.parse(s); assert.equal(j['@context'], 'https://schema.org'); assert.equal(j['@type'], 'FAQPage'); assert.equal(j.mainEntity.length, 4);
    EXPLAINERS[t].faq.forEach((f, i) => { const m = j.mainEntity[i]; assert.equal(m['@type'], 'Question'); assert.equal(m.name, EN[f.q], `${t} Q${i + 1}`); assert.equal(m.acceptedAnswer['@type'], 'Answer'); assert.equal(m.acceptedAnswer.text, EN[f.a], `${t} A${i + 1}`); });
  }
});

test('X3. facts only: no vendor, no outlet the code does not read, no promise', () => {
  const all: Array<readonly [string, string]> = TOPICS.flatMap((t) => [EXPLAINERS[t].title, ...EXPLAINERS[t].paras, ...EXPLAINERS[t].faq.flatMap((f) => [f.q, f.a])].map((k) => [`${t}/${k}`, EN[k]] as const)); all.push(['SEO_FAQ_TITLE', EN.SEO_FAQ_TITLE]);
  for (const [k, v] of all) { assert.ok(!/anthropic|claude|openai|gpt\b|chatgpt|grok|xai\b|gemini|llama|mistral/i.test(v), `${k} names an AI vendor / model`); assert.ok(!/reuters|\bAP\b|associated press|bloomberg/i.test(v), `${k} names an outlet the code does not read`); assert.ok(!/guarantee|risk-free|can't lose|will (?:rise|fall|pump|dump|go up|go down)/i.test(v), `${k} makes a promise`); }
});

test('X4. each topic is rendered by exactly one server route, next to a JSON-LD script for the same topic', () => {
  const rendered = new Map<string, string[]>();
  for (const t of TOPICS) {
    const rel = appPath(ROUTE[t]); const src = read(rel); assert.ok(!/^\s*['"]use client['"]/.test(src), `${ROUTE[t]} is a client component (the explainer would not be in the server HTML)`);
    assert.match(src, new RegExp(`<SeoExplainer topic="${t}"\\s*/>`), `${ROUTE[t]} does not render the ${t} explainer`); assert.match(src, new RegExp(`faqJsonLd\\('${t}'\\)`), `${ROUTE[t]} builds JSON-LD for another topic`); assert.match(src, /type="application\/ld\+json"/);
    const topics = [...src.matchAll(/<SeoExplainer topic="(\w+)"/g)].map((m) => m[1]); assert.deepEqual(topics, [t], `${ROUTE[t]} renders ${JSON.stringify(topics)}`); rendered.set(t, topics);
  }
  assert.ok(/<LiqTerminal\s*\/>/.test(read(appPath('app/liq/page.tsx'))) || !TOPICS.includes('liq'), '/liq no longer renders its terminal'); assert.ok(!TOPICS.includes('funding') || /<\w*Funding\w*\s*\/>/.test(read(appPath('app/funding/page.tsx'))), '/funding no longer renders its terminal');
  for (const t of TOPICS) if (['scanner', 'calc', 'hours', 'econ', 'markets', 'news'].includes(t)) assert.match(read(appPath(ROUTE[t])), /\{children\}/, `${ROUTE[t]} dropped the page it wraps`);
});

test('X5. the held migrations: four locales per key in both projects, English equal to the default', () => {
  const seen = new Set<string>();
  for (const f of MIGS) {
    const sql = read(`supabase/migrations/${f}`); assert.match(sql, /NOT YET APPLIED/, `${f} does not say NOT YET APPLIED`);
    const p = sql.indexOf('insert into lhq_labels'), d = sql.indexOf('insert into lhq_dev_labels'); assert.ok(p > 0 && d > p, `${f}: PROD / DEV blocks`);
    const blockKeys: string[][] = [];
    for (const [name, block] of [['PROD', sql.slice(p, d)], ['DEV', sql.slice(d)]] as const) {
      const rows = [...block.matchAll(/\('(SEO_[A-Z0-9_]+)','([a-z]{2})','((?:[^']|'')*)'\)/g)]; const per = new Map<string, Map<string, string>>();
      for (const r of rows) { const m = per.get(r[1]) ?? new Map<string, string>(); assert.ok(!m.has(r[2]), `${f} ${name}: ${r[1]}/${r[2]} twice`); m.set(r[2], unSql(r[3])); per.set(r[1], m); }
      for (const [k, m] of per) { assert.deepEqual([...m.keys()].sort(), ['en', 'ko', 'ru', 'zh'], `${f} ${name}: ${k} locales`); assert.equal(m.get('en'), EN[k], `${f} ${name}: ${k} en differs from the default`); for (const l of ['ko', 'zh', 'ru']) { assert.ok(m.get(l)!.trim().length > 0, `${f} ${name}: ${k}/${l} empty`); assert.notEqual(m.get(l), m.get('en'), `${f} ${name}: ${k}/${l} is the English text carried over`); } }
      assert.match(block, /on conflict \(key, locale\) do update set value = excluded\.value/, `${f} ${name}: not an upsert`); blockKeys.push([...per.keys()].sort());
    }
    assert.deepEqual(blockKeys[0], blockKeys[1], `${f}: PROD and DEV carry different keys`); blockKeys[0].forEach((k) => seen.add(k));
  }
  const defaults = Object.keys(EN).filter((k) => k.startsWith('SEO_')); const missing = defaults.filter((k) => !seen.has(k)); const extra = [...seen].filter((k) => !(k in EN));
  console.log(`[X5] ${MIGS.length} migration file(s), ${seen.size} keys, SEO_* defaults ${defaults.length}`); assert.deepEqual(extra, [], 'a migration row has no English default'); assert.deepEqual(missing, [], 'a default has no migration rows');
  assert.ok(existsSync(new URL('../lib/labelKeys.ts', import.meta.url)));
  const keysTs = read('lib/labelKeys.ts'); for (const k of defaults) assert.ok(keysTs.includes(`'${k}'`) || keysTs.includes(`"${k}"`) || keysTs.includes(k), `${k} is not registered in labelKeys.ts`);
});
