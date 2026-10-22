/* Zoomed padlock comparison: the locked marker top-left of the visible chart window, qa, dark and light. */
import { readFileSync } from "node:fs";
import { chromium, OUT } from './lib.mjs';
const d = `${OUT}/signal-gate/crops`.split('\\').join('/');
const cell = (t, f) => `<div><div style="font:600 13px sans-serif;margin:4px 0">${t}</div><div style="width:420px;height:220px;overflow:hidden;border:1px solid #888;position:relative"><img src="data:image/png;base64,${readFileSync(d + "/" + f).toString("base64")}" style="position:absolute;left:-${40 * 4}px;top:-${80 * 4}px;width:${851 * 4}px;image-rendering:pixelated"></div></div>`;
const html = '<body style="background:#fff;margin:12px;display:flex;flex-direction:column;gap:12px">' +
  ['dark', 'light'].map((th) => `<div style="display:flex;gap:12px">${cell('qa Free XRP ' + th + ' (zoom 4x)', `qa-free-xrp-${th}-chart.png`)}${cell('qa signed-out ETH ' + th + ' (zoom 4x)', `qa-signed_out-eth-${th}-chart.png`)}</div>`).join('') + '</body>';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 900, height: 560 } });
await p.setContent(html); await p.waitForTimeout(800); await p.screenshot({ path: `${d}/padlock-zoom.png` }); await b.close();
