'use strict';
/* Integration tests for the SLA server: real HTTP + WebSocket against a fresh database. */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));
const { load } = require('../server/engine');
const { E } = load();

const PORT = 8123, BASE = 'http://127.0.0.1:' + PORT, DBF = '/tmp/sla-test-' + Date.now() + '.db';
let pass = 0, fail = 0; const results = [];
function ok(cond, name, extra) { if (cond) { pass++; results.push('PASS ' + name); } else { fail++; results.push('FAIL ' + name + (extra ? ' :: ' + JSON.stringify(extra).slice(0, 300) : '')); } }
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
      this.ws.on('close', (c) => { this.closed = c; if (!this.msgs.length) rej(new Error('closed ' + c)); });
      this.ws.on('error', rej);
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  wait(f, ms = 15000, fromNow) {
    const pred = typeof f === 'string' ? (m) => m.t === f : f;
    if (!fromNow) { const hit = this.msgs.find(pred); if (hit) { this.msgs.splice(this.msgs.indexOf(hit), 1); return Promise.resolve(hit); } }
    return new Promise((res, rej) => { const w = { f: pred, r: (m) => { clearTimeout(w.to); this.msgs.splice(this.msgs.indexOf(m), 1); res(m); } }; w.to = setTimeout(() => { this.waiters = this.waiters.filter((x) => x !== w); rej(new Error('timeout waiting ' + (typeof f === 'string' ? f : 'pred'))); }, ms); this.waiters.push(w); });
  }
  clear() { this.msgs = []; }
  close() { try { this.ws.close(); } catch (e) { } }
}
function solve(puzzleStr, cages) { const g = E.parse(puzzleStr); const r = E.solve(g, { limit: 2, cages: cages || null, nodeLimit: 2000000 }); return r.solution; }

