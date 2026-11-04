'use strict';
/* WCS v4 integration tests: real HTTP + WebSocket + SQLite. The server clock is shifted with SLA_TEST_HOOKS (tests only). */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));
const { load } = require('../server/engine');
const { E } = load();

const PORT = 8125, BASE = 'http://127.0.0.1:' + PORT, DBF = '/tmp/sla-wcs-' + Date.now() + '.db';
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


const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));
const DAY = 864e5;
const MYT = (t) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
const WD = (k) => new Date(k + 'T00:00:00Z').getUTCDay();
const ROTK = { 1: 'speed', 2: 'accuracy', 3: 'survival', 4: 'technique', 5: 'mystery', 6: 'extreme', 0: 'ultimate' };
let OFF = 0;
async function clock(add) { OFF += add; const r = await api('POST', '/api/_test/clock', { offsetMs: OFF }); await api('POST', '/api/_test/tick', {}); return r.body.now; }
async function reg(n, country) { const r = await api('POST', '/api/auth/register', { username: n, password: n + 'pw12345', country: country || null }); if (!r.body || !r.body.token) throw new Error('register ' + n + ' ' + JSON.stringify(r.body)); return r.body; }
async function login(n) { return (await api('POST', '/api/auth/login', { username: n, password: n + 'pw12345' })).body; }
const setRating = (uid, rating) => api('POST', '/api/_test/rating', { uid, rating });
const elo = (r, o, s, k) => Math.max(100, Math.round(r + k * (s - 1 / (1 + Math.pow(10, (o - r) / 400)))));
async function solveRun(token, run, opts) {
  opts = opts || {}; const sol = solve(run.puzzle); let last = null, wrongDone = 0;
  const empt = []; for (let i = 0; i < 81; i++) if (run.puzzle[i] === '0' && run.grid[i] !== String(sol[i])) empt.push(i);
  for (let n = 0; n < empt.length; n++) {
    const i = empt[n];
    if (wrongDone < (opts.wrong || 0)) { const bad = (sol[i] % 9) + 1; await api('POST', '/api/run/' + run.id + '/move', { i, v: bad }, token); wrongDone++; await sleep(90); }
    if (n === empt.length - 1 && opts.beforeLast) await opts.beforeLast();
    last = await api('POST', '/api/run/' + run.id + '/move', { i, v: sol[i] }, token); await sleep(90);
    if (last.status !== 200) return last;
  }
  return last;
}
async function playCustom(SA, SB, ua, ub, how) {
  SA.clear(); SB.clear();
  SA.send({ t: 'room_create', mode: 'classic', diff: 'easy' }); const rm = await SA.wait((m) => m.t === 'room' && m.code);
  SB.send({ t: 'room_join', code: rm.code }); await SB.wait((m) => m.t === 'room' && m.opp);
  SA.send({ t: 'room_ready', val: true }); SB.send({ t: 'room_ready', val: true });
  const cd = await SA.wait('countdown', 30000); await SB.wait('countdown', 30000); await SA.wait('go', 8000);
  if (how === 'a') SB.send({ t: 'surrender' }); else if (how === 'b') SA.send({ t: 'surrender' }); else await clock(61 * 60000);
  const ra = await SA.wait('result', 15000), rb = await SB.wait('result', 15000);
  SA.send({ t: 'room_leave' }); SB.send({ t: 'room_leave' }); await sleep(250);
  return { cd, ra, rb };
}
async function wcsPair(SA, SB) {
  SA.clear(); SB.clear(); SA.send({ t: 'wcs_find' }); SB.send({ t: 'wcs_find' });
  const fa = await SA.wait('mm_found', 15000); await SB.wait('mm_found', 15000);
  const cd = await SA.wait('countdown', 40000); await SB.wait('countdown', 40000); await SA.wait('go', 8000); await SB.wait('go', 8000);
  return { fa, cd };
}
async function finishBy(SA, SB, loserSock) { loserSock.send({ t: 'surrender' }); const ra = await SA.wait('result', 15000), rb = await SB.wait('result', 15000); SA.send({ t: 'room_leave' }); SB.send({ t: 'room_leave' }); await sleep(300); return { ra, rb }; }

