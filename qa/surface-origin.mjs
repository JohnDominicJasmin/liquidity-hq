import { chromium } from '@playwright/test';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1440,height:900}});
await ctx.addInitScript(()=>{try{localStorage.setItem('theme','light');localStorage.setItem('lhq-design-mode','terminal')}catch{}});
const p=await ctx.newPage(); p.on('pageerror',()=>{});
for(const route of ['/dashboard','/scanner','/arena']){
 await p.goto('https://liquidity-hq-qa.onrender.com'+route+'?design=terminal',{waitUntil:'domcontentloaded',timeout:90000});
 await p.waitForTimeout(7000);
 const r=await p.evaluate(()=>{
  /* `color(srgb r g b / a)` channels are 0-1; `rgb()`/`rgba()` are 0-255. Scaling by prefix, not by value range - a real rgb(0 1 2) must not be rescaled. Without this every translucent modern-syntax colour composites to near-black: it read the landing ticker's 80%-alpha change values as 1.04:1 when they are 3.96:1. */
  const parse = c => { const m = (c.match(/[\d.]+/g) || []).map(Number); if (m.length < 3) return null;
    const k = /^color\(/.test(c.trim()) ? 255 : 1;
    return { r: m[0]*k, g: m[1]*k, b: m[2]*k, a: m.length > 3 ? m[3] : 1 }; };
  const over=(f,bg)=>({r:f.r*f.a+bg.r*(1-f.a),g:f.g*f.a+bg.g*(1-f.a),b:f.b*f.a+bg.b*(1-f.a),a:1});
  const hex=c=>'#'+[c.r,c.g,c.b].map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
  const chain=el=>{const L=[];let q=el;while(q){const s=getComputedStyle(q);const c=parse(s.backgroundColor);
    if(c&&c.a>0)L.push({cls:(q.className||'').toString().trim().split(/\s+/).slice(0,2).join('.')||q.tagName,raw:s.backgroundColor,a:c.a});
    if(c&&c.a===1)break; q=q.parentElement;} return L;};
  const bgOf=el=>{const L=[];let q=el;while(q){const c=parse(getComputedStyle(q).backgroundColor);if(c&&c.a>0){L.push(c);if(c.a===1)break;}q=q.parentElement;}
    let base=L.length&&L[L.length-1].a===1?L.pop():{r:0,g:0,b:0,a:1};for(let i=L.length-1;i>=0;i--)base=over(L[i],base);return base;};
  const TARGET=/^#(c1c3bf|cccbc8|c6c4c0|c6c1be|cfcdca|d6d4d1|d7d6d4|cfcdc9)$/;
  const out=[];
  document.querySelectorAll('body *').forEach(el=>{
   if(el.children.length)return; const rr=el.getBoundingClientRect(); if(rr.width<1)return;
   if(el.closest('.nav-menu,.gchat-panel,.app-bar,.nav-drawer,.pf-footer,.mobile-tab-bar'))return;
   const t=(el.textContent||'').trim(); if(!t||t.length>40)return;
   const bg=hex(bgOf(el)); if(!TARGET.test(bg))return;
   if(out.length<6) out.push({text:t.slice(0,20),cls:(el.className||'').toString().trim().split(/\s+/)[0]||el.tagName,bg,chain:chain(el)});
  });
  return {path:location.pathname,out};
 });
 console.log(JSON.stringify(r,null,1));
}
await b.close();
