// Real two-browser E2E test against the local SLA server (http://localhost:8000).
const { chromium } = require('playwright-core');
const URL = process.argv[2] || 'http://localhost:8000/';
const OUT = '/home/user/workspace/qa/lp';
const res = []; let pass = 0, fail = 0;
function ok(c, n, x) { if (c) { pass++; res.push('PASS ' + n); } else { fail++; res.push('FAIL ' + n + (x !== undefined ? ' :: ' + JSON.stringify(x).slice(0, 300) : '')); } console.log(res[res.length - 1]); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now().toString(36).slice(-5);

async function mk(b, w, h) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, permissions: ['microphone', 'camera'] });
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', (e) => p.errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') p.errs.push(m.text() + ' @' + JSON.stringify(m.location())); });
  p.on('dialog', (d) => d.accept()); p.on('response', (r) => { if (r.status() >= 400) p.errs.push('HTTP ' + r.status() + ' ' + r.url()); });
  await p.goto(URL); await p.waitForFunction(() => window.Net && Net.avail() === 'ok', null, { timeout: 15000 });
  return p;
}
async function nav(p, v) {
  const vis = await p.$(`.nav button[data-view="${v}"]:visible, nav button[data-view="${v}"]:visible`);
  if (vis) await vis.click(); else await p.evaluate((v) => APP.showView(v), v);
  await sleep(300);
}
async function modalBtn(p, idx) { await p.waitForSelector('#modalRoot .modal .acts button', { timeout: 15000 }); const bs = await p.$$('#modalRoot .modal .acts button'); await bs[idx === -1 ? bs.length - 1 : idx].click(); await sleep(200); }
async function register(p, name, pw, cc) {
  await nav(p, 'profile');
  await p.click('#acTabs button[data-v="register"]');
  await p.fill('#acUser', name); await p.fill('#acPass', pw); await p.fill('#acPass2', pw);
  await p.waitForFunction(() => document.querySelectorAll('#acCountry option').length > 50);
  await p.selectOption('#acCountry', cc); await sleep(200);
  const regs = await p.$$eval('#acRegion option', (o) => o.map((x) => x.value).filter(Boolean)); if (regs.length) await p.selectOption('#acRegion', regs[0]);
  await p.click('#acSubmit');
  await p.waitForSelector('#modalRoot .rc-box', { timeout: 10000 });
  const rc = await p.textContent('#modalRoot .rc-box');
  await modalBtn(p, -1);
  await p.waitForFunction(() => window.Net && Net.wsState() === 'on', null, { timeout: 10000 });
  return { rc, pid: await p.textContent('#pfPid'), fcode: await p.textContent('#pfFcode') };
}
async function solveMatch(p, wrongFirst) {
  await p.waitForFunction(() => !document.getElementById('vsMatch').classList.contains('hidden'), null, { timeout: 20000 });
  await sleep(400);
  const sol = await p.evaluate(() => {
    const cells = [...document.querySelectorAll('#vmBoard .cell')];
    const s = cells.map((c) => (c.querySelector('.v').textContent.trim() || '0')).join('');
    const g = Engine.parse(s); const r = Engine.solve(g, { limit: 2, nodeLimit: 3000000 }); return { s, sol: r.solution ? Array.from(r.solution) : null };
  });
  if (!sol.sol) return false;
  const empties = []; for (let i = 0; i < 81; i++) if (sol.s[i] === '0') empties.push(i);
  if (wrongFirst) {
    const i = empties[0], w = sol.sol[i] % 9 + 1;
    await p.click(`#vmBoard .cell[data-i="${i}"]`); await p.click(`#vmPad button:nth-child(${w})`); await sleep(500);
  }
  for (const i of empties) { await p.click(`#vmBoard .cell[data-i="${i}"]`); await p.click(`#vmPad button:nth-child(${sol.sol[i]})`); }
  return true;
}


