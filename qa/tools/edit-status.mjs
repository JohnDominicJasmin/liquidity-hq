import { readFileSync, writeFileSync } from 'node:fs';
const p = 'qa/STATUS.md';
let s = readFileSync(p, 'utf8');
const eol = s.includes('\r\n') ? '\r\n' : '\n';
s = s.replace(/\r\n/g, '\n');
const rep = (from, to) => {
  if (s.split(from).length !== 2) throw new Error('expected exactly one match: ' + from.slice(0, 70));
  s = s.replace(from, () => to);
};
rep("| **TERMINAL IS THE DEFAULT ON EVERY ROUTE.** No query param needed;",
    "| **TERMINAL IS THE DEFAULT ON EVERY ROUTE.** *(2026-09-19: `resolveDesignMode` and `lib/designMode.ts` are gone and `data-design=\"terminal\"` is a static attribute on `<html>`, #1111.)* No query param needed;");
rep("| **`?design=current` STAYS, and it is the rollback.**",
    "| **SUPERSEDED 2026-09-19: #1111 deleted the switch. `?design=current` and a stored `lhq-design-mode` do nothing now, and a rollback is a revert of that PR.** *What this row said until then:* **`?design=current` STAYS, and it is the rollback.**");
rep("The opt-out survives navigation - it is stored, not per-request | 2026-09-04 | #768; `lib/designMode.ts` |",
    "The opt-out survives navigation - it is stored, not per-request | 2026-09-04 | #768; `lib/designMode.ts`; superseded by #1111 |");
rep("| **The audit sweeps take `--design`, and the default stays `terminal`.**",
    "| **The audit sweeps take `--design`, and the default stays `terminal`.** *(2026-09-19: only `terminal` exists since #1111. `platform-audit.mjs` now refuses any other value, and `QA_CONTRAST_DESIGN` / `QA_LAYOUT_DESIGN` are gone.)*");
writeFileSync(p, s.replace(/\n/g, eol));
console.log('ok');
