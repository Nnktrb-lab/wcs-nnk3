const { chromium } = require('playwright-core');
(async () => { const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await p.goto('http://localhost:8000/'); await p.waitForFunction(() => window.Net && Net.avail() === 'ok');
const r = await p.evaluate(() => Net.api('POST', '/api/auth/login', { username: 'nnk_trb', password: 'Rahsia#2026' }).then((r) => { Net.setSession(r.body.token, r.body.user); return r.status; }));
await p.waitForFunction(() => window.Net && Net.user()); await p.evaluate(() => APP.showView('shop')); await new Promise((r) => setTimeout(r, 1500));
const el = await p.$('.shop-grid'); await el.screenshot({ path: '/home/user/workspace/qa/v44/shop-grid.png' });
await p.emulateMedia({ reducedMotion: 'reduce' }); const an = await p.evaluate(() => getComputedStyle(document.querySelector('.bd-legend2'), '::before').animationName); console.log(r, 'reduced:', an);
await b.close(); })();
