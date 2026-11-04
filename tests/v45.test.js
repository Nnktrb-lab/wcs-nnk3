'use strict';
/* WCS v4.4.1 integration tests: MR 2v2 (private lobby + matchmaking), team-only boards, turns, eliminations, Elo/coins,
   ban void, team-only voice signalling, chat mute, private rated cap, themes, titles, privacy, profile, remember-me cookie,
   server-side game progress, server-side music, support reports, admin grants, about. Real server, real SQLite. */
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));

const PORT = 8127, BASE = 'http://127.0.0.1:' + PORT, DBF = '/tmp/sla-v45-' + Date.now() + '.db';
let pass = 0, fail = 0; const results = [];
function ok(cond, name, extra) { if (cond) { pass++; results.push('PASS ' + name); } else { fail++; results.push('FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 400) : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, p, body, token, headers) {
  const r = await fetch(BASE + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}, headers || {}), body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (e) { }
  return { status: r.status, body: j, headers: r.headers };
}
class Sock {
  constructor(token) { this.token = token; this.msgs = []; this.raw = []; this.waiters = []; }
  open() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket('ws://127.0.0.1:' + PORT + '/ws');
      this.ws.on('open', () => this.ws.send(JSON.stringify({ t: 'auth', token: this.token })));
      this.ws.on('message', (d) => { const s = d.toString(); this.raw.push(s); const m = JSON.parse(s); this.msgs.push(m); if (m.t === 'hello') res(m); this.waiters = this.waiters.filter((w) => { if (w.f(m)) { w.r(m); return false; } return true; }); });
      this.ws.on('error', rej);
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  wait(f, ms = 15000) {
    const pred = typeof f === 'string' ? (m) => m.t === f : f;
    const hit = this.msgs.find(pred); if (hit) { this.msgs.splice(this.msgs.indexOf(hit), 1); return Promise.resolve(hit); }
    return new Promise((res, rej) => { const w = { f: pred, r: (m) => { clearTimeout(w.to); this.msgs.splice(this.msgs.indexOf(m), 1); res(m); } }; w.to = setTimeout(() => { this.waiters = this.waiters.filter((x) => x !== w); rej(new Error('timeout waiting ' + (typeof f === 'string' ? f : 'predicate'))); }, ms); this.waiters.push(w); });
  }
  none(f, ms = 700) { return this.wait(f, ms).then(() => false, () => true); }
  clear() { this.msgs = []; }
  close() { try { this.ws.close(); } catch (e) { } }
}
let OFF = 0;
async function clock(add) { OFF += add; await api('POST', '/api/_test/clock', { offsetMs: OFF }); }
async function reg(n) { const r = await api('POST', '/api/auth/register', { username: n, password: n + 'pw12345' }); if (!r.body || !r.body.token) throw new Error('register ' + n + ' ' + JSON.stringify(r.body)); return r.body; }
async function login(n) { return (await api('POST', '/api/auth/login', { username: n, password: n + 'pw12345' })).body; }

async function main() {
  const srv = spawn('node', [path.join(__dirname, '..', 'server', 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), SLA_DB: DBF, SLA_REG_LIMIT: '500', SLA_HTTP_LIMIT: '100000', SLA_TEST_HOOKS: '1', SLA_ADMINS: 'v45_admin',
    SLA_MR_TURN_MS: '2500', SLA_MR_COUNTDOWN_MS: '300', SLA_MR_BACK_MS: '600', SLA_MR_LOBBY_GRACE_MS: '600', SLA_MR_DISC_MS: '3000' }), stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => log += d); srv.stderr.on('data', (d) => log += d);
  for (let i = 0; i < 80; i++) { try { await fetch(BASE + '/api/health'); break; } catch (e) { await sleep(100); } }
  const socks = []; const S = async (tok) => { const s = new Sock(tok); await s.open(); socks.push(s); return s; };
  try {
    const h = await api('GET', '/api/health'); ok(h.body.version === '4.4.1', 'health 4.4.1', h.body);
    const ab = await api('GET', '/api/about');
    ok(ab.status === 200 && ab.body.schema === 6 && ab.body.coins && ab.body.coins.win === 30 && ab.body.mr.turnSec === 3 && ab.body.mr.sizes.join() === '2,3', '/api/about reports schema, coin rules, MR config', ab.body);
    const rdb = new Database(DBF, { readonly: true });
    ['mr_matches', 'mr_players', 'owned_themes', 'user_mutes', 'support_reports', 'user_music', 'user_wallpaper'].forEach((t) => ok(!!rdb.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t), 'table ' + t));

    await reg('v45_admin'); await sleep(50); const AD = await login('v45_admin'); ok(AD.user.role === 'admin', 'admin promoted');
    const P = []; for (const n of ['mr_alpha', 'mr_bravo', 'mr_charlie', 'mr_delta', 'mr_echo']) P.push(await reg(n));
    const [A1, B1, A2, B2, X] = P;

    /* ---------------- remember-me cookie */
    let r = await api('POST', '/api/auth/remember', {}, A1.token);
    let sc = r.headers.get('set-cookie') || '';
    ok(r.status === 200 && /wcs_sid=/.test(sc) && /HttpOnly/i.test(sc) && /SameSite=Lax/i.test(sc) && /Path=\//.test(sc) && !/Secure/.test(sc), 'remember sets HttpOnly SameSite=Lax cookie (no Secure on localhost)', sc);
    const cookie = sc.split(';')[0];
    r = await api('GET', '/api/auth/session', null, null, { cookie });
    ok(r.status === 200 && r.body.user.username === 'mr_alpha' && r.body.token === A1.token, 'session restored from cookie after refresh', r.body);
    r = await api('GET', '/api/auth/session');
    ok(r.status === 200 && r.body.user === null && r.body.token === null, 'no cookie -> no session (200, no console error)');
    r = await api('GET', '/api/auth/session', null, A1.token);
    ok(r.status === 200 && r.body.user && r.body.user.username === 'mr_alpha', 'session restored from bearer fallback (proxy strips Set-Cookie)', r.body);
    r = await api('GET', '/api/auth/session', null, 'x'.repeat(48));
    ok(r.status === 200 && r.body.user === null, 'forged bearer fallback rejected');
    r = await api('GET', '/api/auth/session', null, null, { cookie: 'wcs_sid=forged' });
    ok(r.body.user === null && /Max-Age=0/.test(r.headers.get('set-cookie') || ''), 'forged cookie rejected and cleared');
    r = await api('POST', '/api/auth/remember', {}, A1.token, { 'x-forwarded-proto': 'https' });
    ok(/Secure/.test(r.headers.get('set-cookie') || ''), 'cookie is Secure behind https proxy');
    r = await api('POST', '/api/auth/remember', {}, null); ok(r.status === 401, 'remember requires a valid token');
    r = await api('POST', '/api/auth/forget', {}); ok(/Max-Age=0/.test(r.headers.get('set-cookie') || ''), 'forget clears cookie');
    const tmp = await login('mr_echo');
    await api('POST', '/api/auth/remember', {}, tmp.token);
    r = await api('POST', '/api/auth/logout', {}, tmp.token);
    ok(/Max-Age=0/.test(r.headers.get('set-cookie') || ''), 'logout clears cookie');
    r = await api('GET', '/api/auth/session', null, null, { cookie: 'wcs_sid=' + encodeURIComponent(tmp.token) });
    ok(r.body.user === null, 'logged-out session cannot be restored from old cookie');
    r = await api('GET', '/api/auth/session', null, tmp.token);
    ok(r.body.user === null, 'logged-out session cannot be restored from old fallback cookie');

    /* ---------------- solo game progress */
    const game = { mode: 'classic', diff: 'easy', puzzle: '0'.repeat(81), board: [1, 2, 3], notes: {}, t: 1234, mistakes: 1, won: false };
    r = await api('PUT', '/api/me/progress', { progress: { stats: { played: 3 }, settings: { lang: 'ms' }, game } }, A1.token); ok(r.status === 200, 'progress saved with running game');
    r = await api('GET', '/api/me/progress', null, A1.token);
    ok(r.body.progress.game && r.body.progress.game.t === 1234 && r.body.progress.stats.played === 3, 'running game restored after refresh', r.body);
    await api('PUT', '/api/me/progress', { progress: { stats: { played: 4 } } }, A1.token);
    r = await api('GET', '/api/me/progress', null, A1.token);
    ok(r.body.progress.game && r.body.progress.game.t === 1234 && r.body.progress.stats.played === 4, 'update without game keeps the saved game');
    await api('PUT', '/api/me/progress', { progress: { stats: { played: 4 }, game: null } }, A1.token);
    r = await api('GET', '/api/me/progress', null, A1.token); ok(!r.body.progress.game, 'finished game cleared');
    r = await api('PUT', '/api/me/progress', { progress: { stats: { big: 'x'.repeat(270 * 1024) } } }, A1.token); ok(r.status === 400, 'progress over 256KB rejected');
    r = await api('PUT', '/api/me/progress', { progress: { settings: { turn: { secret: 'x' } } } }, A1.token);
    r = await api('GET', '/api/me/progress', null, A1.token); ok(!r.body.progress.settings.turn, 'TURN secrets never stored');
    r = await api('GET', '/api/me/progress', null, null); ok(r.status === 401, 'progress requires auth');

    /* ---------------- themes */
    r = await api('GET', '/api/themes', null, A1.token);
    ok(r.status === 200 && r.body.themes.length === 8 && r.body.equipped === 'default' && r.body.coins === 200, 'theme list + welcome coins', r.body);
    r = await api('POST', '/api/themes/buy', { id: 'midnight' }, A1.token); ok(r.status === 402 && r.body.error === 'no_coins', 'cannot buy theme without enough coins');
    r = await api('POST', '/api/me/cosmetics', { boardTheme: 'midnight' }, A1.token); ok(r.status === 403, 'cannot equip unowned theme');
    r = await api('POST', '/api/themes/buy', { id: 'nope' }, A1.token); ok(r.status === 404, 'unknown theme 404');
    r = await api('POST', '/api/themes/buy', { id: 'default' }, A1.token); ok(r.status === 404, 'default theme not buyable');
    // give coins legitimately via admin? not allowed - top up the test DB directly (test only)
    { const w = new Database(DBF); w.prepare('UPDATE users SET coins = 500 WHERE id = ?').run(A1.user.id); w.close(); }
    r = await api('POST', '/api/themes/buy', { id: 'paper' }, A1.token); ok(r.status === 200 && r.body.coins === 250, 'theme bought, coins deducted on server', r.body);
    r = await api('POST', '/api/themes/buy', { id: 'paper' }, A1.token); ok(r.status === 409, 'cannot buy twice');
    ok(rdb.prepare("SELECT amount FROM coin_tx WHERE user_id = ? AND ref = 'theme:paper'").get(A1.user.id).amount === -250, 'coin_tx records theme purchase');
    r = await api('POST', '/api/me/cosmetics', { boardTheme: 'paper' }, A1.token); ok(r.status === 200 && r.body.user.boardTheme === 'paper', 'theme equipped', r.body);
    r = await api('GET', '/api/me', null, A1.token); ok(r.body.user ? r.body.user.boardTheme === 'paper' : r.body.boardTheme === 'paper', 'equipped theme persists on /api/me', r.body);

    /* ---------------- titles */
    r = await api('GET', '/api/me/titles', null, A1.token); ok(r.status === 200 && r.body.list.length >= 10, 'titles list', r.body);
    const locked = r.body.list.find((x) => !x.unlocked), open = r.body.list.find((x) => x.unlocked);
    if (locked) { const q = await api('POST', '/api/me/cosmetics', { title: locked.id }, A1.token); ok(q.status === 403, 'locked title cannot be equipped'); }
    if (open) { const q = await api('POST', '/api/me/cosmetics', { title: open.id }, A1.token); ok(q.status === 200, 'unlocked title equipped'); }
    r = await api('POST', '/api/me/cosmetics', { title: 'xx' }, A1.token); ok(r.status === 404, 'unknown title 404');
    r = await api('POST', '/api/me/cosmetics', { border: 'galaxy' }, A1.token); ok(r.status === 400, 'border must use border endpoint (no free borders)');

    /* ---------------- privacy + profile */
    r = await api('POST', '/api/me/privacy', { history: 'private' }, B1.token); ok(r.status === 200, 'privacy set private');
    r = await api('POST', '/api/me/privacy', { history: 'weird' }, B1.token); ok(r.status === 400, 'bad privacy rejected');
    r = await api('GET', '/api/profile/' + B1.user.id, null, A1.token); ok(r.status === 200 && r.body.historyVisible === false && r.body.history.length === 0, 'private history hidden from others');
    r = await api('GET', '/api/profile/' + B1.user.id, null, AD.token); ok(r.body.historyVisible === true, 'admin can see private history');
    r = await api('GET', '/api/profile/' + B1.user.id, null, B1.token); ok(r.body.historyVisible === true && r.body.self === true, 'owner sees own history');
    r = await api('GET', '/api/profile/' + B1.user.id); ok(r.status === 200 && r.body.historyVisible === false, 'guest view of private profile');
    await api('POST', '/api/me/privacy', { history: 'friends' }, B1.token);
    r = await api('GET', '/api/profile/' + B1.user.id, null, A1.token); ok(r.body.historyVisible === false, 'friends-only hidden from non-friend');
    r = await api('GET', '/api/profile/999999', null, A1.token); ok(r.status === 404, 'unknown profile 404');
    ok(r.body && !JSON.stringify(r.body).includes('pw_hash'), 'profile response has no secrets');
    r = await api('GET', '/api/profile/' + A1.user.id, null, B1.token); ok(!JSON.stringify(r.body).match(/pw_hash|recovery_hash|token/), 'public profile leaks no secrets');

    /* ---------------- mutes */
    r = await api('POST', '/api/mute', { uid: B1.user.id, on: true }, A1.token); ok(r.status === 200, 'mute');
    r = await api('GET', '/api/mutes', null, A1.token); ok(r.body.ids.includes(B1.user.id), 'mute list');
    r = await api('POST', '/api/mute', { uid: A1.user.id, on: true }, A1.token); ok(r.status === 400, 'cannot mute self');
    r = await api('GET', '/api/profile/' + B1.user.id, null, A1.token); ok(r.body.muted === true, 'profile shows muted');

    /* ---------------- MR private lobby 2v2 */
    const s1 = await S(A1.token), s2 = await S(B1.token), s3 = await S(A2.token), s4 = await S(B2.token), s5 = await S(X.token);
    const all = [s1, s2, s3, s4];
    s1.send({ t: 'mr_create', size: 2, mode: 'classic', diff: 'easy' });
    let lb = await s1.wait('mr_lobby'); ok(lb.private && lb.code && lb.code.length === 6 && lb.myTeam === 'A' && lb.total === 4 && lb.rated === true, 'private 2v2 lobby created', lb);
    const code = lb.code;
    s2.send({ t: 'mr_join', code: code.toLowerCase() }); lb = await s2.wait('mr_lobby'); ok(lb.myTeam === 'B', 'second player auto to team B', lb.myTeam);
    s3.send({ t: 'mr_join', code }); lb = await s3.wait('mr_lobby'); ok(lb.myTeam === 'A', 'third to team A');
    s4.send({ t: 'mr_join', code }); lb = await s4.wait('mr_lobby'); ok(lb.myTeam === 'B' && lb.joined === 4, 'fourth to team B, lobby full');
    s5.send({ t: 'mr_join', code }); let e = await s5.wait((m) => m.t === 'error'); ok(e.code === 'mr_full', 'fifth player rejected (full)', e);
    s5.send({ t: 'mr_join', code: 'ZZZZZZ' }); e = await s5.wait((m) => m.t === 'error'); ok(e.code === 'mr_no_lobby', 'bad code rejected');
    // lobby chat: B1 is muted by A1
    await sleep(50); all.forEach((s) => s.clear());
    s2.send({ t: 'mr_chat', text: 'halo semua' });
    const gotC = await s3.wait('mr_chat').then((m) => m.msg.text === 'halo semua', () => false); ok(gotC, 'lobby chat delivered');
    ok(await s1.none('mr_chat'), 'muted player chat not delivered to muter');
    s1.send({ t: 'mr_chat', text: '<b>x</b>' }); const cm = await s2.wait((m) => m.t === 'mr_chat' && m.msg.from.id === A1.user.id, 3000).catch(() => null); ok(cm && !/</.test(cm.msg.text), 'muter can still talk (text sanitised)', cm && cm.msg);
    // ready up
    all.forEach((s) => s.clear());
    all.forEach((s) => s.send({ t: 'mr_ready', val: true }));
    let st = {}; await Promise.all(all.map(async (s, k) => { st[k] = await s.wait((m) => m.t === 'mr_state' && m.full, 30000); }));
    ok(st[0].mid && st[0].myTeam === 'A' && st[1].myTeam === 'B', 'match started, each player knows own team', [st[0].myTeam, st[1].myTeam]);
    const mid = st[0].mid;
    const sol = rdb.prepare('SELECT solution FROM mr_matches WHERE id = ?').get(mid).solution.split('').map(Number);
    const puz = st[0].puzzle;
    ok(st[0].order.join() === [A1, B1, A2, B2].map((p) => p.user.id).join(), 'turn order alternates A,B,A,B', st[0].order);
    ok(st[0].turnUid === A1.user.id, 'A1 starts');
    const empties = []; for (let i = 0; i < 81; i++) if (!puz[i]) empties.push(i);
    const wrongOf = (i) => (sol[i] % 9) + 1;
    // not-turn move
    s2.send({ t: 'mr_mv', i: empties[0], v: sol[empties[0]] }); e = await s2.wait((m) => m.t === 'error'); ok(e.code === 'mr_not_turn', 'moving out of turn rejected', e);
    // timeout: let A1's turn expire
    all.forEach((s) => s.clear());
    let tm = await s1.wait((m) => m.t === 'mr_state' && m.lastMove && m.lastMove.timeout, 8000).catch(() => null);
    ok(tm && tm.turnUid === B1.user.id, 'turn passes to next player on timeout', tm && tm.turnUid);
    // voice signalling only within team
    all.forEach((s) => s.clear());
    s1.send({ t: 'mrv_signal', to: A2.user.id, data: { sdp: 'x' } });
    ok(await s3.wait('mrv_signal', 2000).then((m) => m.from === A1.user.id, () => false), 'voice signal delivered to teammate');
    s1.send({ t: 'mrv_signal', to: B1.user.id, data: { sdp: 'x' } });
    ok(await s2.none('mrv_signal'), 'voice signal never crosses teams');
    s1.send({ t: 'mr_chat', text: 'rahsia pasukan', team: true });
    ok(await s3.wait('mr_chat', 2000).then((m) => m.msg.team === 'A', () => false), 'team chat to teammate');
    ok(await s4.none('mr_chat'), 'team chat hidden from other team');
    // play: B makes wrong moves until eliminated, A makes correct ones
    const seq = [[s2, 'B', false], [s3, 'A', true], [s4, 'B', false], [s1, 'A', true], [s2, 'B', false], [s3, 'A', true], [s4, 'B', false], [s1, 'A', true], [s2, 'B', false], [s3, 'A', true], [s4, 'B', false]];
    let ai = 0, bi = 1, firstA = null, outSeen = false, res = null;
    for (let k = 0; k < seq.length; k++) {
      const [s, T, good] = seq[k];
      if (k === seq.length - 1) await clock(31000); // match lasted > 30s -> coins
      all.forEach((x) => x.clear());
      const i = good ? empties[ai++] : empties[bi + 40];
      if (good && firstA === null) firstA = i;
      s.send({ t: 'mr_mv', i, v: good ? sol[i] : wrongOf(i) });
      const m1 = await s1.wait((m) => m.t === 'mr_state' && m.lastMove && !m.lastMove.timeout, 8000).catch(() => null);
      const m2 = await s2.wait((m) => m.t === 'mr_state' && m.lastMove && !m.lastMove.timeout, 8000).catch(() => null);
      if (!m1 || !m2) { ok(false, 'move ' + k + ' broadcast'); break; }
      if (k === 1) {
        ok(m1.board[firstA] === sol[firstA], 'team A board shows its correct move');
        ok(m2.board[firstA] === 0, 'team B board does NOT show team A move');
        ok(m2.lastMove.i === undefined && m1.lastMove.i === firstA, 'opponent sees no cell index of other team move');
        ok(m2.progress.A > 0 && m2.progress.B === 0, 'opponent only sees progress %');
      }
      if (k === 8) { outSeen = !!m1.out[B1.user.id]; ok(outSeen && m1.mistakes[B1.user.id] === 3, '3 mistakes -> eliminated', m1.out); }
    }
    res = await Promise.all(all.map((s) => s.wait('mr_result', 8000).catch(() => null)));
    ok(res.every(Boolean) && res[0].winner === 'A' && res[0].reason === 'eliminated', 'team A wins by elimination', res[0]);
    if (res.every(Boolean)) {
      ok(res[0].rated && res[0].elo.delta === 20 && res[2].elo.delta === 20, 'winners +20 Elo (K40)', res[0].elo);
      ok(res[1].elo.delta === -20 && res[3].elo.delta === -20, 'losers -20 Elo', res[1].elo);
      ok(res[0].coins === 30 && res[1].coins === 5, 'MR coins: win 30, loss 5 (server-granted)', [res[0].coins, res[1].coins]);
    }
    ok(all.every((s) => !s.raw.some((x) => /"solution"/.test(x))), 'solution never sent to any client');
    ok(rdb.prepare("SELECT COUNT(*) n FROM elo_transactions WHERE match_id = ?").get('mr:' + mid).n === 4, 'elo_transactions has 4 MR rows');
    ok(rdb.prepare('SELECT COUNT(*) n FROM mr_players WHERE match_id = ?').get(mid).n === 4, 'mr_players has 4 rows');
    const mm = rdb.prepare('SELECT * FROM mr_matches WHERE id = ?').get(mid); ok(mm.winner === 'A' && mm.ended_at && mm.duration_ms >= 30000, 'mr_matches finalised', mm.winner);
    const ua = rdb.prepare('SELECT * FROM users WHERE id = ?').get(A1.user.id);
    ok(ua.mr_games === 1 && ua.mr_wins === 1 && ua.rating === 1220 && ua.games === 0, 'MR stats stored separately from ranked 1v1 stats', { g: ua.mr_games, r: ua.rating, rg: ua.games });
    r = await api('GET', '/api/mr/leaderboard', null, A1.token);
    ok(r.status === 200 && r.body.rows.length === 4 && r.body.me && r.body.me.pos >= 1, 'MR leaderboard with my position', r.body.me);
    r = await api('GET', '/api/mr/history', null, B1.token); ok(r.body.rows.length === 1 && r.body.rows[0].res === 'loss' && r.body.rows[0].team === 'B', 'MR history', r.body.rows);
    r = await api('GET', '/api/profile/' + A1.user.id, null, B2.token); ok(r.body.mr.games === 1 && r.body.mr.wins === 1 && r.body.history.some((x) => x.type === 'mr'), 'public profile shows MR stats + history');
    // back to private lobby
    lb = await s1.wait((m) => m.t === 'mr_lobby' && m.phase === 'lobby', 5000).catch(() => null); ok(lb && lb.joined === 4, 'private lobby returns after result');

    /* ---------------- private rated cap (3 per 24h for the same group) */
    { const w = new Database(DBF); const key = [A1, B1, A2, B2].map((p) => p.user.id).sort((a, b) => a - b).join(',');
      for (let k = 0; k < 2; k++) w.prepare("INSERT INTO mr_matches (size, mode, diff, private, rated, players_key, puzzle, solution, started_at, ended_at, winner) VALUES (2,'classic','easy',1,1,?,?,?,?,?, 'A')").run(key, '0'.repeat(81), '1'.repeat(81), Date.now() + OFF, Date.now() + OFF);
      w.close(); }
    all.forEach((s) => s.clear());
    s4.send({ t: 'mr_team', team: 'A' }); // A is full -> ignored, but triggers rebroadcast? no; toggle ready instead
    s1.send({ t: 'mr_ready', val: true }); s2.send({ t: 'mr_ready', val: true }); s3.send({ t: 'mr_ready', val: true }); s4.send({ t: 'mr_ready', val: true });
    st = await s1.wait((m) => m.t === 'mr_state' && m.full, 30000).catch(() => null);
    lb = await s1.wait((m) => m.t === 'mr_lobby' && m.phase === 'match', 5000).catch(() => null);
    ok(lb && lb.rated === false, 'private group capped at 3 rated games per 24h (4th unrated)', lb && lb.rated);
    const before2 = rdb.prepare('SELECT id, rating, coins FROM users ORDER BY id').all();
    all.forEach((s) => s.clear());
    s1.send({ t: 'mr_surrender' }); s3.send({ t: 'mr_surrender' });
    res = await s2.wait('mr_result', 8000).catch(() => null);
    ok(res && res.winner === 'B' && res.rated === false && res.elo === null && res.coins === 0, 'unrated private game: no Elo, no coins', res);
    ok(JSON.stringify(rdb.prepare('SELECT id, rating, coins FROM users ORDER BY id').all()) === JSON.stringify(before2), 'unrated game changed no rating/coins');
    await sleep(800);
    all.forEach((s) => s.send({ t: 'mr_leave' })); await sleep(300);

    /* ---------------- matchmaking + ban void */
    all.forEach((s) => s.clear());
    all.forEach((s) => s.send({ t: 'mr_find', size: 2, mode: 'classic', diff: 'easy' }));
    st = await Promise.all(all.map((s) => s.wait((m) => m.t === 'mr_state' && m.full, 30000).catch(() => null)));
    ok(st.every(Boolean) && new Set(st.map((x) => x.mid)).size === 1, 'matchmaking formed a 2v2 match for 4 players');
    const lbq = await s1.wait((m) => m.t === 'mr_lobby' && m.phase === 'match', 3000).catch(() => null); ok(lbq && lbq.private === false && lbq.rated === true, 'matchmade lobby is public + rated');
    const mid2 = st[0] && st[0].mid;
    const beforeBan = rdb.prepare('SELECT id, rating, coins, mr_games, mr_wins FROM users ORDER BY id').all();
    const eloRows = rdb.prepare('SELECT COUNT(*) n FROM elo_transactions').get().n;
    all.forEach((s) => s.clear());
    r = await api('POST', '/api/admin/players/' + B2.user.id + '/ban', { preset: 1, reasonCode: 'cheating' }, AD.token);
    ok(r.status === 200, 'admin bans a player mid-MR-match', r.body);
    const v1 = await s1.wait('match_void', 5000).catch(() => null), v4 = await s4.wait((m) => m.t === 'match_void' || (m.t === 'error' && m.code === 'banned'), 5000).catch(() => null);
    ok(v1 && v1.why === 'opp_banned', 'others get match_void', v1);
    ok(!!v4, 'banned player is informed', v4);
    ok(rdb.prepare('SELECT winner FROM mr_matches WHERE id = ?').get(mid2).winner === 'void', 'match recorded as void');
    ok(JSON.stringify(rdb.prepare('SELECT id, rating, coins, mr_games, mr_wins FROM users ORDER BY id').all()) === JSON.stringify(beforeBan), 'ban changed no Elo, coins or stats');
    ok(rdb.prepare('SELECT COUNT(*) n FROM elo_transactions').get().n === eloRows, 'no Elo transactions from void');
    await sleep(200); s4.clear();
    s4.send({ t: 'mr_find', size: 2, mode: 'classic', diff: 'easy' }); e = await s4.wait((m) => m.t === 'error', 3000).catch(() => null); ok(e && e.code === 'banned', 'banned player cannot queue MR', e);
    s4.send({ t: 'mr_create', size: 2, mode: 'classic', diff: 'easy' }); e = await s4.wait((m) => m.t === 'error', 3000).catch(() => null); ok(e && e.code === 'banned', 'banned player cannot create MR lobby', e);
    s1.send({ t: 'mr_create', size: 3, mode: 'killer', diff: 'easy' }); lb = await s1.wait('mr_lobby', 3000).catch(() => null);
    ok(lb && lb.size === 3 && lb.total === 6 && lb.diff === 'medium', '3v3 killer lobby (difficulty clamped)', lb && [lb.size, lb.diff]);
    s4.send({ t: 'mr_join', code: lb.code }); e = await s4.wait((m) => m.t === 'error', 3000).catch(() => null); ok(e && e.code === 'banned', 'banned player cannot join MR lobby');
    s1.send({ t: 'mr_leave' });
    s1.send({ t: 'mr_create', size: 4, mode: 'classic', diff: 'easy' }); e = await s1.wait((m) => m.t === 'error', 3000).catch(() => null); ok(e && e.code === 'bad_request', 'invalid team size rejected');

    /* ---------------- chat wallpaper on server */
    const wimg = 'data:image/jpeg;base64,' + Buffer.alloc(3000, 9).toString('base64');
    r = await api('PUT', '/api/me/wallpaper', { image: wimg }, A1.token); ok(r.status === 200, 'wallpaper saved on server');
    r = await api('GET', '/api/me/wallpaper', null, A1.token); ok(r.body.image === wimg, 'wallpaper restored from server');
    r = await api('GET', '/api/me/wallpaper', null, B1.token); ok(r.body.image === null, 'wallpaper is per player');
    r = await api('PUT', '/api/me/wallpaper', { image: 'javascript:alert(1)' }, A1.token); ok(r.status === 400, 'non-JPEG data URL rejected');
    r = await api('PUT', '/api/me/wallpaper', { image: 'data:image/jpeg;base64,' + 'A'.repeat(400 * 1024) }, A1.token); ok(r.status === 400, 'wallpaper over 400KB rejected');
    r = await api('DELETE', '/api/me/wallpaper', null, A1.token); r = await api('GET', '/api/me/wallpaper', null, A1.token); ok(r.body.image === null, 'wallpaper removed');

    /* ---------------- music */
    const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(3000, 7)]);
    let mr = await fetch(BASE + '/api/me/music?title=Lagu%20Saya', { method: 'POST', headers: { authorization: 'Bearer ' + A1.token, 'content-type': 'application/octet-stream' }, body: mp3 });
    let mj = await mr.json(); ok(mr.status === 200 && mj.mime === 'audio/mpeg' && mj.title === 'Lagu Saya', 'music uploaded to server', mj);
    mr = await fetch(BASE + '/api/me/music', { method: 'POST', headers: { authorization: 'Bearer ' + A1.token }, body: Buffer.alloc(3000, 1) }); ok(mr.status === 400, 'non-audio rejected');
    r = await api('GET', '/api/me/music', null, A1.token); ok(r.body.rows.length === 1 && r.body.limit === 5, 'music list');
    mr = await fetch(BASE + '/api/me/music/' + mj.id, { headers: { authorization: 'Bearer ' + A1.token } });
    const got = Buffer.from(await mr.arrayBuffer()); ok(mr.status === 200 && got.equals(mp3) && mr.headers.get('content-type') === 'audio/mpeg', 'music downloaded byte-exact');
    mr = await fetch(BASE + '/api/me/music/' + mj.id, { headers: { authorization: 'Bearer ' + B1.token } }); ok(mr.status === 404, 'other player cannot read my music');
    r = await api('DELETE', '/api/me/music/' + mj.id, null, B1.token); ok(r.status === 404, 'other player cannot delete my music');
    r = await api('DELETE', '/api/me/music/' + mj.id, null, A1.token); ok(r.status === 200, 'music deleted');
    mr = await fetch(BASE + '/music/gymnopedie-1-satie.mp3'); ok(mr.status === 200 && /audio\/mpeg/.test(mr.headers.get('content-type') || ''), 'built-in MP3 served', mr.status);

    /* ---------------- support + admin grant */
    r = await api('POST', '/api/support/report', { category: 'bug', body: 'butang tidak berfungsi di telefon' }, A1.token); ok(r.status === 200, 'support report sent');
    const sid = r.body.id;
    r = await api('POST', '/api/support/report', { category: 'bug', body: 'x' }, A1.token); ok(r.status === 400, 'too-short report rejected');
    r = await api('GET', '/api/admin/support', null, A1.token); ok(r.status === 403, 'non-admin cannot read support');
    r = await api('GET', '/api/admin/support?status=open', null, AD.token); ok(r.status === 200 && r.body.rows.some((x) => x.id === sid) && r.body.open >= 1, 'admin sees open support report');
    r = await api('POST', '/api/admin/support/' + sid, { status: 'resolved', note: 'Dibaiki' }, AD.token); ok(r.status === 200, 'admin resolves report');
    r = await api('GET', '/api/admin/support?status=resolved', null, AD.token); ok(r.body.rows.find((x) => x.id === sid).note === 'Dibaiki', 'resolution note stored');
    r = await api('POST', '/api/admin/grant', { user: 'mr_bravo', kind: 'border', id: 'champion', note: 'Juara acara' }, A1.token); ok(r.status === 403, 'non-admin cannot grant');
    r = await api('POST', '/api/admin/grant', { user: 'mr_bravo', kind: 'border', id: 'champion', note: '' }, AD.token); ok(r.status === 400, 'grant needs a note');
    r = await api('POST', '/api/admin/grant', { user: 'mr_bravo', kind: 'border', id: 'champion', note: 'Juara acara' }, AD.token); ok(r.status === 200, 'admin grants event border by username', r.body);
    r = await api('POST', '/api/admin/grant', { user: B1.user.playerId || String(B1.user.id), kind: 'border', id: 'champion', note: 'Juara acara' }, AD.token); ok(r.status === 409, 'duplicate grant rejected');
    r = await api('POST', '/api/admin/grant', { user: String(B1.user.id), kind: 'theme', id: 'matrix', note: 'Hadiah' }, AD.token); ok(r.status === 200, 'admin grants theme by id');
    r = await api('POST', '/api/admin/grant', { user: 'nobody_here', kind: 'theme', id: 'matrix', note: 'Hadiah' }, AD.token); ok(r.status === 404, 'grant unknown user 404');
    ok(rdb.prepare("SELECT COUNT(*) n FROM admin_audit WHERE action IN ('grant_border','grant_theme','support_resolved')").get().n === 3, 'grants and support actions audited');
    r = await api('GET', '/api/themes', null, B1.token); ok(r.body.themes.find((t) => t.id === 'matrix').owned, 'granted theme owned');

    ok(!/route error|TypeError|ReferenceError/.test(log), 'no server errors in log', log.slice(-800));
  } catch (e) { ok(false, 'exception: ' + e.message, e.stack); }
  socks.forEach((s) => s.close());
  srv.kill();
  results.forEach((x) => console.log(x));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main();
