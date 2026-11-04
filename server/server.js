'use strict';
/* =====================================================================
   SUDOKU LEARNING ACADEMY – authoritative game server (v3.0)
   - Accounts (scrypt-hashed passwords + recovery codes, bearer sessions)
   - Server-side Elo (K=40 first 30 ranked games, then 20), 7 tiers
   - Ranked matchmaking (same mode + difficulty, ±100 window expanding)
   - Private rooms, friend invites, presence
   - Server-validated moves / mistakes / finish / forfeits
   - Emoji + quick-phrase relay (rate limited), WebRTC signalling relay
   - Leaderboards (global / country / region)
   ===================================================================== */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { WebSocketServer } = require('ws');
const DB = require('./db');

const VERSION = '4.4.0';
const PORT = +process.env.PORT || 8000;
const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const db = DB.open();
/* Matches still open from a previous server run can never finish (rooms live in memory): close them as void
   so they appear in history as "not finished" instead of disappearing. Elo and stats are not changed. */
try { const n = db.prepare("UPDATE matches SET result = 'void', reason = 'void', ended_at = ? WHERE ended_at IS NULL").run(Date.now()).changes; if (n) console.log('closed ' + n + ' unfinished match(es) as void'); } catch (e) { console.error('void matches', e.message); }
const GEO = JSON.parse(fs.readFileSync(path.join(SITE, 'geo.json'), 'utf8'));

/* Server clock. SLA_TEST_HOOKS=1 (automated tests only, never set in production) allows shifting it to test
   365-day flag locks, daily rollovers and streaks without waiting. */
const TEST_HOOKS = process.env.SLA_TEST_HOOKS === '1';
let CLOCK_OFF = 0;
const now = () => Date.now() + CLOCK_OFF;
let WCS = null; // WCS module (server/wcs.js), wired after the core is defined
let V44 = null; // v4.4 module (server/v44.js): bans, player reports, audit, coins, border shop
const DIFFS = ['easy', 'medium', 'hard', 'master', 'extreme'];
const KILLER_DIFFS = ['medium', 'hard'];
const MODES = ['classic', 'killer'];
const EMOJI_N = 8;
const PHRASES = ['ph_gl', 'ph_nice', 'ph_hurry', 'ph_great', 'ph_gg', 'ph_oops'];
const TIERS = [[2000, 'gm'], [1800, 'master'], [1600, 'diamond'], [1400, 'platinum'], [1200, 'gold'], [1000, 'silver'], [0, 'bronze']];
const MATCH_LIMIT_MS = 60 * 60 * 1000;
const RECONNECT_GRACE_MS = +process.env.SLA_GRACE_MS || 30000;
const LOBBY_GRACE_MS = +process.env.SLA_LOBBY_GRACE_MS || 15000;
const CHAT_GAP_MS = 1500;
const INVITE_MS = 60000;

/* ---------------- helpers ---------------- */
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function rcode(n) { const b = crypto.randomBytes(n); let s = ''; for (let i = 0; i < n; i++) s += ALPH[b[i] % 32]; return s; }
function roomCode() { const a = 'abcdefghijklmnopqrstuvwxyz0123456789', b = crypto.randomBytes(6); let s = ''; for (let i = 0; i < 6; i++) s += a[b[i] % 36]; return s; }
function flagEmoji(c) { c = String(c || '').toUpperCase(); if (!/^[A-Z]{2}$/.test(c)) return null; return String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65, 0x1F1E6 + c.charCodeAt(1) - 65); }
function tierOf(r) { for (const [m, k] of TIERS) if (r >= m) return k; return 'bronze'; }
function expected(a, b) { return 1 / (1 + Math.pow(10, (b - a) / 400)); }
function kFactor(games) { return games < 30 ? 40 : 20; }
function eloNew(r, opp, score, k) { return Math.max(100, Math.round(r + k * (score - expected(r, opp)))); }
const scryptAsync = (pw, salt, opts) => new Promise((res, rej) => crypto.scrypt(pw, salt, 32, opts, (e, k) => e ? rej(e) : res(k)));
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
async function hashSecret(secret) {
  const salt = crypto.randomBytes(16);
  const h = await scryptAsync(secret, salt, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), h.toString('base64')].join('$');
}
async function verifySecret(secret, stored) {
  try {
    const [alg, N, r, p, s, h] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const hh = await scryptAsync(secret, Buffer.from(s, 'base64'), { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem });
    const hb = Buffer.from(h, 'base64');
    return hb.length === hh.length && crypto.timingSafeEqual(hb, hh);
  } catch (e) { return false; }
}
let DUMMY_HASH = null; hashSecret('dummy-password-for-timing').then((h) => { DUMMY_HASH = h; });
const normRecovery = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function fmtRecovery(raw) { return raw.match(/.{1,5}/g).join('-'); }

/* rate limiting (in-memory, per key) */
const buckets = new Map();
function limited(key, max, windowMs) {
  const t = now(); let b = buckets.get(key);
  if (!b || t - b.s > windowMs) { b = { s: t, n: 0 }; buckets.set(key, b); }
  b.n++; return b.n > max;
}
setInterval(() => { const t = now(); for (const [k, b] of buckets) if (t - b.s > 3600000) buckets.delete(k); }, 60000).unref();

function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const vid = String(req.headers['x-visitor-id'] || '').slice(0, 80);
  return (xf || req.socket.remoteAddress || '?') + (vid ? '|' + vid : '');
}

/* ---------------- users / sessions ---------------- */
const Q = {
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  userByName: db.prepare('SELECT * FROM users WHERE username_lc = ?'),
  userByFriendCode: db.prepare('SELECT * FROM users WHERE friend_code = ?'),
  userByPlayerId: db.prepare('SELECT * FROM users WHERE player_id = ?'),
  insUser: db.prepare(`INSERT INTO users (username, username_lc, player_id, friend_code, pw_hash, recovery_hash, country, region, created_at, last_seen)
                       VALUES (@username, @username_lc, @player_id, @friend_code, @pw_hash, @recovery_hash, @country, @region, @created_at, @created_at)`),
  insSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used) VALUES (?, ?, ?, ?, ?)'),
  getSession: db.prepare('SELECT * FROM sessions WHERE token_hash = ?'),
  touchSession: db.prepare('UPDATE sessions SET last_used = ?, expires_at = ? WHERE token_hash = ?'),
  delSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  delUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
  trimSessions: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10)'),
  touchUser: db.prepare('UPDATE users SET last_seen = ? WHERE id = ?'),
  getAttempt: db.prepare('SELECT * FROM login_attempts WHERE k = ?'),
  setAttempt: db.prepare('INSERT INTO login_attempts (k, fails, first_at, locked_until) VALUES (@k, @fails, @first_at, @locked_until) ON CONFLICT(k) DO UPDATE SET fails = @fails, first_at = @first_at, locked_until = @locked_until'),
  clearAttempt: db.prepare('DELETE FROM login_attempts WHERE k = ?')
};

function pubUser(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, playerId: u.player_id, country: u.country || null, region: u.region || null,
    rating: u.rating, tier: tierOf(u.rating), games: u.games, wins: u.wins, losses: u.losses, draws: u.draws, peak: u.peak, avatar: u.avatar || null,
    flag: u.country ? flagEmoji(u.country) : null, titles: u.wcs_titles || 0, xp: u.xp || 0, streak: u.streak_cur || 0, border: u.border || 'none' };
}
function privUser(u) {
  const p = pubUser(u);
  return Object.assign(p, { friendCode: u.friend_code, casualGames: u.casual_games, casualWins: u.casual_wins, abandons: u.abandons,
    createdAt: u.created_at, k: kFactor(u.games), progressAt: u.progress_at || null, dmPolicy: u.dm_policy === 'friends' ? 'friends' : 'all',
    role: u.role === 'admin' ? 'admin' : 'player', coins: u.coins || 0, banned: V44 ? V44.publicBan(V44.banOf(u.id)) : null, streakBest: u.streak_best || 0, lastFlagChange: u.last_flag_change || null, nextFlagChange: u.next_flag_change || null });
}
function newSession(uid) {
  const tok = crypto.randomBytes(32).toString('base64url');
  Q.insSession.run(sha(tok), uid, now(), now() + 30 * 864e5, now());
  Q.trimSessions.run(uid, uid);
  return tok;
}
function authToken(tok) {
  if (typeof tok !== 'string' || tok.length < 20 || tok.length > 100) return null;
  const h = sha(tok), s = Q.getSession.get(h);
  if (!s || s.expires_at < now()) { if (s) Q.delSession.run(h); return null; }
  if (!s.last_used || now() - s.last_used > 3600000) Q.touchSession.run(now(), now() + 30 * 864e5, h);
  return Q.userById.get(s.user_id) || null;
}
function bearer(req) { const a = String(req.headers.authorization || ''); return a.startsWith('Bearer ') ? a.slice(7).trim() : ''; }

const USER_RE = /^[A-Za-z0-9_]{3,16}$/;
const RESERVED = /^(admin|administrator|root|system|moderator|mod|support|staff|sla|sudoku|null|undefined|server)$/i;
function checkPassword(pw) { return typeof pw === 'string' && pw.length >= 8 && pw.length <= 128 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw); }
function validGeo(c, r) {
  if (c === null || c === undefined || c === '') return { country: null, region: null };
  c = String(c).toUpperCase(); if (!/^[A-Z]{2}$/.test(c) || !GEO[c]) return null;
  if (r === null || r === undefined || r === '') return { country: c, region: null };
  r = String(r); if (!GEO[c][1].some((x) => x[0] === r)) return null;
  return { country: c, region: r };
}
function uniqueCode(fn, col) {
  for (let i = 0; i < 20; i++) { const c = fn(); if (!db.prepare(`SELECT 1 FROM users WHERE ${col} = ?`).get(c)) return c; }
  throw new Error('code space exhausted');
}

