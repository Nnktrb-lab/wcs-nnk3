// v4.4 browser E2E: admin config spacing, report → ban → enforcement → unban, shop + borders, mobile.
const { chromium } = require('playwright-core');
const URL = process.argv[2] || 'http://localhost:8000/';
const OUT = '/home/user/workspace/qa/v44';
const res = []; let pass = 0, fail = 0;
function ok(c, n, x) { if (c) { pass++; res.push('PASS ' + n); } else { fail++; res.push('FAIL ' + n + (x !== undefined ? ' :: ' + JSON.stringify(x).slice(0, 300) : '')); } console.log(res[res.length - 1]); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now().toString(36).slice(-4);
async function mk(b, w, h) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', (e) => p.errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) p.errs.push(m.text()); });
  await p.goto(URL); await p.waitForFunction(() => window.Net && Net.avail() === 'ok', null, { timeout: 15000 });
  return p;
}
async function nav(p, v) { await p.evaluate((v) => APP.showView(v), v); await sleep(600); }
async function modalBtn(p, idx) { await p.waitForSelector('#modalRoot .modal .acts button', { timeout: 15000 }); const bs = await p.$$('#modalRoot .modal .acts button'); await bs[idx === -1 ? bs.length - 1 : idx].click(); await sleep(300); }
async function register(p, name, pw) {
  await nav(p, 'profile');
  await p.click('#acTabs button[data-v="register"]');
  await p.fill('#acUser', name); await p.fill('#acPass', pw); await p.fill('#acPass2', pw);
  await p.waitForFunction(() => document.querySelectorAll('#acCountry option').length > 50);
  await p.selectOption('#acCountry', 'MY'); await sleep(200);
  await p.click('#acSubmit');
  await p.waitForSelector('#modalRoot .rc-box', { timeout: 10000 }); await modalBtn(p, -1);
  await p.waitForFunction(() => window.Net && Net.wsState() === 'on', null, { timeout: 10000 });
  return p.evaluate(() => Net.user());
}
async function admTab(p, tab) { await nav(p, 'wcs'); await p.evaluate(() => WCSUI.setTab('admin')); await sleep(800); await p.click(`.adm-tabs button[data-adm="${tab}"]`); await sleep(900); }
(async () => {
  const b = await chromium.launch();
  try {
    const A = await mk(b, 1280, 900), P = await mk(b, 375, 812);
    const admin = await register(A, 'nnk_trb', 'Rahsia#2026');
    const pl = await register(P, 'Pemain' + stamp, 'Rahsia#2026');
    await sleep(1500); await A.evaluate(() => Net.api('GET', '/api/me').then(() => 0));
    await A.evaluate(() => Net.api('GET', '/api/me').then((r) => Net.setUser(r.body.user)));
    const role = await A.evaluate(() => Net.user() && Net.user().role); ok(role === 'admin', 'nnk_trb is admin', role);
    ok(pl && pl.role !== 'admin', 'new player is not admin');
    // season config
    await admTab(A, 'season');
    const m = await A.evaluate(() => { const i = document.getElementById('wcsMinM'), r = document.getElementById('wcsRoundH'); const cs = getComputedStyle(i); return { pl: parseFloat(cs.paddingLeft), ta: cs.textAlign, h: i.getBoundingClientRect().height, w: i.getBoundingClientRect().width, sw: i.scrollWidth, cw: i.clientWidth, v1: i.value, v2: r.value, tabs: [...document.querySelectorAll('.adm-tabs button')].map((x) => x.textContent) }; });
    ok(m.pl >= 10 && m.ta === 'center' && m.h >= 38 && m.sw <= m.cw + 1 && m.w > 80, 'config number inputs padded, centered, not clipped', m);
    ok(m.tabs.length === 6, 'admin has 6 tabs (Musim, Laporan, Anti-cheat, Rayuan, Ban, Audit)', m.tabs);
    await A.screenshot({ path: OUT + '/admin-season-desktop.png', fullPage: false });
    // wheel must not change value
    await A.focus('#wcsMinM'); await A.mouse.move(0, 0); const box = await (await A.$('#wcsMinM')).boundingBox(); await A.mouse.move(box.x + 20, box.y + 10); await A.mouse.wheel(0, -300); await sleep(200);
    ok(await A.$eval('#wcsMinM', (i) => i.value) === m.v1, 'mouse wheel does not change config value');
    await A.fill('#wcsMinM', '999'); await A.click('.adm-cfg-act .btn.primary'); await sleep(600);
    const cfg1 = await A.evaluate(() => Net.api('GET', '/api/wcs/state').then((r) => r.body.season.minMatches));
    ok(String(cfg1) === m.v1, 'invalid value (999) rejected client-side, saved value unchanged', cfg1);
    await A.fill('#wcsMinM', '7'); await A.click('.adm-cfg-act .btn.primary'); await sleep(1200);
    const cfg2 = await A.evaluate(() => Net.api('GET', '/api/wcs/state').then((r) => r.body.season.minMatches));
    ok(cfg2 === 7, 'valid config saved (minMatches 7)', cfg2);
    // player reports nothing-admin: player cannot reach admin API
    const pAdm = await P.evaluate(() => Net.api('GET', '/api/admin/bans?status=all').then((r) => r.status));
    ok(pAdm === 403, 'player gets 403 on admin API', pAdm);
    // player reports admin? report a third account: register via API in A context? use admin as reporter of player
    await A.evaluate((u) => V44.report({ id: u.id, username: u.username }), pl); await sleep(300);
    await A.selectOption('#repCat', 'cheating'); await A.fill('#repBody', 'Selesai papan dalam 3 saat, guna cheat'); await A.click('#modalRoot .acts .btn.danger'); await sleep(800);
    await admTab(A, 'reports'); const repTxt = await A.evaluate(() => document.querySelector('.adm-body').innerText);
    ok(repTxt.includes('Pemain' + stamp), 'report appears in Laporan tab', repTxt.slice(0, 200));
    await A.screenshot({ path: OUT + '/admin-reports.png' });
    // ban via dialog (3 days, cheating)
    await A.evaluate((u) => V44.banDialog({ uid: u.id, username: u.username, playerId: u.playerId }), pl); await sleep(300);
    await A.screenshot({ path: OUT + '/admin-ban-dialog.png' });
    await A.click('#modalRoot .adm-seg button:nth-child(2)'); await sleep(150);
    await A.click('#modalRoot .acts .btn.danger'); await sleep(1500);
    const before = await P.evaluate(() => ({ r: Net.user().rating, c: Net.user().coins }));
    await sleep(800);
    const bar = await P.evaluate(() => { const b = document.getElementById('banBar'); return b && !b.classList.contains('hidden') ? b.innerText : ''; });
    ok(/Cheat|cheat/.test(bar), 'banned player sees ban bar with reason', bar);
    await P.screenshot({ path: OUT + '/player-banned-mobile.png' });
    const gate = await P.evaluate(() => new Promise((res) => { let got = null; Net.on('error', (m) => { if (m.code === 'banned') got = m; }); Net.send({ t: 'mm_find', mode: 'race', difficulty: 'easy', ranked: true }); setTimeout(() => res(got ? 'ban' : 'none'), 1200); }));
    ok(gate === 'ban', 'server refuses matchmaking for banned player', gate);
    const daily = await P.evaluate(() => Net.api('POST', '/api/daily/start', {}).then((r) => [r.status, r.body.error]));
    ok(daily[0] === 403, 'server refuses daily tournament for banned player', daily);
    await admTab(A, 'bans'); const bansTxt = await A.evaluate(() => document.querySelector('.adm-body').innerText);
    ok(bansTxt.includes('Pemain' + stamp) && /3 hari/.test(bansTxt) && /nnk_trb/.test(bansTxt), 'ban list shows player, duration, admin', bansTxt.slice(0, 400));
    await A.screenshot({ path: OUT + '/admin-bans-desktop.png', fullPage: true });
    // unban needs note
    const unb = await A.$('.adm-ban.st-active .btn'); if (unb) await unb.click(); await sleep(300);
    await A.click('#modalRoot .acts .btn.primary'); await sleep(300);
    ok((await A.$eval('#modalRoot .err-t', (e) => e.textContent)).length > 0, 'unban without note is refused');
    await A.fill('#modalRoot textarea', 'Rayuan diterima, bukti tidak cukup'); await A.click('#modalRoot .acts .btn.primary'); await sleep(1500);
    const after = await P.evaluate(() => Net.api('GET', '/api/me/ban').then((r) => r.body));
    ok(after && !after.ban, 'player unbanned after note', after);
    const me2 = await P.evaluate(() => Net.api('GET', '/api/me').then((r) => ({ r: r.body.user.rating, c: r.body.user.coins })));
    ok(me2.r === before.r && me2.c === before.c, 'Elo and coins not changed by ban/unban', [before, me2]);
    await admTab(A, 'audit'); const audTxt = await A.evaluate(() => document.querySelector('.adm-body').innerText);
    ok(/ban/i.test(audTxt) && /unban|nyahban|Buka/i.test(audTxt), 'audit shows ban + unban', audTxt.slice(0, 300));
    await A.screenshot({ path: OUT + '/admin-audit.png', fullPage: true });
    // shop: player has welcome coins
    await nav(P, 'shop'); await sleep(900);
    const shop = await P.evaluate(() => ({ cards: document.querySelectorAll('.shop-card').length, coins: document.getElementById('shopCoins') && document.getElementById('shopCoins').textContent, l2: !!document.querySelector('.shop-card[data-border="legend2"] .bd-legend2'), myth: ['nebula', 'thunder', 'dragon', 'phantom', 'celestial'].filter((x) => document.querySelector('.shop-card[data-border="' + x + '"] .bd-' + x)).length }));
    ok(shop.cards >= 25 && shop.l2 && shop.myth === 5, 'shop shows all borders incl. Legendary 2 + 5 new Mythic', shop);
    await P.screenshot({ path: OUT + '/shop-mobile.png', fullPage: true });
    const buy = await P.evaluate(() => Net.api('POST', '/api/shop/buy', { id: 'legend2' }).then((r) => [r.status, r.body.error]));
    ok(buy[0] === 400 || buy[0] === 402 || buy[0] === 409, 'Legendary 2 cannot be bought without enough coins (not auto-given)', buy);
    await P.evaluate(() => Net.api('POST', '/api/shop/buy', { id: 'bronze' })); await P.evaluate(() => Net.api('POST', '/api/me/border', { id: 'bronze' }).then((r) => V44 && V44.showShop()));
    await sleep(900); const eq = await P.evaluate(() => Net.api('GET', '/api/me').then((r) => r.body.user.border)); ok(eq === 'bronze', 'buy + equip bronze works', eq);
    // admin desktop shop preview
    await nav(A, 'shop'); await sleep(900); await A.screenshot({ path: OUT + '/shop-desktop.png', fullPage: true });
    await A.screenshot({ path: OUT + '/shop-desktop-top.png' });
    // mobile admin
    await A.setViewportSize({ width: 375, height: 812 }); await admTab(A, 'season'); await A.screenshot({ path: OUT + '/admin-season-mobile.png' });
    const mm = await A.evaluate(() => { const i = document.getElementById('wcsMinM'); return { w: i.getBoundingClientRect().width, sw: document.documentElement.scrollWidth }; });
    ok(mm.w > 200 && mm.sw <= 376, 'mobile config inputs full width, no horizontal overflow', mm);
    await admTab(A, 'bans'); await A.screenshot({ path: OUT + '/admin-bans-mobile.png', fullPage: true });
    // cloud sync: settings + stats follow the account into a fresh tab (no browser storage)
    ok(await P.evaluate(() => !/localStorage/.test(document.documentElement.outerHTML)), 'no browser storage used');
    await P.evaluate(() => { APP.setSetting('lang', 'en'); APP.stats().played = 42; return V44.cloudPush(true); }); await sleep(1500);
    const Q = await mk(b, 1024, 768);
    await Q.evaluate((n) => Net.api('POST', '/api/auth/login', { username: n, password: 'Rahsia#2026' }).then((r) => Net.setSession(r.body.token, r.body.user)), 'Pemain' + stamp);
    await Q.waitForFunction(() => window.V44 && V44._cloud().ready, null, { timeout: 10000 }); await sleep(300);
    const qs = await Q.evaluate(() => ({ lang: APP.settings().lang, played: APP.stats().played, htmlLang: document.documentElement.lang }));
    ok(qs.lang === 'en' && qs.played === 42, 'settings + stats restored from server on sign-in', qs);
    ok(Q.errs.length === 0, 'no console errors in restored tab', Q.errs);
    ok(A.errs.length === 0 && P.errs.length === 0, 'no console errors', A.errs.concat(P.errs));
  } catch (e) { fail++; res.push('FAIL exception ' + (e && e.stack)); console.log(e); }
  await b.close();
  require('fs').writeFileSync(OUT + '/results.txt', res.join('\n') + '\n' + pass + ' passed, ' + fail + ' failed\n');
  console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
