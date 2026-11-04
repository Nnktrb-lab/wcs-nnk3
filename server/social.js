'use strict';
/* WCS v4.4 – social & collection layer (server-authoritative):
   - Remember-me: an HttpOnly, Secure, SameSite=Lax cookie holds the session token, so a page refresh keeps the
     player signed in without any browser storage API (no localStorage / sessionStorage / IndexedDB).
   - Public profile with history privacy (public / friends / private). Elo and rank are always public.
   - Mutes (MR lobby chat + MR voice + MR invites).
   - Titles: unlocked from real stats on the server; live titles (state / national / global) from the ladder.
   - Board themes: bought with coins in one conditional UPDATE (cannot overspend).
   - Support reports for the admin panel, /api/about, and a small per-player music library stored server-side. */

const DAY = 864e5;
const COOKIE = 'wcs_sid';
const THEMES = [
  { id: 'default', rarity: 'common', price: 0 },
  { id: 'paper', rarity: 'common', price: 250 },
  { id: 'ocean', rarity: 'common', price: 300 },
  { id: 'forest', rarity: 'common', price: 300 },
  { id: 'sunset', rarity: 'rare', price: 600 },
  { id: 'sakura', rarity: 'rare', price: 650 },
  { id: 'midnight', rarity: 'mythic', price: 1200 },
  { id: 'matrix', rarity: 'mythic', price: 1400 }
];
const THEME_BY_ID = new Map(THEMES.map((t) => [t.id, t]));
const TITLE_IDS = ['first_victory', 'sudoku_beginner', 'sudoku_master', 'sudoku_expert', 'killer_specialist', 'ranked_champion', 'mr_champion',
  'wcs_finalist', 'wcs_champion', 'winning_streak', 'veteran_player', 'state_champion', 'national_champion', 'global_champion'];
const LIVE_TITLES = { global_champion: 100, national_champion: 50, state_champion: 20 };
const SUPPORT_CATS = ['bug', 'match', 'account', 'payment', 'other'];
const MUSIC_MAX = +process.env.SLA_MUSIC_MAX || 8 * 1024 * 1024;
const MUSIC_PER_USER = 5;

function parseCookies(req) {
  const out = {}; const h = String(req.headers.cookie || '');
  h.split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) { const k = p.slice(0, i).trim(); const v = p.slice(i + 1).trim(); if (k) { try { out[k] = decodeURIComponent(v); } catch (e) { out[k] = v; } } } });
  return out;
}
function audioMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf.slice(0, 3).toString('latin1') === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (buf.slice(4, 8).toString('latin1') === 'ftyp') return 'audio/mp4';
  if (buf.slice(0, 4).toString('latin1') === 'OggS') return 'audio/ogg';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WAVE') return 'audio/wav';
  if (buf.slice(0, 4).toString('latin1') === 'fLaC') return 'audio/flac';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'audio/webm';
  return null;
}