/* ---------------- HTTP ---------------- */
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  res.end(JSON.stringify(obj));
}
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = []; const lim = max || 96 * 1024;
    req.on('data', (c) => { size += c.length; if (size > lim) { reject(new Error('too_large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => { if (!chunks.length) return resolve({}); try { const o = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(o && typeof o === 'object' && !Array.isArray(o) ? o : {}); } catch (e) { reject(new Error('bad_json')); } });
    req.on('error', reject);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res, p) {
  let rel = decodeURIComponent(p.split('?')[0]); if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(SITE, rel));
  if (!file.startsWith(SITE + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (e, buf) => {
    if (e) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

const routes = [];
function route(method, pattern, auth, fn, opts) { routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), auth, fn, max: opts && opts.max }); }

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const i = u.pathname.indexOf('/api/');
  if (i < 0) return serveStatic(req, res, u.pathname);
  const p = u.pathname.slice(i);
  const ip = clientIp(req);
  if (limited('http:' + ip, +process.env.SLA_HTTP_LIMIT || 240, 60000)) return send(res, 429, { error: 'rate_limited' });
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(p); if (!m) continue;
    let user = null;
    if (r.auth === 'opt') user = authToken(bearer(req)) || null;
    else if (r.auth) { user = authToken(bearer(req)); if (!user) return send(res, 401, { error: 'unauthorized' }); }
    try {
      const body = req.method === 'GET' ? {} : await readBody(req, r.max);
      const out = await r.fn({ req, res, body, user, params: m.groups || {}, query: u.searchParams, ip });
      if (out !== undefined) { const isR = out && typeof out.status === 'number' && 'body' in out; send(res, isR ? out.status : 200, isR ? out.body : out); }
    } catch (e) {
      if (e.message === 'too_large' || e.message === 'bad_json') return send(res, 400, { error: e.message });
      console.error('route error', p, e); send(res, 400, { error: 'server_error' });
    }
    return;
  }
  send(res, 404, { error: 'not_found' });
});
const R = (status, body) => ({ status, body });

route('GET', '/api/health', false, () => ({ ok: true, version: VERSION, time: now(), online: clients.size, searching: queue.size, rooms: rooms.size, lounges: lounges.size, turn: turnConfigured() }));

route('POST', '/api/auth/register', false, async ({ body, ip }) => {
  if (limited('reg:' + ip, +process.env.SLA_REG_LIMIT || 10, 3600000)) return R(429, { error: 'rate_limited' });
  const username = String(body.username || '').trim();
  if (!USER_RE.test(username) || RESERVED.test(username)) return R(400, { error: 'bad_username' });
  if (!checkPassword(body.password)) return R(400, { error: 'weak_password' });
  const geo = validGeo(body.country, body.region); if (!geo) return R(400, { error: 'bad_geo' });
  if (Q.userByName.get(username.toLowerCase())) return R(409, { error: 'username_taken' });
  const recoveryRaw = rcode(20);
  const row = {
    username, username_lc: username.toLowerCase(),
    player_id: uniqueCode(() => 'SLA-' + rcode(4) + '-' + rcode(4), 'player_id'),
    friend_code: uniqueCode(() => rcode(4) + '-' + rcode(4), 'friend_code'),
    pw_hash: await hashSecret(body.password), recovery_hash: await hashSecret(recoveryRaw),
    country: geo.country, region: geo.region, created_at: now()
  };
  let id;
  try { id = Q.insUser.run(row).lastInsertRowid; } catch (e) { if (String(e.message).includes('UNIQUE')) return R(409, { error: 'username_taken' }); throw e; }
  if (geo.country) { db.prepare('UPDATE users SET country_flag = ? WHERE id = ?').run(flagEmoji(geo.country), id); db.prepare("INSERT INTO flag_change_history (user_id, old_code, new_code, kind, changed_at) VALUES (?, NULL, ?, 'initial', ?)").run(id, geo.country, now()); }
  try { if (WCS) WCS.loadAdmins(); if (V44) V44.welcome(id); } catch (e) { console.error('v44 register hook', e.message); }
  const u = Q.userById.get(id);
  return { token: newSession(u.id), user: privUser(u), recoveryCode: fmtRecovery(recoveryRaw) };
});

async function loginGate(ip, uname) {
  if (limited('login:' + ip, 20, 600000)) return 'rate_limited';
  const a = Q.getAttempt.get('u:' + uname);
  if (a && a.locked_until > now()) return 'locked';
  return null;
}
function loginFail(uname) {
  const k = 'u:' + uname, a = Q.getAttempt.get(k), t = now();
  let fails = 1, first = t;
  if (a && t - a.first_at < 15 * 60000) { fails = a.fails + 1; first = a.first_at; }
  Q.setAttempt.run({ k, fails, first_at: first, locked_until: fails >= 5 ? t + 15 * 60000 : 0 });
}
route('POST', '/api/auth/login', false, async ({ body, ip }) => {
  const uname = String(body.username || '').trim().toLowerCase();
  const gate = await loginGate(ip, uname); if (gate) return R(429, { error: gate });
  const u = USER_RE.test(uname) ? Q.userByName.get(uname) : null;
  const ok = await verifySecret(String(body.password || ''), u ? u.pw_hash : (DUMMY_HASH || 'x'));
  if (!u || !ok) { if (uname) loginFail(uname); return R(401, { error: 'bad_credentials' }); }
  Q.clearAttempt.run('u:' + uname);
  return { token: newSession(u.id), user: privUser(u) };
});
route('POST', '/api/auth/logout', true, ({ req }) => { Q.delSession.run(sha(bearer(req))); return { ok: true }; });
route('POST', '/api/auth/logout-all', true, ({ user }) => { Q.delUserSessions.run(user.id); kick(user.id); return { ok: true }; });

route('POST', '/api/auth/recover', false, async ({ body, ip }) => {
  const uname = String(body.username || '').trim().toLowerCase();
  const gate = await loginGate(ip, uname); if (gate) return R(429, { error: gate });
  if (!checkPassword(body.newPassword)) return R(400, { error: 'weak_password' });
  const u = USER_RE.test(uname) ? Q.userByName.get(uname) : null;
  const ok = await verifySecret(normRecovery(body.recoveryCode), u ? u.recovery_hash : (DUMMY_HASH || 'x'));
  if (!u || !ok) { if (uname) loginFail(uname); return R(401, { error: 'bad_recovery' }); }
  const recoveryRaw = rcode(20);
  db.prepare('UPDATE users SET pw_hash = ?, recovery_hash = ? WHERE id = ?').run(await hashSecret(body.newPassword), await hashSecret(recoveryRaw), u.id);
  Q.delUserSessions.run(u.id); kick(u.id); Q.clearAttempt.run('u:' + uname);
  return { token: newSession(u.id), user: privUser(Q.userById.get(u.id)), recoveryCode: fmtRecovery(recoveryRaw) };
});
route('POST', '/api/auth/password', true, async ({ body, user, req }) => {
  if (limited('pw:' + user.id, 5, 600000)) return R(429, { error: 'rate_limited' });
  if (!checkPassword(body.newPassword)) return R(400, { error: 'weak_password' });
  if (!(await verifySecret(String(body.oldPassword || ''), user.pw_hash))) return R(401, { error: 'bad_credentials' });
  db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').run(await hashSecret(body.newPassword), user.id);
  const keep = sha(bearer(req));
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(user.id, keep);
  return { ok: true };
});
route('POST', '/api/auth/recovery-code', true, async ({ body, user }) => {
  if (limited('rc:' + user.id, 5, 600000)) return R(429, { error: 'rate_limited' });
  if (!(await verifySecret(String(body.password || ''), user.pw_hash))) return R(401, { error: 'bad_credentials' });
  const raw = rcode(20);
  db.prepare('UPDATE users SET recovery_hash = ? WHERE id = ?').run(await hashSecret(raw), user.id);
  return { recoveryCode: fmtRecovery(raw) };
});

route('GET', '/api/me', true, ({ user }) => ({ user: privUser(user) }));
route('PATCH', '/api/me', true, ({ body, user }) => {
  const hasGeo = Object.prototype.hasOwnProperty.call(body, 'country'), hasDm = Object.prototype.hasOwnProperty.call(body, 'dmPolicy');
  if (!hasGeo && !hasDm) return R(400, { error: 'bad_request' });
  if (hasDm && body.dmPolicy !== 'all' && body.dmPolicy !== 'friends') return R(400, { error: 'bad_request' });
  let geo = null; if (hasGeo) { geo = validGeo(body.country, body.region); if (!geo) return R(400, { error: 'bad_geo' }); }
  if (geo) { const r = WCS.changeFlag(user, geo); if (r.error) return R(r.status || 403, r); }
  if (hasDm) db.prepare('UPDATE users SET dm_policy = ? WHERE id = ?').run(body.dmPolicy, user.id);
  const u = Q.userById.get(user.id); refreshClientUser(u);
  return { user: privUser(u) };
});
/* ---------- Profile avatar: preset (p01..p24) or uploaded image (re-encoded client-side, ≤ 48 KB) ---------- */
const AVATAR_PRESETS = 24, AVATAR_MAX = 48 * 1024;
function imageMime(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
const AV = {
  get: db.prepare('SELECT mime, data, updated_at FROM avatars WHERE user_id = ?'),
  put: db.prepare('INSERT INTO avatars (user_id, mime, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at'),
  del: db.prepare('DELETE FROM avatars WHERE user_id = ?'),
  set: db.prepare('UPDATE users SET avatar = ? WHERE id = ?')
};
route('PUT', '/api/me/avatar', true, ({ body, user }) => {
  if (limited('avatar:' + user.id, 12, 600000)) return R(429, { error: 'rate_limited' });
  let val = null;
  if (body.clear === true) { AV.del.run(user.id); val = null; }
  else if (typeof body.preset === 'string') {
    const m = /^p(\d{2})$/.exec(body.preset); const n = m ? Number(m[1]) : 0;
    if (n < 1 || n > AVATAR_PRESETS) return R(400, { error: 'bad_avatar' });
    AV.del.run(user.id); val = body.preset;
  } else if (typeof body.image === 'string') {
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(body.image);
    if (!m) return R(400, { error: 'bad_avatar' });
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > AVATAR_MAX) return R(400, { error: 'too_large' });
    const mime = imageMime(buf); if (!mime) return R(400, { error: 'bad_avatar' });
    const t = now(); AV.put.run(user.id, mime, buf, t); val = 'u:' + t;
  } else return R(400, { error: 'bad_avatar' });
  AV.set.run(val, user.id);
  const u = Q.userById.get(user.id); refreshClientUser(u);
  const room = roomOf(user.id); if (room) broadcastRoom(room);
  return { user: privUser(u) };
});
route('GET', '/api/avatar/:uid', false, ({ params, res }) => {
  const id = Number(params.uid); const a = Number.isInteger(id) && id > 0 ? AV.get.get(id) : null;
  if (!a) return R(404, { error: 'not_found' });
  res.writeHead(200, { 'Content-Type': a.mime, 'Content-Length': a.data.length, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': 'inline', 'Cross-Origin-Resource-Policy': 'cross-origin' });
  res.end(a.data);
});
route('GET', '/api/me/progress', true, ({ user }) => {
  const u = Q.userById.get(user.id);
  let data = null; try { data = u.progress_json ? JSON.parse(u.progress_json) : null; } catch (e) { data = null; }
  return { progress: data, at: u.progress_at || null };
});
route('PUT', '/api/me/progress', true, ({ body, user }) => {
  if (limited('prog:' + user.id, 20, 600000)) return R(429, { error: 'rate_limited' });
  const p = body.progress;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return R(400, { error: 'bad_progress' });
  const keep = {}; ['stats', 'settings'].forEach((k) => { if (p[k] && typeof p[k] === 'object') keep[k] = p[k]; });
  if (keep.settings) { delete keep.settings.turn; } // never store TURN secrets server-side
  const s = JSON.stringify(keep); if (s.length > 64 * 1024) return R(400, { error: 'too_large' });
  db.prepare('UPDATE users SET progress_json = ?, progress_at = ? WHERE id = ?').run(s, now(), user.id);
  return { ok: true, at: now() };
});

function matchRow(r, uid) {
  const me1 = r.p1 === uid, opp = Q.userById.get(me1 ? r.p2 : r.p1);
  const before = me1 ? r.p1_before : r.p2_before, after = me1 ? r.p1_after : r.p2_after;
  const res = r.result === 'void' ? 'V' : r.result === 'draw' ? 'D' : ((r.result === 'p1') === me1 ? 'W' : 'L');
  return { id: r.id, ranked: !!r.ranked, kind: r.kind || (r.ranked ? 'ranked' : 'custom'), mode: r.mode, difficulty: r.difficulty, puzzleId: r.puzzle_id, result: res, reason: r.reason,
    before, after, delta: (after != null && before != null) ? after - before : null, opp: opp ? { username: opp.username, playerId: opp.player_id, rating: me1 ? r.p2_before : r.p1_before, country: opp.country } : null,
    endedAt: r.ended_at, durationMs: r.duration_ms };
}
function historyFor(uid, page, size, rankedOnly) {
  const off = (page - 1) * size;
  const where = '(p1 = ? OR p2 = ?) AND ended_at IS NOT NULL' + (rankedOnly ? ' AND ranked = 1' : '');
  const total = db.prepare(`SELECT COUNT(*) n FROM matches WHERE ${where}`).get(uid, uid).n;
  const rows = db.prepare(`SELECT * FROM matches WHERE ${where} ORDER BY ended_at DESC LIMIT ? OFFSET ?`).all(uid, uid, size, off);
  return { total, page, size, rows: rows.map((r) => matchRow(r, uid)) };
}
route('GET', '/api/me/matches', true, ({ user, query }) => {
  const page = Math.max(1, Math.min(1000, parseInt(query.get('page'), 10) || 1));
  return historyFor(user.id, page, 10, query.get('ranked') === '1');
});
route('GET', '/api/players/:pid', true, ({ params }) => {
  const u = Q.userByPlayerId.get(String(params.pid).toUpperCase());
  if (!u) return R(404, { error: 'not_found' });
  const h = historyFor(u.id, 1, 5, true);
  return { player: Object.assign(pubUser(u), { status: statusOf(u.id) }), recent: h.rows.map((r) => ({ result: r.result, delta: r.delta, mode: r.mode, difficulty: r.difficulty, endedAt: r.endedAt })) };
});

/* ---------- leaderboard ---------- */
const SORTS = {
  rating: { expr: 'rating', order: 'rating DESC, wins DESC, id ASC' },
  wins: { expr: 'wins', order: 'wins DESC, rating DESC, id ASC' },
  winrate: { expr: '(wins * 1.0 / games)', order: '(wins * 1.0 / games) DESC, games DESC, id ASC' },
  games: { expr: 'games', order: 'games DESC, rating DESC, id ASC' }
};
/* All registered players are listed (v3.3). Players with at least one Ranked game come first and get a position;
   players without Ranked games are shown afterwards as "unranked" (no position, starting Elo). */
route('GET', '/api/leaderboard', 'opt', ({ user, query }) => {
  const scope = ['global', 'country', 'region', 'friends'].includes(query.get('scope')) ? query.get('scope') : 'global';
  const sort = SORTS[query.get('sort')] ? query.get('sort') : 'rating';
  const S = SORTS[sort];
  const size = Math.max(5, Math.min(50, parseInt(query.get('size'), 10) || 20));
  const page = Math.max(1, Math.min(10000, parseInt(query.get('page'), 10) || 1));
  const U0 = user || {};
  let country = String(query.get('country') || U0.country || '').toUpperCase();
  let region = String(query.get('region') || (country === U0.country ? U0.region : '') || '');
  const where = ['1 = 1'], args = [];
  const empty = (x) => Object.assign({ rows: [], total: 0, totalScope: 0, rankedScope: 0, page, size, scope, sort, country: null, region: null, me: null }, x);
  if (scope === 'friends') {
    if (!user) return empty({ needLogin: true });
    where.push('(id = ? OR id IN (SELECT friend_id FROM friendships WHERE user_id = ?))'); args.push(user.id, user.id);
  } else if (scope !== 'global') {
    if (!GEO[country]) return empty({ needGeo: true });
    where.push('country = ?'); args.push(country);
    if (scope === 'region') {
      if (!region || !GEO[country][1].some((x) => x[0] === region)) return empty({ country, needGeo: true });
      where.push('region = ?'); args.push(region);
    }
  }
  const scopeWhere = where.join(' AND '), scopeArgs = args.slice();
  const q = String(query.get('q') || '').trim().slice(0, 32);
  if (q) {
    const esc = q.replace(/[\\%_]/g, (c) => '\\' + c);
    where.push("(username_lc LIKE ? ESCAPE '\\' OR player_id = ?)"); args.push('%' + esc.toLowerCase() + '%', q.toUpperCase());
  }
  const W = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) n FROM users WHERE ${W}`).get(...args).n;
  const rows = db.prepare(`SELECT * FROM users WHERE ${W} ORDER BY (games > 0) DESC, ${S.order} LIMIT ? OFFSET ?`).all(...args, size, (page - 1) * size);
  const posStmt = db.prepare(`SELECT COUNT(*) n FROM users WHERE ${scopeWhere} AND games > 0 AND ${S.expr} > ?`);
  const val = (u) => sort === 'winrate' ? (u.games ? u.wins / u.games : 0) : u[sort];
  const pos = (u) => u.games > 0 ? posStmt.get(...scopeArgs, val(u)).n + 1 : null;
  const out = rows.map((u) => Object.assign(pubUser(u), { position: pos(u), ranked: u.games > 0, casualGames: u.casual_games, winRate: u.games ? Math.round(1000 * u.wins / u.games) / 10 : 0, online: clients.has(u.id), me: !!user && u.id === user.id, friend: !!user && u.id !== user.id && isFriend(user.id, u.id) }));
  const totalScope = db.prepare(`SELECT COUNT(*) n FROM users WHERE ${scopeWhere}`).get(...scopeArgs).n;
  const rankedScope = db.prepare(`SELECT COUNT(*) n FROM users WHERE ${scopeWhere} AND games > 0`).get(...scopeArgs).n;
  const base = { rows: out, total, totalScope, rankedScope, page, size, scope, sort, country: scope === 'global' || scope === 'friends' ? null : country, region: scope === 'region' ? region : null };
  if (!user) return Object.assign(base, { me: null });
  const me0 = Q.userById.get(user.id) || user;
  const inScope = scope === 'global' || scope === 'friends' || (me0.country === country && (scope === 'country' || me0.region === region));
  let me;
  if (inScope && me0.games > 0) me = { position: pos(me0), rating: me0.rating, winRate: Math.round(1000 * me0.wins / me0.games) / 10 };
  else me = { position: null, unranked: me0.games === 0, outOfScope: !inScope, rating: me0.rating };
  return Object.assign(base, { me });
});

/* ---------- friends ---------- */
const F = {
  isFriend: db.prepare('SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ?'),
  list: db.prepare('SELECT u.*, f.created_at since FROM friendships f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ? ORDER BY u.username_lc'),
  inReq: db.prepare('SELECT u.*, r.created_at at FROM friend_requests r JOIN users u ON u.id = r.from_id WHERE r.to_id = ? ORDER BY r.created_at DESC'),
  outReq: db.prepare('SELECT u.*, r.created_at at FROM friend_requests r JOIN users u ON u.id = r.to_id WHERE r.from_id = ? ORDER BY r.created_at DESC'),
  getReq: db.prepare('SELECT * FROM friend_requests WHERE from_id = ? AND to_id = ?'),
  addReq: db.prepare('INSERT OR IGNORE INTO friend_requests (from_id, to_id, created_at) VALUES (?, ?, ?)'),
  delReq: db.prepare('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?'),
  addF: db.prepare('INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)'),
  delF: db.prepare('DELETE FROM friendships WHERE user_id = ? AND friend_id = ?'),
  countOut: db.prepare('SELECT COUNT(*) n FROM friend_requests WHERE from_id = ?'),
  countF: db.prepare('SELECT COUNT(*) n FROM friendships WHERE user_id = ?')
};
const isFriend = (a, b) => !!F.isFriend.get(a, b);
function friendsPayload(uid) {
  return {
    friends: F.list.all(uid).map((u) => Object.assign(pubUser(u), { status: statusOf(u.id), since: u.since })),
    incoming: F.inReq.all(uid).map((u) => Object.assign(pubUser(u), { at: u.at })),
    outgoing: F.outReq.all(uid).map((u) => Object.assign(pubUser(u), { at: u.at }))
  };
}
const makeFriends = db.transaction((a, b) => { F.delReq.run(a, b); F.delReq.run(b, a); F.addF.run(a, b, now()); F.addF.run(b, a, now()); });
route('GET', '/api/friends', true, ({ user }) => friendsPayload(user.id));
route('POST', '/api/friends/request', true, ({ body, user }) => {
  if (limited('freq:' + user.id, 30, 3600000)) return R(429, { error: 'rate_limited' });
  let target = null;
  if (body.code) { const c = String(body.code).toUpperCase().replace(/[^A-Z0-9]/g, ''); if (c.length === 8) target = Q.userByFriendCode.get(c.slice(0, 4) + '-' + c.slice(4)); if (!target) return R(404, { error: 'not_found' }); }
  else if (Number.isInteger(body.userId)) { target = Q.userById.get(body.userId); if (!target || !clients.has(target.id)) return R(404, { error: 'not_found' }); }
  else return R(400, { error: 'bad_request' });
  if (target.id === user.id) return R(400, { error: 'self' });
  if (isFriend(user.id, target.id)) return R(409, { error: 'already' });
  if (F.getReq.get(target.id, user.id)) { makeFriends(user.id, target.id); pushFriends(target.id, 'accepted', user); pushFriends(user.id); return { ok: true, friends: true }; }
  if (F.countOut.get(user.id).n >= 30) return R(429, { error: 'too_many' });
  if (F.countF.get(user.id).n >= 200) return R(429, { error: 'too_many' });
  F.addReq.run(user.id, target.id, now());
  pushFriends(target.id, 'request', user);
  return { ok: true, pending: true, username: target.username };
});
route('POST', '/api/friends/respond', true, ({ body, user }) => {
  const from = Number(body.userId); if (!Number.isInteger(from)) return R(400, { error: 'bad_request' });
  if (!F.getReq.get(from, user.id)) return R(404, { error: 'not_found' });
  if (body.accept === true) { makeFriends(user.id, from); pushFriends(from, 'accepted', user); }
  else F.delReq.run(from, user.id);
  pushFriends(user.id);
  return friendsPayload(user.id);
});
route('POST', '/api/friends/cancel', true, ({ body, user }) => { F.delReq.run(user.id, Number(body.userId)); pushFriends(Number(body.userId)); return friendsPayload(user.id); });
route('POST', '/api/friends/remove', true, ({ body, user }) => {
  const f = Number(body.userId); F.delF.run(user.id, f); F.delF.run(f, user.id); pushFriends(f); return friendsPayload(user.id);
});
route('GET', '/api/online', true, ({ user }) => {
  const out = [];
  for (const [uid, c] of clients) { if (uid === user.id) continue; out.push(Object.assign(pubUser(c.user), { status: statusOf(uid), friend: isFriend(user.id, uid), pending: !!F.getReq.get(user.id, uid) })); if (out.length >= 60) break; }
  out.sort((a, b) => b.rating - a.rating);
  return { players: out, total: clients.size };
});

/* =====================================================================
   v3.3 Direct messages (any time, no lobby needed) + voice messages
   - Text is filtered on the server (same rules as room chat, max 500 chars)
   - Stickers / emoji are IDs only; voice clips are validated by magic bytes
   - Privacy: per-user policy (everyone / friends only) + blocking
   - Anti-spam: rate limits and max 5 messages to a non-friend until they reply
   ===================================================================== */
const DM_TEXT_MAX = 500, VOICE_MAX = 300 * 1024, VOICE_MAX_MS = 60500, VOICE_MIN_MS = 300, DM_FIRST_CONTACT = 5;
const DMQ = {
  ins: db.prepare('INSERT INTO dm_messages (from_id, to_id, kind, body, voice_id, cmid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  byId: db.prepare('SELECT * FROM dm_messages WHERE id = ?'),
  byCmid: db.prepare('SELECT * FROM dm_messages WHERE from_id = ? AND cmid = ? ORDER BY id DESC LIMIT 1'),
  page: db.prepare('SELECT * FROM dm_messages WHERE ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)) AND id < ? ORDER BY id DESC LIMIT ?'),
  convos: db.prepare(`SELECT peer, MAX(id) last FROM (SELECT to_id peer, id FROM dm_messages WHERE from_id = ? UNION ALL SELECT from_id peer, id FROM dm_messages WHERE to_id = ?) GROUP BY peer ORDER BY last DESC LIMIT 100`),
  unreadBy: db.prepare('SELECT from_id, COUNT(*) n FROM dm_messages WHERE to_id = ? AND read_at IS NULL GROUP BY from_id'),
  unreadTotal: db.prepare('SELECT COUNT(*) n FROM dm_messages WHERE to_id = ? AND read_at IS NULL AND from_id NOT IN (SELECT blocked_id FROM blocks WHERE user_id = ?)'),
  markRead: db.prepare('UPDATE dm_messages SET read_at = ? WHERE to_id = ? AND from_id = ? AND read_at IS NULL AND id <= ?'),
  sentTo: db.prepare('SELECT COUNT(*) n FROM dm_messages WHERE from_id = ? AND to_id = ?'),
  gotFrom: db.prepare('SELECT 1 FROM dm_messages WHERE from_id = ? AND to_id = ? LIMIT 1'),
  dayCount: db.prepare('SELECT COUNT(*) n FROM dm_messages WHERE from_id = ? AND created_at > ?')
};
const VC = {
  ins: db.prepare('INSERT INTO voice_clips (owner_id, mime, data, duration_ms, created_at) VALUES (?, ?, ?, ?, ?)'),
  get: db.prepare('SELECT * FROM voice_clips WHERE id = ?'),
  meta: db.prepare('SELECT id, owner_id, to_id, duration_ms, used_at, created_at FROM voice_clips WHERE id = ?'),
  use: db.prepare('UPDATE voice_clips SET to_id = ?, used_at = ? WHERE id = ? AND used_at IS NULL'),
  unused: db.prepare('SELECT COUNT(*) n FROM voice_clips WHERE owner_id = ? AND used_at IS NULL AND created_at > ?'),
  purgeUnused: db.prepare('DELETE FROM voice_clips WHERE used_at IS NULL AND created_at < ?'),
  purgeRoom: db.prepare('DELETE FROM voice_clips WHERE used_at IS NOT NULL AND created_at < ? AND id NOT IN (SELECT voice_id FROM dm_messages WHERE voice_id IS NOT NULL)')
};
const BL = {
  has: db.prepare('SELECT 1 FROM blocks WHERE user_id = ? AND blocked_id = ?'),
  add: db.prepare('INSERT OR IGNORE INTO blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?)'),
  del: db.prepare('DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?'),
  list: db.prepare('SELECT u.* FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.user_id = ? ORDER BY b.created_at DESC')
};
const blocked = (a, b) => !!BL.has.get(a, b);
function audioMime(buf) {
  if (buf.length > 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'audio/webm';
  if (buf.length > 4 && buf.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
  if (buf.length > 12 && buf.toString('ascii', 4, 8) === 'ftyp') return 'audio/mp4';
  return null;
}
/* A clip can be attached exactly once, by its owner, within one hour of upload. */
function useClip(id, owner, to) {
  if (!Number.isInteger(id) || id < 1) return null;
  const v = VC.meta.get(id);
  if (!v || v.owner_id !== owner || v.used_at || now() - v.created_at > 3600000) return null;
  if (VC.use.run(to, now(), id).changes !== 1) return null;
  return { id: v.id, dur: v.duration_ms };
}
function dmOut(r) {
  if (!r) return null;
  const o = { id: r.id, from: r.from_id, to: r.to_id, k: r.kind, at: r.created_at, readAt: r.read_at || null, cmid: r.cmid || null };
  if (r.kind === 'x' || r.kind === 's') o.v = r.body;
  else if (r.kind === 'e') o.v = Number(r.body);
  else if (r.kind === 'v') { const m = r.voice_id ? VC.meta.get(r.voice_id) : null; o.v = m ? { id: m.id, dur: m.duration_ms } : null; }
  return o;
}
/* Why `from` may not message `to` right now (null = allowed). */
function dmBlockReason(from, to) {
  if (!to) return 'not_found';
  if (from.id === to.id) return 'self';
  if (blocked(from.id, to.id)) return 'dm_you_blocked';
  if (blocked(to.id, from.id)) return 'dm_unavailable';
  const fr = isFriend(from.id, to.id);
  if (!fr && to.dm_policy === 'friends') return 'dm_friends_only';
  if (!fr && !DMQ.gotFrom.get(to.id, from.id) && DMQ.sentTo.get(from.id, to.id).n >= DM_FIRST_CONTACT) return 'dm_wait_reply';
  return null;
}
function h2h(a, b) {
  const rows = db.prepare('SELECT * FROM matches WHERE ((p1 = ? AND p2 = ?) OR (p1 = ? AND p2 = ?)) AND ended_at IS NOT NULL ORDER BY ended_at DESC').all(a, b, b, a);
  const o = { w: 0, l: 0, d: 0, total: 0, ranked: 0, recent: [] };
  rows.forEach((r) => { const m = matchRow(r, a); if (m.result === 'V') return; o.total++; if (r.ranked) o.ranked++; if (m.result === 'W') o.w++; else if (m.result === 'L') o.l++; else o.d++; });
  o.recent = rows.filter((r) => r.result !== 'void').slice(0, 5).map((r) => matchRow(r, a));
  return o;
}
function peerInfo(me, u) { return Object.assign(pubUser(u), { status: statusOf(u.id), friend: isFriend(me.id, u.id), blockedByMe: blocked(me.id, u.id), dmPolicy: u.dm_policy === 'friends' ? 'friends' : 'all' }); }
function pushUnread(uid) { if (clients.has(uid)) sendTo(uid, { t: 'dm_unread', n: DMQ.unreadTotal.get(uid, uid).n }); }

route('GET', '/api/users/find', true, ({ user, query }) => {
  if (limited('find:' + user.id, 60, 600000)) return R(429, { error: 'rate_limited' });
  const raw = String(query.get('q') || '').trim().slice(0, 32); if (!raw) return R(400, { error: 'bad_request' });
  const up = raw.toUpperCase(), compact = up.replace(/[^A-Z0-9]/g, '');
  let u = Q.userByPlayerId.get(up) || null;
  if (!u && compact.length === 8) u = Q.userByFriendCode.get(compact.slice(0, 4) + '-' + compact.slice(4)) || null;
  if (!u && USER_RE.test(raw)) u = Q.userByName.get(raw.toLowerCase()) || null;
  if (!u || u.id === user.id) return R(404, { error: 'not_found' });
  return { user: peerInfo(user, u) };
});
route('GET', '/api/dm', true, ({ user }) => {
  const unread = {}; DMQ.unreadBy.all(user.id).forEach((r) => { unread[r.from_id] = r.n; });
  const convos = DMQ.convos.all(user.id, user.id).map((c) => {
    const u = Q.userById.get(c.peer); if (!u) return null;
    return { peer: peerInfo(user, u), last: dmOut(DMQ.byId.get(c.last)), unread: blocked(user.id, u.id) ? 0 : (unread[u.id] || 0) };
  }).filter(Boolean);
  return { convos, unread: DMQ.unreadTotal.get(user.id, user.id).n };
});
route('GET', '/api/dm/:uid', true, ({ user, params, query }) => {
  const pid = Number(params.uid); const u = Number.isInteger(pid) ? Q.userById.get(pid) : null;
  if (!u || u.id === user.id) return R(404, { error: 'not_found' });
  const before = Math.max(1, parseInt(query.get('before'), 10) || Number.MAX_SAFE_INTEGER);
  const lim = Math.max(10, Math.min(60, parseInt(query.get('limit'), 10) || 40));
  const rows = DMQ.page.all(user.id, u.id, u.id, user.id, before, lim + 1);
  const more = rows.length > lim; const list = rows.slice(0, lim).reverse().map(dmOut);
  const why = dmBlockReason(user, u);
  return { peer: peerInfo(user, u), messages: list, more, canSend: !why, why, h2h: h2h(user.id, u.id) };
});
route('POST', '/api/dm/:uid', true, ({ user, params, body }) => {
  const pid = Number(params.uid); const u = Number.isInteger(pid) ? Q.userById.get(pid) : null;
  if (!u) return R(404, { error: 'not_found' });
  const cmid = typeof body.cmid === 'string' && /^[a-z0-9]{8}$/.test(body.cmid) ? body.cmid : null;
  if (cmid) { const dup = DMQ.byCmid.get(user.id, cmid); if (dup && dup.to_id === u.id) return { msg: dmOut(dup), dup: true }; }
  const why = dmBlockReason(user, u); if (why) return R(why === 'not_found' ? 404 : 403, { error: why });
  if (limited('dmgap:' + user.id, 1, 500) || limited('dmmin:' + user.id, 40, 60000)) return R(429, { error: 'chat_rate' });
  if (DMQ.dayCount.get(user.id, now() - 864e5).n >= 1500) return R(429, { error: 'chat_rate' });
  const k = body.k; let store = null, voice = null;
  if (k === 'x') { store = cleanChat(body.v, DM_TEXT_MAX); if (!store) return R(400, { error: 'chat_blocked' }); }
  else if (k === 's') { if (typeof body.v !== 'string' || !STICKER_RE.test(body.v)) return R(400, { error: 'chat_bad' }); store = body.v; }
  else if (k === 'e') { if (!Number.isInteger(body.v) || body.v < 0 || body.v >= EMOJI_N) return R(400, { error: 'chat_bad' }); store = String(body.v); }
  else if (k === 'v') { voice = useClip(body.v, user.id, u.id); if (!voice) return R(400, { error: 'voice_bad' }); }
  else return R(400, { error: 'chat_bad' });
  const info = DMQ.ins.run(user.id, u.id, k, store, voice ? voice.id : null, cmid, now());
  const msg = dmOut(DMQ.byId.get(info.lastInsertRowid));
  if (!blocked(u.id, user.id)) { sendTo(u.id, { t: 'dm', msg, from: peerInfo(u, Q.userById.get(user.id)) }); pushUnread(u.id); }
  return { msg };
});
route('POST', '/api/dm/:uid/read', true, ({ user, params, body }) => {
  const pid = Number(params.uid); const u = Number.isInteger(pid) ? Q.userById.get(pid) : null;
  if (!u) return R(404, { error: 'not_found' });
  const upTo = Number.isInteger(body.upTo) && body.upTo > 0 ? body.upTo : Number.MAX_SAFE_INTEGER;
  const t = now(); const ch = DMQ.markRead.run(t, user.id, u.id, upTo).changes;
  if (ch) { if (!blocked(user.id, u.id)) sendTo(u.id, { t: 'dm_read', by: user.id, upTo, at: t }); pushUnread(user.id); }
  return { ok: true, marked: ch, unread: DMQ.unreadTotal.get(user.id, user.id).n };
});
route('GET', '/api/blocks', true, ({ user }) => ({ blocked: BL.list.all(user.id).map(pubUser) }));
route('POST', '/api/blocks', true, ({ user, body }) => {
  const id = Number(body.userId); const u = Number.isInteger(id) ? Q.userById.get(id) : null;
  if (!u || u.id === user.id) return R(404, { error: 'not_found' });
  if (body.block === true) BL.add.run(user.id, u.id, now()); else BL.del.run(user.id, u.id);
  pushUnread(user.id);
  return { ok: true, blocked: blocked(user.id, u.id) };
});
route('POST', '/api/voice', true, ({ user, body }) => {
  if (limited('voice:' + user.id, 30, 600000)) return R(429, { error: 'rate_limited' });
  if (VC.unused.get(user.id, now() - 3600000).n >= 10) return R(429, { error: 'rate_limited' });
  const m = typeof body.audio === 'string' ? /^data:audio\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*;base64,([A-Za-z0-9+/=]+)$/i.exec(body.audio) : null;
  if (!m) return R(400, { error: 'voice_bad' });
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length < 200) return R(400, { error: 'voice_bad' });
  if (buf.length > VOICE_MAX) return R(400, { error: 'too_large' });
  const mime = audioMime(buf); if (!mime) return R(400, { error: 'voice_bad' });
  const dur = Number(body.durationMs); if (!Number.isInteger(dur) || dur < VOICE_MIN_MS || dur > VOICE_MAX_MS) return R(400, { error: 'voice_bad' });
  const info = VC.ins.run(user.id, mime, buf, dur, now());
  return { id: Number(info.lastInsertRowid), durationMs: dur };
}, { max: 450 * 1024 });
route('GET', '/api/voice/:id', true, ({ user, params, res }) => {
  const id = Number(params.id); const v = Number.isInteger(id) && id > 0 ? VC.get.get(id) : null;
  if (!v || (v.owner_id !== user.id && v.to_id !== user.id && !(v.to_id == null && loungeClips.has(v.id) && loungeClips.get(v.id).has(user.id)))) return R(404, { error: 'not_found' });
  res.writeHead(200, { 'Content-Type': v.mime, 'Content-Length': v.data.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': 'inline' });
  res.end(v.data);
});
setInterval(() => { try { VC.purgeUnused.run(now() - 3600000); VC.purgeRoom.run(now() - 7 * 864e5); } catch (e) { console.error('voice purge', e.message); } }, 3600000).unref();

/* ---------- ICE (STUN + optional TURN from environment, never from source) ---------- */
function turnConfigured() { return !!(process.env.TURN_URLS && (process.env.TURN_SECRET || process.env.TURN_USERNAME)); }
route('GET', '/api/ice', true, ({ user }) => {
  const l = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }];
  const urls = String(process.env.TURN_URLS || '').split(/[\s,]+/).filter((x) => /^turns?:/.test(x));
  if (urls.length && process.env.TURN_SECRET) {
    const username = (Math.floor(now() / 1000) + 6 * 3600) + ':' + user.id;
    l.push({ urls, username, credential: crypto.createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64') });
  } else if (urls.length && process.env.TURN_USERNAME) l.push({ urls, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL || '' });
  return { iceServers: l, turn: l.length > 2 };
});

/* =====================================================================
   Real-time hub
   ===================================================================== */
const clients = new Map();   // uid -> { ws, user, bucket }
const queue = new Map();     // uid -> { uid, mode, diff, rating, since }
const rooms = new Map();     // code -> room
const userRoom = new Map();  // uid -> code
const discTimers = new Map();// uid -> timeout

function sendTo(uid, obj) { const c = clients.get(uid); if (c && c.ws.readyState === 1) c.ws.send(JSON.stringify(obj)); }
function kick(uid) { const c = clients.get(uid); if (c) { try { c.ws.send(JSON.stringify({ t: 'session_end' })); c.ws.close(4001, 'session'); } catch (e) { } } }
function refreshClientUser(u) { const c = clients.get(u.id); if (c) { c.user = u; sendTo(u.id, { t: 'me', user: privUser(u) }); } }
function roomOf(uid) { const c = userRoom.get(uid); return c ? rooms.get(c) : null; }
function other(room, uid) { return room.players.find((p) => p !== uid); }
function statusOf(uid) {
  if (!clients.has(uid) && !userRoom.has(uid)) return 'offline';
  const r = roomOf(uid);
  if (r) return (r.phase === 'match' || r.phase === 'countdown' || r.phase === 'generating') ? 'playing' : 'lobby';
  if (queue.has(uid)) return 'searching';
  return clients.has(uid) ? 'online' : 'offline';
}
const lastStatus = new Map();
function presence(uid) {
  const s = statusOf(uid); if (lastStatus.get(uid) === s) return; lastStatus.set(uid, s);
  for (const f of F.list.all(uid)) if (clients.has(f.id)) sendTo(f.id, { t: 'presence', uid, status: s });
}
function pushFriends(uid, kind, fromUser) { if (!clients.has(uid)) return; sendTo(uid, Object.assign({ t: 'friends', kind: kind || null, from: fromUser ? { username: fromUser.username } : null }, friendsPayload(uid))); }

/* ---------- puzzle worker pool ---------- */
const pool = []; let jobSeq = 0; const jobs = new Map();
function spawnWorker() {
  const w = new Worker(path.join(__dirname, 'worker.js'));
  w.busy = 0;
  w.on('message', (m) => { const j = jobs.get(m.id); if (!j) return; jobs.delete(m.id); w.busy--; clearTimeout(j.to); m.ok ? j.res(m.res) : j.rej(new Error(m.err)); });
  w.on('error', (e) => { console.error('worker error', e); });
  w.on('exit', () => { const i = pool.indexOf(w); if (i >= 0) pool.splice(i, 1); for (const [id, j] of jobs) if (j.w === w) { jobs.delete(id); j.rej(new Error('worker_exit')); } setTimeout(() => pool.push(spawnWorker()), 500); });
  return w;
}
for (let i = 0; i < 2; i++) pool.push(spawnWorker());
function generate(mode, diff, opts) {
  return new Promise((res, rej) => {
    const w = pool.slice().sort((a, b) => a.busy - b.busy)[0]; if (!w) return rej(new Error('no_worker'));
    const id = ++jobSeq; w.busy++;
    const to = setTimeout(() => { if (jobs.has(id)) { jobs.delete(id); w.busy--; rej(new Error('timeout')); } }, 25000);
    jobs.set(id, { res, rej, to, w }); w.postMessage(Object.assign({ id, mode, diff }, opts || {}));
  });
}

/* ---------- rooms ---------- */
function miniUser(uid) { const c = clients.get(uid); const u = c ? c.user : Q.userById.get(uid); return u ? { uid: u.id, username: u.username, playerId: u.player_id, rating: u.rating, tier: tierOf(u.rating), country: u.country, games: u.games, avatar: u.avatar || null, border: u.border || 'none' } : null; }
function newRoom(opts) {
  let code; do { code = roomCode(); } while (rooms.has(code));
  const room = { code, ranked: !!opts.ranked, kind: opts.kind || (opts.ranked ? 'ranked' : 'custom'), season: opts.season || null, ko: opts.ko || null, mode: opts.mode, diff: opts.diff, host: opts.host, players: [opts.host], ready: {}, mic: {}, phase: 'lobby', invited: opts.invited || null, match: null, rematch: {}, createdAt: now(), touched: now() };
  rooms.set(code, room); userRoom.set(opts.host, code);
  return room;
}
function roomState(room, uid) {
  const opp = other(room, uid), M = room.match;
  return { t: 'room', code: room.code, ranked: room.ranked, mode: room.mode, diff: room.diff, phase: room.phase, role: room.host === uid ? 'host' : 'guest',
    me: Object.assign(miniUser(uid) || {}, { ready: !!room.ready[uid] }), opp: opp ? Object.assign(miniUser(opp) || {}, { ready: !!room.ready[opp], connected: clients.has(opp), mic: room.mic[opp] || 'off' }) : null,
    invited: room.invited ? (miniUser(room.invited) || null) : null, mid: M ? M.mid : null, kind: room.kind,
    rated: M ? !!M.rated : (room.kind === 'ranked' || (room.kind === 'custom' && !!opp && customRatedLeft(uid, opp) > 0)),
    ratedLeft: room.kind === 'custom' && opp ? customRatedLeft(uid, opp) : null, wcs: room.kind === 'wcs_q' || room.kind === 'wcs_ko' };
}
function broadcastRoom(room) { room.players.forEach((p) => sendTo(p, roomState(room, p))); room.players.forEach(presence); }
function matchSnapshot(room, uid) {
  const M = room.match; if (!M) return null; const opp = other(room, uid);
  return { t: 'match', mid: M.mid, mode: M.mode, diff: M.diff, wanted: M.wanted, pid: M.pid, puzzle: M.puzzle.join(''), cages: M.cages, values: M.values[uid].join(''), wrong: M.values[uid].map((v, i) => (v && v !== M.solution[i]) ? '1' : '0').join(''), mistakes: M.mistakes[uid],
    elapsed: elapsed(M), startIn: Math.max(0, M.startAt - now()), over: M.over, pausedBy: M.pausedBy, pausesLeft: M.pausesLeft[uid], oppProgress: progress(M, opp), oppMistakes: M.mistakes[opp], ranked: room.ranked, rated: !!M.rated, kind: room.kind };
}
function elapsed(M) { const t = M.over ? M.endedAt : now(); return Math.max(0, t - M.startAt - M.pausedTotal - (M.pausedBy && !M.over ? t - M.pauseAt : 0)); }
function progress(M, uid) { if (!uid || !M.values[uid]) return 0; let e = 0, ok = 0; for (let i = 0; i < 81; i++) if (!M.puzzle[i]) { e++; if (M.values[uid][i] === M.solution[i]) ok++; } return Math.round(100 * ok / Math.max(1, e)); }
function solvedBy(M, uid) { const v = M.values[uid]; for (let i = 0; i < 81; i++) if (v[i] !== M.solution[i]) return false; return true; }

const insMatch = db.prepare(`INSERT INTO matches (id, ranked, kind, season_id, ko_id, mode, difficulty, puzzle_id, puzzle, p1, p2, p1_before, p2_before, started_at) VALUES (@id, @ranked, @kind, @season_id, @ko_id, @mode, @difficulty, @puzzle_id, @puzzle, @p1, @p2, @p1_before, @p2_before, @started_at)`);
/* v4 Custom Room Elo: private rooms and friend invites are now Elo-rated with the SAME formula and K as Ranked.
   Anti-farming: at most CUSTOM_PAIR_CAP rated games per pair of accounts per rolling 24 h; later games are casual. */
const CUSTOM_PAIR_CAP = +process.env.SLA_CUSTOM_PAIR_CAP || 5;
const pairRatedQ = db.prepare(`SELECT COUNT(*) n FROM matches WHERE kind = 'custom' AND ranked = 1 AND started_at > ? AND ((p1 = ? AND p2 = ?) OR (p1 = ? AND p2 = ?)) AND (result IS NULL OR result != 'void')`);
function customRatedLeft(a, b) { return Math.max(0, CUSTOM_PAIR_CAP - pairRatedQ.get(now() - 864e5, a, b, b, a).n); }

function startMatch(room) {
  if (room.players.length !== 2 || room.phase !== 'lobby') return;
  /* v4.4: a banned player can never start a competitive match, whatever path led here */
  const banned = V44 ? room.players.filter((p) => V44.banOf(p)) : [];
  if (banned.length) { banned.forEach((p) => V44.gate(p)); room.players.forEach((p) => { if (!banned.includes(p)) sendTo(p, { t: 'match_void', why: 'opp_banned' }); }); closeRoom(room, 'void_ban'); return; }
  room.phase = 'generating'; broadcastRoom(room);
  const gen = room.genSeq = (room.genSeq || 0) + 1;
  const strict = room.kind === 'wcs_q' || room.kind === 'wcs_ko';
  generate(room.mode, strict ? 'extreme' : room.diff, strict ? { strict: true } : null).then((P) => {
    if (strict && (P.difficulty !== 'extreme' || P.mode !== 'classic')) throw new Error('wcs_not_extreme');
    if (room.genSeq !== gen || room.phase !== 'generating' || room.players.length !== 2 || !rooms.has(room.code)) return;
    const [a, b] = room.players, ua = Q.userById.get(a), ub = Q.userById.get(b);
    const rated = room.kind === 'ranked' || (room.kind === 'custom' && customRatedLeft(a, b) > 0);
    if (room.kind === 'custom' && !rated) WCS.acLog(null, 'custom_pair_cap', { a, b, cap: CUSTOM_PAIR_CAP }, room.code);
    const M = { rated, kind: room.kind, mid: crypto.randomUUID(), mode: P.mode, diff: P.difficulty, wanted: P.wanted, pid: P.pid, seed: P.seed, puzzle: P.puzzle, solution: P.solution, cages: P.cages,
      values: { [a]: P.puzzle.slice(), [b]: P.puzzle.slice() }, mistakes: { [a]: 0, [b]: 0 }, pausesLeft: { [a]: room.ranked ? 0 : 3, [b]: room.ranked ? 0 : 3 },
      startAt: now() + 3200, pausedBy: null, pauseAt: 0, pausedTotal: 0, over: false, disc: {}, p1: a, p2: b, before: { [a]: ua.rating, [b]: ub.rating } };
    insMatch.run({ id: M.mid, ranked: rated ? 1 : 0, kind: room.kind, season_id: room.season, ko_id: room.ko, mode: M.mode, difficulty: M.diff, puzzle_id: M.pid, puzzle: M.puzzle.join(''), p1: a, p2: b, p1_before: ua.rating, p2_before: ub.rating, started_at: now() });
    room.match = M; room.phase = 'countdown'; room.rematch = {};
    broadcastRoom(room);
    room.players.forEach((p) => sendTo(p, Object.assign(matchSnapshot(room, p), { t: 'countdown' })));
    setTimeout(() => { if (room.match === M && room.phase === 'countdown') { room.phase = 'match'; broadcastRoom(room); room.players.forEach((p) => sendTo(p, { t: 'go', mid: M.mid })); } }, 3200);
  }).catch((e) => {
    console.error('generate failed', e.message);
    if (room.genSeq !== gen) return;
    room.phase = 'lobby'; room.ready = {}; broadcastRoom(room);
    room.players.forEach((p) => sendTo(p, { t: 'error', code: 'gen_failed' }));
    if (room.ranked) closeRoom(room, 'gen_failed');
  });
  if (WCS && room.kind === 'wcs_ko') WCS.koLive(room);
}

const finishTx = db.transaction((room, winner, reason) => {
  const M = room.match, a = M.p1, b = M.p2;
  const row = db.prepare('SELECT ended_at FROM matches WHERE id = ?').get(M.mid);
  if (!row || row.ended_at) return null; // duplicate result protection
  const ua = Q.userById.get(a), ub = Q.userById.get(b);
  const res = winner === a ? 'p1' : winner === b ? 'p2' : 'draw';
  let after = { [a]: ua.rating, [b]: ub.rating }, k = { [a]: null, [b]: null };
  let wcs = null;
  if (M.rated) {
    k[a] = kFactor(ua.games); k[b] = kFactor(ub.games);
    const sa = res === 'p1' ? 1 : res === 'draw' ? 0.5 : 0;
    after[a] = eloNew(ua.rating, ub.rating, sa, k[a]); after[b] = eloNew(ub.rating, ua.rating, 1 - sa, k[b]);
    const tx = db.prepare('INSERT INTO elo_transactions (user_id, match_id, kind, before, after, delta, k, score, expected, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    tx.run(a, M.mid, room.kind, ua.rating, after[a], after[a] - ua.rating, k[a], sa, expected(ua.rating, ub.rating), now());
    tx.run(b, M.mid, room.kind, ub.rating, after[b], after[b] - ub.rating, k[b], 1 - sa, expected(ub.rating, ua.rating), now());
    const upd = db.prepare(`UPDATE users SET rating = ?, peak = MAX(peak, ?), games = games + 1, wins = wins + ?, losses = losses + ?, draws = draws + ?, abandons = abandons + ? WHERE id = ?`);
    upd.run(after[a], after[a], res === 'p1' ? 1 : 0, res === 'p2' ? 1 : 0, res === 'draw' ? 1 : 0, reason === 'left' && res === 'p2' ? 1 : 0, a);
    upd.run(after[b], after[b], res === 'p2' ? 1 : 0, res === 'p1' ? 1 : 0, res === 'draw' ? 1 : 0, reason === 'left' && res === 'p1' ? 1 : 0, b);
  } else if (room.kind === 'wcs_q' || room.kind === 'wcs_ko') {
    wcs = WCS.onMatchFinished(room, M, res, reason, elapsed(M));
  } else {
    const upd = db.prepare('UPDATE users SET casual_games = casual_games + 1, casual_wins = casual_wins + ? WHERE id = ?');
    upd.run(res === 'p1' ? 1 : 0, a); upd.run(res === 'p2' ? 1 : 0, b);
  }
  if (reason === 'finish' && winner) WCS.activity(winner, 'match', M.mid);
  db.prepare(`UPDATE matches SET result = ?, reason = ?, p1_before = ?, p1_after = ?, p2_before = ?, p2_after = ?, p1_k = ?, p2_k = ?, p1_mistakes = ?, p2_mistakes = ?, ended_at = ?, duration_ms = ? WHERE id = ?`)
    .run(res, reason, ua.rating, after[a], ub.rating, after[b], k[a], k[b], M.mistakes[a], M.mistakes[b], now(), elapsed(M), M.mid);
  if (M.rated && reason === 'surrender' && elapsed(M) < 30000) WCS.acLog(res === 'p1' ? b : a, 'quick_surrender', { mid: M.mid, ms: elapsed(M), kind: room.kind }, M.mid);
  const coins = V44 ? V44.matchCoins(room, M, res, reason, elapsed(M)) : {};
  return { res, before: { [a]: ua.rating, [b]: ub.rating }, after, k, wcs, coins };
});
function endMatch(room, winner, reason) {
  const M = room.match; if (!M || M.over) return;
  if (M.pausedBy) { M.pausedTotal += now() - M.pauseAt; M.pausedBy = null; }
  M.endedAt = now();
  const out = finishTx(room, winner, reason);
  M.over = true; room.phase = 'result'; room.ready = {}; room.rematch = {};
  if (!out) return;
  room.players.concat(Object.keys(M.values).map(Number)).filter((v, i, a) => a.indexOf(v) === i).forEach((uid) => {
    const opp = uid === M.p1 ? M.p2 : M.p1, u = Q.userById.get(uid);
    const c = clients.get(uid); if (c && u) c.user = u;
    sendTo(uid, { t: 'result', mid: M.mid, winner: winner || null, draw: !winner, reason, elapsed: elapsed(M), ranked: room.ranked, rated: !!M.rated, kind: room.kind,
      wcs: out.wcs ? WCS.resultFor(out.wcs, uid) : null,
      elo: M.rated ? { before: out.before[uid], after: out.after[uid], delta: out.after[uid] - out.before[uid], k: out.k[uid], oppBefore: out.before[opp], oppAfter: out.after[opp] } : null,
      coins: out.coins && out.coins[uid] != null ? out.coins[uid] : null,
      user: u ? privUser(u) : null, solution: M.solution.join('') });
  });
  broadcastRoom(room);
  if (out.wcs) WCS.afterFinish(out.wcs);
}
function removeFromRoom(room, uid) {
  room.players = room.players.filter((p) => p !== uid); delete room.ready[uid]; delete room.mic[uid];
  if (userRoom.get(uid) === room.code) userRoom.delete(uid);
  clearTimeout(discTimers.get(uid)); discTimers.delete(uid);
  presence(uid);
}
function closeRoom(room, why) {
  room.players.slice().forEach((p) => { sendTo(p, { t: 'room_closed', code: room.code, why }); removeFromRoom(room, p); });
  rooms.delete(room.code);
}
function leaveRoom(uid, why) {
  const room = roomOf(uid); if (!room) return;
  const opp = other(room, uid);
  if (room.match && !room.match.over && (room.phase === 'match' || room.phase === 'countdown')) endMatch(room, opp || null, 'left');
  if (room.phase === 'generating') { room.genSeq++; room.phase = 'lobby'; }
  removeFromRoom(room, uid);
  if (!room.players.length) { rooms.delete(room.code); return; }
  if (room.ranked || room.invited) { closeRoom(room, 'opp_left'); return; }
  room.host = room.players[0]; room.ready = {}; room.phase = room.phase === 'result' ? 'result' : 'lobby';
  if (room.phase === 'result') { closeRoom(room, 'opp_left'); return; }
  sendTo(room.host, { t: 'opp_left' });
  broadcastRoom(room);
}

/* ---------- matchmaking ---------- */
function mmWindow(e) { return Math.min(800, 100 + 50 * Math.floor((now() - e.since) / 5000)); }
function mmStatus(uid) {
  const e = queue.get(uid);
  if (!e) return sendTo(uid, { t: 'mm', searching: false });
  let pool = 0; for (const x of queue.values()) if (x.mode === e.mode && x.diff === e.diff) pool++;
  sendTo(uid, { t: 'mm', searching: true, mode: e.mode, diff: e.diff, window: mmWindow(e), waited: now() - e.since, pool: pool - 1 });
}
function mmTick() {
  const arr = [...queue.values()].sort((a, b) => a.since - b.since), used = new Set();
  for (const a of arr) {
    if (used.has(a.uid)) continue;
    let best = null, bd = Infinity;
    for (const b of arr) {
      if (b.uid === a.uid || used.has(b.uid) || b.mode !== a.mode || b.diff !== a.diff) continue;
      const d = Math.abs(a.rating - b.rating);
      if (d <= Math.min(mmWindow(a), mmWindow(b)) && d < bd) { bd = d; best = b; }
    }
    if (!best) continue;
    if (!clients.has(a.uid) || !clients.has(best.uid) || userRoom.has(a.uid) || userRoom.has(best.uid)) { if (!clients.has(a.uid)) queue.delete(a.uid); if (!clients.has(best.uid)) queue.delete(best.uid); continue; }
    used.add(a.uid); used.add(best.uid); queue.delete(a.uid); queue.delete(best.uid);
    const room = newRoom({ ranked: true, mode: a.mode, diff: a.diff, host: a.uid });
    room.players.push(best.uid); userRoom.set(best.uid, room.code);
    room.ready[a.uid] = room.ready[best.uid] = true;
    [a.uid, best.uid].forEach((p) => sendTo(p, { t: 'mm_found', opp: miniUser(other(room, p)), mode: room.mode, diff: room.diff }));
    broadcastRoom(room);
    startMatch(room);
  }
  for (const e of queue.values()) mmStatus(e.uid);
}

/* ---------- periodic housekeeping ---------- */
setInterval(() => {
  try {
    mmTick();
    const t = now();
    for (const room of rooms.values()) {
      const M = room.match;
      if (M && !M.over && room.phase === 'match') {
        if (M.pausedBy && t - M.pauseAt > 60000) { M.pausedTotal += t - M.pauseAt; M.pausedBy = null; room.players.forEach((p) => sendTo(p, { t: 'paused', by: null, elapsed: elapsed(M) })); }
        if (elapsed(M) > MATCH_LIMIT_MS) {
          const [a, b] = [M.p1, M.p2], pa = progress(M, a), pb = progress(M, b);
          endMatch(room, pa === pb ? null : (pa > pb ? a : b), 'time');
        }
      }
      if (room.phase === 'lobby' && t - room.touched > 30 * 60000) closeRoom(room, 'idle');
      if (room.phase === 'result' && t - (M ? M.endedAt : room.touched) > 15 * 60000) closeRoom(room, 'idle');
    }
  } catch (e) { console.error('tick', e); }
}, 1000).unref();

/* ---------- v3.4 Lepak (hang-out) rooms: chat only, no game, max 5 players ----------
   - Lives in memory like game rooms (a server restart closes them). Independent of game rooms,
     so a player can hang out and still play a match.
   - Public lounges are listed for everyone logged in; private ones need an invite from a member
     or friendship with the host (the code alone is not enough).
   - Text is filtered with the same server rules as DMs; stickers/emoji are IDs; voice clips are
     owner-uploaded and playable only by members present when they were sent. */
const LOUNGE_MAX = 5, LOUNGE_HIST = 60, LOUNGE_IDLE_MS = 2 * 3600000, LOUNGE_GRACE_MS = +process.env.SLA_LOUNGE_GRACE_MS || 60000, LOUNGE_TEXT_MAX = 300;
const lounges = new Map();     // code -> lounge
const userLounge = new Map();  // uid -> code
const loungeDisc = new Map();  // uid -> timeout
const loungeClips = new Map(); // voice clip id -> Set(uid) allowed to play
function loungeOf(uid) { const c = userLounge.get(uid); return c ? lounges.get(c) : null; }
function loungeMember(uid) { const u = miniUser(uid); return u ? { uid: u.uid, username: u.username, playerId: u.playerId, avatar: u.avatar, country: u.country, rating: u.rating, on: clients.has(uid) } : null; }
function loungeState(L) { return { t: 'lp_state', code: L.code, name: L.name, pub: L.pub, host: L.host, max: LOUNGE_MAX, members: L.members.map(loungeMember).filter(Boolean), createdAt: L.createdAt }; }
function loungeCast(L, obj, except) { L.members.forEach((p) => { if (p !== except) sendTo(p, obj); }); }
function loungeSys(L, ev, who, extra) {
  const m = Object.assign({ id: ++L.seq, sys: ev, who: who ? { uid: who.id || who.uid, username: who.username } : null, at: now() }, extra || {});
  m.seen = new Set(L.members); L.msgs.push(m); if (L.msgs.length > LOUNGE_HIST) L.msgs.shift();
  loungeCast(L, { t: 'lp_msg', msg: loungeOut(m) });
}
function loungeOut(m) { const o = Object.assign({}, m); delete o.seen; return o; }
function loungeHistory(L, uid) { return L.msgs.filter((m) => m.seen.has(uid)).map(loungeOut); }
function canJoinLounge(L, u) {
  if (L.members.includes(u.id)) return null;
  if (L.members.length >= LOUNGE_MAX) return 'lp_full';
  if (blocked(L.host, u.id) || blocked(u.id, L.host)) return 'lp_not_allowed';
  if (L.banned.has(u.id)) return 'lp_not_allowed';
  if (!L.pub && !L.invited.has(u.id) && !isFriend(L.host, u.id)) return 'lp_private';
  return null;
}
function leaveLounge(uid, why) {
  const L = loungeOf(uid); clearTimeout(loungeDisc.get(uid)); loungeDisc.delete(uid);
  if (!L) return;
  const u = Q.userById.get(uid);
  L.members = L.members.filter((p) => p !== uid); userLounge.delete(uid);
  if (!L.members.length) { lounges.delete(L.code); return; }
  if (L.host === uid) L.host = L.members[0];
  loungeSys(L, why === 'kick' ? 'kick' : 'leave', u, why === 'kick' ? null : (L.host !== uid ? { host: L.host } : null));
  loungeCast(L, loungeState(L));
}
function joinLounge(L, uid) {
  const prev = loungeOf(uid); if (prev && prev !== L) { leaveLounge(uid, 'leave'); sendTo(uid, { t: 'lp_closed', code: prev.code, why: 'self' }); }
  if (!L.members.includes(uid)) { L.members.push(uid); userLounge.set(uid, L.code); L.invited.delete(uid); loungeSys(L, 'join', Q.userById.get(uid)); }
  L.touched = now();
  loungeCast(L, loungeState(L));
  sendTo(uid, { t: 'lp_hist', code: L.code, msgs: loungeHistory(L, uid) });
}
function loungeList(uid) {
  const rows = [];
  for (const L of lounges.values()) {
    const fr = isFriend(uid, L.host), mine = L.members.includes(uid), inv = L.invited.has(uid);
    if (!L.pub && !fr && !mine && !inv) continue;
    if (L.banned.has(uid) || blocked(L.host, uid) || blocked(uid, L.host)) continue;
    const h = Q.userById.get(L.host);
    rows.push({ code: L.code, name: L.name, pub: L.pub, n: L.members.length, max: LOUNGE_MAX, host: h ? { uid: h.id, username: h.username, avatar: h.avatar || null } : null, friendHost: fr, invited: inv, mine, at: L.touched });
  }
  rows.sort((a, b) => (b.mine - a.mine) || (b.invited - a.invited) || (b.friendHost - a.friendHost) || ((a.n >= a.max) - (b.n >= b.max)) || (b.at - a.at));
  return rows.slice(0, 40);
}
function loungeMsg(c, m) {
  const uid = c.user.id, L = loungeOf(uid);
  const mid = typeof m.mid === 'string' && MID_RE.test(m.mid) ? m.mid : null; if (!mid) return;
  const fail = (code) => sendTo(uid, { t: 'error', code, mid, lp: 1 });
  if (!L) return fail('lp_not_in');
  const t0 = now(); if (c.lpAt && t0 - c.lpAt < 700) return fail('chat_rate');
  if (limited('lp:' + uid, 40, 60000)) return fail('chat_rate');
  let v = m.v;
  if (m.k === 'e') { if (!Number.isInteger(v) || v < 0 || v >= EMOJI_N) return fail('chat_bad'); }
  else if (m.k === 's') { if (typeof v !== 'string' || !STICKER_RE.test(v)) return fail('chat_bad'); }
  else if (m.k === 'x') { v = cleanChat(v, LOUNGE_TEXT_MAX); if (!v) return fail('chat_blocked'); }
  else if (m.k === 'v') { v = useClip(v, uid, null); if (!v) return fail('voice_bad'); loungeClips.set(v.id, new Set(L.members)); }
  else return fail('chat_bad');
  c.lpAt = t0; L.touched = t0;
  const msg = { id: ++L.seq, from: { uid, username: c.user.username, avatar: c.user.avatar || null }, k: m.k, v, mid, at: t0 };
  msg.seen = new Set(L.members); L.msgs.push(msg); if (L.msgs.length > LOUNGE_HIST) L.msgs.shift();
  const out = loungeOut(msg);
  L.members.forEach((p) => { if (p === uid) sendTo(p, { t: 'lp_msg', msg: out, ok: mid }); else if (!blocked(p, uid)) sendTo(p, { t: 'lp_msg', msg: out }); });
}
function onLounge(c, m) {
  const uid = c.user.id, u = c.user;
  switch (m.t) {
    case 'lp_list': if (limited('lpl:' + uid, 30, 60000)) return err(uid, 'rate'); sendTo(uid, { t: 'lp_list', rows: loungeList(uid) }); return;
    case 'lp_create': {
      if (limited('lpc:' + uid, 6, 600000)) return err(uid, 'rate_limited');
      let name = m.name == null || m.name === '' ? null : cleanChat(String(m.name), 24);
      if (m.name && !name) return err(uid, 'lp_bad_name');
      if (!name) name = u.username;
      let code; do { code = roomCode(); } while (lounges.has(code) || rooms.has(code));
      const L = { code, name, pub: m.pub !== false, host: uid, members: [], invited: new Set(), banned: new Set(), msgs: [], seq: 0, createdAt: now(), touched: now() };
      lounges.set(code, L); joinLounge(L, uid); return;
    }
    case 'lp_join': {
      const code = typeof m.code === 'string' ? m.code.trim().toLowerCase() : '';
      if (!CODE_RE.test(code)) return err(uid, 'lp_not_found');
      if (limited('lpj:' + uid, 20, 60000)) return err(uid, 'rate');
      const L = lounges.get(code); if (!L) return err(uid, 'lp_not_found');
      const why = canJoinLounge(L, u); if (why) return err(uid, why);
      joinLounge(L, uid); return;
    }
    case 'lp_leave': { const L = loungeOf(uid); leaveLounge(uid, 'leave'); sendTo(uid, { t: 'lp_closed', code: L ? L.code : null, why: 'self' }); return; }
    case 'lp_msg': loungeMsg(c, m); return;
    case 'lp_typing': { const L = loungeOf(uid); if (!L || limited('lpt:' + uid, 1, 2000)) return; L.members.forEach((p) => { if (p !== uid && !blocked(p, uid)) sendTo(p, { t: 'lp_typing', from: uid, username: u.username }); }); return; }
    case 'lp_invite': {
      const L = loungeOf(uid); if (!L) return err(uid, 'lp_not_in');
      const fid = Number(m.uid); const f = Number.isInteger(fid) ? Q.userById.get(fid) : null;
      if (!f || fid === uid || !isFriend(uid, fid)) return err(uid, 'not_friend');
      if (limited('lpi:' + uid, 20, 600000)) return err(uid, 'rate_limited');
      if (L.members.length >= LOUNGE_MAX) return err(uid, 'lp_full');
      if (L.members.includes(fid)) return err(uid, 'lp_already');
      if (blocked(fid, uid) || L.banned.has(fid)) return err(uid, 'lp_not_allowed');
      if (!clients.has(fid)) return err(uid, 'friend_offline');
      L.invited.add(fid);
      sendTo(fid, { t: 'lp_invite', code: L.code, name: L.name, n: L.members.length, max: LOUNGE_MAX, from: { uid, username: u.username, avatar: u.avatar || null } });
      sendTo(uid, { t: 'lp_invited', uid: fid, username: f.username }); return;
    }
    case 'lp_kick': {
      const L = loungeOf(uid); if (!L || L.host !== uid) return err(uid, 'not_allowed');
      const k = Number(m.uid); if (!Number.isInteger(k) || k === uid || !L.members.includes(k)) return;
      L.banned.add(k); leaveLounge(k, 'kick'); sendTo(k, { t: 'lp_closed', code: L.code, why: 'kick' }); return;
    }
    case 'lp_set': {
      const L = loungeOf(uid); if (!L || L.host !== uid) return err(uid, 'not_allowed');
      if (typeof m.pub === 'boolean') L.pub = m.pub;
      if (typeof m.name === 'string') { const nm = cleanChat(m.name, 24); if (!nm) return err(uid, 'lp_bad_name'); L.name = nm; }
      loungeCast(L, loungeState(L)); return;
    }
  }
}
function loungeOnAuthed(uid) {
  clearTimeout(loungeDisc.get(uid)); loungeDisc.delete(uid);
  const L = loungeOf(uid); if (!L) return;
  sendTo(uid, loungeState(L)); sendTo(uid, { t: 'lp_hist', code: L.code, msgs: loungeHistory(L, uid) });
  loungeCast(L, loungeState(L), uid);
}
function loungeOnClosed(uid) {
  const L = loungeOf(uid); if (!L) return;
  loungeCast(L, loungeState(L), uid);
  loungeDisc.set(uid, setTimeout(() => { loungeDisc.delete(uid); if (!clients.has(uid)) leaveLounge(uid, 'leave'); }, LOUNGE_GRACE_MS));
}
setInterval(() => {
  const t = now();
  for (const L of lounges.values()) if (t - L.touched > LOUNGE_IDLE_MS) { L.members.slice().forEach((p) => { userLounge.delete(p); sendTo(p, { t: 'lp_closed', code: L.code, why: 'idle' }); }); lounges.delete(L.code); }
  for (const id of loungeClips.keys()) { if (!VC.meta.get(id)) loungeClips.delete(id); }
}, 60000).unref();

/* ---------- message validation ---------- */
const CODE_RE = /^[a-z0-9]{6}$/, MID_RE = /^[a-z0-9]{8}$/;
/* Free-text filter (same rules as the client): strips control/bidi chars and <>, max 80 chars,
   blocks links, e-mails, handles and long digit runs (phone numbers), and a small abuse word list. */
const BAD_WORDS = /\b(babi|bodoh|sial|anjing|pukimak|puki|kimak|lancau|bangsat|celaka|fuck|shit|bitch|asshole|cunt)\b/i;
const STICKER_RE = /^s(0[1-9]|1[0-6])$/;
function cleanChat(s, max) {
  max = max || 80;
  if (typeof s !== 'string' || s.length > Math.max(400, max * 2)) return null;
  s = s.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069<>]/g, '').replace(/\s+/g, ' ').trim();
  if (!s || s.length > max) return null;
  if (/https?:|www\.|@|\b[a-z0-9-]{2,}\.(com|net|org|my|io|me|co|app|xyz|link|ly|gg|tv|info|biz)\b|t\.me|wa\.me/i.test(s)) return null;
  if (max <= 80 ? (s.match(/\d/g) || []).length >= 7 : /(?:\+?\d[\s().-]{0,2}){7,}/.test(s)) return null;
  if (BAD_WORDS.test(s)) return null;
  return s;
}
function err(uid, code) { sendTo(uid, { t: 'error', code }); }
const BAN_GATED = new Set(['mm_find', 'room_create', 'room_join', 'room_ready', 'invite', 'invite_reply', 'rematch', 'wcs_find', 'wcs_ready']);
function onMessage(c, raw) {
  const uid = c.user.id;
  if (limited('ws:' + uid, 150, 5000)) { err(uid, 'rate'); return; }
  let m; try { m = JSON.parse(raw); } catch (e) { return; }
  if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.t !== 'string') return;
  const room = roomOf(uid);
  if (room) room.touched = now();
  /* v4.4: server-side ban enforcement on every competitive action (UI state is never trusted) */
  if (V44 && BAN_GATED.has(m.t) && !(m.t === 'invite_reply' && m.accept !== true) && V44.gate(uid)) { if (m.t === 'invite_reply' && typeof m.code === 'string') { const r = rooms.get(m.code); if (r && r.invited === uid) { sendTo(r.host, { t: 'invite_declined', username: c.user.username }); closeRoom(r, 'declined'); } } return; }
  switch (m.t) {
    case 'ping': sendTo(uid, { t: 'pong', ts: now() }); return;
    case 'mm_find': {
      const mode = m.mode, diff = m.diff;
      if (!MODES.includes(mode)) return err(uid, 'bad_mode');
      if (!(mode === 'killer' ? KILLER_DIFFS : DIFFS).includes(diff)) return err(uid, 'bad_diff');
      if (room || WCS.queued(uid)) return err(uid, 'busy');
      if (queue.has(uid)) return err(uid, 'already_searching');
      const u = Q.userById.get(uid); c.user = u;
      queue.set(uid, { uid, mode, diff, rating: u.rating, since: now() });
      mmStatus(uid); presence(uid); return;
    }
    case 'mm_cancel': queue.delete(uid); mmStatus(uid); presence(uid); return;
    case 'room_create': {
      if (room || queue.has(uid) || WCS.queued(uid)) return err(uid, 'busy');
      const mode = MODES.includes(m.mode) ? m.mode : null, diff = m.diff;
      if (!mode || !(mode === 'killer' ? KILLER_DIFFS : DIFFS).includes(diff)) return err(uid, 'bad_diff');
      const r = newRoom({ mode, diff, host: uid }); broadcastRoom(r); return;
    }
    case 'room_join': {
      if (room) { if (room.code === m.code) { broadcastRoom(room); return; } return err(uid, 'busy'); }
      if (queue.has(uid)) return err(uid, 'busy');
      if (typeof m.code !== 'string' || !CODE_RE.test(m.code)) return err(uid, 'bad_code');
      const r = rooms.get(m.code);
      if (!r || r.ranked) return err(uid, 'not_found');
      if (r.invited && r.invited !== uid) return err(uid, 'not_found');
      if (r.players.length >= 2 || r.phase !== 'lobby') return err(uid, 'full');
      r.players.push(uid); userRoom.set(uid, r.code); r.ready = {}; r.invited = r.invited ? r.invited : null;
      if (r.inviteTimer) { clearTimeout(r.inviteTimer); r.inviteTimer = null; }
      broadcastRoom(r); return;
    }
    case 'room_set': {
      if (!room || room.ranked || room.phase !== 'lobby' || room.host !== uid) return err(uid, 'not_allowed');
      const mode = MODES.includes(m.mode) ? m.mode : room.mode;
      const diff = (mode === 'killer' ? KILLER_DIFFS : DIFFS).includes(m.diff) ? m.diff : (mode === 'killer' ? 'medium' : room.diff);
      room.mode = mode; room.diff = diff; room.ready = {}; broadcastRoom(room); return;
    }
    case 'room_ready': {
      if (!room || room.phase !== 'lobby' || room.ranked) return;
      room.ready[uid] = m.val === true; broadcastRoom(room);
      if (room.players.length === 2 && room.players.every((p) => room.ready[p])) startMatch(room);
      return;
    }
    case 'room_leave': leaveRoom(uid, 'leave'); sendTo(uid, { t: 'room_closed', why: 'self' }); return;
    case 'invite': {
      const fid = Number(m.uid);
      if (!Number.isInteger(fid) || !isFriend(uid, fid)) return err(uid, 'not_friend');
      if (room || queue.has(uid)) return err(uid, 'busy');
      if (!clients.has(fid) || userRoom.has(fid) || queue.has(fid) || (V44 && V44.banOf(fid))) return err(uid, 'friend_busy');
      if (limited('inv:' + uid, 6, 60000)) return err(uid, 'rate');
      const mode = MODES.includes(m.mode) ? m.mode : 'classic';
      const diff = (mode === 'killer' ? KILLER_DIFFS : DIFFS).includes(m.diff) ? m.diff : null;
      if (!diff) return err(uid, 'bad_diff');
      const r = newRoom({ mode, diff, host: uid, invited: fid });
      r.inviteTimer = setTimeout(() => { if (rooms.get(r.code) === r && r.players.length === 1) { sendTo(uid, { t: 'invite_expired' }); sendTo(fid, { t: 'invite_cancel', code: r.code }); closeRoom(r, 'invite_expired'); } }, INVITE_MS);
      sendTo(fid, { t: 'invite', code: r.code, from: miniUser(uid), mode, diff, expiresIn: INVITE_MS });
      broadcastRoom(r); return;
    }
    case 'invite_reply': {
      if (typeof m.code !== 'string' || !CODE_RE.test(m.code)) return;
      const r = rooms.get(m.code); if (!r || r.invited !== uid) return err(uid, 'not_found');
      if (m.accept === true) return onMessage(c, JSON.stringify({ t: 'room_join', code: m.code }));
      sendTo(r.host, { t: 'invite_declined', username: c.user.username }); closeRoom(r, 'declined'); return;
    }
    case 'mv': {
      const M = room && room.match;
      if (!M || M.over || room.phase !== 'match' || !M.values[uid]) return err(uid, 'no_match');
      if (now() < M.startAt) return err(uid, 'not_started');
      if (M.pausedBy) return err(uid, 'paused');
      const i = m.i, v = m.v;
      if (!Number.isInteger(i) || i < 0 || i > 80 || !Number.isInteger(v) || v < 0 || v > 9) return err(uid, 'bad_move');
      if (M.puzzle[i]) return err(uid, 'given');
      const vals = M.values[uid];
      if (vals[i] === v) return;
      vals[i] = v;
      const ok = v === 0 || v === M.solution[i];
      if (!ok) M.mistakes[uid]++;
      sendTo(uid, { t: 'mv_res', i, v, ok, mistakes: M.mistakes[uid], seq: m.seq | 0 });
      const opp = other(room, uid);
      if (opp) sendTo(opp, { t: 'opp', pct: progress(M, uid), mk: M.mistakes[uid] });
      if (M.mistakes[uid] >= 3) endMatch(room, opp || null, 'mistakes');
      else if (solvedBy(M, uid)) endMatch(room, uid, 'finish');
      return;
    }
    case 'surrender': { const M = room && room.match; if (!M || M.over || (room.phase !== 'match' && room.phase !== 'countdown')) return; endMatch(room, other(room, uid) || null, 'surrender'); return; }
    case 'pause': {
      const M = room && room.match; if (!M || M.over || room.phase !== 'match' || room.ranked || M.pausedBy || !(M.pausesLeft[uid] > 0)) return err(uid, 'not_allowed');
      M.pausesLeft[uid]--; M.pausedBy = uid; M.pauseAt = now();
      room.players.forEach((p) => sendTo(p, { t: 'paused', by: uid, elapsed: elapsed(M), pausesLeft: M.pausesLeft[p] })); return;
    }
    case 'resume': {
      const M = room && room.match; if (!M || M.pausedBy !== uid) return;
      M.pausedTotal += now() - M.pauseAt; M.pausedBy = null;
      room.players.forEach((p) => sendTo(p, { t: 'paused', by: null, elapsed: elapsed(M) })); return;
    }
    case 'rematch': {
      if (!room || room.ranked || room.phase !== 'result' || room.players.length !== 2) return err(uid, 'not_allowed');
      room.rematch[uid] = true; const opp = other(room, uid); sendTo(opp, { t: 'rematch_req' });
      if (room.rematch[opp]) { room.phase = 'lobby'; room.match = null; room.ready = {}; room.rematch = {}; broadcastRoom(room); }
      return;
    }
    case 'chat': {
      const mid = typeof m.mid === 'string' && MID_RE.test(m.mid) ? m.mid : null;
      if (!mid) return;
      const fail = (code) => sendTo(uid, { t: 'error', code, mid });
      if (!room || room.players.length !== 2) return fail('chat_no_opp');
      const t0 = now(); if (c.chatAt && t0 - c.chatAt < CHAT_GAP_MS) return fail('chat_rate');
      let v = m.v;
      if (m.k === 'e') { if (!Number.isInteger(v) || v < 0 || v >= EMOJI_N) return fail('chat_bad'); }
      else if (m.k === 'p') { if (!PHRASES.includes(v)) return fail('chat_bad'); }
      else if (m.k === 's') { if (typeof v !== 'string' || !STICKER_RE.test(v)) return fail('chat_bad'); }
      else if (m.k === 'v') { v = useClip(v, uid, other(room, uid)); if (!v) return fail('voice_bad'); }
      else if (m.k === 'x') {
        // Free text (opt-in on both sides): allowed in every phase incl. match and Ranked, always filtered on the server.
        v = cleanChat(v); if (!v) return fail('chat_blocked');
      }
      else return fail('chat_bad');
      c.chatAt = t0;
      sendTo(other(room, uid), { t: 'chat', k: m.k, v, mid });
      sendTo(uid, { t: 'chat_ok', mid }); return;
    }
    case 'dm_typing': {
      const to = Number(m.to); if (!Number.isInteger(to) || to === uid || !clients.has(to)) return;
      if (limited('typ:' + uid + ':' + to, 1, 2000)) return;
      const tu = Q.userById.get(to); if (!tu || dmBlockReason(c.user, tu)) return;
      sendTo(to, { t: 'dm_typing', from: uid }); return;
    }
    case 'ack': { if (!room || typeof m.mid !== 'string' || !MID_RE.test(m.mid)) return; sendTo(other(room, uid), { t: 'ack', mid: m.mid }); return; }
    case 'mic': { if (!room || !['off', 'on', 'muted'].includes(m.s)) return; room.mic[uid] = m.s; sendTo(other(room, uid), { t: 'mic', s: m.s }); return; }
    case 'rtc': {
      if (!room || room.players.length !== 2 || raw.length > 24000) return;
      const o = { t: 'rtc' };
      if (m.reset) o.reset = 1;
      else if (m.d && typeof m.d === 'object') { if ((m.d.type !== 'offer' && m.d.type !== 'answer') || typeof m.d.sdp !== 'string' || m.d.sdp.length > 20000) return; o.d = { type: m.d.type, sdp: m.d.sdp }; }
      else if (m.c && typeof m.c === 'object') {
        const cc = m.c; if (typeof cc.candidate !== 'string' || cc.candidate.length > 1500) return;
        o.c = { candidate: cc.candidate, sdpMid: typeof cc.sdpMid === 'string' ? cc.sdpMid.slice(0, 64) : null, sdpMLineIndex: Number.isInteger(cc.sdpMLineIndex) ? cc.sdpMLineIndex : null, usernameFragment: typeof cc.usernameFragment === 'string' ? cc.usernameFragment.slice(0, 64) : undefined };
      } else return;
      sendTo(other(room, uid), o); return;
    }
    case 'wcs_find': case 'wcs_cancel': case 'wcs_ready': WCS.onWs(c, m, room); return;
    case 'lp_list': case 'lp_create': case 'lp_join': case 'lp_leave': case 'lp_msg': case 'lp_typing': case 'lp_invite': case 'lp_kick': case 'lp_set': onLounge(c, m); return;
    default: return;
  }
}

/* ---------- connection lifecycle ---------- */
function onAuthed(ws, user) {
  const prev = clients.get(user.id);
  if (prev && prev.ws !== ws) { try { prev.ws.send(JSON.stringify({ t: 'replaced' })); prev.ws.close(4002, 'replaced'); } catch (e) { } }
  const c = { ws, user, chatAt: 0 };
  clients.set(user.id, c); Q.touchUser.run(now(), user.id);
  clearTimeout(discTimers.get(user.id)); discTimers.delete(user.id);
  sendTo(user.id, { t: 'hello', user: privUser(user), serverTime: now(), version: VERSION });
  pushUnread(user.id);
  const room = roomOf(user.id);
  if (room) {
    sendTo(user.id, roomState(room, user.id));
    if (room.match && (room.phase === 'match' || room.phase === 'countdown' || (room.phase === 'result'))) sendTo(user.id, matchSnapshot(room, user.id));
    const opp = other(room, user.id); if (opp) sendTo(opp, { t: 'opp_conn', on: true });
    if (room.match) delete room.match.disc[user.id];
    broadcastRoom(room);
  }
  presence(user.id);
  pushFriends(user.id);
  loungeOnAuthed(user.id);
}
function onClosed(ws, uid) {
  const c = clients.get(uid); if (!c || c.ws !== ws) return; // replaced by a newer socket
  clients.delete(uid); queue.delete(uid); if (WCS) WCS.onClosed(uid);
  const room = roomOf(uid);
  if (room) {
    const opp = other(room, uid);
    const live = room.match && !room.match.over && (room.phase === 'match' || room.phase === 'countdown' || room.phase === 'generating');
    if (live) {
      room.match.disc[uid] = now();
      if (opp) sendTo(opp, { t: 'opp_conn', on: false, grace: RECONNECT_GRACE_MS });
      discTimers.set(uid, setTimeout(() => { discTimers.delete(uid); if (!clients.has(uid)) leaveRoom(uid, 'disconnect'); }, RECONNECT_GRACE_MS));
    } else {
      if (room.phase === 'generating' && opp) sendTo(opp, { t: 'opp_conn', on: false, grace: LOBBY_GRACE_MS });
      discTimers.set(uid, setTimeout(() => { discTimers.delete(uid); if (!clients.has(uid)) leaveRoom(uid, 'disconnect'); }, LOBBY_GRACE_MS));
      if (opp) broadcastRoom(room);
    }
  }
  lastStatus.delete(uid); presence(uid);
  loungeOnClosed(uid);
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (!p.endsWith('/ws')) { socket.destroy(); return; }
  const ip = clientIp(req);
  if (limited('wsconn:' + ip, 30, 60000)) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});
wss.on('connection', (ws) => {
  let uid = null;
  const authT = setTimeout(() => { if (!uid) ws.close(4000, 'auth timeout'); }, 10000);
  ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => {
    const raw = data.toString('utf8');
    if (!uid) {
      let m; try { m = JSON.parse(raw); } catch (e) { return ws.close(4000, 'bad'); }
      if (!m || m.t !== 'auth') return ws.close(4000, 'auth first');
      const u = authToken(m.token);
      if (!u) { try { ws.send(JSON.stringify({ t: 'auth_fail' })); } catch (e) { } return ws.close(4001, 'auth'); }
      clearTimeout(authT); uid = u.id; onAuthed(ws, u); return;
    }
    const c = clients.get(uid); if (!c || c.ws !== ws) return;
    try { onMessage(c, raw); } catch (e) { console.error('msg error', e); }
  });
  ws.on('close', () => { clearTimeout(authT); if (uid) onClosed(ws, uid); });
  ws.on('error', () => { });
});
setInterval(() => { wss.clients.forEach((ws) => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; try { ws.ping(); } catch (e) { } }); }, 25000).unref();

/* ---------- v4 WCS – World Championship Sudoku ---------- */
WCS = require('./wcs')({ db, Q, now, route, R, sendTo, clients, generate, newRoom, broadcastRoom, startMatch, userRoom, queue, rooms, miniUser, pubUser, privUser,
  refreshClientUser, limited, err, presence, validGeo, flagEmoji, cleanChat, roomOf, GEO, TEST_HOOKS, setClock: (ms) => { CLOCK_OFF = ms; }, getClock: () => CLOCK_OFF,
  banOf: (uid) => (V44 ? V44.banOf(uid) : null), gate: (uid) => (V44 ? V44.gate(uid) : false), coins: (uid, n, why, ref) => (V44 ? V44.grantCoins(uid, n, why, ref) : 0) });

/* ---------- v4.4 – bans, player reports, audit, coins, border shop ---------- */
V44 = require('./v44').init({ db, Q, now, route, R, sendTo, clients, queue, rooms, roomOf, closeRoom, presence, privUser, refreshClientUser, limited,
  getWCS: () => WCS, promoteAdmins: () => WCS.loadAdmins() });

/* ---------- backups ---------- */
setTimeout(() => { DB.backup(db).catch((e) => console.error('backup', e.message)); }, 60000).unref();
setInterval(() => { DB.backup(db).catch((e) => console.error('backup', e.message)); }, 24 * 3600000).unref();

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => console.log('SLA server ' + VERSION + ' listening on ' + PORT));
}
module.exports = { server, db, WCS: () => WCS, _test: { customRatedLeft, lounges, userLounge, expected, kFactor, eloNew, tierOf, mmWindow, validGeo, queue, rooms, clients } };
