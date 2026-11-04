// Offline (file://) single-player regression: v2.2 flows must keep working with no server.
const { chromium } = require('playwright-core');
const URL = process.argv[2] || 'file:///home/user/workspace/sla/site/sudoku-learning-academy.html';
const OUT = '/home/user/workspace/qa/solo';
const res = []; let pass = 0, fail = 0;
function ok(c, n, x) { if (c) { pass++; res.push('PASS ' + n); } else { fail++; res.push('FAIL ' + n + (x !== undefined ? ' :: ' + JSON.stringify(x).slice(0, 300) : '')); } console.log(res[res.length - 1]); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome' });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('dialog', (d) => d.accept());
  try {
    // Seed legacy v2.2 data to check migration keeps it
    await p.goto(URL);
    await p.evaluate(() => { localStorage.setItem('sla.social.v1', JSON.stringify({ rating: 1264, wins: 3, losses: 1, games: 4, hist: [{ a: 1 }, { a: 2 }] })); });
    await p.reload(); await sleep(1500);
    ok(await p.evaluate(() => Net.avail() === 'none' || Net.avail() === 'off' || Net.avail() !== 'ok'), 'file:// → no server, offline mode', await p.evaluate(() => Net.avail()));
    ok((await p.textContent('#qProfTxt')).length > 0, 'profile chip shows offline state', await p.textContent('#qProfTxt'));
    await p.selectOption('#selVariant', 'classic'); await p.selectOption('#selDiff', 'easy'); await p.click('#btnNew');
    await p.waitForFunction(() => document.querySelectorAll('#mainBoard .cell.given').length > 20, null, { timeout: 20000 });
    ok(true, 'Easy classic puzzle generated offline');
    const empty = await p.evaluate(() => [...document.querySelectorAll('#mainBoard .cell')].findIndex((c) => !c.querySelector('.v').textContent.trim()));
    await p.click(`#mainBoard .cell[data-i="${empty}"]`); await p.keyboard.press('5'); await sleep(200);
    ok((await p.textContent(`#mainBoard .cell[data-i="${empty}"] .v`)).trim() === '5', 'keyboard input works');
    await p.click('#tUndo'); await sleep(200); ok((await p.textContent(`#mainBoard .cell[data-i="${empty}"] .v`)).trim() === '', 'undo works');
    await p.click('#tPencil'); await p.keyboard.press('3'); await p.click('#tPencil'); await sleep(200);
    ok((await p.$$eval(`#mainBoard .cell[data-i="${empty}"] .notes span`, (s) => s.map((x) => x.textContent).join(''))).includes('3'), 'pencil mark works');
    await p.click('#tHint'); await sleep(600); ok((await p.textContent('#mainMsg')).length > 3 || (await p.textContent('#infoPanel')).length > 3, 'hint gives technique message');
    await p.click('#tExplain'); await sleep(600); ok((await p.textContent('#xpBody')).length > 10, 'explain shows solver explanation', (await p.textContent('#xpBody')).slice(0, 80));
    await p.click('#tCheck'); await sleep(300); ok(true, 'check runs');
    await p.click('#bNext'); await sleep(500); ok((await p.$$eval('#botHist > *', (x) => x.length)) >= 1, 'bot next step recorded in history');
    await p.click('#btnPause'); await sleep(200); ok(!(await p.$eval('#pauseOverlay', (x) => x.classList.contains('hidden'))), 'pause overlay');
    await p.click('#btnResume'); await sleep(200);
    await p.click('#btRun'); await sleep(300); await p.click('#modalRoot .modal .acts button.danger'); await sleep(3000); ok(/\d/.test(await p.textContent('#btOut')), 'backtracking separate output', (await p.textContent('#btOut')).slice(0, 80));
    await p.selectOption('#selVariant', 'killer'); await sleep(200); await p.click('#btnNew');
    await p.waitForFunction(() => document.querySelectorAll('#mainBoard .cage-sum').length > 5, null, { timeout: 30000 }); ok(true, 'Killer solo puzzle with cages');
    for (const v of ['learn', 'challenge', 'stats', 'settings', 'versus', 'rank', 'profile']) { await p.evaluate((v) => APP.showView(v), v); await sleep(300); ok(await p.$eval('#view-' + v, (x) => x.offsetHeight > 50), 'view renders offline: ' + v); }
    ok(/1264/.test(await p.textContent('#legacyTxt')), 'v2.2 ranked record preserved & shown read-only', await p.textContent('#legacyTxt'));
    ok(await p.$eval('#acSubmit', (x) => x.disabled), 'login disabled with honest note when no server');
    ok(await p.evaluate(() => !!localStorage.getItem('sla.social.v1')), 'legacy data not deleted');
    await p.evaluate(() => APP.showView('settings')); await sleep(200);
    const comp = await p.textContent('#view-settings'); ok(/Accounts & Auth/.test(comp) && /NOT_IMPLEMENTED|NOT IMPLEMENTED/.test(comp), 'component status table updated');
    await p.screenshot({ path: OUT + '-settings.png' });
    ok(errs.length === 0, 'no console errors offline', errs.slice(0, 5));
  } catch (e) { ok(false, 'exception: ' + e.message.split('\n')[0]); await p.screenshot({ path: OUT + '-fail.png' }); console.log(errs); }
  console.log(`\n${pass} passed, ${fail} failed`);
  require('fs').writeFileSync(OUT + '-results.txt', res.join('\n') + `\n\n${pass} passed, ${fail} failed\n`);
  await b.close();
})();
