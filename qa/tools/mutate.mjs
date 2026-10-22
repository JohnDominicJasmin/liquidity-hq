// Usage: node mutate.mjs <worktree> <n>  - applies mutation n (1-4) in place. Restore with git checkout -- <file>.
// Files are CRLF in the worktree; every pattern tolerates that.
import { readFileSync, writeFileSync } from 'node:fs';
const [, , wt, n] = process.argv;
const MIG = `${wt}/supabase/migrations/20261001c_labels_translations_ko_zh_ar_ru.sql`;
const edit = (file, fn) => { const s = readFileSync(file, 'utf8'); const out = fn(s); if (out === s) throw new Error('mutation changed nothing'); writeFileSync(file, out); };
if (n === '1') {
  // delete one dev-block row
  edit(MIG, (s) => s.replace(/^-- \('NAV_THEME_TO_LIGHT','ko',.*\r?\n/m, ''));
} else if (n === '2') {
  // change one translation (first match = live block) to ''
  edit(MIG, (s) => s.replace(/^\('NAV_THEME_TO_DARK','zh',.*$/m, "('NAV_THEME_TO_DARK','zh',''),"));
} else if (n === '3') {
  // drop {cap} from one translation, in BOTH blocks, so the blocks still agree and only the placeholder test should fire
  edit(MIG, (s) => s.replace(/^((?:-- )?\('ALERTS_TF_CAP_OVER_MSG','ru',.*?)\{cap\}/gm, '$1'));
} else if (n === '4') {
  // reintroduce a searchParams.get('design') read
  edit(`${wt}/components/PositionSizer.tsx`, (s) => s.replace("const [account, setAccount] = useState(() => searchParams.get('acc') ?? '');", "const [account, setAccount] = useState(() => searchParams.get('acc') ?? '');\r\n  const designMode = searchParams.get('design');\r\n  void designMode;"));
}
console.log('mutation', n, 'applied');
