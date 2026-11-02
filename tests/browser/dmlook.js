// Visual check of the Messages view (light + dark, mobile + desktop) against a local server.
const { chromium } = require('playwright-core');
const URL = process.argv[2] || 'http://localhost:8001/';
const api = async (m, p, b, tk) => { const r = await fetch(URL.replace(/\/$/, '') + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tk ? { authorization: 'Bearer ' + tk } : {}), body: b ? JSON.stringify(b) : undefined }); return r.json(); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const s = Date.now().toString(36).slice(-4);
  const A = await api('POST', '/api/auth/register', { username: 'Aminah_' + s, password: 'pass12345', country: 'MY' });
  const B = await api('POST', '/api/auth/register', { username: 'Badrul_pjg_' + s, password: 'pass12345', country: 'MY' });
  await api('POST', '/api/friends/request', { code: B.user.friendCode }, A.token); await api('POST', '/api/friends/respond', { userId: A.user.id, accept: true }, B.token);
  for (const [tk, to, v] of [[A.token, B.user.id, 'Assalamualaikum, dah sedia untuk perlawanan Killer malam ni? Saya baru belajar teknik X-Wing dan nak cuba.'], [B.token, A.user.id, 'Boleh! Jom pukul 9'], [A.token, B.user.id, 'Ok set 👍']]) { await api('POST', '/api/dm/' + to, { k: 'x', v }, tk); await sleep(600); }
  await api('POST', '/api/dm/' + A.user.id, { k: 's', v: 's03' }, B.token);
  const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome' });
  const errs = [];
  for (const [w, h, tag] of [[390, 844, 'm'], [1280, 820, 'd']]) for (const theme of ['light', 'dark']) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } }); const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    await ctx.addInitScript(([tk, th]) => { localStorage.setItem('sla.auth.v3', JSON.stringify({ token: tk, uid: 0, username: 'x' })); const d = JSON.parse(localStorage.getItem('sla.v2') || '{}'); d.settings = Object.assign(d.settings || {}, { theme: th }); localStorage.setItem('sla.v2', JSON.stringify(d)); }, [A.token, theme]);
    await p.goto(URL); await p.waitForFunction(() => window.Net && Net.ready(), null, { timeout: 15000 });
    await p.evaluate(() => APP.showView('chat')); await sleep(900);
    await p.screenshot({ path: `dm-list-${theme}-${tag}.png` });
    await p.click('#dmList .dm-row'); await sleep(900);
    await p.screenshot({ path: `dm-thread-${theme}-${tag}.png` });
    const ov = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    console.log(tag, theme, 'overflow', ov);
    if (theme === 'light' && tag === 'm') { await p.click('#dmMenu'); await sleep(300); await p.screenshot({ path: 'dm-menu-light-m.png' }); }
    await ctx.close();
  }
  console.log('errs', errs);
  await b.close();
})();
