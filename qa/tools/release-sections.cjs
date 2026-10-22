const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'release-prs');
const rows = fs.readdirSync(dir).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).sort((a, b) => a.number - b.number);
const out = [];
for (const p of rows) {
  const b = (p.body || '').replace(/\r/g, '');
  const sec = (name) => {
    const m = b.match(new RegExp('(?:^|\\n)#{2,}\\s*' + name + '[^\\n]*\\n([\\s\\S]*?)(?=\\n#{2,}\\s|$)', 'i'));
    return m ? m[1].trim() : null;
  };
  const kinds = [...new Set(p.files.map((f) => f.split('/')[0]))].join(',');
  out.push({ number: p.number, title: p.title, kinds, nFiles: p.files.length, how: sec('How to test'), risk: sec('Risk level'), env: sec('Environment variables'), migrations: p.files.filter((f) => f.startsWith('supabase/')) });
}
fs.writeFileSync(path.join(__dirname, 'release-sections.json'), JSON.stringify(out, null, 1));
const lim = +process.argv[2] || 700;
for (const p of out) console.log(`\n===== #${p.number} ${p.title}\nfiles(${p.nFiles}): ${p.kinds}${p.migrations.length ? '\nMIGRATIONS: ' + p.migrations.join(', ') : ''}\n--- HOW:\n${(p.how || '(none)').slice(0, lim)}\n--- RISK:\n${(p.risk || '(none)').slice(0, lim)}\n--- ENV: ${(p.env || '(none)').slice(0, 200)}`);
