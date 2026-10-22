const fs = require('fs');
const SP = 'C:/Users/Dominic/AppData/Local/Temp/claude/C--Users-Dominic-Documents-VS-code-liquidity-hq-qa-liquidity-hq/a64439a2-d725-4529-aa87-8c1c2203fbaf/scratchpad/';
const F = '__tests__/aiSpendCap.test.mts';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let raw = fs.readFileSync(F, 'utf8');
const crlf = raw.includes(CR + LF);
let s = raw.split(CR + LF).join(LF);
const rep = (a, b) => { const n = s.split(a).length - 1; if (n !== 1) throw new Error('anchor x' + n + ': ' + a.slice(0, 70)); s = s.replace(a, () => b); };

// header paragraph
const lines = s.split(LF);
const h0 = lines.findIndex((l) => l.includes('THIS FILE, first part'));
const h1 = lines.findIndex((l) => l.includes('Expectations are written from the owner'));
if (h0 < 0 || h1 < 0) throw new Error('header anchors');
lines.splice(h0, h1 - h0, ...[
  ' * PART 1 (first half of the file): what does not depend on how the ledger is summed. The constants as recorded DECISIONS,',
  ' * the UTC window boundaries, the owner\'s four messages and their mapping to the four block reasons.',
  ' *',
  ' * PART 2 (second half): the decisions. The first version summed the ledger in JS after a plain select, and this project\'s',
  ' * PostgREST caps every read at 1000 rows, so a heavy account or a busy site was summed over a TRUNCATED set and the',
  ' * monthly cap and the fuse could under-count and never trip (finding on #1437). The sums now live in two SQL functions',
  ' * (supabase/migrations/20260927b_ai_spend_sums.sql) and the tests below run the real spendCapBlock and',
  ' * incrementUsageColumn against a stand-in for the database.',
  ' *',
]);
s = lines.join(LF);

rep("import test from 'node:test';", "import test, { type TestContext } from 'node:test';");
rep("import { readFileSync } from 'node:fs';", "import { readFileSync } from 'node:fs';\nimport { fileURLToPath } from 'node:url';\nimport { execFileSync } from 'node:child_process';");
rep("  dayStartIsoUtc, monthStartIsoUtc, spendCapLabelKey, type SpendReason,\n} from '../lib/aiSpendCap.ts';",
    "  dayStartIsoUtc, monthStartIsoUtc, spendCapLabelKey, spendCapBlock, spendSumToUsd,\n  NULL_COST_SEARCH_ESTIMATE_USD, NULL_COST_OTHER_ESTIMATE_USD, type SpendReason,\n} from '../lib/aiSpendCap.ts';\nimport { PLAIN_CALL_COST_USD } from '../lib/aiCost.ts';\nimport type { UsageTier } from '../lib/limits.ts';");

const tail = fs.readFileSync(SP + 'aicaps-tail.mts', 'utf8').split(CR + LF).join(LF);
s = s.replace(/\n+$/, '\n') + tail;
if (crlf) s = s.split(LF).join(CR + LF);
fs.writeFileSync(F, s);
console.log('assembled, CRLF kept:', crlf, 'lines:', s.split(LF).length);
