/* Visible correction of my own earlier #1423 comments. Strike through, annotate, never delete.
 * Each replacement must match EXACTLY ONCE or the whole run aborts before writing anything -
 * a correction that silently did not apply is the same failure as the claim it corrects. */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SP = process.argv[2];
const comments = JSON.parse(readFileSync(`${SP}/c1423.json`, 'utf8'));
const REPO = 'repos/JohnDominicJasmin/liquidity-hq/issues/comments';

const BANNER = (extra) =>
  `> **CORRECTION, 2026-09-25 (QA Team).** ${extra}\n` +
  `> The old build dimmed **all three** buttons — its source set \`opacity: redirecting ? 0.7 : 1\` on each — exactly as it relabelled all three. ` +
  `The earlier "wrong button dims / fortnightly dim every time" claim was an **artifact of my measurement**: I read computed opacity 8 ms after the click, ` +
  `in a background tab where CSS transitions do not advance, and only the fortnightly button had no opacity transition. It is **not** a second defect. ` +
  `Struck-through text below is the wrong claim, left visible on purpose. Full correction: the comment of 2026-09-25 19:46Z on this issue.\n\n`;

const STRIKE = ' *(struck 2026-09-25 — measurement artifact, see the correction above)*';

const edits = {
  5810269772: {
    banner: BANNER('The label and `disabled` columns of the table below stand; **the `op` (opacity) values in it do not** — they are computed-style reads from that background tab.'),
    replace: [
      // the whole paragraph, struck
      [/\*\*One thing the fix report did not mention[\s\S]*?(?=\n\n|\n## |\n\*\*)/, (m) => `~~${m.replace(/\n/g, ' ').trim()}~~${STRIKE}`],
      ['(the wrong-button dim goes with it)', `~~(the wrong-button dim goes with it)~~${STRIKE}`],
    ],
  },
  5823590473: {
    banner: BANNER('One sentence in the list below is wrong.'),
    replace: [
      ['— the previous code dimmed the fortnightly button every time.', `~~— the previous code dimmed the fortnightly button every time.~~${STRIKE}`],
    ],
  },
  5838322066: {
    banner: BANNER('One table cell below is wrong.'),
    replace: [
      ['wrong button dimmed;', `~~wrong button dimmed;~~${STRIKE}`],
    ],
  },
  5838353288: {
    banner: BANNER('One table cell below is wrong.'),
    replace: [
      ['the wrong button dims;', `~~the wrong button dims;~~${STRIKE}`],
    ],
  },
};

const out = [];
for (const [idStr, spec] of Object.entries(edits)) {
  const id = Number(idStr);
  const orig = comments.find((c) => c.id === id)?.body;
  if (!orig) { console.error(`ABORT: comment ${id} not found`); process.exit(2); }
  if (orig.startsWith('> **CORRECTION')) { console.error(`ABORT: comment ${id} already corrected`); process.exit(2); }
  let body = orig;
  for (const [from, to] of spec.replace) {
    if (typeof from === 'string') {
      const n = body.split(from).length - 1;
      if (n !== 1) { console.error(`ABORT: ${id}: anchor occurs ${n}x, need exactly 1: ${from.slice(0, 50)}`); process.exit(2); }
      body = body.replace(from, to);
    } else {
      const m = body.match(from);
      if (!m) { console.error(`ABORT: ${id}: regex did not match`); process.exit(2); }
      body = body.replace(from, to);
    }
  }
  out.push([id, spec.banner + body]);
}

for (const [id, body] of out) {
  const f = `${SP}/patched-${id}.md`;
  writeFileSync(f, body);
  const r = execFileSync('gh', ['api', '-X', 'PATCH', `${REPO}/${id}`, '-F', `body=@${f}`, '--jq', '.html_url'], { encoding: 'utf8' });
  console.log(`patched ${id}: ${r.trim()}`);
}
