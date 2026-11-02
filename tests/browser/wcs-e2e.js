// Real two-browser WCS E2E test against a local server started with SLA_TEST_HOOKS=1 (http://localhost:8000).
// Test hooks are used ONLY to set Elo / admin role / clock offset; every game result is played through the UI.
const { chromium } = require('playwright-core');
const URL = process.argv[2] || 'http://localhost:8000/';
const OUT = '/home/user/workspace/qa/wcs';
const res = []; let pass = 0, fail = 0;
function ok(c, n, x) { if (c) { pass++; res.push('PASS ' + n); } else { fail++; res.push('FAIL ' + n + (x !== undefined ? ' :: ' + JSON.stringify(x).slice(0, 300) : '')); } console.log(res[res.length - 1]); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now().toString(36).slice(-5);
const hook = (p, path, body) => p.evaluate(([path, body]) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()), [path, body]);

async function mk(b, w, h, theme) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', (e) => p.errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') p.errs.push(m.text()); });
  p.on('dialog', (d) => d.accept());
  if (theme) await p.addInitScript((th) => { try { const d = JSON.parse(localStorage.getItem('sla.v2') || '{}'); d.settings = Object.assign(d.settings || {}, { theme: th }); localStorage.setItem('sla.v2', JSON.stringify(d)); } catch (e) { } }, theme);
  await p.goto(URL); await p.waitForFunction(() => window.Net && Net.avail() === 'ok', null, { timeout: 15000 });
  return p;
}
async function nav(p, v) { const vis = await p.$(`#nav button[data-view="${v}"]:visible`); if (vis) await vis.click(); else await p.evaluate((v) => APP.showView(v), v); await sleep(500); }
async function modalBtn(p, idx) { await p.waitForSelector('#modalRoot .modal .acts button', { timeout: 15000 }); const bs = await p.$$('#modalRoot .modal .acts button'); await bs[idx === -1 ? bs.length - 1 : idx].click(); await sleep(250); }
async function register(p, name, pw, cc) {
  await nav(p, 'profile');
  await p.click('#acTabs button[data-v="register"]');
  await p.fill('#acUser', name); await p.fill('#acPass', pw); await p.fill('#acPass2', pw);
  await p.waitForFunction(() => document.querySelectorAll('#acCountry option').length > 50);
  await p.selectOption('#acCountry', cc); await sleep(200);
  await p.click('#acSubmit');
  await p.waitForSelector('#modalRoot .rc-box', { timeout: 10000 }); await modalBtn(p, -1);
  await p.waitForFunction(() => window.Net && Net.wsState() === 'on', null, { timeout: 10000 });
  return p.evaluate(() => Net.user());
}
async function wcsTab(p, tab) { await nav(p, 'wcs'); await p.evaluate((tb) => WCSUI.setTab(tb), tab); await sleep(900); }
async function solveMatch(p) {
  await p.waitForFunction(() => !document.getElementById('vsMatch').classList.contains('hidden'), null, { timeout: 30000 }); await sleep(400);
  const sol = await p.evaluate(() => { const cells = [...document.querySelectorAll('#vmBoard .cell')]; const s = cells.map((c) => (c.querySelector('.v').textContent.trim() || '0')).join(''); const r = Engine.solve(Engine.parse(s), { limit: 2, nodeLimit: 5000000 }); return { s, sol: r.solution ? Array.from(r.solution) : null, unique: r.count === 1 }; });
  if (!sol.sol) return null;
  for (let i = 0; i < 81; i++) if (sol.s[i] === '0') { await p.click(`#vmBoard .cell[data-i="${i}"]`); await p.click(`#vmPad button:nth-child(${sol.sol[i]})`); }
  return sol;
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome' });
  const A = await mk(b, 1440, 900, 'dark'), B = await mk(b, 390, 844, 'light');
  try {
    await hook(A, '/api/_test/clock', { offsetMs: 0 });
    // ---------- branding ----------
    ok((await A.title()) === 'WCS – World Championship Sudoku', 'page title is WCS – World Championship Sudoku', await A.title());
    ok((await A.textContent('.brand-t')).includes('WORLD CHAMPIONSHIP SUDOKU'), 'header brand WCS');
    ok((await A.textContent('.tagline')).includes('Only the Best Reach the Final.'), 'tagline shown');
    const mnav = await B.$$eval('#nav button', (bs) => bs.filter((x) => x.offsetParent !== null).map((x) => x.getAttribute('data-view') || 'more'));
    ok(mnav.length === 6 && mnav.includes('wcs'), 'mobile bottom nav has 6 items incl. WCS', mnav);
    ok(await B.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal overflow mobile home');
    // ---------- guest view ----------
    await wcsTab(A, 'home');
    ok(await A.$('#wcsRoot .wcs-hero') !== null, 'WCS home hero renders for guest');
    await A.screenshot({ path: OUT + '-home-guest-d.png' });

    const ua = 'wcs_a_' + stamp, ub = 'wcs_b_' + stamp;
    const UA = await register(A, ua, 'alpha12345', 'MY'), UB = await register(B, ub, 'bravo12345', 'SG');
    ok(UA.rating === 1200 && UB.rating === 1200, 'fresh accounts start at 1200');

    // ---------- eligibility (server-checked) ----------
    await wcsTab(A, 'arena');
    let txt = await A.textContent('#wcsRoot');
    ok(txt.includes('YOU ARE NOT QUALIFIED') && txt.includes('Reach 2,000 ELO to enter the World Championship') && txt.includes('1200') && txt.includes('+800'), 'NOT QUALIFIED at 1200 with current/needed Elo', txt.slice(0, 200));
    await A.screenshot({ path: OUT + '-notqualified-d.png' });
    await hook(A, '/api/_test/rating', { uid: UA.id, rating: 1999 }); await wcsTab(A, 'arena');
    txt = await A.textContent('#wcsRoot'); ok(txt.includes('YOU ARE NOT QUALIFIED') && txt.includes('+1'), '1999 Elo still NOT QUALIFIED (+1 needed)');
    const st1999 = await A.evaluate(() => Net.api('GET', '/api/wcs/state').then((r) => r.body.me));
    ok(st1999.eligible === false, 'server says eligible=false at 1999', st1999);
    const wsRej = await A.evaluate(() => new Promise((res) => { const off = Net.on('error', (m) => res(m)); Net.send({ t: 'wcs_find' }); setTimeout(() => res(null), 2500); }));
    ok(wsRej && /not_eligible|elo/i.test(JSON.stringify(wsRej)), 'server rejects wcs_find below 2000', wsRej);
    await hook(A, '/api/_test/rating', { uid: UA.id, rating: 2000 }); await hook(A, '/api/_test/rating', { uid: UB.id, rating: 2000 });
    await wcsTab(A, 'arena');
    txt = await A.textContent('#wcsRoot'); ok(!txt.includes('YOU ARE NOT QUALIFIED') && /EXTREME/.test(txt), 'exactly 2000 Elo opens WCS automatically');
    await A.screenshot({ path: OUT + '-arena-qualified-d.png' });

    // ---------- flag lock (365 days) ----------
    await nav(B, 'profile'); await sleep(1200);
    ok(await B.isVisible('#wcsProf'), 'profile shows WCS panel');
    let pt = await B.textContent('#wcsProf');
    ok(/CHANGE COUNTRY FLAG|FLAG CHANGE LOCKED/.test(pt), 'profile flag box shows status', pt.slice(0, 160));
    const fi = await B.evaluate(() => Net.api('GET', '/api/me/flag').then((r) => r.body));
    if (fi.canChange) {
      await B.click('#wcsFlagBtn'); await B.waitForSelector('#wcsFlagSel'); await B.selectOption('#wcsFlagSel', 'ID'); await modalBtn(B, 0); await sleep(300);
      if (await B.$('#modalRoot .modal .acts button')) await modalBtn(B, 0); await sleep(1500);
    }
    await nav(B, 'profile'); await sleep(1200); pt = await B.textContent('#wcsProf');
    ok(pt.includes('FLAG CHANGE LOCKED – You can change your country flag again on:'), 'flag locked text after change', pt.slice(0, 200));
    ok(await B.evaluate(() => document.getElementById('pfCountry').disabled), 'profile country select disabled while locked');
    const tryPatch = await B.evaluate(() => Net.api('PATCH', '/api/me', { country: 'JP', region: null }));
    ok(tryPatch.status === 403 && tryPatch.body.error === 'flag_locked' && tryPatch.body.nextChange, 'backend blocks second flag change (PATCH)', tryPatch);
    const tryPost = await B.evaluate(() => Net.api('POST', '/api/me/flag', { country: 'JP' }));
    ok(tryPost.status === 403 && tryPost.body.error === 'flag_locked', 'backend blocks second flag change (POST)', tryPost);
    const fi2 = await B.evaluate(() => Net.api('GET', '/api/me/flag').then((r) => r.body));
    ok(fi2.nextChange - fi2.lastChange >= 365 * 86400000 - 1000, 'next change is 365 days after last', fi2);
    await B.screenshot({ path: OUT + '-flag-locked-m.png' });

    // ---------- daily tournament: server-verified run ----------
    await wcsTab(A, 'daily');
    ok((await A.textContent('#wcsRoot')).includes('/3'), 'daily shows attempts out of 3');
    await A.screenshot({ path: OUT + '-daily-d.png' });
    await A.click('#wcsDailyStart'); await A.waitForSelector('#wcsGrid', { timeout: 15000 });
    ok((await A.$$('#wcsGrid button')).length === 81, 'daily run board renders 81 cells');
    const rs = await A.evaluate(() => { const r = WCSUI._debug.run(); return { p: r.puzzle, sol: r.solution, id: r.id }; });
    ok(!rs.sol, 'solution is NOT sent to client during an active run');
    const solved = await A.evaluate((p) => { const r = Engine.solve(Engine.parse(p), { limit: 2, nodeLimit: 5000000 }); return { s: r.solution ? Array.from(r.solution) : null, n: r.count }; }, rs.p);
    ok(solved.s && solved.n === 1, 'daily puzzle has a unique solution', solved.n);
    await hook(A, '/api/_test/clock', { offsetMs: 6 * 60000 }); // simulate a human-paced solve (anti-cheat min time)
    const emp = []; for (let i = 0; i < 81; i++) if (rs.p[i] === '0') emp.push(i);
    for (const i of emp) { await A.click(`#wcsGrid button[data-i="${i}"]`); await A.keyboard.press(String(solved.s[i])); await A.waitForFunction((i) => { const r = WCSUI._debug.run(); return r && r.grid[i] !== '0'; }, i, { timeout: 8000 }); await sleep(110); } // human pace: server rate-limits >12 moves/s
    await A.waitForFunction(() => { const r = WCSUI._debug.run(); return r && r.status !== 'active'; }, null, { timeout: 10000 });
    const fin = await A.evaluate(() => WCSUI._debug.run());
    ok(fin.status === 'solved' && fin.score > 0 && !fin.flagged, 'server verifies daily solve and scores it', { st: fin.status, sc: fin.score, fl: fin.flagged });
    await A.screenshot({ path: OUT + '-daily-solved-d.png' });
    await hook(A, '/api/_test/clock', { offsetMs: 0 });
    await wcsTab(A, 'daily'); txt = await A.textContent('#wcsRoot');
    ok(txt.includes(ua), 'daily leaderboard lists the player');
    // ---------- streak ----------
    await wcsTab(A, 'streak'); txt = await A.textContent('#wcsRoot');
    const sk = await A.evaluate(() => Net.api('GET', '/api/streak').then((r) => r.body));
    ok(sk && sk.cur >= 1, 'streak counts the server-verified solve', sk && sk);
    await A.screenshot({ path: OUT + '-streak-d.png' });

    // ---------- admin + qualification match (WCS rooms are Extreme + Elo-rated) ----------
    await hook(A, '/api/_test/admin', { uid: UA.id });
    const cfg = await A.evaluate(() => Net.api('POST', '/api/admin/wcs/config', { minMatches: 1 }));
    ok(cfg.ok, 'admin can configure season (minMatches=1)', cfg.body);
    const nonAdmin = await B.evaluate(() => Net.api('POST', '/api/admin/wcs/config', { minMatches: 0 }));
    ok(nonAdmin.status === 403, 'non-admin cannot configure season', nonAdmin.status);
    await wcsTab(A, 'arena'); await wcsTab(B, 'arena');
    await A.evaluate(() => Net.send({ t: 'wcs_find' })); await sleep(300); await B.evaluate(() => Net.send({ t: 'wcs_find' }));
    await A.waitForSelector('#view-versus.active', { timeout: 20000 }); await B.waitForSelector('#view-versus.active', { timeout: 20000 });
    ok(true, 'WCS qualification match found for both players');
    const tagB = await B.textContent('#vsRankedTag').catch(() => '');
    const sol1 = await solveMatch(A);
    ok(sol1 && sol1.unique, 'WCS qualification puzzle unique', sol1 && sol1.unique);
    const diffs = await A.evaluate(() => MP && MP._dbg ? null : null);
    await A.waitForSelector('#vsResult:not(.hidden)', { timeout: 20000 }); await B.waitForSelector('#vsResult:not(.hidden)', { timeout: 20000 });
    const vre = await A.textContent('#vrElo');
    ok(/WCS: \+3/.test(vre), 'WCS qualification result shows +3 points and running W/L/D', vre);
    const ma = await A.evaluate(() => Net.api('GET', '/api/me').then((r) => r.body.user));
    ok(ma.rating === 2000, 'WCS matches are scored by WCS points (Elo unchanged, by design)', ma.rating);
    await A.screenshot({ path: OUT + '-q-result-d.png' }); await B.screenshot({ path: OUT + '-q-result-m.png' });
    await A.click('#vrLeave').catch(() => { }); await B.click('#vrLeave').catch(() => { }); await sleep(800);
    const q = await A.evaluate(() => Net.api('GET', '/api/wcs/state').then((r) => r.body.qualification));
    ok(q.length === 2 && q[0].user.username === ua && q[0].points > q[1].points && q[0].wins === 1, 'qualification table points/W/L/D correct', q.map((x) => [x.user.username, x.points, x.wins, x.losses, x.status]));
    await wcsTab(A, 'champ'); await A.screenshot({ path: OUT + '-qual-table-d.png' });

    // ---------- knockout (2 entrants -> Grand Final) ----------
    const endq = await A.evaluate(() => Net.api('POST', '/api/admin/wcs/end-qualification', {}));
    ok(endq.ok, 'admin ends qualification -> bracket generated', endq.body);
    const s2 = await A.evaluate(() => Net.api('GET', '/api/wcs/state').then((r) => r.body));
    ok(s2.season.status === 'knockout' && s2.bracket && s2.bracket.rounds.length >= 1, 'season moves to knockout with bracket', s2.bracket && s2.bracket.rounds.map((r) => r.name));
    await wcsTab(A, 'champ'); txt = await A.textContent('#wcsRoot');
    ok(txt.includes(ua) && txt.includes(ub), 'bracket shows both finalists');
    await A.screenshot({ path: OUT + '-bracket-d.png' }); await wcsTab(B, 'champ'); await B.screenshot({ path: OUT + '-bracket-m.png' });
    await wcsTab(A, 'arena'); await wcsTab(B, 'arena');
    await A.click('#wcsRoot .wcs-ready'); await sleep(500); await B.click('#wcsRoot .wcs-ready');
    await A.waitForSelector('#view-versus.active', { timeout: 20000 }); await B.waitForSelector('#view-versus.active', { timeout: 20000 });
    ok(true, 'Grand Final room opens when both are ready');
    await solveMatch(B);
    const celeb = await B.waitForSelector('.wcs-celebrate.big', { timeout: 20000 }).then(() => true).catch(() => false);
    ok(celeb, 'champion announcement celebration shown');
    await sleep(800); await B.screenshot({ path: OUT + '-champion-m.png' });
    ok((await B.textContent('.wcs-ann')).includes(ub), 'announcement names champion');
    for (const P of [A, B]) { const cb = await P.$('.wcs-celebrate.big .wcs-ann .btn'); if (cb) await cb.click(); } await sleep(300);
    ok(!(await B.$('.wcs-celebrate.big')), 'champion announcement can be closed');
    const hof = await A.evaluate(() => Net.api('GET', '/api/wcs/halloffame').then((r) => r.body));
    ok(hof.champions && hof.champions[0] && hof.champions[0].champion.username === ub && hof.champions[0].runnerUp.username === ua, 'Hall of Fame lists champion', hof.champions && hof.champions[0]);
    const pb = await B.evaluate(() => Net.api('GET', '/api/me').then((r) => r.body.user));
    ok(pb.titles === 1, 'champion holds 1 WCS title', pb.titles);
    await sleep(1500);
    await nav(B, 'profile'); await sleep(1500); pt = await B.textContent('#wcsProf');
    ok(/WCS CHAMPION/.test(pt) && /GRANDMASTER SUDOKU/.test(pt), 'profile shows WCS CHAMPION + GRANDMASTER SUDOKU', pt.slice(0, 200));
    await B.screenshot({ path: OUT + '-profile-champion-m.png' });
    const pa = await A.evaluate(() => Net.api('GET', '/api/me').then((r) => r.body.user));
    ok(!pa.titles, 'runner-up has no champion title');
    await wcsTab(A, 'hof'); await A.screenshot({ path: OUT + '-hof-d.png' });
    await nav(A, 'rank'); await sleep(1500);
    ok((await A.textContent('#view-rank')).includes('WCS CHAMPION'), 'global leaderboard shows champion title badge');
    await A.screenshot({ path: OUT + '-leaderboard-d.png' });
    for (const v of ['wcs', 'rank', 'profile']) { await nav(B, v); await sleep(500); ok(await B.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal overflow mobile/' + v); }
    ok(A.errs.length === 0, 'no console errors desktop', A.errs.slice(0, 5));
    const be = B.errs.filter((e) => !/status of 403/.test(e)); ok(be.length === 0 && B.errs.length - be.length === 3, 'no console errors mobile (only the 3 intentional 403 probes)', B.errs.slice(0, 5));
  } catch (e) { ok(false, 'exception', String(e && e.stack || e).slice(0, 400)); await A.screenshot({ path: OUT + '-fail-d.png' }).catch(() => { }); await B.screenshot({ path: OUT + '-fail-m.png' }).catch(() => { }); }
  await b.close();
  const summary = `\n${pass} passed, ${fail} failed`; console.log(summary);
  require('fs').writeFileSync(OUT + '-results.txt', res.join('\n') + summary + '\n');
  process.exit(fail ? 1 : 0);
})();
