'use strict';
/* WCS v4.4 – player bans (server-enforced), player reports, admin audit, coins and the border shop.
   Everything is server-authoritative:
   - A ban is a row in player_bans. It is "active" while status = 'active' AND ends_at > server time, so it
     expires by itself (no cron, no manual unban) and survives restarts because it lives in SQLite.
   - Competitive actions (matchmaking, rooms, invites, rematch, WCS queue/ready, WCS entry, daily start) ask
     banOf(uid) on every call. The UI only mirrors what the server decided.
   - Banning never touches Elo or Coins. A live match of the banned player is voided (no rating change, no coins).
   - Coins are only granted by the server, deduplicated by UNIQUE(user_id, reason, ref) and capped per day.
   - Buying is a single conditional UPDATE (coins >= price) inside a transaction, so double-clicks or parallel
     requests cannot overspend or double-own. */

const DAY = 864e5;
const BAN_PRESETS = { '1': 1, '3': 3, '7': 7, '14': 14, '30': 30 };
const BAN_REASONS = ['cheating', 'exploit', 'elo_manip', 'coin_manip', 'bug_abuse', 'rules', 'custom'];
const REPORT_CATS = ['cheating', 'exploit', 'elo_manip', 'coin_manip', 'bug_abuse', 'abuse', 'other'];
const COIN = { win: 30, draw: 15, loss: 5, wcsWin: 40, wcsDraw: 20, wcsLoss: 10, daily: 25, welcome: 200, dailyMatchCap: 300 };

/* rarity: common < rare < mythic < legendary.  price null = reward only (cannot be bought). */
const BORDERS = [
  { id: 'none', rarity: 'common', price: 0 },
  { id: 'bronze', rarity: 'common', price: 150 },
  { id: 'silver', rarity: 'common', price: 200 },
  { id: 'jade', rarity: 'common', price: 250 },
  { id: 'gold', rarity: 'common', price: 300 },
  { id: 'neon', rarity: 'common', price: 300 },
  { id: 'frost', rarity: 'rare', price: 600 },
  { id: 'ruby', rarity: 'rare', price: 600 },
  { id: 'sakura', rarity: 'rare', price: 700 },
  { id: 'diamond', rarity: 'rare', price: 800 },
  { id: 'jalur', rarity: 'rare', price: 800 },
  { id: 'veteran', rarity: 'rare', price: null, reward: 'veteran' },
  { id: 'galaxy', rarity: 'mythic', price: 1500 },
  { id: 'aurora', rarity: 'mythic', price: 1500 },
  { id: 'royal', rarity: 'mythic', price: 1800 },
  { id: 'nebula', rarity: 'mythic', price: 2000, isNew: true },
  { id: 'thunder', rarity: 'mythic', price: 2000, isNew: true },
  { id: 'phantom', rarity: 'mythic', price: 2000, isNew: true },
  { id: 'dragon', rarity: 'mythic', price: 2200, isNew: true },
  { id: 'celestial', rarity: 'mythic', price: 2200, isNew: true },
  { id: 'legend', rarity: 'mythic', price: null, reward: 'wcs_ko' },
  { id: 'mrstar', rarity: 'mythic', price: null, reward: 'mr_champion' },
  { id: 'phoenix', rarity: 'legendary', price: 4000 },
  { id: 'inferno', rarity: 'legendary', price: 4000 },
  { id: 'legend2', rarity: 'legendary', price: 6000, isNew: true, premium: true },
  { id: 'founder', rarity: 'legendary', price: null, reward: 'founder' },
  { id: 'finalist', rarity: 'legendary', price: null, reward: 'wcs_final' },
  { id: 'champion', rarity: 'legendary', price: null, reward: 'wcs_champion' }
];
const BORDER_BY_ID = new Map(BORDERS.map((b) => [b.id, b]));
const FOUNDER_LIMIT = 100;

function myDay(ts) { return new Date(ts + 8 * 3600000).toISOString().slice(0, 10); } // Asia/Kuala_Lumpur

