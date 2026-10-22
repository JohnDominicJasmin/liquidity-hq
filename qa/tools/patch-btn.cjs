const fs = require('fs');
let s = fs.readFileSync('mutate-btn.mjs', 'utf8');
const rep = (a, b) => { const n = s.split(a).length - 1; if (n !== 1) throw new Error('anchor x' + n + ': ' + a.slice(0, 60)); s = s.replace(a, () => b); };
rep("const PAGE = 'app/settings/page.tsx';", "const PAGE = 'app/settings/page.tsx';\nconst JSONF = 'lib/labelDefaults.en.json';\nconst KEYS = 'lib/labelKeys.ts';\nconst MIG = 'supabase/migrations/20260926a_labels_subscription_cancel.sql';\nconst VIEW = 'lib/subscriptionPanel.ts';");
rep("const FILES = [CSS, PAGE];", "const FILES = [CSS, PAGE, JSONF, KEYS, MIG, VIEW];");
rep("      if (n !== 1) { console.log(`SKIP    ${m.name}\n        anchor occurs ${n}x`); all = false; continue; }\n      out = src.replace(m.from, () => m.to);",
    "      const need = m.nth ?? 1;\n      if (m.nth ? n < need : n !== 1) { console.log(`SKIP    ${m.name}\n        anchor occurs ${n}x`); all = false; continue; }\n      let at = -1;\n      for (let i = 0; i < need; i++) at = src.indexOf(m.from, at + 1);\n      out = src.slice(0, at) + m.to + src.slice(at + m.from.length);");
rep("];\n\nconst FILES", "  // dated confirm sentence (G9-G14)\n  ...DATED_MUTATIONS,\n];\n\nconst FILES");
rep("const M = [", "const DATED_MUTATIONS = [];\nconst M = [");
fs.writeFileSync('mutate-btn.mjs', s);
console.log('ok');
