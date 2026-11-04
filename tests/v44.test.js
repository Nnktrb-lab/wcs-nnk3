'use strict';
/* WCS v4.4 integration tests: bans (HTTP + WebSocket enforcement + auto expiry), unban, audit, player reports,
   coins (server-granted, deduplicated, capped), border shop (buy / own / equip / persist), Legendary 2 + new Mythic,
   unauthorised access. Real server process, real SQLite file, server clock shifted with SLA_TEST_HOOKS. */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));

const PORT = 8126, BASE = 'http://127.0.0.1:' + PORT, DBF = '/tmp/sla-v44-' + Date.now() + '.db';
const DAY = 864e5, HOUR = 3600e3;
let pass = 0, fail = 0; const results = [];
function ok(cond, name, extra) { if (cond) { pass++; results.push('PASS ' + name); } else { fail++; results.push('FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 400) : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, p, body, token) {
  const r = await fetch(BASE + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (e) { }
  return { status: r.status, body: j };
}
class Sock {
  constructor(token) { this.token = token; this.msgs = []; this.waiters = []; }
  open() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket('ws://127.0.0.1:' + PORT + '/ws');
      this.ws.on('open', () => this.ws.send(JSON.stringify({ t: 'auth', token: this.token })));
      this.ws.on('message', (d) => { const m = JSON.parse(d.toString()); this.msgs.push(m); if (m.t === 'hello') res(m); this.waiters = this.waiters.filter((w) => { if (w.f(m)) { w.r(m); return false; } return true; }); });
      this.ws.on('close', (c) => { this.closed = c; });
      this.ws.on('error', rej);
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  wait(f, ms = 15000) {
    const pred = typeof f === 'string' ? (m) => m.t === f : f;
    const hit = this.msgs.find(pred); if (hit) { this.msgs.splice(this.msgs.indexOf(hit), 1); return Promise.resolve(hit); }
    return new Promise((res, rej) => { const w = { f: pred, r: (m) => { clearTimeout(w.to); this.msgs.splice(this.msgs.indexOf(m), 1); res(m); } }; w.to = setTimeout(() => { this.waiters = this.waiters.filter((x) => x !== w); rej(new Error('timeout waiting ' + (typeof f === 'string' ? f : 'predicate'))); }, ms); this.waiters.push(w); });
  }
  clear() { this.msgs = []; }
  close() { try { this.ws.close(); } catch (e) { } }
}
let OFF = 0;
async function clock(add) { OFF += add; const r = await api('POST', '/api/_test/clock', { offsetMs: OFF }); await api('POST', '/api/_test/tick', {}); return r.body.now; }
async function reg(n) { const r = await api('POST', '/api/auth/register', { username: n, password: n + 'pw12345' }); if (!r.body || !r.body.token) throw new Error('register ' + n + ' ' + JSON.stringify(r.body)); return r.body; }
async function login(n) { return (await api('POST', '/api/auth/login', { username: n, password: n + 'pw12345' })).body; }
const banned = (s) => s.wait((m) => m.t === 'error' && m.code === 'banned', 5000).then(() => true, () => false);

async function rankedPair(SA, SB, diff) {
  SA.clear(); SB.clear();
  SA.send({ t: 'mm_find', mode: 'classic', diff: diff || 'easy' }); SB.send({ t: 'mm_find', mode: 'classic', diff: diff || 'easy' });
  await SA.wait('mm_found', 20000); await SB.wait('mm_found', 20000);
  const cd = await SA.wait('countdown', 40000); await SB.wait('countdown', 40000); await SA.wait('go', 8000); await SB.wait('go', 8000);
  return cd;
}

async function main() {
  const srv = spawn('node', [path.join(__dirname, '..', 'server', 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), SLA_DB: DBF, SLA_REG_LIMIT: '500', SLA_HTTP_LIMIT: '100000', SLA_TEST_HOOKS: '1', SLA_ADMINS: 'v44_admin' }), stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => log += d); srv.stderr.on('data', (d) => log += d);
  for (let i = 0; i < 80; i++) { try { await fetch(BASE + '/api/health'); break; } catch (e) { await sleep(100); } }
  const socks = []; const S = async (tok) => { const s = new Sock(tok); await s.open(); socks.push(s); return s; };
  try {
    const h = await api('GET', '/api/health'); ok(h.body.version === '4.4.1', 'health reports version 4.4.1', h.body);
    const rdb = new Database(DBF, { readonly: true });
    ok(rdb.prepare("SELECT v FROM schema_meta WHERE k='version'").get().v === '6', 'schema version 6');
    ['player_bans', 'player_reports', 'coin_tx', 'owned_borders'].forEach((t) => ok(!!rdb.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t), 'table ' + t + ' exists'));

    const ADM = await reg('v44_admin'); await sleep(50);
    let AD = await login('v44_admin');
    ok(AD.user.role === 'admin', 'configured admin is promoted at registration', AD.user.role);
    const P1 = await reg('cheater_one'), P2 = await reg('honest_two'), P3 = await reg('third_guy'), MAL = await reg('mallory_x');

    /* ---------- unauthorised access ---------- */
    const adminPaths = [['GET', '/api/admin/players'], ['GET', '/api/admin/players/' + P1.user.id], ['POST', '/api/admin/players/' + P1.user.id + '/ban'], ['POST', '/api/admin/bans/1/unban'], ['GET', '/api/admin/bans'], ['GET', '/api/admin/audit'], ['GET', '/api/admin/player-reports'], ['POST', '/api/admin/player-reports/1']];
    let denied = 0, anon = 0;
    for (const [m, p] of adminPaths) { const r = await api(m, p, m === 'POST' ? { preset: 1, reasonCode: 'cheating' } : null, MAL.token); if (r.status === 403) denied++; const r2 = await api(m, p, m === 'POST' ? {} : null); if (r2.status === 401) anon++; }
    ok(denied === adminPaths.length, 'player gets 403 on all ' + adminPaths.length + ' admin endpoints', denied);
    ok(anon === adminPaths.length, 'anonymous gets 401 on all admin endpoints', anon);
    ok(rdb.prepare("SELECT COUNT(*) n FROM anticheat_logs WHERE kind='admin_denied' AND user_id=?").get(MAL.user.id).n >= adminPaths.length, 'denied admin attempts are logged to anti-cheat');
    ok(rdb.prepare('SELECT COUNT(*) n FROM player_bans').get().n === 0, 'no ban was created by unauthorised calls');

    /* ---------- player report ---------- */
    let r = await api('POST', '/api/report', { uid: P1.user.id, category: 'cheating', body: 'Solves extreme in 40s every match' }, P2.token);
    ok(r.status === 200 && r.body.id > 0, 'player can report another player', r.body); const repId = r.body.id;
    r = await api('POST', '/api/report', { uid: P1.user.id, category: 'cheating', body: 'again again' }, P2.token); ok(r.status === 409 && r.body.error === 'report_dup', 'duplicate open report blocked', r.body);
    r = await api('POST', '/api/report', { uid: P2.user.id, category: 'cheating', body: 'self report' }, P2.token); ok(r.status === 400 && r.body.error === 'report_self', 'cannot report self');
    r = await api('POST', '/api/report', { uid: P1.user.id, category: 'xx', body: 'hello there' }, P3.token); ok(r.status === 400 && r.body.error === 'bad_category', 'report category validated');
    r = await api('GET', '/api/admin/player-reports?status=open', null, AD.token); ok(r.status === 200 && r.body.reports.some((x) => x.id === repId && x.target === 'cheater_one'), 'admin sees open report', r.body);

    /* ---------- search / profile ---------- */
    r = await api('GET', '/api/admin/players?q=cheater', null, AD.token); ok(r.body.players.length === 1 && r.body.players[0].uid === P1.user.id, 'admin search by username');
    r = await api('GET', '/api/admin/players?q=' + encodeURIComponent(P1.user.playerId), null, AD.token); ok(r.body.players.some((x) => x.uid === P1.user.id), 'admin search by Player ID');
    r = await api('GET', '/api/admin/players/' + P1.user.id, null, AD.token); ok(r.status === 200 && r.body.player.username === 'cheater_one' && Array.isArray(r.body.bans) && r.body.reports.length === 1, 'admin player detail with reports');

    /* ---------- validation ---------- */
    r = await api('POST', '/api/admin/players/' + P1.user.id + '/ban', { preset: 2, reasonCode: 'cheating' }, AD.token); ok(r.status === 400 && r.body.error === 'bad_duration', 'invalid preset rejected');
    r = await api('POST', '/api/admin/players/' + P1.user.id + '/ban', { preset: 1, reasonCode: 'nope' }, AD.token); ok(r.status === 400 && r.body.error === 'bad_reason', 'invalid reason rejected');
    r = await api('POST', '/api/admin/players/' + P1.user.id + '/ban', { preset: 1, reasonCode: 'custom', reasonText: '' }, AD.token); ok(r.status === 400 && r.body.error === 'reason_required', 'custom reason needs text');
    r = await api('POST', '/api/admin/players/' + P1.user.id + '/ban', { preset: 'custom', customDays: 0, customHours: 0, reasonCode: 'exploit' }, AD.token); ok(r.status === 400, 'custom duration 0 rejected');
    r = await api('POST', '/api/admin/players/' + P1.user.id + '/ban', { preset: 'custom', customDays: 400, reasonCode: 'exploit' }, AD.token); ok(r.status === 400, 'custom duration > 365 days rejected');
    r = await api('POST', '/api/admin/players/' + ADM.user.id + '/ban', { preset: 1, reasonCode: 'cheating' }, AD.token); ok(r.status === 400 && r.body.error === 'ban_self', 'admin cannot ban self');

    /* ---------- live ranked match voided by a ban; Elo and Coins untouched ---------- */
    const S1 = await S(P1.token), S2 = await S(P2.token);
    const cd = await rankedPair(S1, S2);
    ok(cd.rated === true, 'ranked 1v1 started between cheater and honest player');
    const before1 = rdb.prepare('SELECT rating, coins, games FROM users WHERE id=?').get(P1.user.id), before2 = rdb.prepare('SELECT rating, coins, games FROM users WHERE id=?').get(P2.user.id);
    const t0 = Date.now() + OFF;
    r = await api('POST', '/api/admin/players/' + P1.user.id + '/ban', { preset: 1, reasonCode: 'cheating', reasonText: 'Laporan #' + repId, reportId: repId }, AD.token);
    ok(r.status === 200 && r.body.ban.status === 'active', 'BAN 1 day applied', r.body);
    const b1 = r.body.ban;
    ok(b1.durationMs === DAY && Math.abs(b1.endsAt - b1.startsAt - DAY) < 5 && Math.abs(b1.startsAt - t0) < 5000, '1-day ban: start = server now, end = start + 24h', b1);
    ok(b1.reasonCode === 'cheating' && b1.reasonText === 'Laporan #' + repId && b1.admin === 'v44_admin' && b1.username === 'cheater_one' && b1.playerId === P1.user.playerId, 'ban stores reason, admin, username, Player ID');
    const v1 = await S1.wait('match_void', 5000), v2 = await S2.wait('match_void', 5000);
    ok(v1.why === 'banned' && v2.why === 'opp_banned', 'live match voided for both players with correct reason');
    await S1.wait((m) => m.t === 'ban' && m.ban, 5000).then(() => ok(true, 'banned player receives live ban notice'), () => ok(false, 'banned player receives live ban notice'));
    await sleep(300);
    const after1 = rdb.prepare('SELECT rating, coins, games FROM users WHERE id=?').get(P1.user.id), after2 = rdb.prepare('SELECT rating, coins, games FROM users WHERE id=?').get(P2.user.id);
    ok(JSON.stringify(before1) === JSON.stringify(after1) && JSON.stringify(before2) === JSON.stringify(after2), 'ban does not change Elo, Coins or games of either player', { before1, after1, before2, after2 });
    const vm = rdb.prepare("SELECT result, reason FROM matches WHERE (p1=? OR p2=?) ORDER BY started_at DESC LIMIT 1").get(P1.user.id, P1.user.id);
    ok(vm.result === 'void' && vm.reason === 'ban', 'match row recorded as void/ban', vm);
    ok(rdb.prepare('SELECT COUNT(*) n FROM elo_transactions WHERE user_id IN (?,?)').get(P1.user.id, P2.user.id).n === 0, 'no Elo transaction written for the voided match');
    ok(rdb.prepare("SELECT status FROM player_reports WHERE id=?").get(repId).status === 'resolved', 'linked report auto-resolved by the ban');
    r = await api('POST', '/api/admin/players/' + P1.user.id + '/ban', { preset: 3, reasonCode: 'cheating' }, AD.token); ok(r.status === 409 && r.body.error === 'already_banned', 'second overlapping ban refused');

    /* ---------- enforcement on every competitive entry point ---------- */
    S1.clear();
    S1.send({ t: 'mm_find', mode: 'classic', diff: 'easy' }); ok(await banned(S1), 'banned: Ranked 1v1 matchmaking blocked');
    S1.send({ t: 'room_create', mode: 'classic', diff: 'easy' }); ok(await banned(S1), 'banned: custom room create blocked');
    S2.clear(); S2.send({ t: 'room_create', mode: 'classic', diff: 'easy' }); const rm2 = await S2.wait((m) => m.t === 'room' && m.code);
    S1.send({ t: 'room_join', code: rm2.code }); ok(await banned(S1), 'banned: joining a room blocked');
    S2.send({ t: 'room_leave' }); await sleep(200);
    S1.send({ t: 'wcs_find' }); ok(await banned(S1), 'banned: WCS queue blocked');
    S1.send({ t: 'wcs_ready' }); ok(await banned(S1), 'banned: WCS knockout ready blocked');
    S1.send({ t: 'rematch' }); ok(await banned(S1), 'banned: rematch blocked');
    r = await api('POST', '/api/daily/start', {}, P1.token); ok(r.status === 403 && r.body.error === 'banned' && r.body.ban.endsAt === b1.endsAt, 'banned: daily tournament start blocked (HTTP) with end date', r.body);
    r = await api('POST', '/api/wcs/enter', {}, P1.token); ok(r.status === 403 && r.body.error === 'banned', 'banned: WCS entry blocked (HTTP)');
    r = await api('POST', '/api/practice/start', { difficulty: 'easy' }, P1.token); ok(r.status !== 403, 'banned player can still practise solo (not competitive)', r.status);
    r = await api('GET', '/api/me/ban', null, P1.token); ok(r.body.ban && r.body.ban.endsAt === b1.endsAt, 'player can read own ban status');
    const me1 = await login('cheater_one'); ok(me1.user && me1.user.banned && me1.user.banned.reasonCode === 'cheating', 'banned player can still log in and sees ban in profile');
    const S3 = await S(P3.token); S2.clear();
    S3.send({ t: 'mm_find', mode: 'classic', diff: 'easy' }); S2.send({ t: 'mm_find', mode: 'classic', diff: 'easy' });
    await S2.wait('mm_found', 20000).then(() => ok(true, 'unbanned players still match normally'), () => ok(false, 'unbanned players still match normally'));
    S2.send({ t: 'surrender' }); await S2.wait('result', 20000).catch(() => null); S2.send({ t: 'room_leave' }); S3.send({ t: 'room_leave' }); await sleep(300);

    /* ---------- banned player in matchmaking queue is removed ---------- */
    S3.clear(); S3.send({ t: 'mm_find', mode: 'classic', diff: 'medium' }); await S3.wait((m) => m.t === 'mm' && m.searching, 5000);
    r = await api('POST', '/api/admin/players/' + P3.user.id + '/ban', { preset: 3, reasonCode: 'elo_manip' }, AD.token);
    ok(r.status === 200 && r.body.ban.durationMs === 3 * DAY, 'BAN 3 days applied', r.body.ban);
    await S3.wait((m) => m.t === 'mm' && m.searching === false, 5000).then(() => ok(true, 'player searching for a match is removed from the queue when banned'), () => ok(false, 'player searching for a match is removed from the queue when banned'));
    const b3 = r.body.ban;

    /* ---------- presets 7 / 14 / 30 and custom ---------- */
    const extra = []; for (const n of ['p7', 'p14', 'p30', 'pcust', 'pcust2']) extra.push(await reg('ban_' + n));
    const presets = [[7, 'coin_manip'], [14, 'bug_abuse'], [30, 'rules']];
    for (let i = 0; i < 3; i++) { r = await api('POST', '/api/admin/players/' + extra[i].user.id + '/ban', { preset: presets[i][0], reasonCode: presets[i][1] }, AD.token); ok(r.status === 200 && r.body.ban.durationMs === presets[i][0] * DAY && r.body.ban.endsAt - r.body.ban.startsAt === presets[i][0] * DAY && r.body.ban.reasonCode === presets[i][1], 'BAN ' + presets[i][0] + ' days (' + presets[i][1] + ')', r.body.ban); }
    r = await api('POST', '/api/admin/players/' + extra[3].user.id + '/ban', { preset: 'custom', customDays: 2, customHours: 6, reasonCode: 'custom', reasonText: 'Guna akaun kedua' }, AD.token);
    ok(r.status === 200 && r.body.ban.durationMs === 2 * DAY + 6 * HOUR && r.body.ban.reasonText === 'Guna akaun kedua', 'custom duration 2 days 6 hours with custom reason', r.body.ban);
    r = await api('POST', '/api/admin/players/' + extra[4].user.id + '/ban', { preset: 'custom', customDays: 0, customHours: 1, reasonCode: 'exploit' }, AD.token);
    ok(r.status === 200 && r.body.ban.durationMs === HOUR, 'custom duration 1 hour', r.body.ban); const bShort = r.body.ban;

    /* ---------- list / filter ---------- */
    r = await api('GET', '/api/admin/bans?status=active', null, AD.token); ok(r.body.bans.length === 7 && r.body.counts.active === 7, 'active ban list (7)', r.body.counts);
    r = await api('GET', '/api/admin/bans?status=active&q=ban_p1', null, AD.token); ok(r.body.bans.length === 1 && r.body.bans[0].username === 'ban_p14', 'ban list search by username');

    /* ---------- auto expiry by server time (no admin action) ---------- */
    await clock(HOUR + 60000);
    r = await api('GET', '/api/admin/bans?status=expired', null, AD.token); ok(r.body.bans.some((b) => b.id === bShort.id && b.status === 'expired'), '1-hour custom ban is Expired after 1 hour');
    r = await api('GET', '/api/me/ban', null, extra[4].token); ok(r.body.ban === null, 'expired player has no active ban');
    await clock(DAY);
    r = await api('GET', '/api/me/ban', null, P1.token); ok(r.body.ban === null, '1-day ban expired automatically after 24h');
    const S1b = await S((await login('cheater_one')).token); const S2b = await S((await login('honest_two')).token);
    await rankedPair(S1b, S2b, 'hard').then(() => ok(true, 'after expiry the player can play Ranked again'), (e) => ok(false, 'after expiry the player can play Ranked again', e.message));
    await clock(31000);
    S1b.send({ t: 'surrender' }); const res1 = await S2b.wait('result', 20000); S1b.send({ t: 'room_leave' }); S2b.send({ t: 'room_leave' }); await sleep(300);
    ok(res1.elo && res1.elo.delta > 0, 'normal match after expiry is rated again');
    ok(res1.coins === 30, 'ranked win result message reports +30 coins', res1.coins);
    r = await api('GET', '/api/me/ban', null, P3.token); ok(r.body.ban && r.body.ban.id === b3.id, '3-day ban still active after 1 day');

    /* ---------- UNBAN ---------- */
    r = await api('POST', '/api/admin/bans/' + b3.id + '/unban', { note: '' }, AD.token); ok(r.status === 400 && r.body.error === 'note_required', 'UNBAN needs a note');
    r = await api('POST', '/api/admin/bans/' + b3.id + '/unban', { note: 'Rayuan diterima, bukti tidak cukup' }, MAL.token); ok(r.status === 403, 'player cannot UNBAN');
    r = await api('POST', '/api/admin/bans/' + b3.id + '/unban', { note: 'Rayuan diterima, bukti tidak cukup' }, AD.token);
    ok(r.status === 200 && r.body.ban.status === 'revoked' && r.body.ban.revokedBy === 'v44_admin' && r.body.ban.revokeNote === 'Rayuan diterima, bukti tidak cukup', 'UNBAN revokes with note and admin', r.body.ban);
    r = await api('GET', '/api/me/ban', null, P3.token); ok(r.body.ban === null, 'unbanned player has access again');
    r = await api('POST', '/api/admin/bans/' + b3.id + '/unban', { note: 'twice please' }, AD.token); ok(r.status === 409, 'cannot UNBAN twice');
    r = await api('POST', '/api/admin/bans/' + bShort.id + '/unban', { note: 'already expired' }, AD.token); ok(r.status === 409 && r.body.error === 'not_active', 'cannot UNBAN an expired ban');
    r = await api('GET', '/api/admin/bans?status=revoked', null, AD.token); ok(r.body.bans.length === 1 && r.body.bans[0].id === b3.id, 'revoked filter');
    r = await api('GET', '/api/admin/bans?status=all', null, AD.token); ok(r.body.bans.length === 7, 'full ban history (all statuses)');
    r = await api('GET', '/api/admin/players/' + P1.user.id, null, AD.token); ok(r.body.bans.length === 1 && r.body.bans[0].status === 'expired' && r.body.matches.some((m) => m.result === 'void'), 'player detail shows ban history and voided match');

    /* ---------- audit ---------- */
    r = await api('GET', '/api/admin/audit?action=ban', null, AD.token);
    const a1 = r.body.audit.find((x) => x.targetId === P1.user.id);
    ok(r.body.audit.length === 7 && a1 && a1.adminId === ADM.user.id && a1.detail.reasonCode === 'cheating' && a1.detail.durationMs === DAY && a1.detail.statusBefore === 'none' && a1.detail.statusAfter === 'active' && a1.at > 0, 'audit: ban rows with admin ID, player ID, action, reason, time, duration, before/after', a1);
    r = await api('GET', '/api/admin/audit?action=unban', null, AD.token); const a2 = r.body.audit[0];
    ok(r.body.audit.length === 1 && a2.targetId === P3.user.id && a2.detail.statusBefore === 'active' && a2.detail.statusAfter === 'revoked' && a2.detail.note, 'audit: unban row with note and before/after status', a2);
    r = await api('GET', '/api/admin/audit?q=cheater_one', null, AD.token); ok(r.body.audit.some((x) => x.action === 'match_void_ban') && r.body.audit.some((x) => x.action === 'ban'), 'audit search by player includes voided match');
    ok(rdb.prepare('SELECT COUNT(*) n FROM admin_audit WHERE target_id IS NOT NULL').get().n >= 9, 'audit rows are persisted in SQLite');

    /* ---------- coins ---------- */
    r = await api('GET', '/api/me/coins', null, P2.token);
    ok(r.status === 200 && r.body.tx.some((t) => t.reason === 'welcome' && t.amount === 200), 'welcome coins granted once', r.body.tx);
    const c2 = r.body.coins;
    ok(r.body.tx.some((t) => t.reason === 'match' && t.amount === 30), 'ranked win grants 30 coins (server side)', r.body.tx);
    const q3 = (await api('GET', '/api/me/coins', null, P3.token)).body; ok(!q3.tx.some((t) => t.reason === 'match'), 'instant leave (<30s) earns no coins (anti-farming)', q3.tx);
    r = await api('GET', '/api/me/coins', null, P2.token); ok(r.body.coins === c2 && r.body.tx.filter((t) => t.reason === 'welcome').length === 1, 'welcome bonus not duplicated');
    ok(rdb.prepare("SELECT COUNT(*) n FROM coin_tx WHERE reason='match' AND ref IN (SELECT id FROM matches WHERE result='void')").get().n === 0, 'voided match gives no coins');
    ok(rdb.prepare("SELECT COUNT(*) n FROM (SELECT user_id, reason, ref, COUNT(*) c FROM coin_tx GROUP BY 1,2,3 HAVING c > 1)").get().n === 0, 'no duplicate coin rewards in ledger');

    /* ---------- shop / borders ---------- */
    r = await api('GET', '/api/shop', null, P2.token);
    const ids = r.body.borders.map((b) => b.id);
    ok(['legend2', 'nebula', 'thunder', 'dragon', 'phantom', 'celestial'].every((x) => ids.includes(x)), 'shop lists Legendary 2 and 5 new Mythic borders');
    ok(r.body.borders.find((b) => b.id === 'legend2').rarity === 'legendary' && ['nebula', 'thunder', 'dragon', 'phantom', 'celestial'].every((x) => r.body.borders.find((b) => b.id === x).rarity === 'mythic'), 'rarities correct (Legendary 2 = legendary, new = mythic)');
    ok(['founder', 'veteran', 'mrstar', 'legend', 'finalist', 'champion'].every((x) => ids.includes(x)), 'reward borders kept (Founder, Veteran, MR Champion, Legend, Finalist, Champion)');
    ok(r.body.borders.find((b) => b.id === 'founder').owned === true, 'early account owns Founder as a reward');
    ok(r.body.borders.find((b) => b.id === 'legend2').owned === false, 'Legendary 2 is NOT given to everyone');
    r = await api('POST', '/api/shop/buy', { id: 'legend2' }, P2.token); ok(r.status === 402 && r.body.error === 'no_coins', 'cannot buy Legendary 2 without enough coins');
    r = await api('POST', '/api/shop/buy', { id: 'champion' }, P2.token); ok(r.status === 400 && r.body.error === 'reward_only', 'reward-only border cannot be bought');
    r = await api('POST', '/api/me/border', { id: 'legend2' }, P2.token); ok(r.status === 403 && r.body.error === 'not_owned', 'cannot equip a border you do not own');
    const coinsBefore = (await api('GET', '/api/me/coins', null, P2.token)).body.coins;
    const par = await Promise.all([1, 2, 3, 4].map(() => api('POST', '/api/shop/buy', { id: 'bronze' }, P2.token)));
    ok(par.filter((x) => x.status === 200).length === 1 && par.filter((x) => x.status === 409).length === 3, 'parallel double-buy: exactly one purchase succeeds', par.map((x) => x.status));
    const coinsAfter = (await api('GET', '/api/me/coins', null, P2.token)).body.coins;
    ok(coinsBefore - coinsAfter === 150, 'bronze costs 150 coins, charged once', { coinsBefore, coinsAfter });
    /* give coins through the ledger function to test premium purchase */
    const W = new Database(DBF); W.prepare('UPDATE users SET coins = coins + 20000 WHERE id = ?').run(P2.user.id); W.close();
    for (const id of ['legend2', 'nebula', 'thunder', 'dragon', 'phantom', 'celestial']) { r = await api('POST', '/api/shop/buy', { id }, P2.token); ok(r.status === 200, 'buy ' + id, r.body); }
    r = await api('POST', '/api/me/border', { id: 'legend2' }, P2.token); ok(r.status === 200 && r.body.user.border === 'legend2', 'equip Legendary 2');
    const p2 = await login('honest_two'); ok(p2.user.border === 'legend2', 'equipped border persists after re-login');
    r = await api('GET', '/api/players/' + P2.user.playerId, null, P3.token); ok(r.body.player.border === 'legend2', 'public profile shows border');
    r = await api('GET', '/api/leaderboard?scope=global', null, P3.token); ok(r.body.rows.find((x) => x.id === P2.user.id).border === 'legend2', 'leaderboard rows carry border');
    for (const id of ['nebula', 'thunder', 'dragon', 'phantom', 'celestial']) { r = await api('POST', '/api/me/border', { id }, P2.token); ok(r.status === 200 && r.body.border === id, 'equip ' + id); }
    r = await api('GET', '/api/shop', null, P2.token); ok(r.body.equipped === 'celestial' && r.body.borders.filter((b) => b.owned).length >= 8, 'shop shows owned + equipped');
    ok(rdb.prepare("SELECT COUNT(*) n FROM coin_tx WHERE user_id=? AND reason='shop'").get(P2.user.id).n === 7, 'every purchase written to coin history');

    /* ---------- restart: bans + borders persist ---------- */
    srv.kill(); await sleep(600);
    const srv2 = spawn('node', [path.join(__dirname, '..', 'server', 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), SLA_DB: DBF, SLA_REG_LIMIT: '500', SLA_HTTP_LIMIT: '100000', SLA_TEST_HOOKS: '1', SLA_ADMINS: 'v44_admin' }), stdio: ['ignore', 'pipe', 'pipe'] });
    srv2.stdout.on('data', (d) => log += d); srv2.stderr.on('data', (d) => log += d);
    for (let i = 0; i < 80; i++) { try { await fetch(BASE + '/api/health'); break; } catch (e) { await sleep(100); } }
    await api('POST', '/api/_test/clock', { offsetMs: OFF });
    AD = await login('v44_admin');
    r = await api('GET', '/api/admin/bans?status=active', null, AD.token); ok(r.body.counts.active === 4, 'active bans survive a server restart', r.body.counts);
    r = await api('POST', '/api/daily/start', {}, extra[2].token); ok(r.status === 403 && r.body.error === 'banned', 'ban still enforced after restart');
    ok((await login('honest_two')).user.border === 'celestial', 'equipped border survives restart');
    srv2.kill();
    rdb.close();
  } catch (e) {
    fail++; results.push('FAIL exception: ' + e.stack);
  }
  socks.forEach((s) => s.close());
  try { srv.kill(); } catch (e) { }
  fs.writeFileSync(path.join(__dirname, 'v44-test-results.txt'), results.join('\n') + `\n\n${pass} passed, ${fail} failed\n`);
  console.log(results.join('\n')); console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) console.log('--- server log ---\n' + log.slice(-3000));
  process.exit(fail ? 1 : 0);
}
main();