(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const A = await mk(b, 1440, 900), B = await mk(b, 390, 844), C = await mk(b, 390, 844);
  try {
    const nA = 'lpa' + stamp, nB = 'lpb' + stamp, nC = 'lpc' + stamp;
    await register(A, nA, 'pass12345', 'MY'); const rb = await register(B, nB, 'pass12345', 'MY'); await register(C, nC, 'pass12345', 'SG');
    ok(true, 'three accounts registered');
    // friendship A-B through the real API
    const fr = await A.evaluate((code) => Net.api('POST', '/api/friends/request', { code }), rb.fcode.trim());
    const aid = await A.evaluate(() => Net.user().id);
    const acc = await B.evaluate((id) => Net.api('POST', '/api/friends/respond', { userId: id, accept: true }), aid);
    ok(fr.ok && acc.ok, 'A and B are friends', [fr.status, acc.status]);
    // A opens Messages > Lepak
    await nav(A, 'chat'); await A.click('#dmTabs button[data-v="lp"]'); await sleep(300);
    ok(await A.isVisible('#lpSide') && !(await A.isVisible('#dmSideIn')), 'Lepak tab shows hang-out panel');
    ok(await A.isVisible('#lpEmpty'), 'empty state before joining');
    await A.fill('#lpName', 'Lepak QA'); await A.click('#lpCreate button[type=submit]');
    await A.waitForSelector('#lpChat:not(.hidden)', { timeout: 5000 });
    ok((await A.textContent('#lpTitle')) === 'Lepak QA', 'room created and opened');
    ok((await A.$$('#lpMembers .lp-m:not(.empty)')).length === 1 && (await A.$$('#lpMembers .lp-m.empty')).length === 4, 'member strip shows 1 member + 4 free slots');
    const code = await A.evaluate(() => Lounge.current().code);
    // invite B
    await sleep(1200);
    await A.click('#lpInvite'); await A.waitForSelector('#modalRoot .lp-inv .dm-row', { timeout: 5000 });
    await A.click('#modalRoot .lp-inv .dm-row');
    await B.waitForSelector('#modalRoot .modal h3', { timeout: 6000 });
    ok((await B.textContent('#modalRoot .modal h3')).length > 0 && (await B.textContent('#modalRoot .modal p')).includes('Lepak QA'), 'B receives invite modal');
    await modalBtn(B, 0);
    await B.waitForSelector('#lpChat:not(.hidden)', { timeout: 6000 });
    ok(await B.evaluate(() => DM.tab() === 'lp' && document.getElementById('dmRoot').classList.contains('open')), 'B joined, full-screen on mobile');
    await A.waitForFunction(() => document.querySelectorAll('#lpMembers .lp-m:not(.empty)').length === 2, null, { timeout: 5000 });
    ok(true, 'A sees 2 members');
    // text
    await A.fill('#lpText', 'Hai lepak jom'); await A.press('#lpText', 'Enter');
    await B.waitForFunction(() => [...document.querySelectorAll('#lpBody .bub.them')].some((x) => x.textContent.includes('Hai lepak jom')), null, { timeout: 5000 });
    const who = await B.evaluate(() => [...document.querySelectorAll('#lpBody .bub.them .who')].map((x) => x.textContent));
    ok(who.includes(nA), 'B gets text with sender name', who);
    await A.waitForFunction(() => document.querySelector('#lpBody .bub.me .tick') && !document.querySelector('#lpBody .bub.me .tick.pending'), null, { timeout: 5000 });
    ok(true, 'sender tick confirmed by server');
    // filtered
    await sleep(900); await A.fill('#lpText', 'nombor saya 0123456789'); await A.press('#lpText', 'Enter');
    await A.waitForSelector('#lpBody .bub.me.failed', { timeout: 5000 }); ok(true, 'filtered text marked failed');
    // sticker from B
    await sleep(900); await B.click('#lpStkBtn'); await B.click('#lpTray .stk-opt');
    await A.waitForSelector('#lpBody .bub.them.stk-b', { timeout: 5000 }); ok(true, 'sticker delivered');
    // voice from B
    await sleep(900); await B.click('#lpMic'); await B.waitForSelector('#lpRec:not(.hidden) .rec-t', { timeout: 6000 }); await sleep(1600);
    await B.click('#lpRec .send'); await A.waitForSelector('#lpBody .bub.them .vm', { timeout: 10000 });
    ok(true, 'voice message delivered');
    await A.click('#lpBody .bub.them .vm .vm-play'); await sleep(1500);
    ok(!(await A.$('#lpBody .vm.err')), 'member can play voice');
    // C joins with code
    await nav(C, 'chat'); await C.click('#dmTabs button[data-v="lp"]'); await sleep(400);
    await C.waitForFunction((c) => !!document.querySelector('#lpList .lp-row[data-code="' + c + '"]'), code, { timeout: 6000 });
    ok(true, 'public room listed for C');
    await C.screenshot({ path: OUT + '/lp-list-m.png' });
    await C.fill('#lpCode', code.toUpperCase()); await C.click('#lpJoin button');
    await C.waitForSelector('#lpChat:not(.hidden)', { timeout: 6000 });
    ok(!(await C.evaluate(() => [...document.querySelectorAll('#lpBody .bub')].some((x) => x.textContent.includes('Hai lepak jom')))), 'C does not see messages sent before joining');
    await A.waitForFunction(() => document.querySelectorAll('#lpMembers .lp-m:not(.empty)').length === 3, null, { timeout: 5000 }); ok(true, 'A sees 3 members');
    await A.screenshot({ path: OUT + '/lp-desktop.png' }); await B.screenshot({ path: OUT + '/lp-chat-m.png' });
    // overflow
    for (const [p, n] of [[B, 'B'], [C, 'C']]) { const ov = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); ok(ov <= 0, 'no horizontal overflow on mobile ' + n, ov); }
    // host kicks C
    const ms = await A.$$('#lpMembers .lp-m:not(.empty)');
    let kicked = false;
    for (const m of ms) { const tt = await m.getAttribute('title'); if (tt && tt.startsWith(nC)) { await m.click(); await A.waitForSelector('#modalRoot .modal .acts button.danger'); await A.click('#modalRoot .modal .acts button.danger'); await modalBtn(A, 0); kicked = true; break; } }
    await C.waitForFunction(() => !Lounge.current(), null, { timeout: 5000 }); ok(kicked, 'host removed C');
    ok(await C.isVisible('#lpEmpty') || await C.isVisible('#lpSide'), 'C back to lounge list');
    // private toggle via menu
    await A.click('#lpMenu'); await A.waitForSelector('#modalRoot .modal .acts button'); await modalBtn(A, 1);
    await A.waitForFunction(() => Lounge.current() && Lounge.current().pub === false, null, { timeout: 5000 }); ok(true, 'host made the room private');
    await sleep(500); await C.click('#lpRefresh'); await sleep(800);
    ok(!(await C.$('#lpList .lp-row[data-code="' + code + '"]')), 'private room hidden from non-friend C');
    // B: back keeps membership, reopen
    await B.click('#lpBack'); await sleep(300);
    ok(await B.isVisible('#lpCur') && !(await B.isVisible('#lpChat')), 'mobile back shows list with current-room card');
    await A.fill('#lpText', 'masih ada?'); await A.press('#lpText', 'Enter'); await sleep(900);
    ok(await B.evaluate(() => !document.getElementById('lpTabDot').classList.contains('hidden')), 'unread dot while room closed on mobile');
    await B.click('#lpCur .btn'); await sleep(300); ok(await B.isVisible('#lpChat'), 'reopen room');
    ok(await B.evaluate(() => document.getElementById('lpTabDot').classList.contains('hidden')), 'unread cleared on open');
    // B switches to DM tab and back
    await B.click('#lpBack'); await B.click('#dmTabs button[data-v="dm"]'); await sleep(300);
    ok(await B.isVisible('#dmSideIn') && !(await B.isVisible('#lpSide')), 'Chats tab still works');
    await B.click('#dmTabs button[data-v="lp"]'); await sleep(300);
    // light theme screenshot on A
    await A.evaluate(() => { const S = APP.settings(); document.documentElement.setAttribute('data-theme', 'light'); }); await sleep(200); await A.screenshot({ path: OUT + '/lp-desktop-light.png' });
    await A.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    // B leaves
    await B.click('#lpCur .btn'); await sleep(200); await B.click('#lpMenu'); await B.waitForSelector('#modalRoot .modal .acts button.danger'); await B.click('#modalRoot .modal .acts button.danger'); await modalBtn(B, 0);
    await B.waitForFunction(() => !Lounge.current(), null, { timeout: 5000 });
    await A.waitForFunction(() => document.querySelectorAll('#lpMembers .lp-m:not(.empty)').length === 1, null, { timeout: 5000 }); ok(true, 'B left, A sees 1 member');
    ok(await A.evaluate(() => [...document.querySelectorAll('#lpBody .bub.sys')].some((x) => x.textContent.includes('keluar') || x.textContent.includes('left'))), 'leave system message shown');
    for (const [p, n] of [[A, 'A'], [B, 'B'], [C, 'C']]) { const e = p.errs.filter((x) => !/favicon/.test(x)); ok(!e.length, 'no console/page errors ' + n, e); }
  } catch (e) { fail++; res.push('FAIL exception: ' + e.stack); console.log(e.stack); }
  await b.close();
  require('fs').writeFileSync(OUT + '/results.txt', res.join('\n') + `\n\n${pass} passed, ${fail} failed\n`);
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
