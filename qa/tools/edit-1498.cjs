const fs = require('fs');
const p = process.argv[2];
const lines = fs.readFileSync(p, 'utf8').split('\n');
let n = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].startsWith('**The owner approved this release from screenshot sets 1 and 2')) {
    lines[i] = '**The owner approved this release from screenshot sets 1, 2 and 3** ("do the recommendation", 01:43Z; and on set 3: "the \'Saved\' text is my only concern but the rest are approved", relayed by PM). **The one open item is the save message\'s position** (#1460): it is being moved to top-centre in a fix PR into `staging`. This PR merges once QA\'s toast pairs pass (0 px² overlap with the Ask AI button, the tab bar and the top bar) and the owner has seen the toast pair.';
    n++;
  }
  if (lines[i].startsWith('- **Set 3 not yet seen by the owner: BLOCKER.**')) {
    lines[i] = '- **Open item, the only one: the save message position (#1460).** The owner approved every other visual in this release, set 3 included, but rejected "Saved" overlapping the Ask AI button and the tab bar. The fix moves it top-centre at every width. It lands in `staging` as its own PR. QA measures it at 390/768/1280/1440/1920, light and dark, for Saved, Updated from another device and Couldn\'t save. The merge waits for that pair and the owner\'s look.';
    n++;
  }
  if (lines[i].startsWith('- **Set 3**, the state screens:')) {
    lines[i] = '- **Set 3**, the state screens (owner-approved): `scratchpad\\set3-states-2026-10-01`; the signup tour (production 5 steps | candidate 2 steps): `scratchpad\\set3-tour-2026-10-01`.';
    n++;
  }
}
if (n !== 3) throw new Error(`expected 3 replacements, made ${n}`);
fs.writeFileSync(p, lines.join('\n'));
console.log('replaced', n);
