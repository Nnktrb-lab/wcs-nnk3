// v4.4.1 browser E2E: refresh keeps login (HttpOnly cookie), solo game survives refresh, no browser storage,
// MR 2v2 lobby + match UI with 4 browsers, shop themes/titles/privacy, music, admin grant + support, mobile, console errors.
const { chromium } = require('playwright-core');
const URL = process.argv[2] || 'http://localhost:8000/';
const OUT = '/home/user/workspace/qa/v45';
const res = []; let pass = 0, fail = 0;
function ok(c, n, x) { if (c) { pass++; res.push('PASS ' + n); } else { fail++; res.push('FAIL ' + n + (x !== undefined ? ' :: ' + JSON.stringify(x).slice(0, 300) : '')); } console.log(res[res.length - 1]); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now().toString(36).slice(-4);
async function mk(b, w, h) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', (e) => p.errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|getUserMedia|NotAllowedError|NotFoundError/.test(m.text())) p.errs.push(m.text()); });
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
async function storageEmpty(p) { return p.evaluate(async () => ({ ls: localStorage.length, ss: sessionStorage.length, idb: indexedDB.databases ? (await indexedDB.databases()).length : 0, cookieVisible: /wcs_sid/.test(document.cookie), rt: /wcs_rt=/.test(document.cookie) })); }
async function admTab(p, tab) { await nav(p, 'wcs'); await p.evaluate(() => WCSUI.setTab('admin')); await sleep(800); await p.click(`.adm-tabs button[data-adm="${tab}"]`); await sleep(900); }
(async () => {
  const b = await chromium.launch();
  const pages = [];
  try {
    const A = await mk(b, 1280, 900); pages.push(A);
    const admin = await register(A, 'nnk_trb', 'Rahsia#2026');
    await sleep(800); await A.evaluate(() => Net.api('GET', '/api/me').then((r) => Net.setUser(r.body.user)));
    ok(await A.evaluate(() => Net.user().role) === 'admin', 'nnk_trb is admin');

    /* refresh keeps login + game */
    await nav(A, 'play');
    await A.evaluate(() => APP.newGame({ variant: 'classic', diff: 'easy' })); await sleep(500);
    const mv = await A.evaluate(() => { const G = APP.game(); let n = 0, cells = []; for (let i = 0; i < 81 && n < 3; i++) if (!G.puzzle[i] && !G.values[i]) { APP._debug.select(i); APP._debug.inputDigit(G.solution[i]); cells.push(i); n++; } return { id: G.id, cells, vals: cells.map((i) => APP.game().values[i]) }; });
    ok(mv.cells.length === 3 && mv.vals.every((v) => v > 0), 'solo moves entered', mv);
    await sleep(9500); // periodic server sync
    let st = await storageEmpty(A);
    ok(st.ls === 0 && st.ss === 0 && st.idb === 0, 'no localStorage / sessionStorage / IndexedDB used', st);
    ok(!st.cookieVisible, 'session cookie is HttpOnly (not readable by JS)');
    ok(st.rt, 'fallback first-party cookie present (survives proxies that drop Set-Cookie)');
    await A.reload(); await A.waitForFunction(() => window.Net && Net.user() && Net.wsState() === 'on', null, { timeout: 15000 });
    ok(await A.evaluate(() => Net.user().username) === 'nnk_trb', 'still logged in after refresh');
    await A.waitForFunction((id) => APP.game() && APP.game().id === id, mv.id, { timeout: 10000 }).catch(() => null);
    const g2 = await A.evaluate((c) => ({ id: APP.game().id, vals: c.map((i) => APP.game().values[i]) }), mv.cells);
    ok(g2.id === mv.id && JSON.stringify(g2.vals) === JSON.stringify(mv.vals), 'running solo game restored after refresh', g2);
    await A.screenshot({ path: OUT + '/play-after-refresh.png' });
    // second refresh via a fresh page in same context (like closing tab)
    const A2 = await A.context().newPage(); await A2.goto(URL); await A2.waitForFunction(() => window.Net && Net.user(), null, { timeout: 15000 }).catch(() => null);
    ok(await A2.evaluate(() => !!(Net.user() && Net.user().username === 'nnk_trb')), 'new tab is logged in too'); await A2.close();
    await A.evaluate(() => Net.reconnectNow()); await A.waitForFunction(() => Net.wsState() === 'on', null, { timeout: 10000 });

    /* MR 2v2 with 4 browsers */
    const B = await mk(b, 1280, 900), C = await mk(b, 375, 812), D = await mk(b, 390, 844); pages.push(B, C, D);
    await register(B, 'Bravo' + stamp, 'Rahsia#2026'); await register(C, 'Charl' + stamp, 'Rahsia#2026'); await register(D, 'Delta' + stamp, 'Rahsia#2026');
    for (const p of [A, B, C, D]) await nav(p, 'mr');
    ok(await A.$('#mrFind') && await A.$('#mrCreate') && await A.$('#mrSize'), 'MR menu rendered (find / create / size)');
    await A.screenshot({ path: OUT + '/mr-menu-desktop.png' }); await C.screenshot({ path: OUT + '/mr-menu-mobile.png' });
    await A.click('#mrCreate'); await A.waitForSelector('#mrLobbyCode', { timeout: 8000 });
    const code = (await A.textContent('#mrLobbyCode')).trim(); ok(/^[A-Z0-9]{6}$/.test(code), 'private lobby code shown', code);
    for (const p of [B, C, D]) { await p.fill('#mrCode', code); await p.click('#mrJoin'); await p.waitForSelector('#mrReady', { timeout: 8000 }); await sleep(300); }
    await A.screenshot({ path: OUT + '/mr-lobby-desktop.png' }); await C.screenshot({ path: OUT + '/mr-lobby-mobile.png', fullPage: true });
    for (const p of [A, B, C, D]) { await p.click('#mrReady'); await sleep(250); }
    const boards = await Promise.all([A, B, C, D].map((p) => p.waitForSelector('#mrBoard', { timeout: 30000 }).then(() => true, () => false)));
    ok(boards.every(Boolean), 'all 4 players see the MR board');
    await sleep(600);
    const cells = await A.evaluate(() => document.querySelectorAll('#mrBoard .cell, #mrBoard [role=gridcell], #mrBoard > *').length);
    ok(cells >= 81, 'MR board has 81 cells', cells);
    ok(await A.evaluate(() => !!document.getElementById('mrTurn')), 'turn indicator shown');
    await A.screenshot({ path: OUT + '/mr-match-desktop.png' }); await C.screenshot({ path: OUT + '/mr-match-mobile.png', fullPage: true });
    const ovf = await C.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); ok(ovf <= 1, 'no horizontal overflow on mobile MR', ovf);
    for (const p of [A, B, C, D]) await p.evaluate(() => Net.send({ t: 'mr_leave' }));
    await sleep(800);

    /* shop extras */
    await nav(A, 'shop'); await A.waitForSelector('#w45Shop', { timeout: 8000 }).catch(() => null);
    const shop = await A.evaluate(() => ({ el: !!document.getElementById('w45Shop'), tabs: [...document.querySelectorAll('#w45Shop [data-tab]')].map((x) => x.getAttribute('data-tab')) }));
    ok(shop.el && shop.tabs.length >= 3, 'shop has theme / title / privacy tabs', shop);
    await A.evaluate(() => document.getElementById('w45Shop').scrollIntoView()); await sleep(400);
    await A.screenshot({ path: OUT + '/shop-themes.png' });
    for (const t of shop.tabs) { await A.click(`#w45Shop [data-tab="${t}"]`); await sleep(700); await A.screenshot({ path: OUT + '/shop-' + t + '.png' }); }
    const legend2 = await A.evaluate(() => document.body.innerText.includes('Legendary') ); ok(legend2, 'shop shows Legendary section');
    await nav(C, 'shop'); await sleep(800); await C.screenshot({ path: OUT + '/shop-mobile.png', fullPage: false });

    /* music */
    const mus = await A.evaluate(() => window.WCSMusic && WCSMusic.state()); ok(mus && typeof mus.mine === 'number', 'music player available', mus);
    const mp3 = await A.evaluate(() => fetch('music/gymnopedie-1-satie.mp3').then((r) => r.status + ' ' + r.headers.get('content-type')));
    ok(/^200 audio\/mpeg/.test(mp3), 'built-in MP3 loads', mp3);

    /* admin grant + support */
    await C.evaluate(() => Net.api('POST', '/api/support/report', { category: 'bug', body: 'Ujian laporan sokongan daripada E2E' }));
    await admTab(A, 'bans');
    ok(!!(await A.$('#admGrant')), 'admin grant panel in Ban tab');
    const cu = await C.evaluate(() => Net.user().username);
    await A.fill('#admGrantUser', cu); await A.selectOption('#admGrantKind', 'border');
    const opts = await A.$$eval('#admGrantItem option', (o) => o.map((x) => x.value)); if (opts.includes('champion')) await A.selectOption('#admGrantItem', 'champion');
    await A.fill('#admGrantNote', 'Juara acara E2E'); await A.click('#admGrantGo'); await sleep(500);
    ok(!!(await A.$('#modalRoot .modal')), 'grant asks for confirmation');
    await A.screenshot({ path: OUT + '/admin-grant-confirm.png' });
    await modalBtn(A, 0); await sleep(1200);
    const owned = await C.evaluate(() => Net.api('GET', '/api/shop').then((r) => r.body.borders.filter((x) => x.owned).map((x) => x.id)));
    ok(owned.includes('champion'), 'granted border owned by the player', owned);
    await A.screenshot({ path: OUT + '/admin-grant.png' });
    await admTab(A, 'reports'); await sleep(600);
    const sup = await A.evaluate(() => { const e = document.getElementById('admSupport'); return e ? e.innerText : null; });
    ok(sup && /Ujian laporan sokongan/.test(sup), 'admin sees support report', sup && sup.slice(0, 200));
    await A.evaluate(() => document.getElementById('admSupport').scrollIntoView()); await A.screenshot({ path: OUT + '/admin-support.png' });
    const pAdm = await C.evaluate(() => Net.api('GET', '/api/admin/support').then((r) => r.status)); ok(pAdm === 403, 'player blocked from admin support API');

    /* logout clears cookie */
    await B.evaluate(() => Net.api('POST', '/api/auth/logout').then(() => Net.dropSession())); await sleep(800);
    await B.reload(); await B.waitForFunction(() => window.Net && Net.avail() === 'ok', null, { timeout: 15000 }); await sleep(1500);
    ok(await B.evaluate(() => !Net.user()), 'after logout, refresh stays logged out');

    for (const p of pages) ok(p.errs.length === 0, 'no console errors (' + (pages.indexOf(p)) + ')', p.errs.slice(0, 3));
  } catch (e) { ok(false, 'exception ' + e.message, e.stack); }
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  require('fs').writeFileSync(OUT + '/results.txt', res.join('\n') + '\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