function init(ctx) {
  const { db, Q, now, route, R, sendTo, clients, limited, pubUser, privUser, refreshClientUser, isFriend, authToken, bearer, sha, VERSION, SCHEMA, getV44, getMR, cleanText } = ctx;
  const isAdmin = (u) => { if (!u) return false; const x = Q.userById.get(u.id); return !!x && x.role === 'admin'; };

  /* ------------------------------------------------------------------ remember-me cookie */
  function setCookie(req, res, tok, maxAge) {
    if (process.env.SLA_TEST_STRIP_COOKIE === '1') return; // test hook: emulate a proxy that drops Set-Cookie
    const secure = /^https/i.test(String(req.headers['x-forwarded-proto'] || '')) || !!req.socket.encrypted || process.env.SLA_COOKIE_SECURE === '1' || !/^(localhost|127\.0\.0\.1)(:|$)/.test(String(req.headers.host || ''));
    res.setHeader('Set-Cookie', COOKIE + '=' + (tok ? encodeURIComponent(tok) : '') + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + (secure ? '; Secure' : ''));
  }
  route('POST', '/api/auth/remember', true, ({ req, res }) => { setCookie(req, res, bearer(req), 30 * 86400); return { ok: true }; });
  route('GET', '/api/auth/session', false, ({ req, res }) => {
    const ck = parseCookies(req)[COOKIE];
    let tok = ck, u = ck ? authToken(ck) : null;
    if (!u) { const b = bearer(req); if (b) { const ub = authToken(b); if (ub) { tok = b; u = ub; } } }
    if (!u) { if (ck) setCookie(req, res, '', 0); return { token: null, user: null }; } // 200 so a guest page load logs no console error
    return { token: tok, user: privUser(u) };
  });
  route('POST', '/api/auth/forget', false, ({ req, res }) => { setCookie(req, res, '', 0); return { ok: true }; });

  /* ------------------------------------------------------------------ titles */
  let ladder = { at: 0, global: new Map(), national: new Map(), state: new Map() };
  function refreshLadder() {
    if (now() - ladder.at < 30000) return ladder;
    const rows = db.prepare('SELECT id, rating, country, region FROM users WHERE games > 0 ORDER BY rating DESC, id ASC').all();
    const g = new Map(), n = new Map(), s = new Map(), cN = {}, cS = {};
    rows.forEach((r, i) => {
      g.set(r.id, i + 1);
      if (r.country) { cN[r.country] = (cN[r.country] || 0) + 1; n.set(r.id, { pos: cN[r.country], scope: r.country }); }
      if (r.country && r.region) { const k = r.country + '-' + r.region; cS[k] = (cS[k] || 0) + 1; s.set(r.id, { pos: cS[k], scope: k }); }
    });
    ladder = { at: now(), global: g, national: n, state: s };
    return ladder;
  }
  const titleCache = new Map();
  function maxStreak(uid) {
    const rows = db.prepare("SELECT p1, p2, result FROM matches WHERE (p1 = ? OR p2 = ?) AND ended_at IS NOT NULL AND result IN ('p1','p2','draw') ORDER BY ended_at DESC LIMIT 500").all(uid, uid);
    let best = 0, cur = 0;
    rows.reverse().forEach((m) => { const won = (m.result === 'p1' && m.p1 === uid) || (m.result === 'p2' && m.p2 === uid); if (won) { cur++; if (cur > best) best = cur; } else cur = 0; });
    return Math.max(best, 0);
  }
  function winsWhere(uid, cond) {
    const a = db.prepare(`SELECT COUNT(*) n FROM matches WHERE ((p1 = ? AND result = 'p1') OR (p2 = ? AND result = 'p2')) AND ${cond}`).get(uid, uid).n;
    return a;
  }
  function titlesOf(uid) {
    const c = titleCache.get(uid); if (c && now() - c.at < 20000) return c.v;
    const u = Q.userById.get(uid); if (!u) return { list: [], unlocked: new Set() };
    const mrWin = (diff, mode) => db.prepare(`SELECT COUNT(*) n FROM mr_players p JOIN mr_matches m ON m.id = p.match_id WHERE p.user_id = ? AND p.result = 'win'${diff ? ' AND m.diff = ?' : ''}${mode ? ' AND m.mode = ?' : ''}`).get(...[uid].concat(diff ? [diff] : [], mode ? [mode] : [])).n;
    const totalGames = (u.games || 0) + (u.casual_games || 0) + (u.mr_games || 0);
    const totalWins = (u.wins || 0) + (u.casual_wins || 0) + (u.mr_wins || 0);
    const L = refreshLadder();
    const live = {};
    const gpos = L.global.get(uid); if (gpos && gpos <= LIVE_TITLES.global_champion) live.global_champion = [{ id: 'global_champion', scope: 'global' }];
    const np = L.national.get(uid); if (np && np.pos <= LIVE_TITLES.national_champion) live.national_champion = [{ id: 'national_champion', scope: np.scope }];
    const sp = L.state.get(uid); if (sp && sp.pos <= LIVE_TITLES.state_champion) live.state_champion = [{ id: 'state_champion', scope: sp.scope }];
    const wcsChamp = !!db.prepare("SELECT 1 FROM user_titles WHERE user_id = ? AND title = 'wcs_champion'").get(uid);
    const wcsFinal = wcsChamp || !!db.prepare('SELECT 1 FROM wcs_champions WHERE user_id = ? OR runner_up = ?').get(uid, uid)
      || !!db.prepare('SELECT 1 FROM wcs_ko k WHERE (k.p1 = ? OR k.p2 = ?) AND k.round = (SELECT MAX(round) FROM wcs_ko WHERE season_id = k.season_id)').get(uid, uid);
    const ok = {
      first_victory: totalWins >= 1,
      sudoku_beginner: totalGames >= 5,
      sudoku_master: winsWhere(uid, "difficulty = 'master'") + mrWin('master') > 0,
      sudoku_expert: winsWhere(uid, "difficulty = 'extreme'") + mrWin('extreme') > 0,
      killer_specialist: winsWhere(uid, "mode = 'killer'") + mrWin(null, 'killer') >= 10,
      ranked_champion: (u.peak || u.rating) >= 2000,
      mr_champion: (u.mr_wins || 0) >= 25,
      wcs_finalist: wcsFinal,
      wcs_champion: wcsChamp,
      winning_streak: maxStreak(uid) >= 5,
      veteran_player: totalGames >= 100,
      state_champion: !!live.state_champion, national_champion: !!live.national_champion, global_champion: !!live.global_champion
    };
    const list = TITLE_IDS.map((id) => ({ id, unlocked: !!ok[id], live: live[id] || null }));
    const v = { list, unlocked: new Set(TITLE_IDS.filter((id) => ok[id])), live };
    titleCache.set(uid, { at: now(), v });
    return v;
  }
  function activeTitle(u) {
    if (!u || !u.active_title) return null;
    const T = titlesOf(u.id);
    if (!T.unlocked.has(u.active_title)) return null;
    const lv = T.live[u.active_title];
    return lv ? lv[0] : { id: u.active_title, scope: 'global' };
  }
  function titleHistory(uid) {
    return db.prepare('SELECT t.title, t.season_id, t.awarded_at, s.name FROM user_titles t LEFT JOIN wcs_seasons s ON s.id = t.season_id WHERE t.user_id = ? ORDER BY t.awarded_at DESC LIMIT 20').all(uid)
      .map((r) => ({ title: r.title, scope: 'global', season: r.name || ('#' + r.season_id), rank: r.title === 'wcs_champion' ? 1 : 2, at: r.awarded_at }));
  }
  route('GET', '/api/me/titles', true, ({ user }) => {
    titleCache.delete(user.id);
    const T = titlesOf(user.id), u = Q.userById.get(user.id), a = activeTitle(u);
    let hist = []; try { hist = titleHistory(user.id); } catch (e) { hist = []; }
    return { list: T.list, active: a ? a.id : null, history: hist, ladder: null };
  });

  /* ------------------------------------------------------------------ themes */
  const ownedThemes = (uid) => new Set(db.prepare('SELECT theme_id FROM owned_themes WHERE user_id = ?').all(uid).map((r) => r.theme_id).concat(['default']));
  route('GET', '/api/themes', true, ({ user }) => {
    const u = Q.userById.get(user.id), own = ownedThemes(user.id);
    return { coins: u.coins || 0, equipped: own.has(u.board_theme) ? u.board_theme : 'default', themes: THEMES.map((t) => ({ id: t.id, rarity: t.rarity, price: t.price, owned: own.has(t.id) })) };
  });
  const buyThemeTx = db.transaction((uid, t) => {
    if (db.prepare('SELECT 1 FROM owned_themes WHERE user_id = ? AND theme_id = ?').get(uid, t.id)) return { error: 'owned' };
    const ch = db.prepare('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?').run(t.price, uid, t.price);
    if (!ch.changes) return { error: 'no_coins' };
    db.prepare("INSERT INTO owned_themes (user_id, theme_id, source, price, acquired_at) VALUES (?, ?, 'shop', ?, ?)").run(uid, t.id, t.price, now());
    const bal = Q.userById.get(uid).coins;
    const V = getV44();
    db.prepare('INSERT INTO coin_tx (user_id, amount, balance, reason, ref, day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(uid, -t.price, bal, 'shop', 'theme:' + t.id, V ? require('./v44').myDay(now()) : null, now());
    return { ok: true, coins: bal };
  });
  route('POST', '/api/themes/buy', true, ({ body, user }) => {
    if (limited('buy:' + user.id, 20, 60000)) return R(429, { error: 'rate_limited' });
    const t = THEME_BY_ID.get(String(body.id || ''));
    if (!t || t.id === 'default') return R(404, { error: 'not_found' });
    const out = buyThemeTx(user.id, t);
    if (out.error) return R(out.error === 'no_coins' ? 402 : 409, { error: out.error });
    return out;
  });

  /* ------------------------------------------------------------------ cosmetics (border / theme / title) */
  route('POST', '/api/me/cosmetics', true, ({ body, user }) => {
    if (limited('cos:' + user.id, 40, 60000)) return R(429, { error: 'rate_limited' });
    if (body.boardTheme !== undefined) {
      const id = String(body.boardTheme || 'default'); if (!THEME_BY_ID.has(id)) return R(404, { error: 'not_found' });
      if (!ownedThemes(user.id).has(id)) return R(403, { error: 'not_owned' });
      db.prepare('UPDATE users SET board_theme = ? WHERE id = ?').run(id, user.id);
    }
    if (body.title !== undefined) {
      if (body.title === null || body.title === '') db.prepare('UPDATE users SET active_title = NULL WHERE id = ?').run(user.id);
      else {
        const id = String(body.title); if (!TITLE_IDS.includes(id)) return R(404, { error: 'not_found' });
        titleCache.delete(user.id);
        if (!titlesOf(user.id).unlocked.has(id)) return R(403, { error: 'locked' });
        db.prepare('UPDATE users SET active_title = ? WHERE id = ?').run(id, user.id);
      }
    }
    if (body.border !== undefined) return R(400, { error: 'use_border_endpoint' });
    const u = Q.userById.get(user.id); refreshClientUser(u);
    return { ok: true, user: privUser(u) };
  });

  /* ------------------------------------------------------------------ privacy */
  route('POST', '/api/me/privacy', true, ({ body, user }) => {
    const h = String(body.history || ''); if (!['public', 'friends', 'private'].includes(h)) return R(400, { error: 'bad_request' });
    db.prepare('UPDATE users SET history_privacy = ? WHERE id = ?').run(h, user.id);
    const u = Q.userById.get(user.id); refreshClientUser(u);
    return { ok: true, history: h };
  });

  /* ------------------------------------------------------------------ mutes */
  route('GET', '/api/mutes', true, ({ user }) => ({ ids: db.prepare('SELECT target_id FROM user_mutes WHERE user_id = ?').all(user.id).map((r) => r.target_id) }));
  route('POST', '/api/mute', true, ({ body, user }) => {
    if (limited('mute:' + user.id, 30, 60000)) return R(429, { error: 'rate_limited' });
    const t = Number(body.uid); if (!Number.isInteger(t) || t === user.id || !Q.userById.get(t)) return R(400, { error: 'bad_request' });
    if (body.on) db.prepare('INSERT OR IGNORE INTO user_mutes (user_id, target_id, created_at) VALUES (?, ?, ?)').run(user.id, t, now());
    else db.prepare('DELETE FROM user_mutes WHERE user_id = ? AND target_id = ?').run(user.id, t);
    const M = getMR(); if (M) M.mutesChanged(user.id);
    return { ok: true, muted: !!body.on };
  });

  /* ------------------------------------------------------------------ public profile */
  function historyRows(uid, limit) {
    const rows = db.prepare(`SELECT * FROM matches WHERE (p1 = ? OR p2 = ?) AND ended_at IS NOT NULL AND result IN ('p1','p2','draw') ORDER BY ended_at DESC LIMIT ?`).all(uid, uid, limit);
    const coin = db.prepare("SELECT amount FROM coin_tx WHERE user_id = ? AND reason = 'match' AND ref = ?");
    const out = rows.map((m) => {
      const me1 = m.p1 === uid, opp = Q.userById.get(me1 ? m.p2 : m.p1);
      const res = m.result === 'draw' ? 'draw' : (m.result === 'p1') === me1 ? 'win' : 'loss';
      const before = me1 ? m.p1_before : m.p2_before, after = me1 ? m.p1_after : m.p2_after;
      const c = coin.get(uid, m.id);
      return { type: '1v1', kind: m.kind || (m.ranked ? 'ranked' : 'custom'), res, mode: m.mode, diff: m.difficulty, opp: opp ? { id: opp.id, username: opp.username } : null,
        eloDelta: m.ranked && after != null && before != null ? after - before : null, coins: c ? c.amount : 0, at: m.ended_at };
    });
    const M = getMR(); const mr = M ? M.mrHistory(uid, limit) : [];
    return out.concat(mr).sort((a, b) => b.at - a.at).slice(0, limit);
  }
  route('GET', '/api/profile/:uid', 'opt', ({ params, user }) => {
    const id = Number(params.uid); const u = Number.isInteger(id) ? Q.userById.get(id) : null;
    if (!u) return R(404, { error: 'not_found' });
    const self = !!user && user.id === u.id, admin = isAdmin(user);
    const policy = ['public', 'friends', 'private'].includes(u.history_privacy) ? u.history_privacy : 'public';
    const visible = self || admin || policy === 'public' || (policy === 'friends' && !!user && isFriend(user.id, u.id));
    const killer = db.prepare("SELECT COUNT(*) n, SUM(CASE WHEN (p1 = ? AND result = 'p1') OR (p2 = ? AND result = 'p2') THEN 1 ELSE 0 END) w FROM matches WHERE (p1 = ? OR p2 = ?) AND mode = 'killer' AND ended_at IS NOT NULL AND result IN ('p1','p2','draw')").get(u.id, u.id, u.id, u.id);
    const classic = db.prepare("SELECT COUNT(*) n, SUM(CASE WHEN (p1 = ? AND result = 'p1') OR (p2 = ? AND result = 'p2') THEN 1 ELSE 0 END) w FROM matches WHERE (p1 = ? OR p2 = ?) AND mode = 'classic' AND ended_at IS NOT NULL AND result IN ('p1','p2','draw')").get(u.id, u.id, u.id, u.id);
    const T = titlesOf(u.id);
    const pu = Object.assign(pubUser(u), { activeTitle: activeTitle(u) });
    const totalGames = (u.games || 0) + (u.casual_games || 0) + (u.mr_games || 0), totalWins = (u.wins || 0) + (u.casual_wins || 0) + (u.mr_wins || 0);
    let hist = []; try { hist = titleHistory(u.id); } catch (e) { hist = []; }
    return { user: pu, self, muted: !!user && !!db.prepare('SELECT 1 FROM user_mutes WHERE user_id = ? AND target_id = ?').get(user.id, u.id),
      totals: { games: totalGames, wins: totalWins },
      ranked: { games: u.games, wins: u.wins, losses: u.losses, draws: u.draws, peak: u.peak, winRate: u.games ? Math.round(1000 * u.wins / u.games) / 10 : 0 },
      mr: { games: u.mr_games || 0, wins: u.mr_wins || 0, losses: u.mr_losses || 0, draws: u.mr_draws || 0, peak: u.peak, winRate: u.mr_games ? Math.round(1000 * u.mr_wins / u.mr_games) / 10 : 0 },
      classic: { games: classic.n || 0, wins: classic.w || 0 }, killer: { games: killer.n || 0, wins: killer.w || 0 },
      titles: T.list.filter((x) => x.unlocked), titleHistory: hist,
      historyPolicy: policy, historyVisible: visible, history: visible ? historyRows(u.id, 20) : [] };
  });

  /* ------------------------------------------------------------------ support reports */
  route('POST', '/api/support/report', true, ({ body, user }) => {
    if (limited('sup:' + user.id, 5, 3600000)) return R(429, { error: 'rate_limited' });
    const cat = SUPPORT_CATS.includes(body.category) ? body.category : 'other';
    const text = cleanText(body.body, 1000); if (text.length < 10) return R(400, { error: 'report_text' });
    const id = db.prepare('INSERT INTO support_reports (user_id, category, body, client, created_at) VALUES (?, ?, ?, ?, ?)').run(user.id, cat, text, cleanText(body.client, 200) || null, now()).lastInsertRowid;
    return { ok: true, id: Number(id) };
  });
  function adminOnly(fn) { return (a) => { if (!isAdmin(a.user)) return R(403, { error: 'forbidden' }); if (a.req.method !== 'GET' && limited('adm:' + a.user.id, 60, 60000)) return R(429, { error: 'rate_limited' }); return fn(a); }; }
  route('GET', '/api/admin/support', true, adminOnly(({ query }) => {
    const st = ['open', 'resolved', 'all'].includes(query.get('status')) ? query.get('status') : 'open';
    const rows = db.prepare(`SELECT s.*, u.username, u.player_id, a.username admin_name FROM support_reports s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN users a ON a.id = s.resolved_by
                             ${st === 'all' ? '' : 'WHERE s.status = ?'} ORDER BY s.id DESC LIMIT 200`).all(...(st === 'all' ? [] : [st]));
    return { rows: rows.map((r) => ({ id: r.id, uid: r.user_id, username: r.username, playerId: r.player_id, category: r.category, body: r.body, client: r.client, status: r.status, note: r.admin_note, admin: r.admin_name, createdAt: r.created_at, resolvedAt: r.resolved_at })),
      open: db.prepare("SELECT COUNT(*) n FROM support_reports WHERE status = 'open'").get().n };
  }));
  route('POST', '/api/admin/support/:id', true, adminOnly(({ params, body, user }) => {
    const id = Number(params.id); const r = Number.isInteger(id) ? db.prepare('SELECT * FROM support_reports WHERE id = ?').get(id) : null;
    if (!r) return R(404, { error: 'not_found' });
    const status = body.status === 'open' ? 'open' : 'resolved'; const note = cleanText(body.note, 500) || null;
    db.prepare('UPDATE support_reports SET status = ?, admin_note = ?, resolved_by = ?, resolved_at = ? WHERE id = ?').run(status, note, user.id, status === 'resolved' ? now() : null, id);
    const V = getV44(); if (V) V.audit(user.id, 'support_' + status, r.user_id, { supportId: id, note, statusBefore: r.status, statusAfter: status });
    return { ok: true };
  }));

  /* ------------------------------------------------------------------ admin: grant event borders / themes (audited) */
  route('POST', '/api/admin/grant', true, adminOnly(({ body, user }) => {
    const V = getV44(); if (!V) return R(500, { error: 'server_error' });
    const ref = String(body.user || '').trim();
    const t = /^\d+$/.test(ref) ? Q.userById.get(Number(ref)) : (Q.userByPlayerId.get(ref.toUpperCase()) || Q.userByName.get(ref.toLowerCase()));
    if (!t) return R(404, { error: 'not_found' });
    const note = cleanText(body.note, 300); if (note.length < 3) return R(400, { error: 'note_required' });
    if (body.kind === 'border') {
      const b = V.BORDERS.find((x) => x.id === String(body.id)); if (!b || b.id === 'none') return R(404, { error: 'not_found' });
      const ch = db.prepare("INSERT OR IGNORE INTO owned_borders (user_id, border_id, source, price, acquired_at) VALUES (?, ?, 'admin', 0, ?)").run(t.id, b.id, now());
      if (!ch.changes) return R(409, { error: 'owned' });
      V.audit(user.id, 'grant_border', t.id, { border: b.id, username: t.username, playerId: t.player_id, note });
      return { ok: true };
    }
    if (body.kind === 'theme') {
      const th = THEME_BY_ID.get(String(body.id)); if (!th || th.id === 'default') return R(404, { error: 'not_found' });
      const ch = db.prepare("INSERT OR IGNORE INTO owned_themes (user_id, theme_id, source, price, acquired_at) VALUES (?, ?, 'admin', 0, ?)").run(t.id, th.id, now());
      if (!ch.changes) return R(409, { error: 'owned' });
      V.audit(user.id, 'grant_theme', t.id, { theme: th.id, username: t.username, playerId: t.player_id, note });
      return { ok: true };
    }
    return R(400, { error: 'bad_request' });
  }));

  /* ------------------------------------------------------------------ about */
  const started = now();
  route('GET', '/api/about', false, () => {
    const V = getV44(); const M = getMR();
    return { version: VERSION, schema: SCHEMA, online: clients.size, players: db.prepare('SELECT COUNT(*) n FROM users').get().n, uptimeS: Math.round((now() - started) / 1000),
      elo: { kNew: 40, kSettled: 20, settledAfter: 30 }, coins: V ? { win: V.COIN.win, draw: V.COIN.draw, loss: V.COIN.loss, dailyCap: V.COIN.dailyMatchCap } : null,
      mr: { turnSec: M ? Math.round(M.TURN_MS / 1000) : 30, sizes: [2, 3] } };
  });

  /* ------------------------------------------------------------------ music library (server side, per player) */
  route('GET', '/api/me/music', true, ({ user }) => ({
    rows: db.prepare('SELECT id, title, mime, size, created_at FROM user_music WHERE user_id = ? ORDER BY id').all(user.id),
    max: MUSIC_MAX, limit: MUSIC_PER_USER }));
  route('POST', '/api/me/music', true, ({ body, user, query }) => {
    if (limited('mus:' + user.id, 20, 3600000)) return R(429, { error: 'rate_limited' });
    const buf = body; if (!Buffer.isBuffer(buf) || buf.length < 1000) return R(400, { error: 'music_bad' });
    if (buf.length > MUSIC_MAX) return R(400, { error: 'too_large' });
    const mime = audioMime(buf); if (!mime) return R(400, { error: 'music_bad' });
    const n = db.prepare('SELECT COUNT(*) n FROM user_music WHERE user_id = ?').get(user.id).n; if (n >= MUSIC_PER_USER) return R(409, { error: 'music_full' });
    const title = cleanText(query.get('title') || 'Lagu', 80) || 'Lagu';
    const id = db.prepare('INSERT INTO user_music (user_id, title, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(user.id, title, mime, buf.length, buf, now()).lastInsertRowid;
    return { ok: true, id: Number(id), title, mime, size: buf.length };
  }, { max: MUSIC_MAX + 1024, raw: true });
  route('GET', '/api/me/music/:id', true, ({ params, user, res }) => {
    const id = Number(params.id); const m = Number.isInteger(id) ? db.prepare('SELECT * FROM user_music WHERE id = ? AND user_id = ?').get(id, user.id) : null;
    if (!m) return R(404, { error: 'not_found' });
    res.writeHead(200, { 'Content-Type': m.mime, 'Content-Length': m.data.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    res.end(m.data);
  });
  route('DELETE', '/api/me/music/:id', true, ({ params, user }) => {
    const id = Number(params.id); const ch = Number.isInteger(id) ? db.prepare('DELETE FROM user_music WHERE id = ? AND user_id = ?').run(id, user.id) : { changes: 0 };
    return ch.changes ? { ok: true } : R(404, { error: 'not_found' });
  });

  /* ------------------------------------------------------------------ chat wallpaper picture (server side, per player) */
  const WP_MAX = 400 * 1024, WP_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
  route('GET', '/api/me/wallpaper', true, ({ user }) => {
    const r = db.prepare('SELECT data, updated_at FROM user_wallpaper WHERE user_id = ?').get(user.id);
    return { image: r ? r.data : null, at: r ? r.updated_at : null };
  });
  route('PUT', '/api/me/wallpaper', true, ({ body, user }) => {
    if (limited('wp:' + user.id, 30, 3600000)) return R(429, { error: 'rate_limited' });
    const d = String(body.image || '');
    if (d.length > WP_MAX) return R(400, { error: 'too_large' });
    if (!WP_RE.test(d)) return R(400, { error: 'bad_image' });
    db.prepare('INSERT INTO user_wallpaper (user_id, data, size, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, size = excluded.size, updated_at = excluded.updated_at').run(user.id, d, d.length, now());
    return { ok: true };
  }, { max: WP_MAX + 2048 });
  route('DELETE', '/api/me/wallpaper', true, ({ user }) => { db.prepare('DELETE FROM user_wallpaper WHERE user_id = ?').run(user.id); return { ok: true }; });

  function enrich(u, p) {
    if (!u || !p) return p;
    p.boardTheme = THEME_BY_ID.has(u.board_theme) ? u.board_theme : 'default';
    p.historyPrivacy = u.history_privacy || 'public';
    p.mrGames = u.mr_games || 0; p.mrWins = u.mr_wins || 0; p.mrLosses = u.mr_losses || 0;
    try { p.activeTitle = activeTitle(u); } catch (e) { p.activeTitle = null; }
    return p;
  }
  return { enrich, titlesOf, activeTitle, THEMES, setCookie, parseCookies, COOKIE };
}

module.exports = { init, THEMES, TITLE_IDS, parseCookies, audioMime };
