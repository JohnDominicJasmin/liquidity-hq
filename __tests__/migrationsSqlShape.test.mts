/* MIGRATION SQL SHAPE GUARD (PM 2026-11-18: three label migrations (18w, 18s, 18p) reached review with a trailing comma before `on conflict`, a syntax error that only shows when someone applies the file).
 * Every supabase/migrations/*.sql file is checked WITHOUT a database, after comments, string literals and $$ blocks are blanked out (so a comma or bracket inside a label's text cannot trip or hide anything):
 *   S1  no comma directly before `on conflict`, `;` or the end of the file (the exact bug)
 *   S2  no two value rows touch with no comma between them: `) (` or `)\n(` inside a VALUES list
 *   S3  round brackets balance in every statement, and every single quote is closed (an odd number of quotes means a label with an unescaped apostrophe)
 *   S4  every statement ends with `;` (the last non-comment text of a file is a semicolon)
 *   S5  CONTROLS: each of these four checks is run on a planted bad file and must fire; and a known-good insert must pass: so a silent regex change turns this red, not green
 * WHAT IT CANNOT PROVE: that the SQL runs against the real schema (columns, constraints): it only catches the shape errors that make a file unparsable. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

/** comments, $$...$$ blocks and 'string literals' blanked (a quoted label may contain commas, brackets, "on conflict"); returns the shape plus how many quotes were left open */
function shape(sql: string): { text: string; openQuote: boolean } {
  let s = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
  s = s.replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "'d'");
  let out = '', i = 0, open = false;
  while (i < s.length) {
    const c = s[i];
    if (c === "'") { let j = i + 1; for (;;) { if (j >= s.length) { open = true; break; } if (s[j] === "'") { if (s[j + 1] === "'") { j += 2; continue; } break; } j++; } out += "'s'"; i = j + 1; }
    else { out += c; i++; }
  }
  return { text: out, openQuote: open };
}
function problems(sql: string): string[] {
  const { text, openQuote } = shape(sql), p: string[] = [];
  if (openQuote) p.push('S3: a single quote is never closed (an unescaped apostrophe in a label?)');
  const comma = /,\s*(on\s+conflict\b|;|$)/i.exec(text); if (comma) p.push(`S1: a comma directly before "${comma[1] || 'end of file'}" near: ${text.slice(Math.max(0, comma.index - 50), comma.index + 30).replace(/\s+/g, ' ')}`);
  const touch = /\)\s*\(\s*'/.exec(text); if (touch) p.push(`S2: two value rows with no comma between them near: ${text.slice(Math.max(0, touch.index - 40), touch.index + 40).replace(/\s+/g, ' ')}`);
  for (const stmt of text.split(';')) { let d = 0; for (const ch of stmt) { if (ch === '(') d++; else if (ch === ')') d--; if (d < 0) break; } if (d !== 0) p.push(`S3: round brackets do not balance in a statement starting: ${stmt.trim().slice(0, 70).replace(/\s+/g, ' ')}`); }
  const tail = text.trim(); if (tail && !tail.endsWith(';')) p.push('S4: the file does not end with a semicolon');
  return p;
}

test('S1-S4. every migration file is well-formed SQL by shape', () => {
  assert.ok(files.length > 50, `only ${files.length} migration files found: the path moved`);
  const bad = files.map((f) => ({ f, p: problems(readFileSync(new URL(f, dir), 'utf8')) })).filter((x) => x.p.length);
  assert.deepEqual(bad.map((x) => `${x.f}: ${x.p.join(' | ')}`), [], `migration shape errors:\n${bad.map((x) => `${x.f}: ${x.p.join(' | ')}`).join('\n')}`);
});

test('S5. controls: the checks fire on planted bad files and stay quiet on a good one', () => {
  const good = "insert into lhq_labels (key, locale, value) values\n('A','en','it''s fine, (really) on conflict'),\n('B','ko','한국어')\non conflict (key, locale) do update set value = excluded.value;\n";
  assert.deepEqual(problems(good), [], 'the known-good insert was flagged (a quote, comma or bracket inside a label must not matter)');
  assert.ok(problems(good.replace("'한국어')\non conflict", "'한국어'),\non conflict")).some((x) => x.startsWith('S1')), 'S1 did not catch a comma before on conflict');
  assert.ok(problems(good.replace("'),\n('B'", "')\n('B'")).some((x) => x.startsWith('S2')), 'S2 did not catch missing comma between rows');
  assert.ok(problems(good.replace("it''s", "it's")).some((x) => x.startsWith('S3')), 'S3 did not catch an unescaped apostrophe');
  assert.ok(problems(good.replace("'B','ko','한국어')", "'B','ko','한국어'")).some((x) => x.startsWith('S3')), 'S3 did not catch an unbalanced bracket');
  assert.ok(problems(good.replace(/;\n$/, '\n')).some((x) => x.startsWith('S4')), 'S4 did not catch a missing final semicolon');
});
