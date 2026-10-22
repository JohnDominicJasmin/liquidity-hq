/* Side-by-side before (prod) | after (qa) crop of the top of a full-page shot. usage: node crop-pair.mjs <name> <theme> <width> <cropHeight> */
import { readFileSync, existsSync } from 'node:fs';
import { chromium, OUT } from './lib.mjs';
const [, , name, theme = 'dark', width = '1280', crop = '1500'] = process.argv;
const d = `${OUT}/perf-wording`.split('\\').join('/'); const w = Number(width); const h = Number(crop);
const f = (env) => `${d}/${env}/${name}-${theme}-${width}.png`;
if (!existsSync(f('prod')) || !existsSync(f('qa'))) { console.log('missing', f('prod'), f('qa')); process.exit(1); }
const img = (p) => `<img src="data:image/png;base64,${readFileSync(p).toString('base64')}" style="display:block;width:${w}px;position:absolute;left:0;top:0">`;
const box = (t, p) => `<div><div style="font:600 14px sans-serif;margin:4px 0">${t}</div><div style="width:${w}px;height:${h}px;overflow:hidden;position:relative;border:1px solid #888">${img(p)}</div></div>`;
const html = `<body style="margin:8px;background:#fff;display:flex;gap:12px">${box('BEFORE prod d3659f1 - ' + name + ' ' + theme + ' ' + width, f('prod'))}${box('AFTER qa aca88356 - ' + name + ' ' + theme + ' ' + width, f('qa'))}</body>`;
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: w * 2 + 40, height: h + 50 } });
await p.setContent(html); await p.waitForTimeout(1000); const out = `${d}/pair-${name}-${theme}-${width}.png`; await p.screenshot({ path: out }); await b.close(); console.log(out);