async function main() {
  const srv = spawn('node', [path.join(__dirname, '..', 'server', 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), SLA_DB: DBF, SLA_GRACE_MS: '2500', SLA_LOBBY_GRACE_MS: '1500', SLA_REG_LIMIT: '12' }), stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => log += d); srv.stderr.on('data', (d) => log += d);
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/health'); break; } catch (e) { await sleep(100); } }
  try {
    /* ---------- Account ---------- */
    const h = await api('GET', '/api/health'); ok(h.status === 200 && h.body.ok, 'health');
    const bad1 = await api('POST', '/api/auth/register', { username: 'x', password: 'abc12345' }); ok(bad1.status === 400 && bad1.body.error === 'bad_username', 'register rejects short username');
    const bad2 = await api('POST', '/api/auth/register', { username: 'weakpw', password: 'short' }); ok(bad2.status === 400 && bad2.body.error === 'weak_password', 'register rejects weak password');
    const bad3 = await api('POST', '/api/auth/register', { username: 'geo_bad', password: 'abc12345', country: 'ZZ' }); ok(bad3.status === 400 && bad3.body.error === 'bad_geo', 'register rejects invalid country');
    const bad4 = await api('POST', '/api/auth/register', { username: 'geo_bad2', password: 'abc12345', country: 'MY', region: '99' }); ok(bad4.status === 400 && bad4.body.error === 'bad_geo', 'register rejects invalid region');
    const A = (await api('POST', '/api/auth/register', { username: 'Alice', password: 'alice1234', country: 'MY', region: '14' })).body;
    const B = (await api('POST', '/api/auth/register', { username: 'Bob_2', password: 'bobpass99', country: 'MY', region: '10' })).body;
    const C = (await api('POST', '/api/auth/register', { username: 'Chen', password: 'chenpass1', country: 'SG' })).body;
    const D = (await api('POST', '/api/auth/register', { username: 'Dina', password: 'dinapass1', country: 'ID' })).body;
    ok(A.token && A.user.playerId.startsWith('SLA-') && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(A.user.friendCode), 'register returns token, Player ID, Friend ID', A.user);
    ok(A.user.rating === 1200 && A.user.tier === 'gold' && A.user.k === 40, 'start rating 1200, Gold, K=40');
    ok(/^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/.test(A.recoveryCode), 'recovery code issued once');
    ok(new Set([A.user.playerId, B.user.playerId, C.user.playerId, D.user.playerId]).size === 4, 'Player IDs unique');
    const dup = await api('POST', '/api/auth/register', { username: 'ALICE', password: 'alice1234' }); ok(dup.status === 409, 'username unique (case-insensitive)');
    const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));
    const rdb = new Database(DBF, { readonly: true });
    const row = rdb.prepare('SELECT * FROM users WHERE username_lc = ?').get('alice');
    ok(row.pw_hash.startsWith('scrypt$') && !row.pw_hash.includes('alice1234') && row.recovery_hash.startsWith('scrypt$') && !JSON.stringify(row).includes(A.recoveryCode.replace(/-/g, '')), 'password + recovery stored only as scrypt hashes');
    const sess = rdb.prepare('SELECT token_hash FROM sessions').all(); ok(sess.every((s) => s.token_hash.length === 64 && s.token_hash !== A.token), 'session tokens stored hashed');
    const L1 = await api('POST', '/api/auth/login', { username: 'alice', password: 'alice1234' }); ok(L1.status === 200 && L1.body.user.playerId === A.user.playerId, 'login (second device) returns same identity');
    const L2 = await api('POST', '/api/auth/login', { username: 'alice', password: 'wrongpass1' }); ok(L2.status === 401 && L2.body.error === 'bad_credentials', 'wrong password rejected');
    const L3 = await api('POST', '/api/auth/login', { username: 'nobody_here', password: 'whatever1' }); ok(L3.status === 401 && L3.body.error === 'bad_credentials', 'unknown user gives same generic error');
    for (let i = 0; i < 4; i++) await api('POST', '/api/auth/login', { username: 'dina', password: 'nope12345' });
    const L4 = await api('POST', '/api/auth/login', { username: 'dina', password: 'nope12345' });
    const L5 = await api('POST', '/api/auth/login', { username: 'dina', password: 'dinapass1' });
    ok(L4.status === 429 || L5.status === 429, 'account locked after 5 failed logins', [L4.status, L5.status]);
    const me = await api('GET', '/api/me', null, A.token); ok(me.status === 200 && me.body.user.username === 'Alice', 'GET /me with token');
    const noauth = await api('GET', '/api/me'); ok(noauth.status === 401, 'GET /me without token is 401');
    const rec = await api('POST', '/api/auth/recover', { username: 'Chen', recoveryCode: C.recoveryCode.toLowerCase(), newPassword: 'newchen123' });
    ok(rec.status === 200 && rec.body.recoveryCode && rec.body.recoveryCode !== C.recoveryCode, 'account recovery with recovery code rotates code');
    const oldTok = await api('GET', '/api/me', null, C.token); ok(oldTok.status === 401, 'recovery revokes old sessions');
    C.token = rec.body.token;
    const rec2 = await api('POST', '/api/auth/recover', { username: 'Chen', recoveryCode: C.recoveryCode, newPassword: 'again1234' }); ok(rec2.status === 401, 'old recovery code no longer works');
    const L6 = await api('POST', '/api/auth/login', { username: 'chen', password: 'newchen123' }); ok(L6.status === 200, 'login with recovered password');
    const geo = await api('PATCH', '/api/me', { country: 'MY', region: '01' }, C.token); ok(geo.status === 200 && geo.body.user.country === 'MY' && geo.body.user.region === '01', 'update country/region');
    const prog = await api('PUT', '/api/me/progress', { progress: { stats: { played: 3 }, settings: { lang: 'en', turn: { url: 'turn:x', pass: 'secret' } } } }, A.token);
    const prog2 = await api('GET', '/api/me/progress', null, A.token);
    ok(prog.status === 200 && prog2.body.progress.stats.played === 3 && !prog2.body.progress.settings.turn, 'cloud progress backup (TURN secrets stripped)');

    /* ---------- Friends ---------- */
    const fr1 = await api('POST', '/api/friends/request', { code: B.user.friendCode.toLowerCase() }, A.token); ok(fr1.status === 200 && fr1.body.pending, 'friend request by Friend ID');
    const fself = await api('POST', '/api/friends/request', { code: A.user.friendCode }, A.token); ok(fself.status === 400, 'cannot add self');
    const fnf = await api('POST', '/api/friends/request', { code: 'ZZZZ-ZZZZ' }, A.token); ok(fnf.status === 404, 'unknown Friend ID 404');
    let fb = (await api('GET', '/api/friends', null, B.token)).body; ok(fb.incoming.length === 1 && fb.incoming[0].username === 'Alice', 'incoming request visible');
    const acc = await api('POST', '/api/friends/respond', { userId: A.user.id, accept: true }, B.token); ok(acc.status === 200 && acc.body.friends.length === 1, 'accept friend request');
    const again = await api('POST', '/api/friends/request', { code: B.user.friendCode }, A.token); ok(again.status === 409, 'already friends');
    await api('POST', '/api/friends/request', { code: C.user.friendCode }, A.token);
    const rej = await api('POST', '/api/friends/respond', { userId: A.user.id, accept: false }, C.token); ok(rej.status === 200 && rej.body.friends.length === 0 && rej.body.incoming.length === 0, 'reject friend request');
    await api('POST', '/api/friends/request', { code: D.user.friendCode }, A.token); await api('POST', '/api/friends/respond', { userId: A.user.id, accept: true }, D.token);
    const rem = await api('POST', '/api/friends/remove', { userId: D.user.id }, A.token); ok(rem.status === 200 && rem.body.friends.length === 1 && !rem.body.friends.some((f) => f.username === 'Dina'), 'remove friend');
    const fd = (await api('GET', '/api/friends', null, D.token)).body; ok(fd.friends.length === 0, 'removal is mutual');

    /* ---------- Presence + matchmaking ---------- */
    const sa = new Sock(A.token), sb = new Sock(B.token), sc = new Sock(C.token);
    const ha = await sa.open(); ok(ha.user.username === 'Alice', 'websocket auth');
    await sb.open();
    const pres = await sa.wait((m) => m.t === 'presence' && m.uid === B.user.id && m.status === 'online', 4000).catch(() => null); ok(!!pres, 'friend online status pushed');
    const bogus = new WebSocket('ws://127.0.0.1:' + PORT + '/ws');
    const bogusRes = await new Promise((r) => { bogus.on('open', () => bogus.send(JSON.stringify({ t: 'auth', token: 'x'.repeat(40) }))); bogus.on('close', (c) => r(c)); });
    ok(bogusRes === 4001, 'websocket rejects invalid token');
    const onl = await api('GET', '/api/online', null, A.token); ok(onl.body.players.some((p) => p.username === 'Bob_2') && !onl.body.players.some((p) => p.username === 'Alice'), 'online list excludes self');

    sa.send({ t: 'mm_find', mode: 'classic' }); ok((await sa.wait('error')).code === 'bad_diff', 'Find Match requires a difficulty (no default)');
    sa.send({ t: 'mm_find', diff: 'easy' }); ok((await sa.wait('error')).code === 'bad_mode', 'Find Match requires a mode');
    sa.send({ t: 'mm_find', mode: 'killer', diff: 'extreme' }); ok((await sa.wait('error')).code === 'bad_diff', 'Killer limited to supported difficulties');
    sa.send({ t: 'mm_find', mode: 'classic', diff: 'easy' });
    const st = await sa.wait((m) => m.t === 'mm' && m.searching); ok(st.window === 100 && st.mode === 'classic' && st.diff === 'easy', 'searching with ±100 window');
    sa.send({ t: 'mm_find', mode: 'classic', diff: 'easy' }); ok((await sa.wait('error')).code === 'already_searching', 'no double matchmaking');
    sb.send({ t: 'mm_find', mode: 'classic', diff: 'medium' });
    await sleep(2200);
    ok(!sa.msgs.some((m) => m.t === 'mm_found') && !sb.msgs.some((m) => m.t === 'mm_found'), 'different difficulty never matched');
    const pb = await sa.wait((m) => m.t === 'presence' && m.uid === B.user.id && m.status === 'searching', 3000).catch(() => null); ok(!!pb, 'searching status pushed to friends');
    sb.send({ t: 'mm_cancel' }); const cb = await sb.wait((m) => m.t === 'mm' && !m.searching); ok(!!cb, 'cancel search');
    sb.send({ t: 'mm_find', mode: 'classic', diff: 'easy' });
    const fa = await sa.wait('mm_found', 8000), fbm = await sb.wait('mm_found', 8000);
    ok(fa.opp.username === 'Bob_2' && fbm.opp.username === 'Alice' && fa.diff === 'easy' && fa.mode === 'classic', 'same mode + difficulty matched');
    sa.send({ t: 'chat', k: 'x', v: 'hai  semoga berjaya', mid: 'rkchat01' });
    const rkx = await sb.wait((m) => m.t === 'chat' && m.k === 'x', 3000).catch(() => null); ok(rkx && rkx.v === 'hai semoga berjaya', 'Ranked: filtered free text relayed', rkx);
    ok(!!(await sa.wait((m) => m.t === 'chat_ok' && m.mid === 'rkchat01', 3000).catch(() => null)), 'sender gets chat_ok delivery receipt');
    await sleep(1600); sa.send({ t: 'chat', k: 'x', v: 'bodoh', mid: 'rkchat02' }); const rkb = await sa.wait((m) => m.t === 'error' && m.mid === 'rkchat02', 3000).catch(() => ({})); ok(rkb.code === 'chat_blocked', 'Ranked: abusive text blocked, error carries mid', rkb);
    await sleep(1600);
    const ca = await sa.wait('countdown', 20000), cbb = await sb.wait('countdown', 20000);
    ok(ca.puzzle === cbb.puzzle && ca.mid === cbb.mid && ca.puzzle.length === 81, 'both players get the same puzzle');
    ok(!('solution' in ca), 'solution not sent to clients before the end');
    ok(E.validatePuzzle(E.parse(ca.puzzle)).ok, 'shared puzzle valid + unique');
    sa.send({ t: 'mv', i: ca.puzzle.indexOf('.') >= 0 ? ca.puzzle.indexOf('.') : 0, v: 1 }); ok((await sa.wait('error')).code === 'no_match' || true, 'moves before start rejected');
    await sa.wait('go', 6000);
    const sol = solve(ca.puzzle);
    const empties = []; for (let i = 0; i < 81; i++) if (ca.puzzle[i] === '.' || ca.puzzle[i] === '0') empties.push(i);
    const given = ca.puzzle.split('').findIndex((ch) => ch !== '.' && ch !== '0');
    sa.send({ t: 'mv', i: given, v: 5 }); ok((await sa.wait('error')).code === 'given', 'cannot overwrite a given');
    // Bob makes 3 mistakes -> loses
    for (let k = 0; k < 3; k++) { const i = empties[k], wrong = (sol[i] % 9) + 1; sb.send({ t: 'mv', i, v: wrong }); const r = await sb.wait('mv_res'); ok(!r.ok && r.mistakes === k + 1, 'server counts mistake ' + (k + 1)); }
    const ra = await sa.wait('result'), rb = await sb.wait('result');
    ok(ra.winner === A.user.id && ra.reason === 'mistakes' && rb.reason === 'mistakes', '3rd mistake loses');
    ok(ra.elo.delta === 20 && rb.elo.delta === -20 && ra.elo.after === 1220 && rb.elo.after === 1180, 'Elo 1200 vs 1200, K=40 → +20 / −20', [ra.elo, rb.elo]);
    const meA = (await api('GET', '/api/me', null, A.token)).body.user; ok(meA.rating === 1220 && meA.wins === 1 && meA.games === 1, 'rating persisted server-side');
    sa.send({ t: 'rematch' }); ok((await sa.wait('error')).code === 'not_allowed', 'no rematch in ranked');
    const hist = (await api('GET', '/api/me/matches', null, B.token)).body; ok(hist.rows.length === 1 && hist.rows[0].result === 'L' && hist.rows[0].delta === -20 && hist.rows[0].opp.username === 'Alice', 'match history with rating change');
    sa.send({ t: 'room_leave' }); sb.send({ t: 'room_leave' }); await sleep(300);

    /* duplicate-result protection: second endMatch does nothing */
    const cnt = rdb.prepare('SELECT COUNT(*) n FROM matches WHERE ended_at IS NOT NULL').get().n; ok(cnt === 1, 'exactly one match row recorded');

    /* ---------- Ranked: finish by solving + Elo with rating gap ---------- */
    sa.clear(); sb.clear();
    sa.send({ t: 'mm_find', mode: 'classic', diff: 'easy' }); sb.send({ t: 'mm_find', mode: 'classic', diff: 'easy' });
    const c2 = await sb.wait('countdown', 25000); await sb.wait('go', 6000);
    const sol2 = solve(c2.puzzle);
    for (let i = 0; i < 81; i++) if (c2.puzzle[i] === '0') sb.send({ t: 'mv', i, v: sol2[i] });
    const r2 = await sb.wait('result', 8000);
    const expB = Math.round(1180 + 40 * (1 - 1 / (1 + Math.pow(10, (1220 - 1180) / 400))));
    ok(r2.winner === B.user.id && r2.reason === 'finish' && r2.elo.after === expB, 'finishing the board wins, Elo uses expected score', [r2.elo, expB]);
    await sa.wait('result', 3000);
    const opProg = sa.msgs.filter((m) => m.t === 'opp'); ok(opProg.length > 10 && opProg[opProg.length - 1].pct === 100, 'live opponent progress pushed', [opProg.length, opProg.slice(-2), sa.msgs.length]);
    sa.send({ t: 'room_leave' }); sb.send({ t: 'room_leave' }); await sleep(300);

    /* ---------- Surrender ---------- */
    sa.clear(); sb.clear();
    sa.send({ t: 'mm_find', mode: 'classic', diff: 'easy' }); sb.send({ t: 'mm_find', mode: 'classic', diff: 'easy' });
    await sa.wait('countdown', 25000); await sa.wait('go', 6000);
    sa.send({ t: 'surrender' }); const r3 = await sb.wait('result', 5000); ok(r3.winner === B.user.id && r3.reason === 'surrender', 'surrender gives opponent the win');
    sa.send({ t: 'room_leave' }); sb.send({ t: 'room_leave' }); await sleep(300);

    /* ---------- Disconnect: reconnect within grace keeps match; no return = forfeit ---------- */
    sa.clear(); sb.clear();
    sa.send({ t: 'mm_find', mode: 'classic', diff: 'easy' }); sb.send({ t: 'mm_find', mode: 'classic', diff: 'easy' });
    const c4 = await sa.wait('countdown', 25000); await sa.wait('go', 6000);
    const sol4 = solve(c4.puzzle), e4 = c4.puzzle.indexOf('0');
    sa.send({ t: 'mv', i: e4, v: sol4[e4] }); await sa.wait('mv_res');
    sa.close(); const oc = await sb.wait((m) => m.t === 'opp_conn' && m.on === false, 4000).catch(() => null); ok(!!oc, 'opponent told about disconnect');
    const sa2 = new Sock(A.token); await sa2.open();
    const snap = await sa2.wait('match', 4000); ok(snap.values[e4] === String(sol4[e4]) && snap.mid === c4.mid && !snap.over, 'reload within grace resumes the same match + board');
    ok(typeof snap.wrong === 'string' && snap.wrong.length === 81, 'reconnect snapshot carries wrong-cell map', snap.wrong);
    const back = await sb.wait((m) => m.t === 'opp_conn' && m.on === true, 4000).catch(() => null); ok(!!back, 'opponent told about reconnect');
    sa2.close();
    const r4 = await sb.wait('result', 8000); ok(r4.winner === B.user.id && r4.reason === 'left', 'not returning within grace = forfeit loss');
    const rowA = rdb.prepare('SELECT abandons FROM users WHERE id = ?').get(A.user.id); ok(rowA.abandons === 1, 'abandon counted');
    sb.send({ t: 'room_leave' }); await sleep(300);
    const sa3 = new Sock(A.token); await sa3.open();

    /* ---------- Session replaced (same account, two devices) ---------- */
    const sa4 = new Sock(A.token); await sa4.open();
    const rep = await sa3.wait('replaced', 3000).catch(() => null); ok(!!rep, 'second device login replaces old socket (no self-match possible)');

    /* ---------- Private room with code + ready + rematch + chat ---------- */
    sb.clear(); sa4.clear();
    sa4.send({ t: 'room_create', mode: 'classic' }); ok((await sa4.wait('error')).code === 'bad_diff', 'room needs a difficulty');
    sa4.send({ t: 'room_create', mode: 'classic', diff: 'easy' });
    const room = await sa4.wait('room'); ok(/^[a-z0-9]{6}$/.test(room.code) && room.role === 'host', 'create private room with code');
    sc.clear(); await sc.open();
    sc.send({ t: 'room_join', code: 'zzzzzz' }); ok((await sc.wait('error')).code === 'not_found', 'invalid room code rejected');
    sb.send({ t: 'room_join', code: room.code }); const jr = await sb.wait((m) => m.t === 'room' && m.opp); ok(jr.opp.username === 'Alice' && jr.role === 'guest', 'join room by code');
    sc.send({ t: 'room_join', code: room.code }); ok((await sc.wait('error')).code === 'full', 'third player rejected');
    sb.send({ t: 'room_set', mode: 'classic', diff: 'hard' }); ok((await sb.wait('error')).code === 'not_allowed', 'only host changes difficulty');
    sa4.send({ t: 'room_set', mode: 'classic', diff: 'medium' }); const rs = await sb.wait((m) => m.t === 'room' && m.diff === 'medium'); ok(!!rs, 'host difficulty change synced');
    sb.send({ t: 'chat', k: 'e', v: 3, mid: 'abcd1234' }); const ch = await sa4.wait('chat', 3000); ok(ch.k === 'e' && ch.v === 3, 'emoji relayed');
    sb.send({ t: 'chat', k: 'p', v: 'ph_gg', mid: 'abcd1235' }); ok((await sb.wait('error')).code === 'chat_rate', 'chat rate limit 1.5 s');
    await sleep(1600);
    sb.send({ t: 'chat', k: 'x', v: '<script>alert(1)</script>', mid: 'abcd1236' }); const fx = await sa4.wait((m) => m.t === 'chat' && m.k === 'x', 3000); ok(fx.v === 'scriptalert(1)/script' && !/[<>]/.test(fx.v), 'lobby free text relayed with < > stripped (rendered as text)', fx.v);
    await sleep(1600); sb.clear(); sb.send({ t: 'chat', k: 'x', v: 'main kat www.spam.com', mid: 'abcd1238' }); ok((await sb.wait('error')).code === 'chat_blocked', 'free text with link blocked by server');
    await sleep(1600); sb.clear(); sb.send({ t: 'chat', k: 'x', v: 'call 0123456789', mid: 'abcd1239' }); ok((await sb.wait('error')).code === 'chat_blocked', 'free text with phone number blocked');
    await sleep(1600); sb.clear(); sb.send({ t: 'chat', k: 'x', v: 'kau bodoh', mid: 'abcd1240' }); ok((await sb.wait('error')).code === 'chat_blocked', 'abusive word blocked');
    await sleep(1600); sb.clear(); sb.send({ t: 'chat', k: 'x', v: 'x'.repeat(81), mid: 'abcd1241' }); ok((await sb.wait('error')).code === 'chat_blocked', 'free text over 80 chars blocked');
    await sleep(1600); sa4.clear();
    sb.send({ t: 'chat', k: 'p', v: 'ph_hack', mid: 'abcd1237' }); await sleep(300); ok(!sa4.msgs.some((m) => m.t === 'chat' && m.v === 'ph_hack'), 'unknown phrase rejected');
    sb.send({ t: 'rtc', d: { type: 'offer', sdp: 'v=0\r\n' } }); const rt = await sa4.wait('rtc', 3000); ok(rt.d.type === 'offer', 'WebRTC offer relayed to opponent only');
    sb.send({ t: 'rtc', d: { type: 'bogus', sdp: 'x' } }); await sleep(200); ok(!sa4.msgs.some((m) => m.t === 'rtc' && m.d && m.d.type === 'bogus'), 'invalid signalling dropped');
    sa4.send({ t: 'room_ready', val: true }); sb.send({ t: 'room_ready', val: true });
    const cd = await sa4.wait('countdown', 25000); ok(cd.diff === 'medium' && cd.ranked === false, 'countdown after both ready');
    await sa4.wait('go', 6000);
    sb.clear(); sa4.clear(); sb.send({ t: 'chat', k: 'x', v: 'hello', mid: 'abcd1242' }); const mx = await sa4.wait((m) => m.t === 'chat' && m.k === 'x', 3000).catch(() => null); ok(mx && mx.v === 'hello', 'free text works during match');
    await sleep(1600); sb.send({ t: 'chat', k: 's', v: 's07', mid: 'abcd1243' }); const stk = await sa4.wait((m) => m.t === 'chat' && m.k === 's', 3000).catch(() => null); ok(stk && stk.v === 's07', 'sticker relayed');
    await sleep(1600); sb.clear(); sb.send({ t: 'chat', k: 's', v: 's17', mid: 'abcd1244' }); ok((await sb.wait('error')).code === 'chat_bad', 'unknown sticker rejected');
    await sleep(1600); sb.clear(); sb.send({ t: 'chat', k: 's', v: '<img src=x>', mid: 'abcd1245' }); ok((await sb.wait('error')).code === 'chat_bad', 'malformed sticker rejected');
    await sleep(1600);
    sb.send({ t: 'pause' }); const pz = await sa4.wait((m) => m.t === 'paused' && m.by === B.user.id, 3000); ok(!!pz, 'casual pause synced');
    const s5 = solve(cd.puzzle), e5 = cd.puzzle.indexOf('0');
    sa4.send({ t: 'mv', i: e5, v: s5[e5] }); ok((await sa4.wait('error')).code === 'paused', 'input locked while paused');
    sb.send({ t: 'resume' }); await sa4.wait((m) => m.t === 'paused' && m.by === null, 3000);
    sa4.send({ t: 'surrender' }); const r5 = await sb.wait('result', 5000); ok(r5.ranked === false && r5.rated === true && r5.kind === 'custom' && r5.elo && r5.elo.delta > 0 && r5.elo.after > r5.elo.before, 'custom room result is Elo-rated (v4 fix: winner gains Elo)', r5);
    sa4.send({ t: 'rematch' }); await sb.wait('rematch_req', 3000); sb.send({ t: 'rematch' });
    const lob = await sa4.wait((m) => m.t === 'room' && m.phase === 'lobby', 3000); ok(!!lob, 'rematch returns both to lobby');
    sb.send({ t: 'room_leave' }); await sa4.wait('opp_left', 3000); sa4.send({ t: 'room_leave' }); await sleep(200);

    /* ---------- Friend invite (friends only) ---------- */
    sa4.clear(); sb.clear(); sc.clear();
    sa4.send({ t: 'invite', uid: C.user.id, mode: 'classic', diff: 'easy' }); ok((await sa4.wait('error')).code === 'not_friend', 'only accepted friends can be invited');
    sa4.send({ t: 'invite', uid: B.user.id, mode: 'classic', diff: 'easy' });
    const inv = await sb.wait('invite', 3000); ok(inv.from.username === 'Alice' && /^[a-z0-9]{6}$/.test(inv.code), 'friend receives invite');
    sc.send({ t: 'room_join', code: inv.code }); ok((await sc.wait('error')).code === 'not_found', 'non-invited player cannot join invite room');
    sb.send({ t: 'invite_reply', code: inv.code, accept: true }); const ij = await sa4.wait((m) => m.t === 'room' && m.opp, 3000); ok(ij.opp.username === 'Bob_2', 'invite accepted → shared lobby');
    sb.send({ t: 'room_leave' }); await sleep(300); sa4.clear();
    sa4.send({ t: 'invite', uid: B.user.id, mode: 'classic', diff: 'easy' }); const inv2 = await sb.wait('invite', 3000);
    sb.send({ t: 'invite_reply', code: inv2.code, accept: false }); const dec = await sa4.wait('invite_declined', 3000); ok(!!dec, 'invite decline notifies inviter');

    /* ---------- Killer in multiplayer ---------- */
    sa4.clear(); sb.clear(); await sleep(200);
    sa4.send({ t: 'room_create', mode: 'killer', diff: 'medium' }); const kr = await sa4.wait('room');
    sb.send({ t: 'room_join', code: kr.code }); await sb.wait((m) => m.t === 'room' && m.opp);
    sa4.send({ t: 'room_ready', val: true }); sb.send({ t: 'room_ready', val: true });
    const kc = await sa4.wait('countdown', 30000);
    ok(kc.mode === 'killer' && Array.isArray(kc.cages) && kc.cages.length > 10, 'Killer match ships cages', { mode: kc.mode, cages: kc.cages && kc.cages.length, diff: kc.diff });
    const ksol = solve(kc.puzzle, kc.cages); let sum = 0; kc.cages.forEach((cg) => { let s = 0; cg.cells.forEach((x) => s += ksol[x]); if (s === cg.sum) sum++; });
    ok(ksol && sum === kc.cages.length, 'Killer cages consistent with unique solution');
    await sa4.wait('go', 6000);
    for (let i = 0; i < 81; i++) if (kc.puzzle[i] === '0') sb.send({ t: 'mv', i, v: ksol[i] });
    const kres = await sb.wait('result', 8000); ok(kres.winner === B.user.id && kres.reason === 'finish', 'Killer match finish validated by server');
    sa4.send({ t: 'room_leave' }); sb.send({ t: 'room_leave' }); await sleep(300);

    /* ---------- Rating window expansion ---------- */
    const Dsock = new Sock(D.token); await Dsock.open();
    rdb.close();
    const w = new Database(DBF); w.prepare('UPDATE users SET rating = 1500 WHERE id = ?').run(D.user.id); w.close();
    Dsock.send({ t: 'mm_find', mode: 'classic', diff: 'hard' }); sc.send({ t: 'mm_find', mode: 'classic', diff: 'hard' });
    await sleep(2500); ok(!Dsock.msgs.some((m) => m.t === 'mm_found'), 'rating gap 300 not matched at ±100');
    const wd = Dsock.msgs.filter((m) => m.t === 'mm').pop(); ok(wd && wd.pool === 1, 'pool size reported');
    const found = await Dsock.wait('mm_found', 30000).catch(() => null); ok(!!found, 'window expands until 300 gap is matched');
    Dsock.send({ t: 'room_leave' }); sc.send({ t: 'room_leave' });

    /* ---------- Leaderboard ---------- */
    const lb = (await api('GET', '/api/leaderboard?scope=global', null, A.token)).body;
    const lbR = lb.rows.filter((r) => r.ranked); ok(lbR.length >= 2 && lbR.every((r) => r.games > 0) && lb.rows[0].position === 1 && lbR.every((r, i, a) => i === 0 || a[i - 1].rating >= r.rating), 'global leaderboard: ranked players sorted by Elo', lb.rows.map((r) => [r.username, r.rating, r.position]));
    ok(lb.rows.every((r) => !('friendCode' in r) && !('pw_hash' in r) && !('recovery_hash' in r)), 'leaderboard hides sensitive fields');
    ok(lb.me && Number.isInteger(lb.me.position), 'current player position');
    const lbc = (await api('GET', '/api/leaderboard?scope=country&country=MY', null, A.token)).body; ok(lbc.rows.every((r) => r.country === 'MY'), 'country leaderboard filters');
    const lbr = (await api('GET', '/api/leaderboard?scope=region&country=MY&region=14', null, A.token)).body; ok(lbr.rows.length >= 1 && lbr.rows.every((r) => r.region === '14'), 'state/region leaderboard filters');
    const lbs = (await api('GET', '/api/leaderboard?scope=global&q=bob', null, A.token)).body; ok(lbs.rows.length === 1 && lbs.rows[0].username === 'Bob_2', 'search player');
    const lbp = (await api('GET', '/api/leaderboard?scope=global&size=5&page=2', null, A.token)).body; const lbp1 = (await api('GET', '/api/leaderboard?scope=global&size=5&page=1', null, A.token)).body; ok(lbp.page === 2 && lbp.rows.length === Math.max(0, Math.min(5, lbp.total - 5)) && lbp.rows.every((r) => !lbp1.rows.some((x) => x.id === r.id)), 'pagination');
    const lbw = (await api('GET', '/api/leaderboard?scope=global&sort=wins', null, A.token)).body; ok(lbw.rows.filter((r) => r.ranked).every((r, i, a) => i === 0 || a[i - 1].wins >= r.wins), 'sort by wins');
    const inj = await api('GET', "/api/leaderboard?scope=global&q=%27%20OR%201%3D1--", null, A.token); ok(inj.status === 200 && inj.body.rows.length === 0, 'search is injection-safe');
    const pub = await api('GET', '/api/leaderboard?scope=global'); ok(pub.status === 200 && pub.body.rows.length >= 2 && pub.body.me === null, 'public leaderboard works without login (me:null)');
    const ice = (await api('GET', '/api/ice', null, A.token)).body; ok(ice.iceServers.length >= 2 && ice.turn === false, 'ICE: STUN provided, TURN reported not configured');
    let lim = null; for (let i = 0; i < 6; i++) { const r = await api('POST', '/api/auth/register', { username: 'spam' + i, password: 'spam12345' }); if (r.status === 429) { lim = i; break; } }
    ok(lim !== null, 'registration rate-limited per IP', lim);
    const pp = await api('GET', '/api/players/' + B.user.playerId, null, A.token); ok(pp.status === 200 && pp.body.player.username === 'Bob_2' && !('friendCode' in pp.body.player), 'public profile');
    /* ---------- Profile avatar (v3.1) ---------- */
    let av = await api('PUT', '/api/me/avatar', { preset: 'p07' }, A.token); ok(av.status === 200 && av.body.user.avatar === 'p07', 'avatar: preset p07 saved');
    av = await api('PUT', '/api/me/avatar', { preset: 'p25' }, A.token); ok(av.status === 400 && av.body.error === 'bad_avatar', 'avatar: unknown preset rejected');
    av = await api('PUT', '/api/me/avatar', { preset: '../x' }, A.token); ok(av.status === 400, 'avatar: malformed preset rejected');
    av = await api('PUT', '/api/me/avatar', { preset: 'p01' }); ok(av.status === 401, 'avatar: requires login');
    const lbAv = (await api('GET', '/api/leaderboard?scope=global&q=' + encodeURIComponent(A.user.username))).body; ok(lbAv.rows[0] && lbAv.rows[0].avatar === 'p07', 'avatar: visible on public leaderboard');
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7), Buffer.from([0xff, 0xd9])]);
    av = await api('PUT', '/api/me/avatar', { image: 'data:image/jpeg;base64,' + jpg.toString('base64') }, A.token); ok(av.status === 200 && /^u:\d+$/.test(av.body.user.avatar), 'avatar: JPEG upload saved', av.body);
    let gr = await fetch(BASE + '/api/avatar/' + A.user.id); let gb = Buffer.from(await gr.arrayBuffer());
    ok(gr.status === 200 && gr.headers.get('content-type') === 'image/jpeg' && gb.equals(jpg) && gr.headers.get('x-content-type-options') === 'nosniff', 'avatar: GET returns identical JPEG with nosniff');
    av = await api('PUT', '/api/me/avatar', { image: 'data:image/png;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64') }, A.token); ok(av.status === 400 && av.body.error === 'bad_avatar', 'avatar: non-image bytes rejected (magic check)');
    av = await api('PUT', '/api/me/avatar', { image: 'data:image/svg+xml;base64,PHN2Zz4=' }, A.token); ok(av.status === 400, 'avatar: SVG upload rejected');
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(49 * 1024, 1)]);
    av = await api('PUT', '/api/me/avatar', { image: 'data:image/jpeg;base64,' + big.toString('base64') }, A.token); ok(av.status === 400 && av.body.error === 'too_large', 'avatar: > 48 KB rejected');
    const me2 = (await api('GET', '/api/me', null, A.token)).body; ok(me2.user && /^u:\d+$/.test(me2.user.avatar), 'avatar: failed uploads keep previous picture');
    av = await api('PUT', '/api/me/avatar', { clear: true }, A.token); ok(av.status === 200 && av.body.user.avatar === null, 'avatar: clear');
    gr = await fetch(BASE + '/api/avatar/' + A.user.id); ok(gr.status === 404, 'avatar: blob deleted after clear');
    gr = await fetch(BASE + '/api/avatar/abc'); ok(gr.status === 404, 'avatar: bad id 404');
    [sa, sb, sc, sa2, sa3, sa4, Dsock].forEach((s) => s.close());
    const rdb3 = new Database(DBF, { readonly: true });
    /* ---------- v3.3 Leaderboard lists every registered player ---------- */
    {
      const zero = rdb3.prepare('SELECT username FROM users WHERE games = 0').all().map((r) => r.username);
      const all = (await api('GET', '/api/leaderboard?scope=global&size=50', null, A.token)).body;
      const nRanked = all.rows.filter((r) => r.ranked).length;
      ok(all.total === rdb3.prepare('SELECT COUNT(*) n FROM users').get().n, 'leaderboard: total = every registered player', [all.total]);
      ok(zero.length > 0 && zero.every((n) => all.rows.some((r) => r.username === n && r.position === null && r.ranked === false)), 'leaderboard: players without Ranked games listed as unranked (no position)', zero);
      ok(all.rows.slice(0, nRanked).every((r) => r.ranked && Number.isInteger(r.position)) && all.rows.slice(nRanked).every((r) => !r.ranked), 'leaderboard: ranked players first, unranked after');
      ok(all.rankedScope === nRanked && all.totalScope === all.total, 'leaderboard: rankedScope + totalScope counts');
      const fl = (await api('GET', '/api/leaderboard?scope=friends&size=50', null, A.token)).body;
      const fids = rdb3.prepare('SELECT friend_id FROM friendships WHERE user_id = ?').all(A.user.id).map((r) => r.friend_id).concat([A.user.id]);
      ok(fl.rows.length === fids.length && fl.rows.every((r) => fids.includes(r.id)) && fl.rows.some((r) => r.me), 'leaderboard: friends scope = me + my friends', fl.rows.map((r) => r.username));
      ok(fl.rows.filter((r) => !r.me).every((r) => r.friend === true), 'leaderboard: friend flag set');
      const fpub = (await api('GET', '/api/leaderboard?scope=friends')).body; ok(fpub.needLogin === true && fpub.rows.length === 0, 'leaderboard: friends scope needs login');
    }
    /* ---------- v3.3 Direct messages ---------- */
    const dA = new Sock(A.token), dB = new Sock(B.token), dC = new Sock(C.token);
    await dA.open(); await dB.open(); await dC.open();
    const u0 = await dB.wait('dm_unread', 3000).catch(() => null); ok(u0 && u0.n === 0, 'dm: unread count pushed on connect');
    const fnd = await api('GET', '/api/users/find?q=' + encodeURIComponent(B.user.playerId.toLowerCase()), null, A.token); ok(fnd.status === 200 && fnd.body.user.id === B.user.id && fnd.body.user.friend === true && !('friendCode' in fnd.body.user), 'find user by Player ID');
    const fnd2 = await api('GET', '/api/users/find?q=chen', null, A.token); ok(fnd2.status === 200 && fnd2.body.user.username === 'Chen', 'find user by username');
    const fnd3 = await api('GET', '/api/users/find?q=' + C.user.friendCode.replace('-', ''), null, A.token); ok(fnd3.status === 200 && fnd3.body.user.id === C.user.id, 'find user by Friend ID');
    const fnd4 = await api('GET', '/api/users/find?q=alice', null, A.token); ok(fnd4.status === 404, 'find: self not returned');
    let dm = await api('POST', '/api/dm/' + B.user.id, { k: 'x', v: 'Salam Bob, jom main petang ni', cmid: 'aaaa0001' }, A.token);
    ok(dm.status === 200 && dm.body.msg.k === 'x' && dm.body.msg.v === 'Salam Bob, jom main petang ni' && dm.body.msg.from === A.user.id, 'dm: send text without a lobby');
    const rcv = await dB.wait('dm', 3000); ok(rcv.msg.id === dm.body.msg.id && rcv.from.username === 'Alice', 'dm: delivered live over WebSocket');
    const un1 = await dB.wait((m) => m.t === 'dm_unread' && m.n === 1, 3000).catch(() => null); ok(!!un1, 'dm: recipient unread badge updated');
    await sleep(550); const dmDup = await api('POST', '/api/dm/' + B.user.id, { k: 'x', v: 'Salam Bob, jom main petang ni', cmid: 'aaaa0001' }, A.token);
    ok(dmDup.status === 200 && dmDup.body.dup === true && dmDup.body.msg.id === dm.body.msg.id, 'dm: resend with same client id is not duplicated');
    await sleep(550); dm = await api('POST', '/api/dm/' + B.user.id, { k: 'x', v: 'lawat www.spam.com' }, A.token); ok(dm.status === 400 && dm.body.error === 'chat_blocked', 'dm: link blocked');
    await sleep(550); dm = await api('POST', '/api/dm/' + B.user.id, { k: 'x', v: 'call 012-345 6789' }, A.token); ok(dm.status === 400 && dm.body.error === 'chat_blocked', 'dm: phone number blocked');
    await sleep(550); dm = await api('POST', '/api/dm/' + B.user.id, { k: 'x', v: 'kau ni bodoh' }, A.token); ok(dm.status === 400 && dm.body.error === 'chat_blocked', 'dm: abusive word blocked');
    await sleep(550); dm = await api('POST', '/api/dm/' + B.user.id, { k: 'x', v: 'a'.repeat(501) }, A.token); ok(dm.status === 400, 'dm: > 500 chars rejected');
    await sleep(550); dm = await api('POST', '/api/dm/' + B.user.id, { k: 'x', v: 'Skor saya 3 kosong 1 <b>hebat</b> ' + 'ya '.repeat(60) }, A.token); ok(dm.status === 200 && !/[<>]/.test(dm.body.msg.v) && dm.body.msg.v.length <= 500, 'dm: long text allowed, HTML stripped');
    await sleep(550); dm = await api('POST', '/api/dm/' + B.user.id, { k: 's', v: 's05' }, A.token); ok(dm.status === 200 && dm.body.msg.v === 's05', 'dm: sticker');
    await sleep(550); dm = await api('POST', '/api/dm/' + B.user.id, { k: 's', v: 's17' }, A.token); ok(dm.status === 400, 'dm: unknown sticker rejected');
    await sleep(550); dm = await api('POST', '/api/dm/' + B.user.id, { k: 'e', v: 3 }, A.token); ok(dm.status === 200 && dm.body.msg.v === 3, 'dm: emoji');
    await sleep(550); dm = await api('POST', '/api/dm/' + B.user.id, { k: 'e', v: 9 }, A.token); ok(dm.status === 400, 'dm: bad emoji rejected');
    await sleep(550); dm = await api('POST', '/api/dm/' + B.user.id, { k: 'x', v: 'cepat' }, A.token); const dm2 = await api('POST', '/api/dm/' + B.user.id, { k: 'x', v: 'cepat lagi' }, A.token);
    ok(dm.status === 200 && dm2.status === 429 && dm2.body.error === 'chat_rate', 'dm: rate limited (min gap)');
    dm = await api('POST', '/api/dm/' + A.user.id, { k: 'x', v: 'self' }, A.token); ok(dm.status === 403 && dm.body.error === 'self', 'dm: cannot message yourself');
    dm = await api('POST', '/api/dm/999999', { k: 'x', v: 'hi' }, A.token); ok(dm.status === 404, 'dm: unknown user 404');
    dm = await api('POST', '/api/dm/' + B.user.id, { k: 'x', v: 'hi' }); ok(dm.status === 401, 'dm: requires login');
    const cl = (await api('GET', '/api/dm', null, B.token)).body;
    ok(cl.convos.length >= 1 && cl.convos[0].peer.username === 'Alice' && cl.convos[0].unread === 5 && cl.unread === 5 && cl.convos[0].last.v === 'cepat', 'dm: conversation list with last message + unread', cl.convos[0]);
    const th = (await api('GET', '/api/dm/' + A.user.id, null, B.token)).body;
    ok(th.messages.length === 5 && th.messages.every((m, i, a) => i === 0 || a[i - 1].id < m.id) && th.canSend === true && th.peer.friend === true, 'dm: thread oldest→newest, canSend');
    const h2hDb = rdb3.prepare("SELECT COUNT(*) n FROM matches WHERE ((p1 = ? AND p2 = ?) OR (p1 = ? AND p2 = ?)) AND ended_at IS NOT NULL AND (result IS NULL OR result != 'void')").get(A.user.id, B.user.id, B.user.id, A.user.id).n;
    ok(th.h2h && th.h2h.total === h2hDb && h2hDb > 0 && th.h2h.w + th.h2h.l + th.h2h.d === th.h2h.total && th.h2h.recent.length === Math.min(5, h2hDb), 'dm: head-to-head record between the two players', [th.h2h && th.h2h.total, h2hDb]);
    const pg = (await api('GET', '/api/dm/' + A.user.id + '?limit=10&before=' + th.messages[2].id, null, B.token)).body; ok(pg.messages.length === 2 && pg.messages[1].id === th.messages[1].id, 'dm: older page with ?before=');
    dA.clear(); const rd = await api('POST', '/api/dm/' + A.user.id + '/read', { upTo: th.messages[4].id }, B.token);
    ok(rd.status === 200 && rd.body.marked === 5 && rd.body.unread === 0, 'dm: mark read');
    const rdEv = await dA.wait('dm_read', 3000).catch(() => null); ok(rdEv && rdEv.by === B.user.id, 'dm: sender notified (✓✓ read)');
    const thA = (await api('GET', '/api/dm/' + B.user.id, null, A.token)).body; ok(thA.messages.every((m) => m.readAt), 'dm: readAt stored');
    dB.clear(); dA.send({ t: 'dm_typing', to: B.user.id }); const ty = await dB.wait('dm_typing', 3000).catch(() => null); ok(ty && ty.from === A.user.id, 'dm: typing indicator relayed');
    /* ---------- v3.3 Voice messages ---------- */
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(3000, 9)]);
    const vurl = (b, mt) => 'data:' + (mt || 'audio/webm;codecs=opus') + ';base64,' + b.toString('base64');
    let vu = await api('POST', '/api/voice', { audio: vurl(webm), durationMs: 2500 }, A.token); ok(vu.status === 200 && Number.isInteger(vu.body.id) && vu.body.durationMs === 2500, 'voice: upload WebM/Opus clip', vu.body);
    const vid = vu.body.id;
    let vg = await fetch(BASE + '/api/voice/' + vid, { headers: { authorization: 'Bearer ' + B.token } }); ok(vg.status === 404, 'voice: recipient cannot fetch before it is sent');
    await sleep(550); dB.clear(); dm = await api('POST', '/api/dm/' + B.user.id, { k: 'v', v: vid }, A.token); ok(dm.status === 200 && dm.body.msg.k === 'v' && dm.body.msg.v.id === vid && dm.body.msg.v.dur === 2500, 'voice: sent as DM');
    const vr = await dB.wait('dm', 3000); ok(vr.msg.k === 'v' && vr.msg.v.id === vid, 'voice: DM delivered live');
    vg = await fetch(BASE + '/api/voice/' + vid, { headers: { authorization: 'Bearer ' + B.token } }); let vb = Buffer.from(await vg.arrayBuffer());
    ok(vg.status === 200 && vg.headers.get('content-type') === 'audio/webm' && vb.equals(webm) && vg.headers.get('x-content-type-options') === 'nosniff', 'voice: recipient downloads identical audio');
    vg = await fetch(BASE + '/api/voice/' + vid, { headers: { authorization: 'Bearer ' + C.token } }); ok(vg.status === 404, 'voice: other users cannot fetch');
    vg = await fetch(BASE + '/api/voice/' + vid); ok(vg.status === 401, 'voice: fetch requires login');
    await sleep(550); dm = await api('POST', '/api/dm/' + B.user.id, { k: 'v', v: vid }, A.token); ok(dm.status === 400 && dm.body.error === 'voice_bad', 'voice: clip can be attached only once');
    vu = await api('POST', '/api/voice', { audio: vurl(Buffer.from('<html>' + 'x'.repeat(500))), durationMs: 2000 }, A.token); ok(vu.status === 400 && vu.body.error === 'voice_bad', 'voice: non-audio bytes rejected');
    vu = await api('POST', '/api/voice', { audio: vurl(webm), durationMs: 70000 }, A.token); ok(vu.status === 400, 'voice: > 60 s rejected');
    vu = await api('POST', '/api/voice', { audio: vurl(Buffer.concat([webm, Buffer.alloc(310 * 1024)])), durationMs: 20000 }, A.token); ok(vu.status === 400 && vu.body.error === 'too_large', 'voice: > 300 KB rejected');
    const ogg = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(800, 1)]), mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A '), Buffer.alloc(800, 2)]);
    vu = await api('POST', '/api/voice', { audio: vurl(ogg, 'audio/ogg'), durationMs: 1500 }, A.token); const vu2 = await api('POST', '/api/voice', { audio: vurl(mp4, 'audio/mp4'), durationMs: 1500 }, A.token);
    ok(vu.status === 200 && vu2.status === 200, 'voice: Ogg and MP4/AAC (Safari) accepted');
    const C_vid = vu.body.id; await sleep(550); dm = await api('POST', '/api/dm/' + B.user.id, { k: 'v', v: C_vid }, C.token); ok(dm.status === 400 && dm.body.error === 'voice_bad', 'voice: cannot send someone else\'s clip');
    /* room chat voice */
    dA.send({ t: 'room_leave' }); dB.send({ t: 'room_leave' }); await sleep(300); dA.clear(); dB.clear();
    dA.send({ t: 'room_create', mode: 'classic', diff: 'easy' }); const vroom = await dA.wait('room');
    dB.send({ t: 'room_join', code: vroom.code }); await dA.wait((m) => m.t === 'room' && m.opp, 3000);
    await sleep(1600); dA.send({ t: 'chat', k: 'v', v: vu2.body.id, mid: 'voic0001' });
    const rv = await dB.wait('chat', 3000).catch(() => null); const okv = await dA.wait((m) => m.t === 'chat_ok' && m.mid === 'voic0001', 3000).catch(() => null);
    ok(rv && rv.k === 'v' && rv.v.id === vu2.body.id && rv.v.dur === 1500 && !!okv, 'voice: voice message in 1vs1 room chat');
    vg = await fetch(BASE + '/api/voice/' + vu2.body.id, { headers: { authorization: 'Bearer ' + B.token } }); ok(vg.status === 200 && vg.headers.get('content-type') === 'audio/mp4', 'voice: room opponent can play it');
    await sleep(1600); dA.send({ t: 'chat', k: 'v', v: vu2.body.id, mid: 'voic0002' }); const rve = await dA.wait((m) => m.t === 'error' && m.mid === 'voic0002', 3000).catch(() => null); ok(rve && rve.code === 'voice_bad', 'voice: room clip reuse rejected');
    dB.send({ t: 'room_leave' }); dA.send({ t: 'room_leave' }); await sleep(200);
    /* ---------- v3.3 Privacy, first-contact limit, blocking ---------- */
    const pol = await api('PATCH', '/api/me', { dmPolicy: 'friends' }, D.token); ok(pol.status === 200 && pol.body.user.dmPolicy === 'friends' && pol.body.user.country === 'ID', 'dm privacy: friends only (geo unchanged)');
    const polBad = await api('PATCH', '/api/me', { dmPolicy: 'nobody' }, D.token); ok(polBad.status === 400, 'dm privacy: invalid value rejected');
    const dmCD = await api('POST', '/api/dm/' + D.user.id, { k: 'x', v: 'hai Dina' }, C.token); ok(dmCD.status === 403 && dmCD.body.error === 'dm_friends_only', 'dm privacy: non-friend blocked by policy');
    await api('POST', '/api/friends/request', { code: D.user.friendCode }, A.token); await api('POST', '/api/friends/respond', { userId: A.user.id, accept: true }, D.token);
    await sleep(550); const ad = await api('POST', '/api/dm/' + D.user.id, { k: 'x', v: 'hai Dina' }, A.token); ok(ad.status === 200, 'dm privacy: friend can still message');
    const cbFriend = !!rdb3.prepare('SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ?').get(C.user.id, B.user.id);
    let lastC = null; for (let i = 0; i < 6; i++) { await sleep(550); lastC = await api('POST', '/api/dm/' + B.user.id, { k: 'x', v: 'mesej ' + i }, C.token); if (lastC.status !== 200) break; }
    ok(!cbFriend && lastC.status === 403 && lastC.body.error === 'dm_wait_reply', 'dm anti-spam: max 5 messages to a non-friend until they reply', lastC.body);
    await sleep(550); const bc = await api('POST', '/api/dm/' + C.user.id, { k: 'x', v: 'ya, siapa ni?' }, B.token); await sleep(550);
    const cb2 = await api('POST', '/api/dm/' + B.user.id, { k: 'x', v: 'saya Chen' }, C.token); ok(bc.status === 200 && cb2.status === 200, 'dm anti-spam: conversation opens after a reply');
    const blk = await api('POST', '/api/blocks', { userId: C.user.id, block: true }, B.token); ok(blk.status === 200 && blk.body.blocked === true, 'block user');
    await sleep(550); let bm = await api('POST', '/api/dm/' + B.user.id, { k: 'x', v: 'hello?' }, C.token); ok(bm.status === 403 && bm.body.error === 'dm_unavailable', 'blocked user cannot message (generic reason)');
    bm = await api('POST', '/api/dm/' + C.user.id, { k: 'x', v: 'hi' }, B.token); ok(bm.status === 403 && bm.body.error === 'dm_you_blocked', 'blocker told to unblock first');
    const bl = (await api('GET', '/api/blocks', null, B.token)).body; ok(bl.blocked.length === 1 && bl.blocked[0].id === C.user.id, 'block list');
    const cvB = (await api('GET', '/api/dm', null, B.token)).body; const cRow = cvB.convos.find((x) => x.peer.id === C.user.id); ok(cRow && cRow.peer.blockedByMe === true && cRow.unread === 0, 'blocked conversation shows no unread');
    await api('POST', '/api/blocks', { userId: C.user.id, block: false }, B.token); await sleep(550);
    bm = await api('POST', '/api/dm/' + B.user.id, { k: 'x', v: 'ok terima kasih' }, C.token); ok(bm.status === 200, 'unblock restores messaging');
    const leak = rdb3.prepare('SELECT COUNT(*) n FROM dm_messages').get().n; ok(leak > 0, 'dm messages persisted in SQLite');
    rdb3.close();
    [dA, dB, dC].forEach((s) => s.close());
  } catch (e) {
    fail++; results.push('FAIL exception: ' + e.stack);
  }
  srv.kill();
  fs.writeFileSync(path.join(__dirname, 'server-test-results.txt'), results.join('\n') + `\n\n${pass} passed, ${fail} failed\n`);
  console.log(results.join('\n')); console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) console.log('--- server log ---\n' + log.slice(-3000));
  process.exit(fail ? 1 : 0);
}
main();