async function main() {
  const srv = spawn('node', [path.join(__dirname, '..', 'server', 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), SLA_DB: DBF, SLA_REG_LIMIT: '200', SLA_HTTP_LIMIT: '100000', SLA_TEST_HOOKS: '1', SLA_CUSTOM_PAIR_CAP: '3' }), stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => log += d); srv.stderr.on('data', (d) => log += d);
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/health'); break; } catch (e) { await sleep(100); } }
  const socks = []; const S = async (tok) => { const s = new Sock(tok); await s.open(); socks.push(s); return s; };
  try {
    const h = await api('GET', '/api/health'); ok(h.body.version === '4.4.1', 'server version 4.4.1');
    const rdb = new Database(DBF, { readonly: true });
    ok(rdb.prepare("SELECT v FROM schema_meta WHERE k='version'").get().v === '6', 'schema version 6');

    /* ===== 1. Custom Room Elo ===== */
    const A = await reg('cr_alice', 'MY'), B = await reg('cr_bob', 'SG');
    const SA = await S(A.token), SB = await S(B.token);
    let g = await playCustom(SA, SB, A, B, 'a');
    ok(g.cd.rated === true && g.cd.kind === 'custom', 'custom room countdown says Elo-rated');
    ok(g.ra.elo && g.ra.elo.before === 1200 && g.ra.elo.after === 1220 && g.ra.elo.delta === 20, 'custom WIN: 1200 → 1220 (+20, K=40, E=0.5)', g.ra.elo);
    ok(g.rb.elo && g.rb.elo.before === 1200 && g.rb.elo.after === 1180 && g.rb.elo.delta === -20, 'custom LOSE: 1200 → 1180 (−20)', g.rb.elo);
    let ua = (await api('GET', '/api/me', null, A.token)).body.user, ub = (await api('GET', '/api/me', null, B.token)).body.user;
    ok(ua.rating === 1220 && ub.rating === 1180 && ua.games === 1 && ua.wins === 1 && ub.losses === 1, 'both ratings + W/L stored in the database');
    const tx1 = rdb.prepare('SELECT * FROM elo_transactions WHERE match_id = ?').all(g.ra.mid);
    ok(tx1.length === 2 && tx1.some((x) => x.user_id === A.user.id && x.delta === 20) && tx1.some((x) => x.user_id === B.user.id && x.delta === -20), 'two Elo transactions written (one per player)', tx1);
    const mrow = rdb.prepare('SELECT * FROM matches WHERE id = ?').get(g.ra.mid);
    ok(mrow.kind === 'custom' && mrow.ranked === 1 && mrow.p1_after === 1220 && mrow.p2_after === 1180, 'match row: kind=custom, rated, before/after saved');
    // refresh / reconnect must not re-apply Elo
    SA.close(); const SA2 = await S(A.token); await sleep(300);
    ua = (await api('GET', '/api/me', null, A.token)).body.user; ok(ua.rating === 1220, 'reconnect/refresh does not apply Elo twice');
    ok(rdb.prepare('SELECT COUNT(*) n FROM elo_transactions WHERE match_id = ?').get(g.ra.mid).n === 2, 'still exactly 2 Elo transactions after refresh');
    const hist = await api('GET', '/api/me/matches?page=1', null, A.token); ok(hist.body.rows[0].delta === 20 && hist.body.rows[0].kind === 'custom', 'history shows +20 for the custom room');
    // draw (time limit, equal progress) uses the formula
    g = await playCustom(SA2, SB, A, B, 'draw');
    const expA = elo(1220, 1180, 0.5, 40), expB = elo(1180, 1220, 0.5, 40);
    ok(g.ra.draw === true && g.ra.elo.after === expA && g.rb.elo.after === expB, `custom DRAW uses the formula: A 1220→${expA}, B 1180→${expB}`, [g.ra.elo, g.rb.elo]);
    // B wins: B gains, A loses
    g = await playCustom(SA2, SB, A, B, 'b');
    ok(g.rb.elo.delta > 0 && g.ra.elo.delta < 0 && g.rb.elo.after === elo(expB, expA, 1, 40), 'custom: the other player wins → gains, loser drops', [g.ra.elo, g.rb.elo]);
    // pair cap (test env cap = 3): 4th game in 24 h is casual, Elo unchanged
    const before4 = (await api('GET', '/api/me', null, A.token)).body.user.rating;
    g = await playCustom(SA2, SB, A, B, 'a');
    ok(g.cd.rated === false && g.ra.elo === null && (await api('GET', '/api/me', null, A.token)).body.user.rating === before4, 'anti-farming: rated games per pair capped per 24 h (then casual, no Elo)');
    ok(rdb.prepare("SELECT COUNT(*) n FROM anticheat_logs WHERE kind = 'custom_pair_cap'").get().n >= 1, 'pair cap logged for admin review');
    // cancelled room (left before the match) changes nothing
    SA2.clear(); SA2.send({ t: 'room_create', mode: 'classic', diff: 'easy' }); const rmX = await SA2.wait((m) => m.t === 'room' && m.code); SB.send({ t: 'room_join', code: rmX.code }); await SB.wait((m) => m.t === 'room' && m.opp);
    SB.send({ t: 'room_leave' }); SA2.send({ t: 'room_leave' }); await sleep(300);
    ok((await api('GET', '/api/me', null, A.token)).body.user.rating === before4, 'cancelled / not-started custom room: no Elo change');

    /* ===== 2. WCS eligibility (server-side) ===== */
    const C = await reg('wcs_c', 'MY'); const SC = await S(C.token);
    await setRating(C.user.id, 1999);
    let r = await api('POST', '/api/wcs/enter', {}, C.token); ok(r.status === 403 && r.body.error === 'wcs_not_eligible' && r.body.need === 1, 'Elo 1,999: NOT eligible (need 1 more)', r.body);
    SC.clear(); SC.send({ t: 'wcs_find' }); let e = await SC.wait('error', 4000); ok(e.code === 'wcs_not_eligible', 'Elo 1,999: direct WebSocket request (frontend bypass) rejected');
    let st = await api('GET', '/api/wcs/state', null, C.token); ok(st.body.me.eligible === false && st.body.me.need === 1 && st.body.me.minElo === 2000, 'state reports NOT QUALIFIED with current/needed Elo');
    await setRating(C.user.id, 2000); r = await api('POST', '/api/wcs/enter', {}, C.token); ok(r.status === 200 && r.body.ok, 'Elo 2,000: eligible');
    const C2 = await reg('wcs_c2', 'ID'); await setRating(C2.user.id, 2001); r = await api('POST', '/api/wcs/enter', {}, C2.token); ok(r.status === 200, 'Elo 2,001: eligible');
    st = await api('GET', '/api/wcs/state', null, C.token); ok(st.body.me.eligible === true && st.body.me.entered === true, 'access opens automatically at 2,000');
    ok(rdb.prepare("SELECT COUNT(*) n FROM anticheat_logs WHERE kind = 'wcs_ineligible_attempt'").get().n >= 2, 'ineligible attempts logged');

    /* ===== 3. Qualification Stage (no elimination) ===== */
    const P = {}; for (const [n, rt, cc] of [['wcs_e', 2000, 'MY'], ['wcs_f', 2001, 'SG'], ['wcs_g', 2100, 'JP'], ['wcs_h', 2050, 'BR']]) { P[n] = await reg(n, cc); await setRating(P[n].user.id, rt); P[n].s = await S(P[n].token); }
    const Ad = await reg('wcs_admin', 'MY'); await api('POST', '/api/_test/admin', { uid: Ad.user.id });
    r = await api('POST', '/api/admin/wcs/config', { topN: 4, minMatches: 1 }, P.wcs_e.token); ok(r.status === 403, 'non-admin cannot change WCS config');
    r = await api('POST', '/api/admin/wcs/config', { topN: 4, minMatches: 1 }, Ad.token); ok(r.status === 200 && r.body.season.topN === 4, 'admin sets Top N (4) for the test season');
    const E_ = P.wcs_e, F_ = P.wcs_f, G_ = P.wcs_g, H_ = P.wcs_h;
    let w = await wcsPair(E_.s, F_.s);
    ok(w.fa.wcs === 'qualification' && w.cd.diff === 'extreme' && w.cd.mode === 'classic' && w.cd.rated === false, 'qualification match: Classic EXTREME, not Elo-rated', { wcs: w.fa.wcs, diff: w.cd.diff });
    const xr = rdb.prepare('SELECT * FROM matches WHERE id = ?').get(w.cd.mid); ok(xr.difficulty === 'extreme' && xr.kind === 'wcs_q', 'database: match stored as wcs_q / extreme');
    ok(solve(w.cd.puzzle) !== null && E.solve(E.parse(w.cd.puzzle), { limit: 2 }).count === 1, 'championship puzzle has exactly one solution');
    let fr = await finishBy(E_.s, F_.s, F_.s); ok(fr.ra.wcs && fr.ra.wcs.points === 3 && fr.rb.wcs.points === 0 && fr.ra.elo === null, 'win = 3 points, loss = 0, Elo untouched');
    w = await wcsPair(G_.s, H_.s); await finishBy(G_.s, H_.s, H_.s);
    w = await wcsPair(F_.s, H_.s); fr = await finishBy(F_.s, H_.s, H_.s);
    ok(fr.ra.wcs.points === 3 && fr.ra.wcs.total.played === 2, 'loser of match 1 keeps playing and scores (no elimination)');
    w = await wcsPair(E_.s, F_.s); await finishBy(E_.s, F_.s, E_.s); // E–F second meeting allowed (cap 2/day)
    E_.s.clear(); F_.s.clear(); E_.s.send({ t: 'wcs_find' }); F_.s.send({ t: 'wcs_find' });
    const third = await E_.s.wait('mm_found', 5000).catch(() => null); ok(!third, 'same pair limited to 2 qualification matches per day');
    E_.s.send({ t: 'wcs_cancel' }); F_.s.send({ t: 'wcs_cancel' }); await sleep(300);
    st = await api('GET', '/api/wcs/state', null, F_.token);
    const q = st.body.qualification; ok(q.length >= 4 && q[0].user.username === 'wcs_f' && q[0].points === 6 && q[0].played === 3 && q[0].wins === 2 && q[0].losses === 1, 'qualification leaderboard: F first with 6 pts (2W 1L)', q.slice(0, 4).map((x) => [x.user.username, x.points]));
    ok(q.every((x, i) => i === 0 || q[i - 1].points >= x.points), 'leaderboard sorted by points');
    ok(q.find((x) => x.user.username === 'wcs_h').points === 0 && q.find((x) => x.user.username === 'wcs_h').status === 'qualified', 'H (0 pts) still in Top 4 → provisionally qualified');
    ok(q.find((x) => x.user.username === 'wcs_c').status === 'not_qualified', 'entrant with 0 matches is Not Qualified (min matches)');
    ok(st.body.me.pos === 1 && st.body.me.entry.points === 6, 'my position + points');
    for (const k of Object.keys(P)) ok((await api('GET', '/api/me', null, P[k].token)).body.user.rating === [2000, 2001, 2100, 2050][Object.keys(P).indexOf(k)], 'WCS matches never change Elo: ' + k);

    /* ===== 4. Knockout ===== */
    r = await api('POST', '/api/admin/wcs/end-qualification', {}, P.wcs_e.token); ok(r.status === 403, 'non-admin cannot end qualification');
    r = await api('POST', '/api/admin/wcs/end-qualification', {}, Ad.token); ok(r.status === 200 && r.body.bracketSize === 4 && r.body.season.status === 'knockout', 'qualification closed → knockout bracket of 4 (Semi-Final)', r.body);
    r = await api('POST', '/api/admin/wcs/config', { topN: 8 }, Ad.token); ok(r.status === 409, 'config (and bracket) locked once the knockout started');
    st = await api('GET', '/api/wcs/state', null, F_.token);
    const br = st.body.bracket; ok(br && br.rounds.length === 2 && br.rounds[0].name === 'sf' && br.rounds[1].name === 'final' && br.rounds[0].matches.length === 2, 'bracket: Semi-Final (2 matches) → Grand Final');
    const sf = br.rounds[0].matches; const seedOf = (n) => q.findIndex((x) => x.user.username === n) + 1;
    ok(sf[0].seed1 === 1 && sf[0].seed2 === 4 && sf[1].seed1 === 2 && sf[1].seed2 === 3, 'seeding 1 v 4, 2 v 3 (no byes, no unfair advantage)', sf.map((m) => [m.seed1, m.seed2]));
    ok(st.body.qualification.filter((x) => x.seed).length === 4 && !st.body.qualification.find((x) => x.user.username === 'wcs_c').seed, 'only qualified players were seeded');
    const byName = (n) => P[n]; const nm = (u) => u.username;
    const m1 = sf[0], m2 = sf[1];
    const p1a = byName(nm(m1.p1)), p1b = byName(nm(m1.p2)), p2a = byName(nm(m2.p1)), p2b = byName(nm(m2.p2));
    // SF1: both READY → server starts an Extreme match
    p1a.s.clear(); p1b.s.clear(); p1a.s.send({ t: 'wcs_ready' }); await sleep(200); p1b.s.send({ t: 'wcs_ready' });
    const kf = await p1a.s.wait('mm_found', 10000); const kcd = await p1a.s.wait('countdown', 40000); await p1b.s.wait('countdown', 40000); await p1a.s.wait('go', 8000); await p1b.s.wait('go', 8000);
    ok(kf.wcs === 'sf' && kcd.diff === 'extreme', 'Semi-Final starts when both are READY; Extreme puzzle');
    p1b.s.send({ t: 'surrender' }); const kr = await p1a.s.wait('result', 15000); await p1b.s.wait('result', 15000);
    ok(kr.wcs && kr.wcs.kind === 'wcs_ko' && kr.wcs.advanced === true, 'winner advances');
    p1a.s.send({ t: 'room_leave' }); p1b.s.send({ t: 'room_leave' }); await sleep(300);
    // SF2: only one shows up → walkover after the deadline
    p2b.s.clear(); p2b.s.send({ t: 'wcs_ready' }); await sleep(400);
    await clock(49 * 3600e3); await sleep(2500);
    st = await api('GET', '/api/wcs/state', null, F_.token);
    const sf2 = st.body.bracket.rounds[0].matches[1]; ok(sf2.status === 'done' && sf2.winner === p2b.user.id && sf2.reason === 'walkover', 'no-show: the player who was READY wins by walkover');
    const fin = st.body.bracket.rounds[1].matches[0];
    ok(fin && fin.status === 'pending' && [fin.p1.id, fin.p2.id].sort().join() === [p1a.user.id, p2b.user.id].sort().join(), 'Grand Final created automatically with both winners');
    ok(st.body.final && st.body.final.id === fin.id, 'state exposes the Grand Final');
    p1b.s.clear(); p1b.s.send({ t: 'wcs_ready' }); e = await p1b.s.wait('error', 4000); ok(e.code === 'wcs_no_ko_match', 'eliminated player cannot play on');
    // Grand Final: draw on time → tie-break (fewer mistakes) decides
    const fa = byName(nm(fin.p1)), fb = byName(nm(fin.p2));
    fa.s.clear(); fb.s.clear(); fa.s.send({ t: 'wcs_ready' }); await sleep(200); fb.s.send({ t: 'wcs_ready' });
    const ff = await fa.s.wait('mm_found', 10000); const fcd = await fa.s.wait('countdown', 40000); await fb.s.wait('countdown', 40000); await fa.s.wait('go', 8000); await fb.s.wait('go', 8000);
    ok(ff.wcs === 'final' && fcd.diff === 'extreme', 'Grand Final: Extreme match');
    const fsol = solve(fcd.puzzle), fi = fcd.puzzle.indexOf('0'); fa.s.send({ t: 'mv', i: fi, v: (fsol[fi] % 9) + 1 }); await fa.s.wait('mv_res', 5000);
    await clock(61 * 60000);
    const gfa = await fa.s.wait('result', 15000), gfb = await fb.s.wait('result', 15000);
    ok(gfa.draw === true && gfb.wcs.advanced === true && gfb.wcs.why === 'tb_mistakes', 'Grand Final draw → pre-announced tie-break: fewer mistakes wins', gfb.wcs);
    await sleep(1200);
    const champ = fb; st = await api('GET', '/api/wcs/state?season=1', null, champ.token);
    ok(st.body.season.status === 'finished', 'season finished after the Grand Final');
    const ttl = rdb.prepare('SELECT title FROM user_titles WHERE user_id = ? AND season_id = 1').all(champ.user.id).map((x) => x.title).sort();
    ok(ttl.join() === 'grandmaster_sudoku,wcs_champion', 'champion receives WCS CHAMPION + GRANDMASTER SUDOKU', ttl);
    ok(rdb.prepare('SELECT COUNT(*) n FROM user_titles').get().n === 2 && rdb.prepare('SELECT COUNT(*) n FROM wcs_champions WHERE season_id = 1').get().n === 1, 'only one champion per season; nobody else has titles');
    const hof = await api('GET', '/api/wcs/halloffame'); ok(hof.body.champions.length === 1 && hof.body.champions[0].champion.id === champ.user.id && hof.body.champions[0].wins === 1 && hof.body.champions[0].runnerUp.id === fa.user.id, 'Hall of Fame records champion, runner-up and number of titles');
    const prof = await api('GET', '/api/wcs/player/' + champ.user.id); ok(prof.body.championships === 1 && prof.body.titles.length === 2 && prof.body.seasons[0].result === 'champion', 'champion profile: titles, Championship Wins 1, Final Result Champion', prof.body.seasons);
    const prof2 = await api('GET', '/api/wcs/player/' + fa.user.id); ok(prof2.body.seasons[0].result === 'final' && prof2.body.titles.length === 0, 'runner-up: Final, no titles');
    const cur = await api('GET', '/api/wcs/state'); ok(cur.body.season.id === 2 && cur.body.season.status === 'qualification', 'next season (Season 2) opens automatically');
    ok((await api('GET', '/api/me', null, champ.token)).body.user.titles === 1, 'title count on the public profile');
    ok(rdb.prepare("SELECT COUNT(*) n FROM matches WHERE kind IN ('wcs_q','wcs_ko') AND difficulty != 'extreme'").get().n === 0, 'every championship match in the database is Extreme');

    /* ===== 5. Daily Tournament ===== */
    const D1 = await reg('dly_one', 'MY'), D2 = await reg('dly_two', 'SG'), D3 = await reg('dly_three', 'TH');
    let dy = await api('GET', '/api/daily', null, D1.token); const today = dy.body.day;
    ok(dy.body.kind === ROTK[WD(today)], 'today\'s challenge follows the weekday schedule (' + dy.body.kind + ')');
    ok(dy.body.week.length === 7 && dy.body.week.every((x) => x.kind === ROTK[x.weekday]), 'weekly schedule Mon–Sun');
    let r1 = await api('POST', '/api/daily/start', {}, D1.token); const rr1 = await api('POST', '/api/daily/start', {}, D1.token);
    ok(r1.status === 200 && rr1.body.id === r1.body.id && r1.body.n === 1, 'refresh/second start resumes the same attempt');
    ok(r1.body.solution === null && !('solution' in r1.body && r1.body.solution), 'solution never sent while the attempt is active');
    const r2 = await api('POST', '/api/daily/start', {}, D2.token); ok(r2.body.puzzle === r1.body.puzzle && r2.body.id !== r1.body.id, 'every player gets the same puzzle today');
    // wrong move counts a mistake
    const s1 = solve(r1.body.puzzle), i1 = r1.body.puzzle.indexOf('0');
    const mv = await api('POST', '/api/run/' + r1.body.id + '/move', { i: i1, v: (s1[i1] % 9) + 1 }, D1.token);
    ok(mv.body.mistakes === 1 && mv.body.last.ok === false, 'server counts mistakes');
    // attempts: abandon 3 → 4th refused
    await api('POST', '/api/run/' + r1.body.id + '/abandon', {}, D1.token);
    const a2 = await api('POST', '/api/daily/start', {}, D1.token); await api('POST', '/api/run/' + a2.body.id + '/abandon', {}, D1.token);
    const a3 = await api('POST', '/api/daily/start', {}, D1.token); await api('POST', '/api/run/' + a3.body.id + '/abandon', {}, D1.token);
    const a4 = await api('POST', '/api/daily/start', {}, D1.token); ok(a2.body.n === 2 && a3.body.n === 3 && a4.status === 403 && a4.body.error === 'no_attempts', 'maximum 3 attempts per day (server)');
    // D2 solves cleanly, D3 solves with mistakes → leaderboard order
    const r3 = await api('POST', '/api/daily/start', {}, D3.token);
    const rules = dy.body.rules;
    let fin2 = null, fin3 = null;
    if (!rules.lives) {
      fin2 = await solveRun(D2.token, r2.body, { beforeLast: () => clock(6 * 60000) });
      fin3 = await solveRun(D3.token, r3.body, { wrong: 2 });
      ok(fin2.body.status === 'solved' && fin3.body.status === 'solved' && fin2.body.score > fin3.body.score, 'scores: clean solve beats a solve with mistakes', [fin2.body.score, fin3.body.score]);
      dy = await api('GET', '/api/daily', null, D2.token);
      ok(dy.body.leaderboard[0].user.id === D2.user.id && dy.body.leaderboard[1].user.id === D3.user.id && dy.body.myPos === 1, 'daily leaderboard ordered by best valid score');
      ok(fin2.body.rewards.some((x) => x.why === 'daily' && x.xp > 0), 'daily XP awarded');
      const xp2 = (await api('GET', '/api/me/xp', null, D2.token)).body.rows.filter((x) => x.reason === 'daily').length; ok(xp2 === 1, 'daily XP paid once');
    } else {
      fin2 = await solveRun(D2.token, r2.body, { beforeLast: () => clock(6 * 60000) });
      ok(fin2.body.status === 'solved', 'clean solve on a lives day');
      const w3 = []; let lastR = null; const sl3 = solve(r3.body.puzzle); for (let i = 0, n = 0; i < 81 && n < rules.lives; i++) if (r3.body.puzzle[i] === '0') { lastR = await api('POST', '/api/run/' + r3.body.id + '/move', { i, v: (sl3[i] % 9) + 1 }, D3.token); n++; await sleep(90); }
      ok(lastR.body.status === 'failed' && lastR.body.livesLeft === 0, 'limited lives: attempt fails when lives run out');
    }
    // flagged fast solve (no clock shift) is logged and excluded from the board
    const D4 = await reg('dly_fast', 'MY'); const r4 = await api('POST', '/api/daily/start', {}, D4.token); const f4 = await solveRun(D4.token, r4.body, {});
    if (f4.body.status === 'solved') { ok(f4.body.flagged === true && !(await api('GET', '/api/daily')).body.leaderboard.some((x) => x.user.id === D4.user.id), 'impossibly fast solve flagged, hidden from leaderboard'); ok(rdb.prepare("SELECT COUNT(*) n FROM anticheat_logs WHERE kind = 'run_too_fast' AND user_id = ?").get(D4.user.id).n === 1, 'anti-cheat log written'); }
    // admin review clears it
    const lg = await api('GET', '/api/admin/anticheat', null, Ad.token); const lrow = lg.body.rows.find((x) => x.kind === 'run_too_fast');
    if (lrow) { const rv = await api('POST', '/api/admin/anticheat/' + lrow.id, { status: 'dismissed', note: 'reviewed replay' }, Ad.token); ok(rv.status === 200 && (await api('GET', '/api/daily')).body.leaderboard.some((x) => x.user.id === D4.user.id), 'admin review (dismiss) restores the result'); }
    // appeal
    const ap = await api('POST', '/api/appeals', { refType: 'run', ref: r4.body.id, body: 'Saya selesaikan sendiri, sila semak semula.' }, D4.token); ok(ap.status === 200, 'player can file an appeal');
    const apl = await api('GET', '/api/admin/appeals', null, Ad.token); const apr = await api('POST', '/api/admin/appeals/' + apl.body.rows[0].id, { status: 'accepted', note: 'ok' }, Ad.token); ok(apr.status === 200 && (await api('GET', '/api/appeals', null, D4.token)).body.rows[0].status === 'accepted', 'admin resolves the appeal');
    // move to the next days and check the schedule + rules enforced by the server
    const seen = {};
    for (let d = 1; d <= 7; d++) {
      await clock(DAY); const dd = await api('GET', '/api/daily', null, D1.token);
      seen[dd.body.kind] = dd.body.rules;
      ok(dd.body.kind === ROTK[WD(dd.body.day)] && dd.body.me.used === 0, `day ${dd.body.day}: ${dd.body.kind}, attempts reset`);
      const st1 = await api('POST', '/api/daily/start', {}, D1.token);
      if (dd.body.rules.lives === 1) { const sl = solve(st1.body.puzzle), ii = st1.body.puzzle.indexOf('0'); const m1x = await api('POST', '/api/run/' + st1.body.id + '/move', { i: ii, v: (sl[ii] % 9) + 1 }, D1.token); ok(m1x.body.status === 'failed', 'Perfect Accuracy: first mistake ends the attempt'); }
      if (dd.body.rules.hints === 0) { const hh = await api('POST', '/api/run/' + st1.body.id + '/hint', {}, D1.token); ok(hh.status === 403 && hh.body.error === 'no_hints', dd.body.kind + ': hints disabled by the server'); }
      if (dd.body.kind === 'speed') { let hr; for (let k = 0; k < 4; k++) hr = await api('POST', '/api/run/' + st1.body.id + '/hint', {}, D1.token); ok(hr.status === 403 && hr.body.error === 'hint_limit', 'Speed: hint limit (3) enforced'); }
      if (dd.body.kind === 'technique') ok(!!dd.body.rules.tech, 'Technique challenge names its technique: ' + dd.body.rules.tech);
      if (dd.body.kind === 'mystery') ok(dd.body.rules.secret === 'hidden', 'Mystery objective hidden before playing');
      if (dd.body.kind === 'extreme') ok(dd.body.difficulty === 'extreme', 'Saturday puzzle graded Extreme');
      await api('POST', '/api/run/' + st1.body.id + '/abandon', {}, D1.token);
    }
    ok(Object.keys(seen).length === 7, 'all 7 rotating challenges seen in one week');

    /* ===== 6. Daily Streak ===== */
    const K = await reg('stk_user', 'MY'); const SK = await S(K.token); await api('GET', '/api/me', null, K.token);
    let sk = await api('GET', '/api/streak', null, K.token); ok(sk.body.cur === 0 && sk.body.today === false, 'opening the app alone does not count');
    async function practiceSolve(tok) { const pr = await api('POST', '/api/practice/start', { diff: 'easy' }, tok); return solveRun(tok, pr.body, { beforeLast: () => clock(3 * 60000) }); }
    let ps = await practiceSolve(K.token); sk = await api('GET', '/api/streak', null, K.token); ok(ps.body.status === 'solved' && sk.body.cur === 1 && sk.body.today === true, 'server-verified solve → streak 1');
    await clock(DAY); await practiceSolve(K.token); await clock(DAY); ps = await practiceSolve(K.token);
    sk = await api('GET', '/api/streak', null, K.token); ok(sk.body.cur === 3, 'streak 3 after three consecutive days');
    await practiceSolve(K.token);
    const s3 = rdb.prepare("SELECT COUNT(*) n, SUM(amount) a FROM xp_transactions WHERE user_id = ? AND reason = 'streak3'").get(K.user.id); ok(s3.n === 1 && s3.a === 50, '3-day streak pays 50 XP once (no double reward)');
    await clock(2 * DAY); // skip one day
    sk = await api('GET', '/api/streak', null, K.token); const miss = sk.body.recoverable[0];
    ok(sk.body.cur === 0 || sk.body.cur === 3, 'missed day breaks the live streak');
    ok(miss && sk.body.token.available === true, 'missed day is recoverable with a free token (48 h window)');
    r = await api('POST', '/api/streak/recover', { day: miss.day }, K.token); ok(r.status === 200 && r.body.cur === 4 && r.body.token.available === false, 'recovery restores the streak (4) and consumes the token');
    r = await api('POST', '/api/streak/recover', { day: miss.day }, K.token); ok(r.status === 409 && r.body.error === 'already_recovered', 'same date cannot be recovered twice');
    ok(r.status === 409 && (await api('GET', '/api/streak', null, K.token)).body.recoveries.length === 1, 'token usage history shown');
    await clock(3 * DAY);
    sk = await api('GET', '/api/streak', null, K.token); ok(sk.body.recoverable.length === 0 || !sk.body.token.available, 'recovery only inside 48 h and only with a token');
    r = await api('POST', '/api/streak/recover', { day: MYT(Date.now() + OFF - 3 * DAY) }, K.token); ok(r.status === 400 && r.body.error === 'recovery_window', 'outside the 48 h window refused');
    // 7-day badge (once)
    const K2 = await reg('stk_seven', 'MY'); const t7 = MYT(Date.now() + OFF);
    for (let d = 6; d >= 1; d--) await api('POST', '/api/_test/activity', { uid: K2.user.id, day: MYT(Date.now() + OFF - d * DAY) });
    await practiceSolve(K2.token); await practiceSolve(K2.token);
    sk = await api('GET', '/api/streak', null, K2.token); ok(sk.body.cur === 7 && sk.body.milestones.find((m) => m.n === 7).earned === true, '7-day streak → Beginner Badge');
    ok(rdb.prepare("SELECT COUNT(*) n FROM user_badges WHERE user_id = ? AND badge = 'streak_beginner'").get(K2.user.id).n === 1, 'badge granted once');
    ok(sk.body.calendar.length === 84 && sk.body.calendar.filter((c) => c.src).length >= 7, 'activity calendar (12 weeks)');

    /* ===== 7. Country flag: once per 365 days ===== */
    const FL = await reg('flag_user', 'MY');
    let fl = await api('GET', '/api/me/flag', null, FL.token); ok(fl.body.code === 'MY' && fl.body.canChange === true && fl.body.history[0].kind === 'initial', 'flag chosen at sign-up (no lock yet)');
    const t0 = fl.body.serverTime;
    r = await api('POST', '/api/me/flag', { country: 'SG' }, FL.token); ok(r.status === 200 && r.body.code === 'SG' && r.body.flag === '🇸🇬' && Math.abs(r.body.nextChange - (t0 + 365 * DAY)) < 60000, 'first change recorded; next change = +365 days (server time)');
    r = await api('POST', '/api/me/flag', { country: 'ID' }, FL.token); ok(r.status === 403 && r.body.error === 'flag_locked' && r.body.nextChange, 'second change before 365 days rejected');
    r = await api('PATCH', '/api/me', { country: 'ID' }, FL.token); ok(r.status === 403 && r.body.error === 'flag_locked', 'old profile endpoint enforces the same lock');
    const FL2 = await login('flag_user'); fl = await api('GET', '/api/me/flag', null, FL2.token); ok(fl.body.canChange === false && fl.body.code === 'SG', 'logout/login does not reset the lock');
    fl = await api('GET', '/api/me/flag', null, FL.token); ok(fl.body.canChange === false, 'refresh does not reset the lock');
    const sgReg = (await api('GET', '/api/countries')).body.countries.length; ok(sgReg > 200, 'country list with flags (' + sgReg + ')');
    await clock(364 * DAY); let FL3 = await login('flag_user');
    r = await api('POST', '/api/me/flag', { country: 'ID' }, FL3.token); ok(r.status === 403, 'still locked after 364 days');
    await clock(DAY + 120000); FL3 = await login('flag_user');
    r = await api('POST', '/api/me/flag', { country: 'ID' }, FL3.token); ok(r.status === 200 && r.body.code === 'ID' && r.body.canChange === false, 'change allowed after 365 days, then locked again');
    ok(rdb.prepare('SELECT COUNT(*) n FROM flag_change_history WHERE user_id = ?').get(FL.user.id).n === 3, 'flag history: initial + 2 changes');
    rdb.close();
  } catch (e) {
    fail++; results.push('FAIL exception: ' + e.stack);
  }
  socks.forEach((s) => s.close());
  srv.kill();
  fs.writeFileSync(path.join(__dirname, 'wcs-test-results.txt'), results.join('\n') + `\n\n${pass} passed, ${fail} failed\n`);
  console.log(results.join('\n')); console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) console.log('--- server log ---\n' + log.slice(-3000));
  process.exit(fail ? 1 : 0);
}
main();
