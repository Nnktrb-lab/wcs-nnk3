// Real two-browser E2E test against the local SLA server (http://localhost:8000).
const { chromium } = require('playwright-core');
const URL = process.argv[2] || 'http://localhost:8000/';
const OUT = '/home/user/workspace/qa/e2e';
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
  const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const A = await mk(b, 1440, 900), B = await mk(b, 390, 844);
  try {
    // Leaderboard visible before login
    await nav(A, 'rank'); await sleep(800);
    ok((await A.textContent('#lbMe')).length > 0, 'leaderboard view renders before login', await A.textContent('#lbMe'));

    const ua = 'qa_a_' + stamp, ub = 'qa_b_' + stamp;
    const ra = await register(A, ua, 'alpha12345', 'MY'), rb = await register(B, ub, 'bravo12345', 'MY');
    ok(/^SLA-/.test(ra.pid) && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(ra.fcode), 'register shows Player ID + Friend ID', ra);
    ok(/^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/.test(ra.rc), 'recovery code shown once in modal');
    await A.screenshot({ path: OUT + '-profile-d.png' }); await B.screenshot({ path: OUT + '-profile-m.png' });
    ok((await A.textContent('#qProfTxt')).includes('1200'), 'top chip shows username + 1200');

    // Ranked: Find disabled until mode + difficulty selected
    await nav(A, 'versus'); await nav(B, 'versus');
    ok(await A.$eval('#rkFind', (x) => x.disabled), 'Find Match disabled before mode/difficulty chosen');
    ok((await A.$eval('#rkMode', (x) => x.value)) === '', 'no default mode preselected');
    for (const p of [A, B]) { await p.selectOption('#rkMode', 'classic'); await sleep(100); ok((await p.$eval('#rkDiff', (x) => x.value)) === '', 'no default difficulty after picking mode'); await p.selectOption('#rkDiff', 'easy'); }
    ok(!(await A.$eval('#rkFind', (x) => x.disabled)), 'Find Match enabled after choosing');
    await A.click('#rkFind'); await sleep(1200);
    const smsg = await A.textContent('#rkMsg'); ok(/±100/.test(smsg), 'searching message shows ±100 window', smsg);
    ok(!(await A.$eval('#rkCancel', (x) => x.classList.contains('hidden') || x.disabled)), 'Cancel Search visible while searching');
    await A.click('#rkCancel'); await sleep(600);
    ok(!/±/.test(await A.textContent('#rkMsg')), 'cancel search stops searching', await A.textContent('#rkMsg'));
    await A.click('#rkFind'); await B.click('#rkFind');
    await A.waitForSelector('#vsCount:not(.hidden)', { timeout: 20000 }); ok(true, 'ranked match found + 3s countdown shown');
    await A.screenshot({ path: OUT + '-countdown-d.png' });
    // locked tools during match
    const locked = await A.evaluate(() => [...document.querySelectorAll('.nav button[data-view="play"], .nav button[data-view="learn"]')].every((x) => x.disabled));
    ok(locked, 'nav to solo/learn tools locked during match');
    ok(await solveMatch(A, true), 'player A solved puzzle via board + pad');
    await A.waitForSelector('#vsResult:not(.hidden)', { timeout: 15000 });
    const elo = await A.textContent('#vrElo'); ok(/\+\d+/.test(elo), 'winner sees positive Elo delta (server)', elo);
    await B.waitForSelector('#vsResult:not(.hidden)', { timeout: 15000 });
    const elob = await B.textContent('#vrElo'); ok(/-\d+/.test(elob), 'loser sees negative Elo delta', elob);
    await A.screenshot({ path: OUT + '-result-d.png' }); await B.screenshot({ path: OUT + '-result-m.png' });
    const ua2 = await A.evaluate(() => Net.user()); ok(ua2.rating === 1220 && ua2.games === 1 && ua2.wins === 1, 'A rating 1220 after first win (K=40, equal Elo)', ua2);
    ok(ua2.mistakes === undefined, 'no client-side mistake leakage in user');
    await A.click('#vrLeave'); await B.click('#vrLeave'); await sleep(800);

    // Tamper attempt: changing local user object must not affect server rating
    await A.evaluate(() => { const u = Net.user(); u.rating = 3000; try { localStorage.setItem('sla.auth.v3', JSON.stringify({ token: 'x', user: u })); } catch (e) { } });
    const me = await A.evaluate(async () => { const r = await fetch('/api/me', { headers: { authorization: 'Bearer ' + Net.token() } }); return r.json(); });
    ok(me.user ? me.user.rating === 1220 : me.rating === 1220, 'server rating unaffected by local tampering', me);
    await A.reload(); await A.waitForFunction(() => window.Net && Net.avail() === 'ok', null, { timeout: 15000 }); await sleep(1500);
    const afterReload = await A.evaluate(() => Net.user());
    ok(!afterReload || afterReload.rating !== 3000, 'tampered token/rating not accepted after reload', afterReload && afterReload.rating);
    // log A back in
    await nav(A, 'profile');
    if (!(await A.evaluate(() => !!Net.user()))) { await A.click('#acTabs button[data-v="login"]'); await A.fill('#acUser', ua); await A.fill('#acPass', 'alpha12345'); await A.click('#acSubmit'); await A.waitForFunction(() => window.Net && Net.wsState() === 'on', null, { timeout: 10000 }); }
    ok((await A.evaluate(() => Net.user().rating)) === 1220, 'login again restores server rating 1220');

    // Friends
    await nav(A, 'versus'); await nav(B, 'versus');
    await A.fill('#frIdIn', rb.fcode); await A.click('#frAdd');
    await B.waitForFunction(() => document.querySelectorAll('#frReqs button').length > 0, null, { timeout: 8000 });
    ok(true, 'B receives friend request live');
    await (await B.$('#frReqs button.primary')).click();
    await A.waitForFunction((n) => document.getElementById('frList').textContent.includes(n), ub, { timeout: 8000 });
    ok(true, 'friendship accepted on both sides');
    await A.waitForFunction(() => { const b = document.querySelector('#frList button.primary'); return b && !b.disabled; }, null, { timeout: 8000 });
    ok(true, 'online friend shows enabled Invite');
    await A.selectOption('#vsNewMode', 'killer'); await sleep(100);
    const kd = await A.$$eval('#vsNewDiff option', (o) => o.map((x) => x.value)); ok(kd.length >= 1, 'killer difficulties available for 1vs1', kd);
    await A.selectOption('#vsNewDiff', kd.includes('medium') ? 'medium' : kd[0]);
    await A.click('#frList button.primary');
    await B.waitForSelector('#modalRoot .modal', { timeout: 8000 }); const inv = await B.textContent('#modalRoot .modal');
    ok(/Killer/i.test(inv), 'B receives private Killer invite', inv);
    await modalBtn(B, 0);
    await A.waitForSelector('#vsLobby:not(.hidden)', { timeout: 8000 }); await B.waitForSelector('#vsLobby:not(.hidden)', { timeout: 8000 });
    ok(true, 'invite accepted → both in lobby');
    await A.screenshot({ path: OUT + '-lobby-d.png' });
    // Free text toggle (filtered): clickable, works in casual lobby
    for (const p of [A, B]) { ok(!(await p.$eval('#chatTextOn', (x) => x.disabled)), 'free-text toggle is clickable in server room'); await p.click('#chatTextOn + span'); await sleep(200); ok(await p.$eval('#chatTextOn', (x) => x.checked), 'free-text toggle turns on'); }
    ok(await A.isVisible('#chatText'), 'text box shown in casual lobby');
    await sleep(1600);
    await A.fill('#chatText', 'Jom main <b>sekarang</b>'); await A.click('#chatSend');
    await B.waitForFunction(() => [...document.querySelectorAll('#chatBody .bub.them')].some((x) => x.textContent.includes('Jom main')), null, { timeout: 5000 });
    const bub = await B.$$eval('#chatBody .bub.them', (x) => x.map((y) => y.innerHTML).join('|')); ok(!/<b>/.test(bub), 'free text received as plain text (no HTML)', bub);
    await sleep(1600); await A.fill('#chatText', 'lawat www.spam.com'); await A.click('#chatSend'); await sleep(600);
    ok(!(await B.$$eval('#chatBody .bub.them', (x) => x.some((y) => y.textContent.includes('spam')))), 'link message blocked');
    await A.screenshot({ path: OUT + '-freetext-d.png' });
    // ready
    for (const p of [A, B]) { const r = await p.$('#vsAgree'); if (r) { if (await r.isVisible()) await r.click(); } }
    await A.waitForSelector('#vsMatch:not(.hidden)', { timeout: 20000 }); ok(true, 'casual Killer match started after both ready');
    await sleep(400); ok(await A.isVisible('#chatText') && !(await A.isDisabled('#chatText')), 'text box usable during match');
    await sleep(1600); await A.fill('#chatText', ''); await A.click('#chatText'); await A.keyboard.type('Semoga berjaya'); ok((await A.inputValue('#chatText')) === 'Semoga berjaya', 'real keyboard typing works during match (board keys not hijacked)');
    await A.keyboard.press('Enter');
    await B.waitForFunction(() => [...document.querySelectorAll('#chatBody .bub.them')].some((x) => x.textContent.includes('Semoga berjaya')), null, { timeout: 5000 }); ok(true, 'free text delivered during match (Enter key)');
    await A.waitForFunction(() => { const b = [...document.querySelectorAll('#chatBody .bub.me')].pop(); return b && /✓✓/.test(b.textContent); }, null, { timeout: 5000 }); ok(true, 'sender sees ✓✓ after opponent receives');
    // stickers
    await sleep(1600); await B.click('#stkBtn'); ok(await B.isVisible('#stkTray'), 'sticker tray opens');
    ok((await B.$$eval('#stkTray .stk-opt svg', (x) => x.length)) === 16, '16 stickers in tray');
    await B.screenshot({ path: OUT + '-stickers-m.png' });
    await B.click('#stkTray .stk-opt[data-stk="s01"]');
    await A.waitForFunction(() => !!document.querySelector('#chatBody .bub.them.stk-b svg'), null, { timeout: 5000 }); ok(true, 'sticker delivered and drawn for opponent');
    ok(!(await B.isVisible('#stkTray')), 'tray closes after sending');
    // abusive text is blocked before sending and never appears as delivered
    await sleep(1600); const nMe = await A.$$eval('#chatBody .bub.me', (x) => x.length);
    await A.fill('#chatText', 'kau bodoh'); await A.click('#chatSend'); await sleep(500);
    ok((await A.$$eval('#chatBody .bub.me', (x) => x.length)) === nMe && (await A.inputValue('#chatText')) === 'kau bodoh', 'blocked text not sent, kept in box for editing');
    await A.fill('#chatText', '');
    const cages = await A.$$eval('#vmBoard .cage-sum', (x) => x.length); ok(cages > 5, 'killer cages rendered in 1vs1', cages);
    await A.screenshot({ path: OUT + '-killer-d.png' }); await B.screenshot({ path: OUT + '-killer-m.png' });
    // emoji
    await (await B.$('#emojiRow button')).click(); await sleep(800);
    ok(await A.evaluate(() => document.querySelector('.float-emo, #chatBody .bub.them') !== null), 'emoji delivered to opponent');
    await sleep(1600); ok(await B.isVisible('#chatMic'), 'mic button shown in room chat (free text on)');
    await B.click('#chatMic'); await B.waitForFunction(() => /Merakam|Recording/.test(document.getElementById('chatRec').textContent), null, { timeout: 8000 });
    await sleep(1500); await B.screenshot({ path: OUT + '-room-voice-rec-m.png' }); await B.click('#chatRec .icon-btn.send');
    await A.waitForSelector('#chatBody .bub.them .vm', { timeout: 10000 }); ok(true, 'voice message delivered in room chat during match');
    await A.click('#chatBody .bub.them .vm .vm-play'); await sleep(1200);
    ok(await A.evaluate(() => { const n = document.querySelector('#chatBody .bub.them .vm'); return !n.classList.contains('err') && parseFloat(n.querySelector('.vm-bar i').style.width) > 0; }), 'room voice message plays');
    // B surrenders
    await B.click('#vmSurrender'); await modalBtn(B, 0);
    await A.waitForSelector('#vsResult:not(.hidden)', { timeout: 10000 });
    const at = await A.textContent('#vrTitle'); ok(at.length > 0, 'surrender ends match for opponent', at);
    const au = await A.evaluate(() => Net.user()); ok(au.rating !== 1220 && au.games >= 2, 'custom room match is Elo-rated (v4 fix, not +0)', au);
    const vre = await A.textContent('#vrElo'); ok(/Elo sebelum|Previous Elo|Sebelum|Previous/i.test(vre) && /\+\d+/.test(vre), 'MATCH RESULT shows previous/new/change', vre);
    await A.click('#vrLeave'); await B.click('#vrLeave'); await sleep(500);

    // Leaderboard
    await nav(A, 'rank'); await sleep(1200);
    const rows = await A.$$eval('#lbBody tr', (r) => r.map((x) => x.textContent));
    ok(rows.some((r) => r.includes(ua)) && rows.some((r) => r.includes(ub)), 'leaderboard lists both ranked players', rows.slice(0, 3));
    ok(/#1/.test(await A.textContent('#lbMe')), 'current player position shown', await A.textContent('#lbMe'));
    await A.click('#lbScope button[data-v="country"]'); await sleep(200); await A.selectOption('#lbCountry', 'MY'); await sleep(1000);
    ok((await A.$$eval('#lbBody tr', (r) => r.length)) >= 2, 'country leaderboard MY');
    await A.screenshot({ path: OUT + '-leaderboard-d.png' });
    await nav(B, 'rank'); await sleep(1000); await B.screenshot({ path: OUT + '-leaderboard-m.png' });

    // Profile history + cloud backup
    await nav(A, 'profile'); await sleep(1000);
    ok((await A.$$eval('#pfHist .rk-row', (r) => r.length)) >= 2, 'match history shows ranked + casual');
    await A.click('#cloudUp'); await sleep(1200);
    ok(!/-$/.test(await A.textContent('#cloudStat')) && (await A.evaluate(() => !!Net.user().progressAt)), 'cloud backup saved', await A.textContent('#cloudStat'));

    // Profile avatar (v3.1): presets, gallery, camera, remove
    ok(!(await A.isDisabled('#avPresets')) && !(await A.isDisabled('#avGallery')) && !(await A.isDisabled('#avCamera')), 'avatar buttons enabled when signed in');
    await A.click('#avPresets'); await A.waitForSelector('#modalRoot .av-opt');
    ok((await A.$$eval('#modalRoot .av-opt svg', (r) => r.length)) === 24, '24 ready-made avatars shown');
    await A.screenshot({ path: OUT + '-avatar-presets-d.png' });
    await A.click('#modalRoot .av-opt[data-av="p05"]'); await A.waitForFunction(() => Net.user().avatar === 'p05', null, { timeout: 8000 });
    ok(await A.evaluate(() => !!document.querySelector('#spAv.has-av svg') && !!document.querySelector('#pfAv.has-av svg')), 'preset shown in sidebar + profile');
    await nav(B, 'rank'); await B.evaluate(() => Board.load && Board.load()); await sleep(1500);
    ok(await B.evaluate((n) => [...document.querySelectorAll('#lbBody tr')].some((tr) => tr.textContent.includes(n) && tr.querySelector('.mini-av.has-av svg')), ua), 'other player sees preset avatar on leaderboard');
    const png = await A.screenshot({ type: 'png' });
    await A.setInputFiles('#avFile', { name: 'me.png', mimeType: 'image/png', buffer: png });
    await A.waitForSelector('#avPrevImg', { timeout: 8000 });
    const prevLen = await A.$eval('#avPrevImg', (i) => i.src.length); ok(prevLen < 48 * 1024 * 1.4, 'gallery image shrunk to <= 48 KB', prevLen);
    await modalBtn(A, 0); await A.waitForFunction(() => /^u:/.test(Net.user().avatar || ''), null, { timeout: 8000 });
    await A.waitForFunction(() => { const i = document.querySelector('#spAv img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 8000 });
    ok(await A.evaluate(() => document.querySelector('#spAv img').naturalWidth >= 128), 'gallery upload saved + served by server');
    await A.click('#avCamera'); await A.waitForFunction(() => { const v = document.getElementById('avVideo'); return v && v.videoWidth > 0; }, null, { timeout: 10000 });
    await A.screenshot({ path: OUT + '-avatar-camera-d.png' });
    const before = await A.evaluate(() => Net.user().avatar);
    await A.click('#avSnap'); await A.waitForSelector('#avPrevImg', { timeout: 8000 });
    ok(await A.evaluate(() => !document.getElementById('avVideo')), 'camera closed after capture');
    await modalBtn(A, 0); await A.waitForFunction((b) => /^u:/.test(Net.user().avatar || '') && Net.user().avatar !== b, before, { timeout: 8000 });
    ok(true, 'camera photo saved as avatar');
    await nav(B, 'rank'); await B.evaluate(() => Board.load && Board.load()); await sleep(1500);
    ok(await B.evaluate((n) => { const tr = [...document.querySelectorAll('#lbBody tr')].find((tr) => tr.textContent.includes(n)); const i = tr && tr.querySelector('.mini-av img'); return !!i && i.complete && i.naturalWidth > 0; }, ua), 'other player sees uploaded photo');
    await A.screenshot({ path: OUT + '-avatar-profile-d.png' });
    await A.click('#avRemove'); await sleep(300); await modalBtn(A, 0); await A.waitForFunction(() => Net.user().avatar === null, null, { timeout: 8000 });
    ok(await A.evaluate(() => !document.querySelector('#spAv img, #spAv svg') && /^[A-Z0-9]$/i.test(document.getElementById('spAv').textContent)), 'remove returns to initial');
    await A.click('#avPresets'); await A.waitForSelector('#modalRoot .av-opt'); await A.click('#modalRoot .av-opt[data-av="p18"]'); await A.waitForFunction(() => Net.user().avatar === 'p18');
    await A.reload(); await A.waitForFunction(() => window.Net && Net.user() && Net.user().avatar === 'p18', null, { timeout: 10000 }); ok(true, 'avatar persists after reload');
    await nav(B, 'profile'); await sleep(400); await B.click('#avPresets'); await B.waitForSelector('#modalRoot .av-opt'); await B.screenshot({ path: OUT + '-avatar-presets-m.png' }); await modalBtn(B, -1);
    // Chat wallpaper (local only)
    await nav(A, 'settings'); await A.click('#setWall'); await A.waitForSelector('#modalRoot .wp-opt');
    ok((await A.$$eval('#modalRoot .wp-opt', (x) => x.length)) === 10, '9 wallpapers + gallery option');
    await A.click('#modalRoot .wp-opt[data-wp="grid"]'); await A.fill('#wpDim', '30'); await A.dispatchEvent('#wpDim', 'input');
    await A.screenshot({ path: OUT + '-wallpaper-d.png' });
    await modalBtn(A, 0); ok((await A.evaluate(() => APP.settings().chatBg)) === 'grid' && (await A.evaluate(() => APP.settings().chatBgDim)) === 30, 'wallpaper + dim saved to settings');
    ok(await A.evaluate(() => document.getElementById('chatWall').classList.contains('wp-grid')), 'wallpaper applied to chat');
    const wpng = await A.screenshot({ type: 'png' });
    await A.click('#setWall'); await A.waitForSelector('#wpFile', { state: 'attached' });
    await A.setInputFiles('#wpFile', { name: 'w.png', mimeType: 'image/png', buffer: wpng }); await A.waitForFunction(() => /url\(/.test(document.getElementById('wpPrev').style.backgroundImage), null, { timeout: 8000 });
    await modalBtn(A, 0);
    await sleep(800); { const w = await A.evaluate(() => Net.api('GET', '/api/me/wallpaper').then((r) => ({ st: r.status, bg: APP.settings().chatBg, len: (r.body.image || '').length, jpg: /^data:image\/jpeg/.test(r.body.image || ''), ls: Object.keys(localStorage).filter((k) => k !== 'sla.auth.v3').length }))); ok(w.bg === 'custom' && w.jpg && w.len <= 400 * 1024 && w.ls === 0, 'gallery wallpaper stored on the server (≤ 400 KB, no localStorage)', w); }
    await A.reload(); await A.waitForFunction(() => window.Net && Net.avail() === 'ok' && Net.user()); await A.waitForFunction(() => document.getElementById('chatWall').classList.contains('wp-custom') && /url\(/.test(document.getElementById('chatWall').style.backgroundImage), null, { timeout: 10000 }).catch(() => null);
    ok(await A.evaluate(() => document.getElementById('chatWall').classList.contains('wp-custom') && /url\(/.test(document.getElementById('chatWall').style.backgroundImage)), 'custom wallpaper persists after reload');
    ok(await A.evaluate(() => !!APP.stats() && !!APP.settings() && APP.settings().chatBg === 'custom'), 'existing progress + settings intact after wallpaper change and reload');
    // ---------- v3.3: full match history in 1vs1 panel ----------
    await nav(A, 'versus'); await sleep(1200);
    const hr = await A.$$eval('#rkHist .rk-row', (r) => r.map((x) => x.textContent));
    ok(hr.length >= 2 && hr.some((x) => /Custom · Elo/.test(x)) && hr.some((x) => /Ranked/.test(x)), '1vs1 history lists ranked AND custom-room (Elo) matches', hr);
    // ---------- v3.3: direct messages without a lobby ----------
    await nav(A, 'chat'); await nav(B, 'chat'); await sleep(600);
    ok(await A.isVisible('#dmFind') && await B.isVisible('#dmFind'), 'Messages view opens for signed-in players');
    ok(await A.evaluate((n) => [...document.querySelectorAll('#dmFriends .dm-frb')].some((x) => x.textContent.includes(n)), ub), 'friend shown in Messages quick list');
    await A.evaluate((n) => [...document.querySelectorAll('#dmFriends .dm-frb')].find((x) => x.textContent.includes(n)).click(), ub);
    await A.waitForFunction(() => { const i = document.getElementById('dmText'); return i && !i.disabled; }, null, { timeout: 8000 }); ok(true, 'thread opens with friend, compose enabled (no lobby)');
    ok(await A.evaluate(() => !(window.MP && MP.active())), 'no room/lobby created for direct message');
    await A.click('#dmText'); await A.keyboard.type('Hai kawan, jom main nanti'); await A.keyboard.press('Enter');
    await B.waitForFunction(() => !document.getElementById('navDmBadge').classList.contains('hidden') && document.getElementById('navDmBadge').textContent === '1', null, { timeout: 8000 });
    ok(true, 'receiver gets unread badge live');
    await A.waitForFunction(() => { const b = [...document.querySelectorAll('#dmBody .bub.me')].pop(); return b && /✓/.test(b.textContent) && !/◷/.test(b.textContent); }, null, { timeout: 5000 }); ok(true, 'sender sees ✓ (stored on server)');
    await B.waitForSelector('#dmList .dm-row.unread', { timeout: 5000 }); await B.click('#dmList .dm-row.unread');
    await B.waitForFunction(() => [...document.querySelectorAll('#dmBody .bub.them')].some((x) => x.textContent.includes('Hai kawan')), null, { timeout: 8000 }); ok(true, 'receiver opens thread and sees the message (mobile)');
    ok(await B.evaluate(() => document.getElementById('dmRoot').classList.contains('open')), 'mobile shows thread full-screen with back button');
    await A.waitForFunction(() => { const b = [...document.querySelectorAll('#dmBody .bub.me')].pop(); return b && /✓✓/.test(b.textContent); }, null, { timeout: 6000 }); ok(true, 'sender sees ✓✓ after receiver reads');
    await B.waitForFunction(() => document.getElementById('navDmBadge').classList.contains('hidden'), null, { timeout: 5000 }); ok(true, 'unread badge cleared after reading');
    await B.click('#dmText'); await B.keyboard.type('ok');
    await A.waitForFunction(() => /menaip|typing/.test(document.getElementById('dmTyping').textContent), null, { timeout: 5000 }); ok(true, 'typing indicator shown live');
    await B.keyboard.press('Enter');
    await A.waitForFunction(() => [...document.querySelectorAll('#dmBody .bub.them')].some((x) => x.textContent.trim().startsWith('ok')), null, { timeout: 6000 }); ok(true, 'reply delivered live to open thread');
    let e0 = A.errs.length; await sleep(700); await A.fill('#dmText', 'call me 012 345 6789'); await A.keyboard.press('Enter');
    await A.waitForFunction(() => !!document.querySelector('#dmBody .bub.me.failed'), null, { timeout: 6000 }); ok(true, 'phone number blocked by server filter (shown as failed)'); await sleep(300); A.errs.length = e0; /* expected HTTP 400 */
    ok(!(await B.evaluate(() => [...document.querySelectorAll('#dmBody .bub')].some((x) => x.textContent.includes('6789')))), 'blocked message never reaches receiver');
    await sleep(700); await A.click('#dmStkBtn'); await A.click('#dmTray .stk-opt');
    await B.waitForFunction(() => !!document.querySelector('#dmBody .bub.them.stk-b svg'), null, { timeout: 6000 }); ok(true, 'sticker in direct message delivered');
    await sleep(700); await A.click('#dmStkBtn'); await A.click('#dmTray .emo-tray button');
    await B.waitForFunction(() => !!document.querySelector('#dmBody .bub.them.emo'), null, { timeout: 6000 }); ok(true, 'emoji in direct message delivered');
    // voice message (fake microphone)
    ok(await B.isVisible('#dmMic'), 'mic button shown when text box empty');
    await B.click('#dmMic'); await B.waitForFunction(() => /Merakam|Recording/.test(document.getElementById('dmRec').textContent), null, { timeout: 8000 }); ok(true, 'recording starts only after tapping mic');
    await sleep(2200); await B.screenshot({ path: OUT + '-voice-rec-m.png' });
    await B.click('#dmRec .icon-btn.send');
    await A.waitForSelector('#dmBody .bub.them .vm', { timeout: 10000 }); ok(true, 'voice message delivered to friend');
    const vdur = await A.$eval('#dmBody .bub.them .vm', (x) => +x.getAttribute('data-dur')); ok(vdur >= 1500 && vdur <= 4000, 'voice duration recorded (~2 s)', vdur);
    await A.click('#dmBody .bub.them .vm .vm-play'); await sleep(1500);
    const vst = await A.evaluate(() => { const n = document.querySelector('#dmBody .bub.them .vm'); return { err: n.classList.contains('err'), w: n.querySelector('.vm-bar i').style.width, t: n.querySelector('.vm-t').textContent }; });
    ok(!vst.err && parseFloat(vst.w) > 0, 'voice message plays for receiver (authenticated fetch)', vst);
    ok(await B.evaluate(() => !!document.querySelector('#dmBody .bub.me .vm')), 'sender sees own voice bubble');
    const vid = await A.$eval('#dmBody .bub.them .vm', (x) => x.getAttribute('data-vid'));
    e0 = A.errs.length; const anon = (await require('playwright-core').request.newContext()).get(URL.replace(/\/$/, '') + '/api/voice/' + vid).then((r) => r.status());
    const anonS = await anon; ok(anonS === 401, 'voice clip not downloadable without login', anonS); await sleep(300); A.errs.length = e0; /* expected HTTP 401 */
    await A.screenshot({ path: OUT + '-dm-d.png' }); await B.screenshot({ path: OUT + '-dm-m.png' });
    // non-friend (newly registered, unranked) appears on leaderboard and can message by Player ID
    const C = await mk(b, 390, 844); const uc = 'qa_c_' + stamp; const rcx = await register(C, uc, 'charl12345', 'MY');
    const ec0 = C.errs.length; const cst = await C.evaluate(async (id) => (await fetch('/api/voice/' + id, { headers: { authorization: 'Bearer ' + Net.token() } })).status, vid); ok(cst === 404, 'other signed-in player cannot fetch someone else\'s voice clip', cst); await sleep(300); C.errs.length = ec0;
    await nav(C, 'rank'); await sleep(1200);
    const crow = await C.evaluate((n) => { const tr = [...document.querySelectorAll('#lbBody tr')].find((x) => x.textContent.includes(n)); return tr ? tr.textContent : null; }, uc);
    ok(!!crow && /Belum ranked|Unranked/.test(crow), 'newly registered player (0 ranked games) is listed on the leaderboard as unranked', crow);
    ok(/berdaftar|registered/.test(await C.textContent('#lbMsg')), 'leaderboard shows ranked + registered counts', await C.textContent('#lbMsg'));
    await C.screenshot({ path: OUT + '-leaderboard-unranked-m.png' });
    await C.evaluate((n) => [...document.querySelectorAll('#lbBody tr')].find((x) => x.textContent.includes(n)).click(), ua);
    await C.waitForSelector('#modalRoot .pcard'); ok(/1220|12\d\d/.test(await C.textContent('#modalRoot .pcard')), 'leaderboard row opens player card');
    await C.waitForFunction(() => !/Memuatkan|Loading/.test(document.querySelector('#modalRoot .pcard').textContent), null, { timeout: 5000 });
    await C.screenshot({ path: OUT + '-player-card-m.png' });
    await modalBtn(C, 0); await C.waitForFunction(() => { const i = document.getElementById('dmText'); return i && !i.disabled && document.getElementById('dmRoot').classList.contains('open'); }, null, { timeout: 8000 });
    ok(true, 'Message button on player card opens a direct chat with a non-friend');
    await C.fill('#dmText', 'Salam, boleh lawan?'); await C.keyboard.press('Enter');
    await A.waitForFunction((n) => [...document.querySelectorAll('#dmList .dm-row')].some((x) => x.textContent.includes(n)), uc, { timeout: 8000 }); ok(true, 'non-friend message arrives in conversation list');
    // friends-scope leaderboard
    await nav(A, 'rank'); await A.click('#lbScope button[data-v="friends"]'); await sleep(1200);
    const fr = await A.$$eval('#lbBody tr', (r) => r.map((x) => x.textContent));
    ok(fr.length === 2 && fr.some((x) => x.includes(ub)) && fr.some((x) => x.includes(ua)) && !fr.some((x) => x.includes(uc)), 'friends leaderboard = me + friends only', fr);
    await A.click('#lbScope button[data-v="global"]'); await sleep(300);
    // block from thread menu
    await nav(A, 'chat'); await sleep(500); await A.evaluate((n) => [...document.querySelectorAll('#dmList .dm-row')].find((x) => x.textContent.includes(n)).click(), uc);
    await A.waitForFunction(() => { const i = document.getElementById('dmText'); return i && !i.disabled; }, null, { timeout: 8000 });
    await A.click('#dmMenu'); await A.waitForSelector('#modalRoot .modal');
    await A.evaluate(() => [...document.querySelectorAll('#modalRoot .acts button')].find((x) => /Sekat|Block/.test(x.textContent)).click()); await sleep(200); await modalBtn(A, 0);
    await A.waitForFunction(() => !document.getElementById('dmWhy').classList.contains('hidden'), null, { timeout: 6000 }); ok(true, 'blocking shows reason + hides compose');
    const ec = C.errs.length; await sleep(700); await C.fill('#dmText', 'hello lagi'); await C.keyboard.press('Enter');
    await C.waitForFunction(() => !!document.querySelector('#dmBody .bub.me.failed'), null, { timeout: 6000 }); ok(true, 'blocked sender cannot deliver'); await sleep(300); C.errs.length = ec; /* expected HTTP 403 */
    ok(C.errs.length === 0, 'no console errors (third player)', C.errs.slice(0, 5));
    await C.context().close();
    for (const p of [A, B]) for (const w of [390]) { /* overflow check for chat view at mobile handled below */ }
    // Language + theme
    await A.evaluate(() => { APP.setSetting('lang', 'en'); }); await A.reload(); await A.waitForFunction(() => window.Net && Net.avail() === 'ok'); await sleep(800);
    const en = await A.textContent('.nav button[data-view="rank"]'); ok(/Ranking|Leaderboard/.test(en), 'EN language persisted', en);
    // overflow
    for (const [p, n] of [[A, 'desktop'], [B, 'mobile']]) for (const v of ['play', 'versus', 'rank', 'chat', 'profile', 'settings']) {
      await p.evaluate((v) => APP.showView(v), v); await sleep(250);
      const sw = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); ok(sw <= 0, `no horizontal overflow ${n}/${v}`, sw);
    }
    ok(A.errs.length === 0, 'no console errors desktop', A.errs.slice(0, 5)); ok(B.errs.length === 0, 'no console errors mobile', B.errs.slice(0, 5));
  } catch (e) { ok(false, 'exception: ' + e.message.split('\n')[0]); await A.screenshot({ path: OUT + '-fail-A.png' }); await B.screenshot({ path: OUT + '-fail-B.png' }); console.log('errsA', A.errs, 'errsB', B.errs); for (const p of [A,B]) console.log(await p.evaluate(() => JSON.stringify({ act: MP.active(), ph: MP.phase(), rdy: Net.ready(), fr: document.getElementById('frList').textContent }))); }
  console.log(`\n${pass} passed, ${fail} failed`);
  require('fs').writeFileSync(OUT + '-results.txt', res.join('\n') + `\n\n${pass} passed, ${fail} failed\n`);
  await b.close();
})();
