'use strict';
/* Integration tests for the SLA server: real HTTP + WebSocket against a fresh database. */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));
const { load } = require('../server/engine');
const { E } = load();

const PORT = 8124, BASE = 'http://127.0.0.1:' + PORT, DBF = '/tmp/sla-lounge-' + Date.now() + '.db';
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
  const srv = spawn('node', [path.join(__dirname, '..', 'server', 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), SLA_DB: DBF, SLA_REG_LIMIT: '50', SLA_LOUNGE_GRACE_MS: '1500' }), stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => log += d); srv.stderr.on('data', (d) => log += d);
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/health'); break; } catch (e) { await sleep(100); } }
  const socks = [];
  try {
    const h = await api('GET', '/api/health'); ok(h.body.version === '4.0.0' && h.body.lounges === 0, 'health reports version 4.0.0 and lounge count', h.body);
    const U = [];
    for (const n of ['lp_host', 'lp_b', 'lp_c', 'lp_d', 'lp_e', 'lp_f', 'lp_g']) { const r = await api('POST', '/api/auth/register', { username: n, password: n + 'pass123' }); U.push(r.body); }
    ok(U.every((u) => u && u.token), 'register 7 users');
    const S = []; for (const u of U) { const s = new Sock(u.token); await s.open(); S.push(s); socks.push(s); }
    const [H, B, C, D, E2, F, G] = S;
    /* create */
    H.send({ t: 'lp_create', name: 'Lepak Petang', pub: true });
    let st = await H.wait('lp_state'); ok(st.name === 'Lepak Petang' && st.pub === true && st.max === 5 && st.members.length === 1 && st.host === U[0].user.id, 'create public lounge (max 5)', st);
    const code = st.code; ok(/^[a-z0-9]{6}$/.test(code), 'lounge code format');
    const hs = await H.wait('lp_hist'); ok(Array.isArray(hs.msgs) && hs.msgs.some((m) => m.sys === 'join'), 'creator receives history with join event');
    const bad = await (async () => { H.send({ t: 'lp_create', name: 'https://spam.com' }); return H.wait('error', 3000); })(); ok(bad.code === 'lp_bad_name', 'lounge name filtered (links rejected)');
    st = await H.wait('lp_state', 3000).catch(() => null); ok(!st || st.code === code, 'failed create does not move host');
    /* list */
    B.send({ t: 'lp_list' }); let ls = await B.wait('lp_list'); ok(ls.rows.some((r) => r.code === code && r.n === 1 && r.max === 5 && r.pub), 'public lounge listed for others', ls.rows);
    /* join up to 5 */
    for (const s of [B, C, D, E2]) { s.send({ t: 'lp_join', code }); await s.wait((m) => m.t === 'lp_state' && m.members.some((x) => x.uid === U[S.indexOf(s)].user.id)); }
    await sleep(200); H.clear();
    H.send({ t: 'lp_list' }); ls = await H.wait('lp_list'); ok(ls.rows.find((r) => r.code === code).n === 5, '5 members joined');
    F.send({ t: 'lp_join', code }); let e = await F.wait('error', 3000); ok(e.code === 'lp_full', '6th player rejected: lounge full', e);
    const hh = await api('GET', '/api/health'); ok(hh.body.lounges === 1, 'health counts lounges');
    /* messages */
    await sleep(800); B.clear(); C.clear();
    H.send({ t: 'lp_msg', k: 'x', v: 'Hai semua, jom lepak', mid: 'lpm00001' });
    const mb = await B.wait('lp_msg'), mc = await C.wait('lp_msg'), mh = await H.wait((m) => m.t === 'lp_msg' && m.ok === 'lpm00001');
    ok(mb.msg.k === 'x' && mb.msg.v === 'Hai semua, jom lepak' && mb.msg.from.username === 'lp_host' && mc.msg.id === mb.msg.id && mh.msg.mid === 'lpm00001', 'text message reaches all members + sender ack');
    await sleep(800); H.send({ t: 'lp_msg', k: 'x', v: 'call 0123456789', mid: 'lpm00002' }); e = await H.wait((m) => m.t === 'error' && m.mid === 'lpm00002', 3000); ok(e.code === 'chat_blocked', 'phone numbers filtered in lounge');
    await sleep(800); H.send({ t: 'lp_msg', k: 'x', v: 'kau bodoh', mid: 'lpm00003' }); e = await H.wait((m) => m.t === 'error' && m.mid === 'lpm00003', 3000); ok(e.code === 'chat_blocked', 'abusive words filtered in lounge');
    await sleep(800); H.send({ t: 'lp_msg', k: 'x', v: 'satu', mid: 'lpm0004a' }); H.send({ t: 'lp_msg', k: 'x', v: 'cepat', mid: 'lpm00004' }); e = await H.wait((m) => m.t === 'error' && m.mid === 'lpm00004', 3000); ok(e.code === 'chat_rate', 'lounge rate limit');
    await sleep(800); B.clear(); B.send({ t: 'lp_msg', k: 's', v: 's05', mid: 'lpm00005' }); const ms = await C.wait((m) => m.t === 'lp_msg' && m.msg.k === 's'); ok(ms.msg.v === 's05' && ms.msg.from.uid === U[1].user.id, 'sticker message');
    await sleep(800); C.send({ t: 'lp_msg', k: 'e', v: 3, mid: 'lpm00006' }); const me = await D.wait((m) => m.t === 'lp_msg' && m.msg.k === 'e'); ok(me.msg.v === 3, 'emoji message');
    await sleep(800); C.send({ t: 'lp_msg', k: 's', v: 's99', mid: 'lpm00007' }); e = await C.wait((m) => m.t === 'error' && m.mid === 'lpm00007', 3000); ok(e.code === 'chat_bad', 'invalid sticker rejected');
    F.send({ t: 'lp_msg', k: 'x', v: 'hai', mid: 'lpm00008' }); e = await F.wait((m) => m.t === 'error' && m.mid === 'lpm00008', 3000); ok(e.code === 'lp_not_in', 'non-member cannot post');
    /* voice */
    const vurl = (b, mt) => 'data:' + mt + ';base64,' + b.toString('base64');
    const ogg = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(900, 3)]);
    const vu = await api('POST', '/api/voice', { audio: vurl(ogg, 'audio/ogg'), durationMs: 2100 }, U[1].token); ok(vu.status === 200 && vu.body.id, 'voice upload');
    await sleep(800); D.clear(); B.send({ t: 'lp_msg', k: 'v', v: vu.body.id, mid: 'lpm00009' }); const mv = await D.wait((m) => m.t === 'lp_msg' && m.msg.k === 'v');
    ok(mv.msg.v.id === vu.body.id && mv.msg.v.dur === 2100, 'voice message reaches members');
    let vg = await fetch(BASE + '/api/voice/' + vu.body.id, { headers: { authorization: 'Bearer ' + U[3].token } }); ok(vg.status === 200 && vg.headers.get('content-type') === 'audio/ogg', 'lounge member can play voice');
    vg = await fetch(BASE + '/api/voice/' + vu.body.id, { headers: { authorization: 'Bearer ' + U[5].token } }); ok(vg.status === 404, 'non-member cannot play lounge voice');
    vg = await fetch(BASE + '/api/voice/' + vu.body.id); ok(vg.status === 401, 'anonymous cannot play lounge voice');
    await sleep(800); B.send({ t: 'lp_msg', k: 'v', v: vu.body.id, mid: 'lpm00010' }); e = await B.wait((m) => m.t === 'error' && m.mid === 'lpm00010', 3000); ok(e.code === 'voice_bad', 'voice clip cannot be reused');
    const vuC = await api('POST', '/api/voice', { audio: vurl(ogg, 'audio/ogg'), durationMs: 1000 }, U[2].token);
    await sleep(800); B.send({ t: 'lp_msg', k: 'v', v: vuC.body.id, mid: 'lpm00011' }); e = await B.wait((m) => m.t === 'error' && m.mid === 'lpm00011', 3000); ok(e.code === 'voice_bad', 'cannot send someone else\'s clip');
    /* typing */
    C.clear(); B.send({ t: 'lp_typing' }); const ty = await C.wait('lp_typing', 3000); ok(ty.from === U[1].user.id && ty.username === 'lp_b', 'typing indicator to members');
    /* leave + rejoin slot */
    H.clear(); E2.send({ t: 'lp_leave' }); const cl = await E2.wait('lp_closed'); ok(cl.why === 'self', 'leave lounge');
    st = await H.wait((m) => m.t === 'lp_state' && m.members.length === 4); ok(!!st, 'members see updated count after leave');
    const lm = await H.wait((m) => m.t === 'lp_msg' && m.msg.sys === 'leave', 3000).catch(() => null); ok(lm && lm.msg.who.username === 'lp_e', 'leave system message');
    F.send({ t: 'lp_join', code }); st = await F.wait('lp_state', 3000); ok(st.members.length === 5, 'freed slot can be taken');
    const fh = await F.wait('lp_hist'); ok(!fh.msgs.some((m) => m.k === 'x' && m.v === 'Hai semua, jom lepak') && fh.msgs.some((m) => m.sys === 'join'), 'new joiner does not see earlier messages (privacy)');
    /* host kick */
    B.send({ t: 'lp_kick', uid: U[5].user.id }); e = await B.wait('error', 3000); ok(e.code === 'not_allowed', 'only host can remove members');
    H.clear(); H.send({ t: 'lp_kick', uid: U[5].user.id }); const kc = await F.wait('lp_closed'); ok(kc.why === 'kick', 'host removes member');
    F.send({ t: 'lp_join', code }); e = await F.wait('error', 3000); ok(e.code === 'lp_not_allowed', 'removed member cannot rejoin');
    /* host leaves -> host passes */
    H.send({ t: 'lp_leave' }); await H.wait('lp_closed'); st = await B.wait((m) => m.t === 'lp_state' && m.host === U[1].user.id && m.members.length === 3); ok(!!st, 'host leaving passes host to next member');
    /* private lounge */
    G.send({ t: 'lp_create', name: 'Geng G', pub: false }); st = await G.wait('lp_state'); const pcode = st.code; ok(st.pub === false, 'create private lounge');
    E2.send({ t: 'lp_list' }); ls = await E2.wait('lp_list'); ok(!ls.rows.some((r) => r.code === pcode), 'private lounge hidden from non-friends');
    E2.send({ t: 'lp_join', code: pcode }); e = await E2.wait('error', 3000); ok(e.code === 'lp_private', 'code alone is not enough for a private lounge');
    G.send({ t: 'lp_invite', uid: U[4].user.id }); e = await G.wait('error', 3000); ok(e.code === 'not_friend', 'invite needs friendship');
    // make G and E friends
    await api('POST', '/api/friends/request', { code: U[4].user.friendCode }, U[6].token); const acc = await api('POST', '/api/friends/respond', { userId: U[6].user.id, accept: true }, U[4].token); ok(acc.status === 200, 'friendship G–E');
    E2.send({ t: 'lp_list' }); ls = await E2.wait('lp_list'); ok(ls.rows.some((r) => r.code === pcode && r.friendHost), 'private lounge visible to host\'s friends');
    G.send({ t: 'lp_invite', uid: U[4].user.id }); const inv = await E2.wait('lp_invite'); const ia = await G.wait('lp_invited'); ok(inv.code === pcode && inv.from.username === 'lp_g' && inv.name === 'Geng G' && ia.uid === U[4].user.id, 'friend receives lounge invite');
    E2.send({ t: 'lp_join', code: pcode }); st = await E2.wait((m) => m.t === 'lp_state' && m.code === pcode); ok(st.members.length === 2, 'invited friend joins private lounge');
    G.send({ t: 'lp_set', pub: true, name: 'Geng G Terbuka' }); st = await E2.wait((m) => m.t === 'lp_state' && m.pub === true); ok(st.name === 'Geng G Terbuka', 'host changes name + visibility');
    /* reconnect grace keeps membership */
    E2.close(); await sleep(400); G.clear();
    const E3 = new Sock(U[4].token); await E3.open(); socks.push(E3);
    st = await E3.wait('lp_state', 3000); ok(st.code === pcode && st.members.length === 2, 'reconnect within grace keeps lounge membership');
    const eh = await E3.wait('lp_hist', 3000); ok(eh.msgs.length >= 1, 'history restored after reconnect');
    E3.close(); await sleep(2600); st = await G.wait((m) => m.t === 'lp_state' && m.members.length === 1, 3000).catch(() => null); ok(!!st, 'disconnected member removed after grace');
    /* blocked user cannot join */
    await api('POST', '/api/blocks', { userId: U[2].user.id, block: true }, U[6].token);
    C.send({ t: 'lp_join', code: pcode }); e = await C.wait('error', 3000); ok(e.code === 'lp_not_allowed', 'user blocked by host cannot join');
    /* validation */
    C.send({ t: 'lp_join', code: 'ZZZ' }); e = await C.wait('error', 3000); ok(e.code === 'lp_not_found', 'bad code rejected');
    C.send({ t: 'lp_join', code: 'abcdef' }); e = await C.wait('error', 3000); ok(e.code === 'lp_not_found', 'unknown lounge');
    /* game still works while in a lounge */
    B.send({ t: 'room_create', mode: 'classic', diff: 'easy' }); const rm = await B.wait('room', 5000); ok(rm && rm.code, 'can create a game room while in a lounge');
    B.send({ t: 'room_leave' }); await sleep(200);
    B.send({ t: 'lp_list' }); ls = await B.wait('lp_list'); ok(ls.rows.some((r) => r.code === code && r.mine), 'still in lounge after game room');
    /* empty lounge removed */
    G.send({ t: 'lp_leave' }); await G.wait('lp_closed'); await sleep(100);
    E2.close && 0; B.send({ t: 'lp_list' }); ls = await B.wait('lp_list'); ok(!ls.rows.some((r) => r.code === pcode), 'empty lounge removed');
  } catch (e) {
    fail++; results.push('FAIL exception: ' + e.stack);
  }
  socks.forEach((s) => s.close());
  srv.kill();
  fs.writeFileSync(path.join(__dirname, 'lounge-test-results.txt'), results.join('\n') + `\n\n${pass} passed, ${fail} failed\n`);
  console.log(results.join('\n')); console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) console.log('--- server log ---\n' + log.slice(-3000));
  process.exit(fail ? 1 : 0);
}
main();