function init(ctx) {
  const { db, route, R, now, limited, Q, sendTo, clients } = ctx;

  /* ------------------------------------------------------------------ audit */
  const insAudit = db.prepare('INSERT INTO admin_audit (admin_id, action, detail, created_at, target_id) VALUES (?, ?, ?, ?, ?)');
  function audit(adminId, action, targetId, detail) { insAudit.run(adminId, action, JSON.stringify(detail || {}), now(), targetId == null ? null : targetId); }
  const isAdmin = (u) => { if (!u) return false; const x = Q.userById.get(u.id); return !!x && x.role === 'admin'; };
  function adminOnly(fn) {
    return (a) => {
      if (!isAdmin(a.user)) { try { db.prepare('INSERT INTO anticheat_logs (user_id, kind, detail, ref, created_at) VALUES (?, ?, ?, ?, ?)').run(a.user.id, 'admin_denied', JSON.stringify({ path: a.req.url }), null, now()); } catch (e) { } return R(403, { error: 'forbidden' }); }
      if (a.req.method !== 'GET' && limited('adm:' + a.user.id, 60, 60000)) return R(429, { error: 'rate_limited' });
      return fn(a);
    };
  }

  /* ------------------------------------------------------------------ bans */
  const qActiveBan = db.prepare("SELECT * FROM player_bans WHERE user_id = ? AND status = 'active' AND ends_at > ? ORDER BY ends_at DESC LIMIT 1");
  function banOf(uid) { if (!uid) return null; return qActiveBan.get(uid, now()) || null; }
  function banStatus(b, t) { if (!b) return null; if (b.status === 'revoked') return 'revoked'; return b.ends_at > (t || now()) ? 'active' : 'expired'; }
  function banView(b) {
    if (!b) return null;
    const u = Q.userById.get(b.user_id), a = Q.userById.get(b.admin_id), r = b.revoked_by ? Q.userById.get(b.revoked_by) : null;
    return { id: b.id, uid: b.user_id, username: u ? u.username : '?', playerId: u ? u.player_id : '?', reasonCode: b.reason_code, reasonText: b.reason_text || '',
      startsAt: b.starts_at, endsAt: b.ends_at, durationMs: b.duration_ms, admin: a ? a.username : '?', adminId: b.admin_id, status: banStatus(b),
      revokedAt: b.revoked_at || null, revokedBy: r ? r.username : null, revokeNote: b.revoke_note || null, reportId: b.report_id || null, createdAt: b.created_at };
  }
  function publicBan(b) { return b ? { id: b.id, reasonCode: b.reason_code, reasonText: b.reason_text || '', startsAt: b.starts_at, endsAt: b.ends_at, serverTime: now() } : null; }
  /* Called from every competitive WS/HTTP entry point. Sends a 'banned' error with the end date. */
  function gate(uid) {
    const b = banOf(uid); if (!b) return false;
    sendTo(uid, { t: 'error', code: 'banned', ban: publicBan(b) });
    return true;
  }
  /* Remove a freshly banned player from anything competitive. Never changes Elo or Coins. */
  function enforce(uid, b) {
    if (ctx.queue.delete(uid)) { sendTo(uid, { t: 'mm', searching: false }); }
    try { const M = ctx.getMR && ctx.getMR(); if (M) M.voidForBan(uid); } catch (e) { console.error('mr ban', e.message); }
    try { if (ctx.getWCS().queued(uid)) ctx.getWCS().onWs({ user: Q.userById.get(uid) }, { t: 'wcs_cancel' }, null); } catch (e) { }
    const room = ctx.roomOf(uid);
    if (room) {
      const M = room.match;
      if (M && !M.over) {
        M.over = true; M.endedAt = now();
        db.prepare("UPDATE matches SET result = 'void', reason = 'ban', ended_at = ?, duration_ms = ? WHERE id = ? AND ended_at IS NULL").run(now(), Math.max(0, now() - M.startAt), M.mid);
        audit(b.admin_id, 'match_void_ban', uid, { matchId: M.mid, kind: room.kind, players: room.players.slice() });
      }
      room.players.forEach((p) => sendTo(p, { t: 'match_void', why: p === uid ? 'banned' : 'opp_banned' }));
      if (room.inviteTimer) { clearTimeout(room.inviteTimer); room.inviteTimer = null; }
      ctx.closeRoom(room, 'void_ban');
    }
    /* active daily-tournament runs are closed (not scored); practice is solo and stays allowed */
    db.prepare("UPDATE solo_runs SET status = 'void', ended_at = ? WHERE user_id = ? AND status = 'active' AND kind = 'daily'").run(now(), uid);
    sendTo(uid, { t: 'ban', ban: publicBan(b) });
    ctx.presence(uid);
  }
  const insBan = db.prepare(`INSERT INTO player_bans (user_id, reason_code, reason_text, starts_at, ends_at, duration_ms, admin_id, status, report_id, created_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`);
  const banTx = db.transaction((target, admin, code, text, ms, reportId) => {
    const t = now();
    if (qActiveBan.get(target.id, t)) return { error: 'already_banned' };
    const id = insBan.run(target.id, code, text || null, t, t + ms, ms, admin.id, reportId || null, t).lastInsertRowid;
    if (reportId) db.prepare("UPDATE player_reports SET status = 'resolved', admin_note = COALESCE(admin_note, ?), resolved_by = ?, resolved_at = ? WHERE id = ? AND status = 'open'").run('ban #' + id, admin.id, t, reportId);
    audit(admin.id, 'ban', target.id, { banId: id, playerId: target.player_id, username: target.username, reasonCode: code, reasonText: text || '', startsAt: t, endsAt: t + ms, durationMs: ms, statusBefore: 'none', statusAfter: 'active', reportId: reportId || null });
    return { ban: db.prepare('SELECT * FROM player_bans WHERE id = ?').get(id) };
  });
  const unbanTx = db.transaction((banId, admin, note) => {
    const b = db.prepare('SELECT * FROM player_bans WHERE id = ?').get(banId);
    if (!b) return { error: 'not_found' };
    const before = banStatus(b);
    if (before !== 'active') return { error: 'not_active', status: before };
    const t = now();
    const ch = db.prepare("UPDATE player_bans SET status = 'revoked', revoked_at = ?, revoked_by = ?, revoke_note = ? WHERE id = ? AND status = 'active'").run(t, admin.id, note, banId);
    if (!ch.changes) return { error: 'not_active' };
    const u = Q.userById.get(b.user_id);
    audit(admin.id, 'unban', b.user_id, { banId, playerId: u ? u.player_id : null, username: u ? u.username : null, note, reasonCode: b.reason_code, startsAt: b.starts_at, endsAt: b.ends_at, durationMs: b.duration_ms, revokedAt: t, statusBefore: before, statusAfter: 'revoked' });
    return { ban: db.prepare('SELECT * FROM player_bans WHERE id = ?').get(banId) };
  });
  function parseDuration(body) {
    if (body.preset != null && body.preset !== 'custom') { const d = BAN_PRESETS[String(body.preset)]; return d ? d * DAY : null; }
    const days = body.customDays == null || body.customDays === '' ? 0 : Number(body.customDays);
    const hours = body.customHours == null || body.customHours === '' ? 0 : Number(body.customHours);
    if (!Number.isInteger(days) || !Number.isInteger(hours) || days < 0 || hours < 0 || days > 365 || hours > 23) return null;
    const ms = days * DAY + hours * 3600000;
    return ms >= 3600000 && ms <= 365 * DAY ? ms : null;
  }
  const cleanText = (s, max) => { if (s == null) return ''; s = String(s).normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069<>]/g, '').replace(/\s+/g, ' ').trim(); return s.slice(0, max); };
  function findUser(ref) {
    if (ref == null) return null; const s = String(ref).trim(); if (!s) return null;
    if (/^\d+$/.test(s)) { const u = Q.userById.get(Number(s)); if (u) return u; }
    return Q.userByPlayerId.get(s.toUpperCase()) || Q.userByName.get(s.toLowerCase()) || null;
  }
  function playerRow(u) {
    const b = banOf(u.id);
    return { uid: u.id, username: u.username, playerId: u.player_id, rating: u.rating, games: u.games, wins: u.wins, losses: u.losses, draws: u.draws,
      coins: u.coins || 0, role: u.role === 'admin' ? 'admin' : 'player', createdAt: u.created_at, lastSeen: u.last_seen, online: clients.has(u.id), country: u.country || null,
      avatar: u.avatar || null, border: u.border || 'none', banned: b ? { id: b.id, endsAt: b.ends_at, reasonCode: b.reason_code } : null };
  }

  route('GET', '/api/me/ban', true, ({ user }) => ({ ban: publicBan(banOf(user.id)), serverTime: now() }));

  route('GET', '/api/admin/players', true, adminOnly(({ query }) => {
    const q = cleanText(query.get('q'), 40);
    if (!q) return { players: db.prepare('SELECT * FROM users ORDER BY last_seen DESC LIMIT 20').all().map(playerRow) };
    const like = '%' + q.toLowerCase().replace(/[%_\\]/g, (c) => '\\' + c) + '%';
    const rows = db.prepare("SELECT * FROM users WHERE username_lc LIKE ? ESCAPE '\\' OR LOWER(player_id) LIKE ? ESCAPE '\\' OR CAST(id AS TEXT) = ? ORDER BY (username_lc = ?) DESC, last_seen DESC LIMIT 30").all(like, like, q, q.toLowerCase());
    return { players: rows.map(playerRow) };
  }));
  route('GET', '/api/admin/players/:uid', true, adminOnly(({ params }) => {
    const u = findUser(params.uid); if (!u) return R(404, { error: 'not_found' });
    const matches = db.prepare('SELECT id, kind, mode, difficulty, p1, p2, result, reason, p1_before, p1_after, p2_before, p2_after, started_at, ended_at FROM matches WHERE p1 = ? OR p2 = ? ORDER BY started_at DESC LIMIT 15').all(u.id, u.id)
      .map((m) => { const me1 = m.p1 === u.id, opp = Q.userById.get(me1 ? m.p2 : m.p1); return { id: m.id, kind: m.kind, mode: m.mode, diff: m.difficulty, opp: opp ? opp.username : '?', result: m.result === 'void' ? 'void' : m.result === 'draw' ? 'draw' : m.result == null ? 'open' : ((m.result === 'p1') === me1 ? 'win' : 'loss'), reason: m.reason, before: me1 ? m.p1_before : m.p2_before, after: me1 ? m.p1_after : m.p2_after, at: m.ended_at || m.started_at }; });
    return { player: playerRow(u),
      bans: db.prepare('SELECT * FROM player_bans WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(u.id).map(banView),
      reports: db.prepare('SELECT * FROM player_reports WHERE target_id = ? ORDER BY id DESC LIMIT 30').all(u.id).map(reportView),
      anticheat: db.prepare('SELECT id, kind, status, created_at FROM anticheat_logs WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(u.id),
      matches, serverTime: now() };
  }));
  route('POST', '/api/admin/players/:uid/ban', true, adminOnly(({ params, body, user }) => {
    const target = findUser(params.uid); if (!target) return R(404, { error: 'not_found' });
    if (target.id === user.id) return R(400, { error: 'ban_self' });
    if (target.role === 'admin') return R(403, { error: 'ban_admin' });
    const code = String(body.reasonCode || '');
    if (!BAN_REASONS.includes(code)) return R(400, { error: 'bad_reason' });
    const text = cleanText(body.reasonText, 300);
    if (code === 'custom' && text.length < 3) return R(400, { error: 'reason_required' });
    const ms = parseDuration(body); if (!ms) return R(400, { error: 'bad_duration' });
    const reportId = body.reportId != null ? Number(body.reportId) : null;
    if (reportId != null && (!Number.isInteger(reportId) || !db.prepare('SELECT 1 FROM player_reports WHERE id = ? AND target_id = ?').get(reportId, target.id))) return R(400, { error: 'bad_report' });
    const out = banTx(target, Q.userById.get(user.id), code, text, ms, reportId);
    if (out.error) return R(409, { error: out.error });
    enforce(target.id, out.ban);
    return { ok: true, ban: banView(out.ban) };
  }));
  route('POST', '/api/admin/bans/:id/unban', true, adminOnly(({ params, body, user }) => {
    const id = Number(params.id); if (!Number.isInteger(id)) return R(400, { error: 'bad_id' });
    const note = cleanText(body.note, 300); if (note.length < 3) return R(400, { error: 'note_required' });
    const out = unbanTx(id, Q.userById.get(user.id), note);
    if (out.error) return R(out.error === 'not_found' ? 404 : 409, { error: out.error });
    sendTo(out.ban.user_id, { t: 'ban', ban: null }); ctx.presence(out.ban.user_id);
    return { ok: true, ban: banView(out.ban) };
  }));
  route('GET', '/api/admin/bans', true, adminOnly(({ query }) => {
    const st = String(query.get('status') || 'active'), q = cleanText(query.get('q'), 40), t = now();
    let where = '1=1'; const args = [];
    if (st === 'active') { where = "b.status = 'active' AND b.ends_at > ?"; args.push(t); }
    else if (st === 'expired') { where = "b.status = 'active' AND b.ends_at <= ?"; args.push(t); }
    else if (st === 'revoked') where = "b.status = 'revoked'";
    if (q) { where += " AND (u.username_lc LIKE ? ESCAPE '\\' OR LOWER(u.player_id) LIKE ? ESCAPE '\\')"; const like = '%' + q.toLowerCase().replace(/[%_\\]/g, (c) => '\\' + c) + '%'; args.push(like, like); }
    const rows = db.prepare(`SELECT b.* FROM player_bans b JOIN users u ON u.id = b.user_id WHERE ${where} ORDER BY b.id DESC LIMIT 200`).all(...args);
    const counts = { active: db.prepare("SELECT COUNT(*) n FROM player_bans WHERE status = 'active' AND ends_at > ?").get(t).n,
      expired: db.prepare("SELECT COUNT(*) n FROM player_bans WHERE status = 'active' AND ends_at <= ?").get(t).n,
      revoked: db.prepare("SELECT COUNT(*) n FROM player_bans WHERE status = 'revoked'").get().n };
    return { bans: rows.map(banView), counts, serverTime: t };
  }));
  route('GET', '/api/admin/audit', true, adminOnly(({ query }) => {
    const act = String(query.get('action') || ''), q = cleanText(query.get('q'), 40);
    let where = '1=1'; const args = [];
    if (/^[a-z_]{2,40}$/.test(act)) { where += ' AND a.action = ?'; args.push(act); }
    if (q) { const tu = findUser(q); where += ' AND (a.target_id = ? OR a.admin_id = ?)'; args.push(tu ? tu.id : -1, tu ? tu.id : -1); }
    const rows = db.prepare(`SELECT a.* FROM admin_audit a WHERE ${where} ORDER BY a.id DESC LIMIT 200`).all(...args);
    return { audit: rows.map((r) => { const a = Q.userById.get(r.admin_id), tg = r.target_id ? Q.userById.get(r.target_id) : null; let d = {}; try { d = JSON.parse(r.detail || '{}'); } catch (e) { } return { id: r.id, adminId: r.admin_id, admin: a ? a.username : '?', action: r.action, targetId: r.target_id, target: tg ? tg.username : null, targetPid: tg ? tg.player_id : null, detail: d, at: r.created_at }; }),
      actions: db.prepare('SELECT DISTINCT action FROM admin_audit ORDER BY action').all().map((x) => x.action) };
  }));

  /* ------------------------------------------------------------------ player reports */
  function reportView(r) {
    const rp = Q.userById.get(r.reporter_id), tg = Q.userById.get(r.target_id), ad = r.resolved_by ? Q.userById.get(r.resolved_by) : null;
    return { id: r.id, reporter: rp ? rp.username : '?', reporterId: r.reporter_id, target: tg ? tg.username : '?', targetId: r.target_id, targetPid: tg ? tg.player_id : '?',
      category: r.category, body: r.body || '', matchId: r.match_id || null, status: r.status, adminNote: r.admin_note || null, resolvedBy: ad ? ad.username : null, resolvedAt: r.resolved_at || null, createdAt: r.created_at,
      targetBanned: !!banOf(r.target_id) };
  }
  route('POST', '/api/report', true, ({ body, user }) => {
    if (limited('report:' + user.id, 8, 3600000)) return R(429, { error: 'rate_limited' });
    const target = findUser(body.uid != null ? body.uid : body.playerId); if (!target) return R(404, { error: 'not_found' });
    if (target.id === user.id) return R(400, { error: 'report_self' });
    const cat = String(body.category || ''); if (!REPORT_CATS.includes(cat)) return R(400, { error: 'bad_category' });
    const text = cleanText(body.body, 500); if (text.length < 5) return R(400, { error: 'report_short' });
    if (db.prepare("SELECT 1 FROM player_reports WHERE reporter_id = ? AND target_id = ? AND status = 'open' AND created_at > ?").get(user.id, target.id, now() - DAY)) return R(409, { error: 'report_dup' });
    const mid = typeof body.matchId === 'string' && /^[0-9a-f-]{36}$/.test(body.matchId) ? body.matchId : null;
    const id = db.prepare('INSERT INTO player_reports (reporter_id, target_id, category, body, match_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(user.id, target.id, cat, text, mid, now()).lastInsertRowid;
    return { ok: true, id };
  });
  route('GET', '/api/admin/player-reports', true, adminOnly(({ query }) => {
    const st = String(query.get('status') || 'open');
    const rows = st === 'all' ? db.prepare('SELECT * FROM player_reports ORDER BY id DESC LIMIT 200').all() : db.prepare('SELECT * FROM player_reports WHERE status = ? ORDER BY id DESC LIMIT 200').all(['open', 'resolved', 'dismissed'].includes(st) ? st : 'open');
    return { reports: rows.map(reportView), open: db.prepare("SELECT COUNT(*) n FROM player_reports WHERE status = 'open'").get().n };
  }));
  route('POST', '/api/admin/player-reports/:id', true, adminOnly(({ params, body, user }) => {
    const id = Number(params.id), st = String(body.status || '');
    if (!['resolved', 'dismissed', 'open'].includes(st)) return R(400, { error: 'bad_status' });
    const r = db.prepare('SELECT * FROM player_reports WHERE id = ?').get(id); if (!r) return R(404, { error: 'not_found' });
    const note = cleanText(body.note, 300) || null;
    db.prepare('UPDATE player_reports SET status = ?, admin_note = ?, resolved_by = ?, resolved_at = ? WHERE id = ?').run(st, note, st === 'open' ? null : user.id, st === 'open' ? null : now(), id);
    audit(user.id, 'report_' + st, r.target_id, { reportId: id, statusBefore: r.status, statusAfter: st, note });
    return { ok: true };
  }));

  /* ------------------------------------------------------------------ coins */
  const insCoin = db.prepare('INSERT OR IGNORE INTO coin_tx (user_id, amount, balance, reason, ref, day, created_at) VALUES (?, ?, 0, ?, ?, ?, ?)');
  /* Grant coins once per (user, reason, ref). Returns the amount actually granted (0 if duplicate / capped). */
  function grantCoins(uid, amount, reason, ref, cap) {
    if (!uid || !(amount > 0)) return 0;
    const t = now(), day = myDay(t);
    if (cap) { const got = db.prepare('SELECT COALESCE(SUM(amount), 0) s FROM coin_tx WHERE user_id = ? AND reason = ? AND day = ?').get(uid, reason, day).s; amount = Math.min(amount, Math.max(0, cap - got)); if (!amount) return 0; }
    const r = insCoin.run(uid, amount, reason, String(ref), day, t);
    if (!r.changes) return 0;
    db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(amount, uid);
    db.prepare('UPDATE coin_tx SET balance = (SELECT coins FROM users WHERE id = ?) WHERE id = ?').run(uid, r.lastInsertRowid);
    return amount;
  }
  const grantTx = db.transaction(grantCoins);
  /* Inside finishTx (already a transaction): coins for a finished match. Never for voided/unrated/casual games. */
  function matchCoins(room, M, res, reason, ms) {
    const out = {}; const a = M.p1, b = M.p2;
    const wcs = room.kind === 'wcs_q' || room.kind === 'wcs_ko';
    if (!M.rated && !wcs) return out;
    if ((reason === 'surrender' || reason === 'left') && ms < 30000) return out; // anti farming: instant surrender/leave earns nothing
    const val = (uid) => {
      const won = (res === 'p1' && uid === a) || (res === 'p2' && uid === b), draw = res === 'draw';
      if (won) return wcs ? COIN.wcsWin : COIN.win;
      if (draw) return wcs ? COIN.wcsDraw : COIN.draw;
      return reason === 'left' ? 0 : wcs ? COIN.wcsLoss : COIN.loss;
    };
    [a, b].forEach((uid) => { out[uid] = grantCoins(uid, val(uid), 'match', M.mid, COIN.dailyMatchCap); });
    return out;
  }
  function welcome(uid) { return grantTx(uid, COIN.welcome, 'welcome', 'v44'); }
  route('GET', '/api/me/coins', true, ({ user }) => {
    welcome(user.id);
    const u = Q.userById.get(user.id), day = myDay(now());
    return { coins: u.coins || 0, today: db.prepare("SELECT COALESCE(SUM(amount), 0) s FROM coin_tx WHERE user_id = ? AND reason = 'match' AND day = ?").get(user.id, day).s, cap: COIN.dailyMatchCap,
      tx: db.prepare('SELECT id, amount, balance, reason, ref, created_at FROM coin_tx WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(user.id), rules: COIN };
  });

  /* ------------------------------------------------------------------ borders / shop */
  function rewardEligible(uid) {
    const u = Q.userById.get(uid); if (!u) return [];
    const out = [];
    if ((u.games || 0) + (u.casual_games || 0) + (u.mr_games || 0) >= 100) out.push('veteran');
    if ((u.mr_wins || 0) >= 25) out.push('mrstar');
    if (db.prepare('SELECT COUNT(*) n FROM users WHERE id < ?').get(uid).n < FOUNDER_LIMIT) out.push('founder');
    if (db.prepare('SELECT 1 FROM wcs_entries WHERE user_id = ? AND seed IS NOT NULL').get(uid)) out.push('legend');
    if (db.prepare("SELECT 1 FROM wcs_ko k WHERE (k.p1 = ? OR k.p2 = ?) AND k.round = (SELECT MAX(round) FROM wcs_ko WHERE season_id = k.season_id)").get(uid, uid)
      || db.prepare('SELECT 1 FROM wcs_champions WHERE user_id = ? OR runner_up = ?').get(uid, uid)) out.push('finalist');
    if (db.prepare('SELECT 1 FROM wcs_champions WHERE user_id = ?').get(uid)) out.push('champion');
    return out;
  }
  function syncRewards(uid) {
    const ins = db.prepare("INSERT OR IGNORE INTO owned_borders (user_id, border_id, source, price, acquired_at) VALUES (?, ?, 'reward', 0, ?)");
    rewardEligible(uid).forEach((id) => ins.run(uid, id, now()));
  }
  const owned = (uid) => new Set(db.prepare('SELECT border_id FROM owned_borders WHERE user_id = ?').all(uid).map((r) => r.border_id).concat(['none']));
  route('GET', '/api/shop', true, ({ user }) => {
    welcome(user.id); syncRewards(user.id);
    const u = Q.userById.get(user.id), own = owned(user.id);
    return { coins: u.coins || 0, equipped: own.has(u.border) ? u.border : 'none',
      borders: BORDERS.map((b) => ({ id: b.id, rarity: b.rarity, price: b.price, reward: b.reward || null, isNew: !!b.isNew, premium: !!b.premium, owned: own.has(b.id), available: true })) };
  });
  const buyTx = db.transaction((uid, b) => {
    if (db.prepare('SELECT 1 FROM owned_borders WHERE user_id = ? AND border_id = ?').get(uid, b.id)) return { error: 'owned' };
    const ch = db.prepare('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?').run(b.price, uid, b.price);
    if (!ch.changes) return { error: 'no_coins' };
    db.prepare("INSERT INTO owned_borders (user_id, border_id, source, price, acquired_at) VALUES (?, ?, 'shop', ?, ?)").run(uid, b.id, b.price, now());
    const bal = Q.userById.get(uid).coins;
    db.prepare('INSERT INTO coin_tx (user_id, amount, balance, reason, ref, day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(uid, -b.price, bal, 'shop', 'border:' + b.id, myDay(now()), now());
    return { ok: true, coins: bal };
  });
  route('POST', '/api/shop/buy', true, ({ body, user }) => {
    if (limited('buy:' + user.id, 20, 60000)) return R(429, { error: 'rate_limited' });
    const b = BORDER_BY_ID.get(String(body.id || ''));
    if (!b || b.id === 'none') return R(404, { error: 'not_found' });
    if (b.price == null) return R(400, { error: 'reward_only' });
    const out = buyTx(user.id, b);
    if (out.error) return R(out.error === 'no_coins' ? 402 : 409, { error: out.error });
    return out;
  });
  route('POST', '/api/me/border', true, ({ body, user }) => {
    if (limited('border:' + user.id, 30, 60000)) return R(429, { error: 'rate_limited' });
    const id = String(body.id || 'none'); if (!BORDER_BY_ID.has(id)) return R(404, { error: 'not_found' });
    syncRewards(user.id);
    if (!owned(user.id).has(id)) return R(403, { error: 'not_owned' });
    db.prepare('UPDATE users SET border = ? WHERE id = ?').run(id, user.id);
    const u = Q.userById.get(user.id); ctx.refreshClientUser(u);
    return { ok: true, border: id, user: ctx.privUser(u) };
  });

  /* admins listed in wcs-admins.json / SLA_ADMINS are also promoted when they register after startup */
  setInterval(() => { try { ctx.promoteAdmins && ctx.promoteAdmins(); } catch (e) { } }, 30000).unref();

  return { banOf, gate, enforce, publicBan, grantCoins: grantTx, matchCoins, welcome, audit, BORDERS, BAN_REASONS, REPORT_CATS, COIN };
}

module.exports = { init, BORDERS, BAN_PRESETS, BAN_REASONS, REPORT_CATS, COIN, myDay };
