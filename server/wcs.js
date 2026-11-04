'use strict';
/* =====================================================================
   WCS – WORLD CHAMPIONSHIP SUDOKU (v4)   "Only the Best Reach the Final."
   Everything here is decided on the server; the client only displays it.
   - Eligibility: Elo >= 2000 read from the database at every entry / queue / ready action.
   - Championship matches: Classic Extreme only (graded + unique-solution checked in the worker).
   - Qualification Stage (no elimination, points 3/1/0) -> Knockout bracket (largest power of two
     <= qualified players, no byes) -> Grand Final -> WCS CHAMPION + GRANDMASTER SUDOKU titles.
   - Daily Tournament (rotating weekday challenge, same puzzle & rules for everyone, 3 attempts,
     every move validated by the server), Daily Streak with recovery tokens, XP / badge ledger.
   - Country flag: one change per 365 days per account (server clock).
   - Anti-cheat log, appeals, admin review (role from server/wcs-admins.json or SLA_ADMINS).
   ===================================================================== */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

module.exports = function initWCS(ctx) {
  const { db, Q, now, route, R, sendTo, clients, generate, newRoom, broadcastRoom, startMatch, userRoom, queue, miniUser, pubUser, privUser,
    refreshClientUser, limited, err, presence, flagEmoji, cleanChat, GEO, TEST_HOOKS } = ctx;
  /* v4.4: server-side ban check (player_bans) for every competitive WCS entry point */
  const banOf = (uid) => (ctx.banOf ? ctx.banOf(uid) : null);
  const banBody = (uid) => { const b = banOf(uid); return b ? { error: 'banned', ban: { reasonCode: b.reason_code, reasonText: b.reason_text || '', startsAt: b.starts_at, endsAt: b.ends_at, serverTime: now() } } : null; };
  const DAY = 864e5, HOUR = 3600e3, MYT = 8 * HOUR, YEAR_LOCK = 365 * DAY;

  /* ---------------- time helpers (Asia/Kuala_Lumpur, UTC+8, no DST) ---------------- */
  const dayKey = (t) => new Date((t == null ? now() : t) + MYT).toISOString().slice(0, 10);
  const dayStart = (k) => Date.parse(k + 'T00:00:00Z') - MYT;
  const addDays = (k, n) => new Date(Date.parse(k + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
  const weekday = (k) => new Date(k + 'T00:00:00Z').getUTCDay(); // 0 = Sunday
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const hashNum = (s) => parseInt(crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 12), 16) / 0xffffffffffff;

  /* ---------------- ledgers: XP, badges, anti-cheat ---------------- */
  const insXp = db.prepare('INSERT OR IGNORE INTO xp_transactions (user_id, amount, reason, ref, created_at) VALUES (?, ?, ?, ?, ?)');
  const addXp = db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?');
  function grantXp(uid, amount, reason, ref) {
    amount = Math.round(amount); if (!(amount > 0)) return 0;
    if (insXp.run(uid, amount, reason, String(ref), now()).changes !== 1) return 0; // UNIQUE(user, reason, ref): never paid twice
    addXp.run(amount, uid); return amount;
  }
  const insBadge = db.prepare('INSERT OR IGNORE INTO user_badges (user_id, badge, ref, earned_at) VALUES (?, ?, ?, ?)');
  const grantBadge = (uid, badge, ref) => insBadge.run(uid, badge, ref == null ? null : String(ref), now()).changes === 1;
  const insAc = db.prepare('INSERT INTO anticheat_logs (user_id, kind, detail, ref, created_at) VALUES (?, ?, ?, ?, ?)');
  function acLog(uid, kind, detail, ref) {
    try { insAc.run(uid || null, kind, typeof detail === 'string' ? detail : JSON.stringify(detail || {}), ref == null ? null : String(ref), now()); } catch (e) { console.error('acLog', e.message); }
  }
  const audit = (adminId, action, detail, targetId) => db.prepare('INSERT INTO admin_audit (admin_id, action, detail, created_at, target_id) VALUES (?, ?, ?, ?, ?)').run(adminId, action, JSON.stringify(detail || {}), now(), targetId == null ? null : targetId);

  /* ---------------- admin role (configuration, never from the client) ---------------- */
  function loadAdmins() {
    let names = String(process.env.SLA_ADMINS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    try { const f = JSON.parse(fs.readFileSync(path.join(__dirname, 'wcs-admins.json'), 'utf8')); if (Array.isArray(f.admins)) names = names.concat(f.admins.map((x) => String(x).toLowerCase())); } catch (e) { /* optional file */ }
    names.forEach((n) => db.prepare("UPDATE users SET role = 'admin' WHERE username_lc = ?").run(n));
  }
  loadAdmins();
  const isAdmin = (u) => !!u && Q.userById.get(u.id).role === 'admin';

  /* backfill: emoji flag column for accounts created before v4 (no lock is started by this) */
  db.prepare('SELECT id, country FROM users WHERE country IS NOT NULL AND country_flag IS NULL').all().forEach((r) => db.prepare('UPDATE users SET country_flag = ? WHERE id = ?').run(flagEmoji(r.country), r.id));

  /* =====================================================================
     COUNTRY FLAG – one change per 365 days, bound to the account, server clock
     ===================================================================== */
  function flagInfo(u) {
    u = Q.userById.get(u.id);
    const hist = db.prepare('SELECT old_code, new_code, kind, changed_at FROM flag_change_history WHERE user_id = ? ORDER BY changed_at DESC LIMIT 20').all(u.id);
    const locked = !!(u.next_flag_change && now() < u.next_flag_change);
    return { code: u.country || null, flag: u.country ? flagEmoji(u.country) : null, region: u.region || null, lastChange: u.last_flag_change || null,
      nextChange: u.next_flag_change || null, canChange: !locked, lockedFor: locked ? u.next_flag_change - now() : 0, serverTime: now(),
      history: hist.map((h) => ({ from: h.old_code, to: h.new_code, kind: h.kind, at: h.changed_at })) };
  }
  const flagTx = db.transaction((uid, oldC, geo, kind) => {
    const t = now(), lock = kind === 'change';
    db.prepare(`UPDATE users SET country = ?, region = ?, country_flag = ?, last_flag_change = CASE WHEN ? THEN ? ELSE last_flag_change END,
      next_flag_change = CASE WHEN ? THEN ? ELSE next_flag_change END WHERE id = ?`).run(geo.country, geo.region, geo.country ? flagEmoji(geo.country) : null, lock ? 1 : 0, t, lock ? 1 : 0, t + YEAR_LOCK, uid);
    db.prepare('INSERT INTO flag_change_history (user_id, old_code, new_code, kind, changed_at) VALUES (?, ?, ?, ?, ?)').run(uid, oldC, geo.country, kind, t);
  });
  /* geo = validated { country, region }. Region-only edits inside the same country are free. */
  function changeFlag(user, geo) {
    const u = Q.userById.get(user.id);
    if (!geo.country) { if (u.country) return { status: 400, error: 'flag_required' }; return { ok: true }; }
    if (geo.country === u.country) { db.prepare('UPDATE users SET region = ? WHERE id = ?').run(geo.region, u.id); return { ok: true }; }
    if (u.next_flag_change && now() < u.next_flag_change) {
      acLog(u.id, 'flag_change_blocked', { to: geo.country, next: u.next_flag_change });
      return { status: 403, error: 'flag_locked', nextChange: u.next_flag_change, serverTime: now() };
    }
    flagTx(u.id, u.country || null, geo, u.country ? 'change' : 'initial');
    return { ok: true };
  }
  route('GET', '/api/me/flag', true, ({ user }) => flagInfo(user));
  route('POST', '/api/me/flag', true, ({ user, body }) => {
    if (limited('flag:' + user.id, 10, 3600000)) return R(429, { error: 'rate_limited' });
    const geo = ctx.validGeo(body.country, body.region); if (!geo || !geo.country) return R(400, { error: 'bad_geo' });
    const r = changeFlag(user, geo); if (r.error) return R(r.status, r);
    const u = Q.userById.get(user.id); refreshClientUser(u);
    return Object.assign({ user: privUser(u) }, flagInfo(u));
  });
  route('GET', '/api/countries', false, () => ({ countries: Object.keys(GEO).sort((a, b) => GEO[a][0].localeCompare(GEO[b][0])).map((c) => ({ code: c, name: GEO[c][0], flag: flagEmoji(c) })) }));

  /* =====================================================================
     DAILY STREAK (server-verified solves only) + recovery tokens
     ===================================================================== */
  const STREAK_BADGES = [[7, 'streak_beginner'], [14, 'streak_consistent'], [30, 'streak_master'], [60, 'streak_elite'], [100, 'streak_legend']];
  function streakOf(uid) {
    const days = db.prepare('SELECT day, source FROM activity_days WHERE user_id = ? ORDER BY day').all(uid);
    const set = new Set(days.map((d) => d.day));
    let best = 0, run = 0, prev = null;
    for (const d of days) { run = prev && addDays(prev, 1) === d.day ? run + 1 : 1; prev = d.day; if (run > best) best = run; }
    const today = dayKey(); let end = set.has(today) ? today : set.has(addDays(today, -1)) ? addDays(today, -1) : null, cur = 0, start = null;
    if (end) { let d = end; while (set.has(d)) { cur++; start = d; d = addDays(d, -1); } }
    return { cur, best, start, today: set.has(today), set, days };
  }
  function streakRewards(uid, s) {
    const out = [];
    if (s.cur >= 3) {
      const recent = db.prepare("SELECT 1 FROM xp_transactions WHERE user_id = ? AND reason = 'streak3' AND created_at > ?").get(uid, now() - 3 * DAY);
      if (!recent) { const x = grantXp(uid, 50, 'streak3', s.start); if (x) out.push({ xp: x, why: 'streak3' }); }
    }
    STREAK_BADGES.forEach(([n, b]) => { if (s.cur >= n && grantBadge(uid, b, n)) out.push({ badge: b }); });
    db.prepare('UPDATE users SET streak_cur = ?, streak_best = MAX(streak_best, ?) WHERE id = ?').run(s.cur, s.best, uid);
    return out;
  }
  /* Called after a server-verified solve (solo run, Daily Tournament, or a match won by finishing the board). */
  function activity(uid, source, ref) {
    const r = db.prepare('INSERT OR IGNORE INTO activity_days (user_id, day, source, ref, created_at) VALUES (?, ?, ?, ?, ?)').run(uid, dayKey(), source, ref == null ? null : String(ref), now());
    const s = streakOf(uid); const rw = streakRewards(uid, s);
    if (r.changes) sendTo(uid, { t: 'streak', cur: s.cur, best: Math.max(s.best, s.cur), rewards: rw });
    return rw;
  }
  function tokenState(uid) {
    let unused = db.prepare('SELECT * FROM streak_tokens WHERE user_id = ? AND used_at IS NULL ORDER BY granted_at LIMIT 1').get(uid);
    const last = db.prepare('SELECT * FROM streak_tokens WHERE user_id = ? ORDER BY granted_at DESC LIMIT 1').get(uid);
    if (!unused && (!last || now() - last.granted_at >= 30 * DAY)) {
      const id = db.prepare('INSERT INTO streak_tokens (user_id, granted_at) VALUES (?, ?)').run(uid, now()).lastInsertRowid;
      unused = db.prepare('SELECT * FROM streak_tokens WHERE id = ?').get(id);
    }
    const lastNow = db.prepare('SELECT * FROM streak_tokens WHERE user_id = ? ORDER BY granted_at DESC LIMIT 1').get(uid);
    return { available: !!unused, tokenId: unused ? unused.id : null, grantedAt: unused ? unused.granted_at : null, nextAt: unused ? null : lastNow.granted_at + 30 * DAY };
  }
  function recoverable(uid, s) {
    const out = [], today = dayKey();
    for (const back of [1, 2]) {
      const d = addDays(today, -back);
      const open = now() >= dayStart(d) + DAY && now() < dayStart(d) + 3 * DAY; // 48 h after the missed day ended
      if (open && !s.set.has(d) && s.set.has(addDays(d, -1))) out.push({ day: d, until: dayStart(d) + 3 * DAY });
    }
    return out;
  }
  function streakPayload(uid) {
    const s = streakOf(uid), today = dayKey(), cal = [];
    const src = new Map(s.days.map((d) => [d.day, d.source]));
    for (let i = 83; i >= 0; i--) { const d = addDays(today, -i); cal.push({ day: d, src: src.get(d) || null }); }
    const badges = db.prepare('SELECT badge, earned_at FROM user_badges WHERE user_id = ?').all(uid);
    return { cur: s.cur, best: s.best, today: s.today, todayKey: today, nextDayAt: dayStart(addDays(today, 1)), calendar: cal, token: tokenState(uid), recoverable: recoverable(uid, s),
      recoveries: db.prepare('SELECT day, used_at FROM streak_recoveries WHERE user_id = ? ORDER BY used_at DESC LIMIT 20').all(uid).map((r) => ({ day: r.day, at: r.used_at })),
      milestones: [{ n: 3, reward: '50 XP' }].concat(STREAK_BADGES.map(([n, b]) => ({ n, badge: b, earned: badges.some((x) => x.badge === b) }))),
      xp: Q.userById.get(uid).xp, serverTime: now() };
  }
  route('GET', '/api/streak', true, ({ user }) => streakPayload(user.id));
  const recoverTx = db.transaction((uid, day, tokenId) => {
    db.prepare('INSERT INTO streak_recoveries (user_id, day, token_id, used_at) VALUES (?, ?, ?, ?)').run(uid, day, tokenId, now());
    if (db.prepare('UPDATE streak_tokens SET used_at = ?, used_day = ? WHERE id = ? AND used_at IS NULL').run(now(), day, tokenId).changes !== 1) throw new Error('token_race');
    db.prepare("INSERT INTO activity_days (user_id, day, source, ref, created_at) VALUES (?, ?, 'recovery', ?, ?)").run(uid, day, String(tokenId), now());
  });
  route('POST', '/api/streak/recover', true, ({ user, body }) => {
    if (limited('rec:' + user.id, 10, 3600000)) return R(429, { error: 'rate_limited' });
    const day = String(body.day || ''); if (!DAY_RE.test(day)) return R(400, { error: 'bad_day' });
    if (db.prepare('SELECT 1 FROM streak_recoveries WHERE user_id = ? AND day = ?').get(user.id, day)) return R(409, { error: 'already_recovered' });
    const s = streakOf(user.id);
    if (!recoverable(user.id, s).some((r) => r.day === day)) return R(400, { error: s.set.has(day) ? 'not_missed' : 'recovery_window' });
    const tk = tokenState(user.id); if (!tk.available) return R(403, { error: 'no_token', nextAt: tk.nextAt });
    try { recoverTx(user.id, day, tk.tokenId); } catch (e) { return R(409, { error: 'already_recovered' }); }
    const s2 = streakOf(user.id); streakRewards(user.id, s2);
    return streakPayload(user.id);
  });

  /* =====================================================================
     SERVER-VERIFIED SOLO RUNS (Daily Tournament + verified practice for streaks)
     ===================================================================== */
  const ROT = {
    1: { kind: 'speed', diff: 'medium', lives: 0, hints: 3, limitMin: 20, wAcc: 0.3, wTime: 0.7 },
    2: { kind: 'accuracy', diff: 'hard', lives: 1, hints: 2, limitMin: 30, wAcc: 0.7, wTime: 0.3 },
    3: { kind: 'survival', diff: 'hard', lives: 3, hints: 2, limitMin: 30, wAcc: 0.7, wTime: 0.3 },
    4: { kind: 'technique', diff: 'hard', lives: 0, hints: 0, limitMin: 30, wAcc: 0.7, wTime: 0.3 },
    5: { kind: 'mystery', diff: 'hard', lives: 0, hints: 2, limitMin: 30, wAcc: 0.7, wTime: 0.3 },
    6: { kind: 'extreme', diff: 'extreme', lives: 0, hints: 1, limitMin: 45, wAcc: 0.7, wTime: 0.3 },
    0: { kind: 'ultimate', diff: 'master', lives: 3, hints: 0, limitMin: 40, wAcc: 0.7, wTime: 0.3, perfectBonus: 150 }
  };
  const TECHS = [['naked_pair', 'medium'], ['hidden_pair', 'medium'], ['pointing_pair', 'hard'], ['box_line', 'hard'], ['naked_triple', 'hard'], ['x_wing', 'master'], ['xy_wing', 'master']];
  const SECRETS = ['no_hint', 'perfect_run', 'time_attack', 'roulette'];
  const EVENTS = ['double_xp', 'mystery_bonus', 'extreme_day', 'perfect_event', 'champion_bonus'];
  function dailyPlan(day) {
    const wd = weekday(day), base = Object.assign({}, ROT[wd]), h = hashNum('wcs-daily:' + day);
    const events = [];
    if (h < 0.55) events.push(EVENTS[Math.floor(hashNum('ev:' + day) * EVENTS.length)]);
    if (wd === 0 || wd === 6) events.push('weekend_special');
    if (base.kind === 'technique') { const t = TECHS[Math.floor(hashNum('tech:' + day) * TECHS.length)]; base.tech = t[0]; base.diff = t[1]; }
    if (base.kind === 'mystery') { base.secret = SECRETS[Math.floor(hashNum('sec:' + day) * SECRETS.length)]; if (base.secret === 'time_attack') { base.wAcc = 0.5; base.wTime = 0.5; } if (base.secret === 'roulette') base.diff = ['medium', 'hard', 'master', 'extreme'][Math.floor(hashNum('rl:' + day) * 4)]; }
    if (events.includes('extreme_day') && base.kind !== 'technique') base.diff = 'extreme';
    if (events.includes('mystery_bonus')) base.mysteryXp = 20 + Math.floor(hashNum('mx:' + day) * 81);
    base.limitMs = base.limitMin * 60000; base.attempts = 3;
    return { day, weekday: wd, rules: base, events };
  }
  const dailyInflight = new Map();
  function ensureDaily(day) {
    const row = db.prepare('SELECT * FROM daily_tournaments WHERE day = ?').get(day);
    if (row) return Promise.resolve(row);
    if (dailyInflight.has(day)) return dailyInflight.get(day);
    const plan = dailyPlan(day);
    const p = generate('classic', plan.rules.diff, { strict: plan.rules.diff === 'extreme', tech: plan.rules.tech || undefined }).then((P) => {
      if (plan.rules.tech && !P.used.includes(plan.rules.tech)) { const alt = TECHS.find((t) => P.used.includes(t[0])); plan.rules.tech = alt ? alt[0] : (P.used.find((x) => !/single/.test(x)) || plan.rules.tech); plan.rules.techAdjusted = true; }
      db.prepare('INSERT OR IGNORE INTO daily_tournaments (day, kind, rules_json, events_json, difficulty, puzzle_id, puzzle, solution, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(day, plan.rules.kind, JSON.stringify(plan.rules), JSON.stringify(plan.events), P.difficulty, P.pid, P.puzzle.join(''), P.solution.join(''), now());
      return db.prepare('SELECT * FROM daily_tournaments WHERE day = ?').get(day);
    }).finally(() => dailyInflight.delete(day));
    dailyInflight.set(day, p); return p;
  }
  const runById = db.prepare('SELECT * FROM solo_runs WHERE id = ?');
  function rulesOf(run) {
    if (run.kind === 'daily') { const d = db.prepare('SELECT rules_json FROM daily_tournaments WHERE day = ?').get(run.day); return JSON.parse(d.rules_json); }
    return { kind: 'practice', diff: run.difficulty, lives: 0, hints: 3, limitMs: run.limit_ms, wAcc: 0.7, wTime: 0.3 };
  }
  const publicRules = (r, reveal) => { const o = Object.assign({}, r); if (o.secret && !reveal) o.secret = 'hidden'; return o; };
  function runElapsed(run) { return (run.ended_at || now()) - run.started_at; }
  function expireIfNeeded(run) {
    if (run.status === 'active' && runElapsed(run) > run.limit_ms) {
      db.prepare("UPDATE solo_runs SET status = 'expired', ended_at = ?, time_ms = ? WHERE id = ? AND status = 'active'").run(run.started_at + run.limit_ms, run.limit_ms, run.id);
      return runById.get(run.id);
    }
    return run;
  }
  function runView(run, uid) {
    run = expireIfNeeded(run);
    const rules = rulesOf(run), done = run.status !== 'active';
    const wrong = run.grid.split('').map((v, i) => (v !== '0' && v !== run.solution[i]) ? '1' : '0').join('');
    return { id: run.id, kind: run.kind, day: run.day, n: run.n, difficulty: run.difficulty, puzzle: run.puzzle, grid: run.grid, wrong, status: run.status,
      mistakes: run.mistakes, hints: run.hints, livesLeft: rules.lives ? Math.max(0, rules.lives - run.mistakes) : null, elapsed: runElapsed(run), limitMs: run.limit_ms,
      startedAt: run.started_at, serverTime: now(), score: run.score, timeMs: run.time_ms, flagged: !!run.flagged, rules: publicRules(rules, done),
      detail: run.detail_json ? JSON.parse(run.detail_json) : null, solution: done ? run.solution : null };
  }
  function scoreRun(run, rules) {
    const ts = Math.max(0, Math.min(1, 1 - run.time_ms / rules.limitMs));
    let acc = rules.lives ? 1 - run.mistakes / rules.lives : 1 - 0.12 * run.mistakes;
    acc = Math.max(0, acc - 0.08 * run.hints);
    let score = 1000 * (rules.wAcc * acc + rules.wTime * ts), bonus = 0, notes = [];
    const perfect = run.mistakes === 0 && run.hints === 0;
    if (rules.perfectBonus && perfect) { bonus += rules.perfectBonus; notes.push('perfect_bonus'); }
    if (rules.secret === 'no_hint' && run.hints === 0) { bonus += 200; notes.push('secret_no_hint'); }
    if (rules.secret === 'perfect_run' && perfect) { bonus += 200; notes.push('secret_perfect'); }
    return { score: Math.round(score + bonus), acc: Math.round(acc * 1000) / 10, timeScore: Math.round(ts * 1000) / 10, bonus, notes, perfect };
  }
  function finishRun(run, uid) {
    const rules = rulesOf(run), t = now(), timeMs = t - run.started_at;
    const sc = scoreRun(Object.assign({}, run, { time_ms: timeMs }), rules);
    const empties = run.puzzle.split('').filter((x) => x === '0').length, minHuman = empties * 900;
    const flagged = timeMs < minHuman ? 1 : 0;
    const rewards = [];
    db.transaction(() => {
      if (db.prepare("UPDATE solo_runs SET status = 'solved', ended_at = ?, time_ms = ?, score = ?, flagged = ?, detail_json = ? WHERE id = ? AND status = 'active'")
        .run(t, timeMs, sc.score, flagged, JSON.stringify(sc), run.id).changes !== 1) return;
      if (flagged) { acLog(uid, 'run_too_fast', { run: run.id, kind: run.kind, timeMs, minHuman, empties }, run.id); return; } // no XP / streak until an admin clears it
      if (run.kind === 'daily') {
        const d = db.prepare('SELECT events_json FROM daily_tournaments WHERE day = ?').get(run.day), ev = JSON.parse(d.events_json);
        const mult = ev.includes('double_xp') ? 2 : 1;
        let x = grantXp(uid, (50 + Math.floor(sc.score / 20)) * mult, 'daily', run.day); if (x) rewards.push({ xp: x, why: 'daily' });
        if (ctx.coins) { const cn = ctx.coins(uid, 25, 'daily', run.day); if (cn) rewards.push({ coins: cn, why: 'daily_coins' }); }
        if (ev.includes('perfect_event') && sc.perfect) { x = grantXp(uid, 100 * mult, 'daily_perfect', run.day); if (x) rewards.push({ xp: x, why: 'perfect_event' }); }
        if (rules.mysteryXp) { x = grantXp(uid, rules.mysteryXp * mult, 'daily_mystery', run.day); if (x) rewards.push({ xp: x, why: 'mystery_bonus' }); }
        if (grantBadge(uid, 'daily_debut', run.day)) rewards.push({ badge: 'daily_debut' });
        if (ev.includes('weekend_special') && grantBadge(uid, 'weekend_warrior', run.day)) rewards.push({ badge: 'weekend_warrior' });
      } else {
        const n = db.prepare("SELECT COUNT(*) n FROM xp_transactions WHERE user_id = ? AND reason = 'practice' AND created_at >= ?").get(uid, dayStart(dayKey())).n;
        if (n < 10) { const x = grantXp(uid, 10, 'practice', run.id); if (x) rewards.push({ xp: x, why: 'practice' }); }
      }
    })();
    if (!flagged) activity(uid, run.kind, run.id).forEach((r) => rewards.push(r));
    const out = runView(runById.get(run.id), uid); out.rewards = rewards; out.user = privUser(Q.userById.get(uid));
    return out;
  }
  function ownRun(user, id) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) return null;
    const r = runById.get(id); return r && r.user_id === user.id ? r : null;
  }
  function newRun(uid, kind, P, extra) {
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO solo_runs (id, user_id, kind, day, n, difficulty, puzzle_id, puzzle, solution, grid, started_at, limit_ms, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`).run(id, uid, kind, extra.day || null, extra.n || null, P.difficulty, P.puzzle_id || null, P.puzzle, P.solution, P.puzzle, now(), extra.limitMs);
    return runById.get(id);
  }
  route('POST', '/api/daily/start', true, async ({ user }) => {
    { const bb = banBody(user.id); if (bb) return R(403, bb); }
    if (limited('dstart:' + user.id, 12, 600000)) return R(429, { error: 'rate_limited' });
    const day = dayKey(), D = await ensureDaily(day), rules = JSON.parse(D.rules_json);
    const runs = db.prepare("SELECT * FROM solo_runs WHERE user_id = ? AND kind = 'daily' AND day = ? ORDER BY n").all(user.id, day).map(expireIfNeeded);
    const active = runs.find((r) => r.status === 'active');
    if (active) return runView(active, user.id); // refresh / second tab resumes the same attempt, never a free extra one
    if (runs.length >= rules.attempts) return R(403, { error: 'no_attempts', used: runs.length, max: rules.attempts });
    const r = newRun(user.id, 'daily', { difficulty: D.difficulty, puzzle_id: D.puzzle_id, puzzle: D.puzzle, solution: D.solution }, { day, n: runs.length + 1, limitMs: rules.limitMs });
    return runView(r, user.id);
  });
  const PRACTICE_DIFFS = ['easy', 'medium', 'hard', 'master', 'extreme'];
  route('POST', '/api/practice/start', true, async ({ user, body }) => {
    const diff = PRACTICE_DIFFS.includes(body.diff) ? body.diff : null; if (!diff) return R(400, { error: 'bad_diff' });
    if (limited('pstart:' + user.id, 20, 3600000)) return R(429, { error: 'rate_limited' });
    db.prepare("UPDATE solo_runs SET status = 'abandoned', ended_at = ? WHERE user_id = ? AND kind = 'practice' AND status = 'active'").run(now(), user.id);
    const P = await generate('classic', diff);
    const r = newRun(user.id, 'practice', { difficulty: P.difficulty, puzzle_id: P.pid, puzzle: P.puzzle.join(''), solution: P.solution.join('') }, { limitMs: 2 * HOUR });
    return runView(r, user.id);
  });
  route('GET', '/api/run/active', true, ({ user }) => {
    const r = db.prepare("SELECT * FROM solo_runs WHERE user_id = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1").get(user.id);
    if (!r) return { run: null };
    const v = runView(r, user.id); return { run: v.status === 'active' ? v : null };
  });
  route('GET', '/api/run/:id', true, ({ user, params }) => { const r = ownRun(user, params.id); if (!r) return R(404, { error: 'not_found' }); return runView(r, user.id); });
  route('POST', '/api/run/:id/move', true, ({ user, params, body }) => {
    let r = ownRun(user, params.id); if (!r) return R(404, { error: 'not_found' });
    if (limited('runmv:' + user.id, 12, 1000)) { if (!limited('runmvlog:' + user.id, 1, 60000)) acLog(user.id, 'move_flood', { run: r.id }, r.id); return R(429, { error: 'rate_limited' }); }
    r = expireIfNeeded(r); if (r.status !== 'active') return R(409, Object.assign({ error: 'run_over' }, runView(r, user.id)));
    if (r.kind === 'daily') { const bb = banBody(user.id); if (bb) return R(403, bb); }
    const i = body.i, v = body.v;
    if (!Number.isInteger(i) || i < 0 || i > 80 || !Number.isInteger(v) || v < 0 || v > 9) return R(400, { error: 'bad_move' });
    if (r.puzzle[i] !== '0') return R(400, { error: 'given' });
    if (r.grid[i] === String(v)) return runView(r, user.id);
    if (r.grid[i] === r.solution[i] && v !== 0) return R(400, { error: 'locked' }); // correct cells stay (like the 1vs1 server)
    const grid = r.grid.slice(0, i) + v + r.grid.slice(i + 1), wrong = v !== 0 && String(v) !== r.solution[i];
    const rules = rulesOf(r), mistakes = r.mistakes + (wrong ? 1 : 0);
    db.prepare('UPDATE solo_runs SET grid = ?, mistakes = ?, moves = moves + 1 WHERE id = ? AND status = ?').run(grid, mistakes, r.id, 'active');
    if (rules.lives && mistakes >= rules.lives) {
      db.prepare("UPDATE solo_runs SET status = 'failed', ended_at = ?, time_ms = ?, score = 0 WHERE id = ? AND status = 'active'").run(now(), now() - r.started_at, r.id);
      return Object.assign(runView(runById.get(r.id), user.id), { last: { i, v, ok: false } });
    }
    if (grid === r.solution) return Object.assign(finishRun(runById.get(r.id), user.id), { last: { i, v, ok: true } });
    return Object.assign(runView(runById.get(r.id), user.id), { last: { i, v, ok: !wrong } });
  });
  route('POST', '/api/run/:id/hint', true, ({ user, params }) => {
    let r = ownRun(user, params.id); if (!r) return R(404, { error: 'not_found' });
    r = expireIfNeeded(r); if (r.status !== 'active') return R(409, { error: 'run_over' });
    const rules = rulesOf(r);
    if (!rules.hints) return R(403, { error: 'no_hints' });
    if (r.hints >= rules.hints) return R(403, { error: 'hint_limit' });
    const cand = []; for (let i = 0; i < 81; i++) if (r.puzzle[i] === '0' && r.grid[i] !== r.solution[i]) cand.push(i);
    if (!cand.length) return R(400, { error: 'nothing' });
    const i = cand[crypto.randomInt(cand.length)], grid = r.grid.slice(0, i) + r.solution[i] + r.grid.slice(i + 1);
    db.prepare('UPDATE solo_runs SET grid = ?, hints = hints + 1 WHERE id = ?').run(grid, r.id);
    if (grid === r.solution) return Object.assign(finishRun(runById.get(r.id), user.id), { hint: { i, v: +r.solution[i] } });
    return Object.assign(runView(runById.get(r.id), user.id), { hint: { i, v: +r.solution[i] } });
  });
  route('POST', '/api/run/:id/abandon', true, ({ user, params }) => {
    const r = ownRun(user, params.id); if (!r) return R(404, { error: 'not_found' });
    db.prepare("UPDATE solo_runs SET status = 'abandoned', ended_at = ?, time_ms = ? WHERE id = ? AND status = 'active'").run(now(), now() - r.started_at, r.id);
    return runView(runById.get(r.id), user.id);
  });
  function dailyBoard(day, limit) {
    return db.prepare(`SELECT r.user_id, MAX(r.score) score, MIN(CASE WHEN r.score IS NOT NULL THEN r.time_ms END) best_ms FROM solo_runs r
      WHERE r.kind = 'daily' AND r.day = ? AND r.status = 'solved' AND r.flagged = 0 GROUP BY r.user_id`).all(day)
      .map((x) => { const best = db.prepare("SELECT score, time_ms, mistakes, hints, n FROM solo_runs WHERE user_id = ? AND kind = 'daily' AND day = ? AND status = 'solved' AND flagged = 0 ORDER BY score DESC, time_ms ASC LIMIT 1").get(x.user_id, day); return Object.assign({ uid: x.user_id }, best); })
      .sort((a, b) => b.score - a.score || a.time_ms - b.time_ms).slice(0, limit || 100)
      .map((x, i) => Object.assign({ pos: i + 1, user: pubUser(Q.userById.get(x.uid)) }, { score: x.score, timeMs: x.time_ms, mistakes: x.mistakes, hints: x.hints, attempt: x.n }));
  }
  route('GET', '/api/daily', 'opt', async ({ user, query }) => {
    const today = dayKey(), day = DAY_RE.test(query.get('day') || '') && query.get('day') <= today ? query.get('day') : today;
    const D = day === today ? await ensureDaily(day) : db.prepare('SELECT * FROM daily_tournaments WHERE day = ?').get(day);
    if (!D) return R(404, { error: 'not_found' });
    const rules = JSON.parse(D.rules_json), events = JSON.parse(D.events_json);
    let me = null;
    if (user) {
      const runs = db.prepare("SELECT * FROM solo_runs WHERE user_id = ? AND kind = 'daily' AND day = ? ORDER BY n").all(user.id, day).map(expireIfNeeded);
      me = { used: runs.length, max: rules.attempts, active: (runs.find((r) => r.status === 'active') || {}).id || null,
        runs: runs.map((r) => ({ id: r.id, n: r.n, status: r.status, score: r.score, timeMs: r.time_ms, mistakes: r.mistakes, hints: r.hints, flagged: !!r.flagged })) };
      const best = runs.filter((r) => r.status === 'solved' && !r.flagged).sort((a, b) => b.score - a.score)[0]; me.best = best ? best.score : null;
    }
    const reveal = day < today || (me && me.used >= rules.attempts && !me.active);
    const week = []; const mon = addDays(today, -((weekday(today) + 6) % 7));
    for (let i = 0; i < 7; i++) { const d = addDays(mon, i); week.push({ day: d, weekday: weekday(d), kind: ROT[weekday(d)].kind, today: d === today }); }
    const board = dailyBoard(day, 100);
    return { day, today, weekday: weekday(day), kind: rules.kind, rules: publicRules(rules, reveal), events, difficulty: D.difficulty, puzzleId: D.puzzle_id,
      nextAt: dayStart(addDays(today, 1)), serverTime: now(), me, leaderboard: board, myPos: user ? (board.find((b) => b.user.id === user.id) || {}).pos || null : null, week,
      scoring: { standard: '70% accuracy + 30% time', speed: '30% accuracy + 70% time' } };
  });
  /* settle finished days: champion bonus + podium badges (once, guarded by settled_at and ledger uniqueness) */
  function settleDays() {
    const today = dayKey();
    db.prepare('SELECT * FROM daily_tournaments WHERE day < ? AND settled_at IS NULL').all(today).forEach((D) => {
      const ev = JSON.parse(D.events_json), top = dailyBoard(D.day, 3);
      db.transaction(() => {
        if (db.prepare('UPDATE daily_tournaments SET settled_at = ? WHERE day = ? AND settled_at IS NULL').run(now(), D.day).changes !== 1) return;
        top.forEach((t) => { grantBadge(t.user.id, 'daily_podium', D.day); if (ev.includes('champion_bonus')) grantXp(t.user.id, t.pos === 1 ? 300 : 200, 'champion_bonus', D.day); });
      })();
    });
  }

  /* =====================================================================
     WORLD CHAMPIONSHIP – seasons, qualification, knockout, Grand Final
     ===================================================================== */
  const CFG = { topN: 32, minMatches: 3, qualDays: 14, roundHours: 48, minElo: 2000, pairDailyCap: 2, readyMs: 120000 };
  const RULES = {
    points: { win: 3, draw: 1, loss: 0 },
    qualTiebreak: ['points', 'wins', 'fewer_losses', 'fastest_average_solve', 'earliest_last_result'],
    koTiebreak: ['fewer_mistakes', 'higher_seed'],
    walkover: 'If only one player pressed READY during the round window, that player advances. If neither or both (never at the same time), the higher seed advances.',
    difficulty: 'extreme', mode: 'classic', noPauses: true, mistakesLimit: 3
  };
  const season = () => db.prepare('SELECT * FROM wcs_seasons ORDER BY id DESC LIMIT 1').get();
  const seasonById = (id) => db.prepare('SELECT * FROM wcs_seasons WHERE id = ?').get(id);
  function createSeason() {
    const n = (db.prepare('SELECT COUNT(*) n FROM wcs_seasons').get().n || 0) + 1, start = now();
    const end = dayStart(addDays(dayKey(start), CFG.qualDays));
    db.prepare(`INSERT INTO wcs_seasons (name, status, qual_start, qual_end, top_n, min_matches, round_hours, min_elo, rules_json, created_at)
      VALUES (?, 'qualification', ?, ?, ?, ?, ?, ?, ?, ?)`).run('WCS Season ' + n, start, end, CFG.topN, CFG.minMatches, CFG.roundHours, CFG.minElo, JSON.stringify(RULES), start);
    return season();
  }
  if (!season()) createSeason();
  /* KO matches that were live when the server stopped become replayable (their match row was voided at startup). */
  db.prepare("UPDATE wcs_ko SET status = 'pending', match_id = NULL, ready1_at = NULL, ready2_at = NULL WHERE status = 'live'").run();

  const roundName = (size) => ({ 2: 'final', 4: 'sf', 8: 'qf', 16: 'r16', 32: 'r32', 64: 'r64' })[size] || ('r' + size);
  function bracketOrder(B) { let a = [1, 2]; while (a.length < B) { const n = a.length * 2 + 1, nx = []; a.forEach((x) => nx.push(x, n - x)); a = nx; } return a; }
  const QUAL_ORDER = `ORDER BY e.points DESC, e.wins DESC, e.losses ASC, CASE WHEN e.wins > 0 THEN e.solve_ms * 1.0 / e.wins ELSE 1e15 END ASC, COALESCE(e.last_at, 9e15) ASC, e.joined_at ASC`;
  function qualTable(sid) { return db.prepare(`SELECT e.* FROM wcs_entries e WHERE e.season_id = ? ${QUAL_ORDER}`).all(sid); }
  function eligible(u) { const s = season(); const r = Q.userById.get(u.id).rating; return { ok: r >= (s ? s.min_elo : CFG.minElo), rating: r, need: Math.max(0, (s ? s.min_elo : CFG.minElo) - r), min: s ? s.min_elo : CFG.minElo }; }
  function ensureEntry(sid, u) {
    const e = db.prepare('SELECT * FROM wcs_entries WHERE season_id = ? AND user_id = ?').get(sid, u.id);
    if (e) return e;
    db.prepare('INSERT INTO wcs_entries (season_id, user_id, joined_at, elo_at_join) VALUES (?, ?, ?, ?)').run(sid, u.id, now(), Q.userById.get(u.id).rating);
    return db.prepare('SELECT * FROM wcs_entries WHERE season_id = ? AND user_id = ?').get(sid, u.id);
  }
  function startKnockout(s, byAdmin) {
    const rows = qualTable(s.id).filter((e) => e.played >= s.min_matches), n = Math.min(s.top_n, rows.length);
    if (n < 2) { // not enough qualified players: extend the Qualification Stage by 7 days (announced in rules)
      const r = JSON.parse(s.rules_json); r.extensions = (r.extensions || 0) + 1;
      db.prepare('UPDATE wcs_seasons SET qual_end = ?, rules_json = ? WHERE id = ?').run(Math.max(s.qual_end, now()) + 7 * DAY, JSON.stringify(r), s.id);
      broadcastUpdate(); return { extended: true };
    }
    let B = 1; while (B * 2 <= n) B *= 2;
    const t = now(), order = bracketOrder(B), seeds = rows.slice(0, B);
    db.transaction(() => {
      if (db.prepare("UPDATE wcs_seasons SET status = 'knockout', bracket_size = ?, ko_start = ? WHERE id = ? AND status = 'qualification'").run(B, t, s.id).changes !== 1) return;
      seeds.forEach((e, i) => { db.prepare('UPDATE wcs_entries SET seed = ? WHERE season_id = ? AND user_id = ?').run(i + 1, s.id, e.user_id); grantBadge(e.user_id, 'wcs_qualifier', s.id); });
      for (let k = 0; k < B / 2; k++) {
        const a = seeds[order[2 * k] - 1], b = seeds[order[2 * k + 1] - 1];
        db.prepare(`INSERT INTO wcs_ko (season_id, round, slot, p1, p2, seed1, seed2, status, opens_at, deadline) VALUES (?, 1, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
          .run(s.id, k, a.user_id, b.user_id, order[2 * k], order[2 * k + 1], t, t + s.round_hours * HOUR);
      }
    })();
    broadcastUpdate();
    return { bracketSize: B, qualified: B, byAdmin: !!byAdmin };
  }
  const koById = (id) => db.prepare('SELECT * FROM wcs_ko WHERE id = ?').get(id);
  function koRoundRows(sid, round) { return db.prepare('SELECT * FROM wcs_ko WHERE season_id = ? AND round = ? ORDER BY slot').all(sid, round); }
  function maxRound(sid) { return (db.prepare('SELECT MAX(round) r FROM wcs_ko WHERE season_id = ?').get(sid).r) || 0; }
  function settleKo(ko, winner, reason) {
    return db.prepare("UPDATE wcs_ko SET status = 'done', winner = ?, reason = ?, ended_at = ? WHERE id = ? AND status != 'done'").run(winner, reason, now(), ko.id).changes === 1;
  }
  function koAdvance(sid) {
    const s = seasonById(sid); if (!s || s.status !== 'knockout') return;
    const r = maxRound(sid), rows = koRoundRows(sid, r);
    if (!rows.length || rows.some((x) => x.status !== 'done')) return;
    rows.forEach((x) => db.prepare('UPDATE wcs_entries SET eliminated_round = ? WHERE season_id = ? AND user_id = ?').run(r, sid, x.winner === x.p1 ? x.p2 : x.p1));
    if (rows.length === 1) { crown(s, rows[0]); return; }
    const t = now();
    db.transaction(() => {
      for (let k = 0; k < rows.length / 2; k++) {
        const A = rows[2 * k], B = rows[2 * k + 1];
        const wa = A.winner, wb = B.winner, sa = wa === A.p1 ? A.seed1 : A.seed2, sb = wb === B.p1 ? B.seed1 : B.seed2;
        db.prepare(`INSERT OR IGNORE INTO wcs_ko (season_id, round, slot, p1, p2, seed1, seed2, status, opens_at, deadline) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
          .run(sid, r + 1, k, wa, wb, sa, sb, t, t + s.round_hours * HOUR);
      }
      if (rows.length === 2) [rows[0].winner, rows[1].winner].forEach((u) => grantBadge(u, 'wcs_finalist', sid));
    })();
    broadcastUpdate();
  }
  function crown(s, fin) {
    const champ = fin.winner, runner = fin.winner === fin.p1 ? fin.p2 : fin.p1, u = Q.userById.get(champ), t = now();
    const ok = db.transaction(() => {
      if (db.prepare("UPDATE wcs_seasons SET status = 'finished', champion_id = ?, runner_up_id = ?, finished_at = ? WHERE id = ? AND status = 'knockout'").run(champ, runner, t, s.id).changes !== 1) return false;
      db.prepare('INSERT INTO wcs_champions (season_id, user_id, runner_up, final_ko_id, decided_at, rating_at, country) VALUES (?, ?, ?, ?, ?, ?, ?)').run(s.id, champ, runner, fin.id, t, u.rating, u.country);
      db.prepare('INSERT OR IGNORE INTO user_titles (user_id, title, season_id, awarded_at) VALUES (?, ?, ?, ?)').run(champ, 'wcs_champion', s.id, t);
      db.prepare('INSERT OR IGNORE INTO user_titles (user_id, title, season_id, awarded_at) VALUES (?, ?, ?, ?)').run(champ, 'grandmaster_sudoku', s.id, t);
      db.prepare('UPDATE users SET wcs_titles = (SELECT COUNT(*) FROM user_titles WHERE user_id = ? AND title = ?) WHERE id = ?').run(champ, 'wcs_champion', champ);
      db.prepare('UPDATE wcs_entries SET eliminated_round = NULL WHERE season_id = ? AND user_id = ?').run(s.id, champ);
      grantXp(champ, 1000, 'wcs_champion', s.id); grantXp(runner, 400, 'wcs_finalist', s.id);
      return true;
    })();
    if (!ok) return;
    const cu = Q.userById.get(champ); refreshClientUser(cu);
    const msg = { t: 'wcs_champion', season: { id: s.id, name: s.name }, champion: pubUser(cu), runnerUp: pubUser(Q.userById.get(runner)) };
    for (const uid of clients.keys()) sendTo(uid, msg);
    createSeason(); broadcastUpdate();
  }
  /* ---- queue (Qualification Stage) ---- */
  const wq = new Map(); // uid -> { uid, since, sid }
  const pairTodayQ = db.prepare(`SELECT COUNT(*) n FROM matches WHERE kind = 'wcs_q' AND season_id = ? AND started_at >= ? AND ((p1 = ? AND p2 = ?) OR (p1 = ? AND p2 = ?)) AND (result IS NULL OR result != 'void')`);
  function canQueue(u) {
    const s = season();
    if (!s || s.status !== 'qualification' || now() >= s.qual_end) return 'wcs_not_qualification';
    const el = eligible(u); if (!el.ok) { acLog(u.id, 'wcs_ineligible_attempt', { rating: el.rating, need: el.min }); return 'wcs_not_eligible'; }
    if (userRoom.has(u.id) || queue.has(u.id)) return 'busy';
    return null;
  }
  function wqTick() {
    const s = season(); if (!s || s.status !== 'qualification') { if (wq.size) wq.clear(); return; }
    const arr = [...wq.values()].sort((a, b) => a.since - b.since), used = new Set(), t0 = dayStart(dayKey());
    for (const a of arr) {
      if (used.has(a.uid)) continue;
      const b = arr.find((x) => x.uid !== a.uid && !used.has(x.uid) && pairTodayQ.get(s.id, t0, a.uid, x.uid, x.uid, a.uid).n < CFG.pairDailyCap);
      if (!b) continue;
      if (!clients.has(a.uid) || !clients.has(b.uid) || userRoom.has(a.uid) || userRoom.has(b.uid)) { [a, b].forEach((x) => { if (!clients.has(x.uid)) wq.delete(x.uid); }); continue; }
      if (Q.userById.get(a.uid).rating < s.min_elo || Q.userById.get(b.uid).rating < s.min_elo) { [a, b].forEach((x) => { if (Q.userById.get(x.uid).rating < s.min_elo) { wq.delete(x.uid); sendTo(x.uid, { t: 'error', code: 'wcs_not_eligible' }); } }); continue; }
      used.add(a.uid); used.add(b.uid); wq.delete(a.uid); wq.delete(b.uid);
      const room = newRoom({ ranked: true, kind: 'wcs_q', season: s.id, mode: 'classic', diff: 'extreme', host: a.uid });
      room.players.push(b.uid); userRoom.set(b.uid, room.code); room.ready[a.uid] = room.ready[b.uid] = true;
      [a.uid, b.uid].forEach((p) => sendTo(p, { t: 'mm_found', wcs: 'qualification', opp: miniUser(p === a.uid ? b.uid : a.uid), mode: 'classic', diff: 'extreme' }));
      broadcastRoom(room); startMatch(room);
    }
    for (const e of wq.values()) sendTo(e.uid, { t: 'wcs_queue', searching: true, waited: now() - e.since, pool: wq.size - 1 });
  }
  /* ---- knockout READY / start ---- */
  function myKo(uid) {
    const s = season(); if (!s || s.status !== 'knockout') return null;
    const r = maxRound(s.id);
    return db.prepare("SELECT * FROM wcs_ko WHERE season_id = ? AND round = ? AND (p1 = ? OR p2 = ?)").get(s.id, r, uid, uid) || null;
  }
  function koReady(u) {
    const ko = myKo(u.id); if (!ko) return 'wcs_no_ko_match';
    if (ko.status === 'done') return 'wcs_ko_done';
    if (ko.status === 'live') return 'busy';
    const t = now(); if (t < ko.opens_at || t >= ko.deadline) return 'wcs_ko_closed';
    if (userRoom.has(u.id) || queue.has(u.id) || wq.has(u.id)) return 'busy';
    const col = ko.p1 === u.id ? 'ready1_at' : 'ready2_at';
    db.prepare(`UPDATE wcs_ko SET ${col} = ? WHERE id = ?`).run(t, ko.id);
    const k2 = koById(ko.id), opp = ko.p1 === u.id ? ko.p2 : ko.p1, oppReady = ko.p1 === u.id ? k2.ready2_at : k2.ready1_at;
    sendTo(opp, { t: 'wcs_ready_ping', ko: ko.id, from: miniUser(u.id) });
    if (oppReady && t - oppReady < CFG.readyMs && clients.has(opp) && !userRoom.has(opp) && !queue.has(opp) && !wq.has(opp)) {
      if (db.prepare("UPDATE wcs_ko SET status = 'live', attempts = attempts + 1 WHERE id = ? AND status = 'pending'").run(ko.id).changes !== 1) return null;
      const room = newRoom({ ranked: true, kind: 'wcs_ko', season: ko.season_id, ko: ko.id, mode: 'classic', diff: 'extreme', host: ko.p1 });
      room.players.push(ko.p2); userRoom.set(ko.p2, room.code); room.ready[ko.p1] = room.ready[ko.p2] = true;
      const s = seasonById(ko.season_id), size = s.bracket_size / Math.pow(2, ko.round - 1);
      [ko.p1, ko.p2].forEach((p) => sendTo(p, { t: 'mm_found', wcs: roundName(size), opp: miniUser(p === ko.p1 ? ko.p2 : ko.p1), mode: 'classic', diff: 'extreme' }));
      broadcastRoom(room); startMatch(room); broadcastUpdate();
    }
    return null;
  }
  function koLive(room) { /* match row id is attached in onMatchFinished; nothing else to do here */ }
  function koDeadlines() {
    const s = season(); if (!s || s.status !== 'knockout') return;
    const t = now();
    /* a 'live' slot whose room vanished before a result (generation failure, both left in the countdown) becomes playable again */
    db.prepare("SELECT * FROM wcs_ko WHERE season_id = ? AND status = 'live'").all(s.id).forEach((ko) => {
      const alive = [...ctx.rooms.values()].some((r) => r.ko === ko.id && r.match && !r.match.over) || [...ctx.rooms.values()].some((r) => r.ko === ko.id && r.phase === 'generating');
      if (!alive) db.prepare("UPDATE wcs_ko SET status = 'pending', ready1_at = NULL, ready2_at = NULL WHERE id = ? AND status = 'live'").run(ko.id);
    });
    db.prepare("SELECT * FROM wcs_ko WHERE season_id = ? AND status = 'pending' AND deadline <= ?").all(s.id, t).forEach((ko) => {
      let w, why;
      if (ko.ready1_at && !ko.ready2_at) { w = ko.p1; why = 'walkover'; }
      else if (ko.ready2_at && !ko.ready1_at) { w = ko.p2; why = 'walkover'; }
      else { w = ko.seed1 <= ko.seed2 ? ko.p1 : ko.p2; why = 'seed_tiebreak'; }
      if (settleKo(ko, w, why)) acLog(w === ko.p1 ? ko.p2 : ko.p1, 'wcs_no_show', { ko: ko.id, round: ko.round, why }, ko.id);
    });
    koAdvance(s.id);
  }
  /* ---- match result hook (runs INSIDE the match transaction in server.js) ---- */
  function onMatchFinished(room, M, res, reason, ms) {
    const a = M.p1, b = M.p2, P = RULES.points;
    if (room.kind === 'wcs_q') {
      const up = db.prepare('UPDATE wcs_entries SET played = played + 1, wins = wins + ?, losses = losses + ?, draws = draws + ?, points = points + ?, solve_ms = solve_ms + ?, last_at = ? WHERE season_id = ? AND user_id = ?');
      [[a, 'p1'], [b, 'p2']].forEach(([u, me]) => {
        ensureEntry(room.season, { id: u });
        const w = res === me, l = res !== 'draw' && !w;
        up.run(w ? 1 : 0, l ? 1 : 0, res === 'draw' ? 1 : 0, w ? P.win : res === 'draw' ? P.draw : P.loss, w && reason === 'finish' ? ms : 0, now(), room.season, u);
      });
      return { kind: 'wcs_q', season: room.season, res, a, b, pts: { [a]: res === 'p1' ? P.win : res === 'draw' ? P.draw : P.loss, [b]: res === 'p2' ? P.win : res === 'draw' ? P.draw : P.loss } };
    }
    const ko = koById(room.ko); if (!ko || ko.status === 'done') return null;
    let w = res === 'p1' ? a : res === 'p2' ? b : null, why = reason;
    if (!w) { // draw -> pre-announced tie-break: fewer mistakes, then higher seed
      if (M.mistakes[a] !== M.mistakes[b]) { w = M.mistakes[a] < M.mistakes[b] ? a : b; why = 'tb_mistakes'; }
      else { const sa = ko.p1 === a ? ko.seed1 : ko.seed2, sb = ko.p1 === b ? ko.seed1 : ko.seed2; w = sa <= sb ? a : b; why = 'tb_seed'; }
    }
    db.prepare('UPDATE wcs_ko SET match_id = ? WHERE id = ?').run(M.mid, ko.id);
    settleKo(ko, w, why);
    return { kind: 'wcs_ko', season: room.season, ko: ko.id, round: ko.round, winner: w, why, a, b };
  }
  function resultFor(w, uid) {
    if (w.kind === 'wcs_q') { const e = db.prepare('SELECT points, played, wins, losses, draws FROM wcs_entries WHERE season_id = ? AND user_id = ?').get(w.season, uid); return { kind: 'wcs_q', points: w.pts[uid], total: e }; }
    return { kind: 'wcs_ko', round: w.round, advanced: w.winner === uid, why: w.why };
  }
  function afterFinish(w) { if (w.kind === 'wcs_ko') koAdvance(w.season); broadcastUpdate(); }
  let updT = null;
  function broadcastUpdate() { clearTimeout(updT); updT = setTimeout(() => { for (const uid of clients.keys()) sendTo(uid, { t: 'wcs_update' }); }, 300); }

  /* ---- state API ---- */
  function mini(uid) { const u = Q.userById.get(uid); return u ? { id: u.id, username: u.username, country: u.country, flag: u.country ? flagEmoji(u.country) : null, rating: u.rating, avatar: u.avatar || null, titles: u.wcs_titles || 0 } : null; }
  function bracketOf(s) {
    if (!s.bracket_size) return null;
    const rounds = [], R0 = Math.log2(s.bracket_size);
    for (let r = 1; r <= R0; r++) {
      const size = s.bracket_size / Math.pow(2, r - 1), rows = koRoundRows(s.id, r);
      rounds.push({ round: r, size, name: roundName(size), matches: rows.map((k) => ({ id: k.id, slot: k.slot, p1: mini(k.p1), p2: mini(k.p2), seed1: k.seed1, seed2: k.seed2, status: k.status, winner: k.winner, reason: k.reason,
        opensAt: k.opens_at, deadline: k.deadline, ready1: !!k.ready1_at, ready2: !!k.ready2_at, matchId: k.match_id, endedAt: k.ended_at })) });
    }
    return { size: s.bracket_size, rounds };
  }
  function seasonOut(s) { return { id: s.id, name: s.name, status: s.status, qualStart: s.qual_start, qualEnd: s.qual_end, topN: s.top_n, minMatches: s.min_matches, roundHours: s.round_hours, minElo: s.min_elo, rules: JSON.parse(s.rules_json), bracketSize: s.bracket_size, koStart: s.ko_start, finishedAt: s.finished_at }; }
  function journey(sid, uid) {
    return db.prepare('SELECT round, p1, p2, winner, reason, status FROM wcs_ko WHERE season_id = ? AND (p1 = ? OR p2 = ?) ORDER BY round').all(sid, uid, uid)
      .map((k) => ({ round: k.round, opp: mini(k.p1 === uid ? k.p2 : k.p1), status: k.status, won: k.status === 'done' ? k.winner === uid : null, reason: k.reason }));
  }
  route('GET', '/api/wcs/state', 'opt', ({ user, query }) => {
    let s = season(); const sid = Number(query.get('season')); if (sid) s = seasonById(sid) || s;
    const tbl = qualTable(s.id);
    let elig = 0; const erank = tbl.map((e) => (e.played >= s.min_matches ? ++elig : 0)); // rank among players meeting the minimum matches
    const qual = tbl.slice(0, 200).map((e, i) => ({ pos: i + 1, user: mini(e.user_id), played: e.played, wins: e.wins, losses: e.losses, draws: e.draws, points: e.points, seed: e.seed,
      status: s.status === 'qualification' ? (erank[i] && erank[i] <= s.top_n ? 'qualified' : 'not_qualified') : (e.seed ? 'qualified' : 'not_qualified'), eliminated: e.eliminated_round }));
    let me = null;
    if (user) {
      const el = eligible(user), idx = tbl.findIndex((e) => e.user_id === user.id), e = idx >= 0 ? tbl[idx] : null, ko = s.status === 'knockout' ? myKo(user.id) : null;
      me = { eligible: el.ok, rating: el.rating, need: el.need, minElo: el.min, entered: !!e, pos: idx >= 0 ? idx + 1 : null, entry: e ? { played: e.played, wins: e.wins, losses: e.losses, draws: e.draws, points: e.points, seed: e.seed } : null,
        queued: wq.has(user.id), ko: ko ? { id: ko.id, round: ko.round, opp: mini(ko.p1 === user.id ? ko.p2 : ko.p1), status: ko.status, deadline: ko.deadline, opensAt: ko.opens_at,
          meReady: !!(ko.p1 === user.id ? ko.ready1_at : ko.ready2_at), oppReady: !!(ko.p1 === user.id ? ko.ready2_at : ko.ready1_at), oppReadyNow: !!(ko.p1 === user.id ? ko.ready2_at && now() - ko.ready2_at < CFG.readyMs : ko.ready1_at && now() - ko.ready1_at < CFG.readyMs), winner: ko.winner } : null,
        journey: journey(s.id, user.id), admin: isAdmin(user) };
    }
    const br = bracketOf(s), last = db.prepare('SELECT * FROM wcs_champions ORDER BY season_id DESC LIMIT 1').get();
    const fin = br ? br.rounds[br.rounds.length - 1].matches[0] || null : null;
    return { season: seasonOut(s), seasons: db.prepare('SELECT id, name, status FROM wcs_seasons ORDER BY id DESC').all(), qualification: qual, qualifiedCount: Math.min(s.top_n, tbl.filter((e) => e.played >= s.min_matches).length),
      entrants: tbl.length, bracket: br, final: fin, me, serverTime: now(), eligibleCount: db.prepare('SELECT COUNT(*) n FROM users WHERE rating >= ?').get(s.min_elo).n,
      lastChampion: last ? { season: last.season_id, seasonName: (seasonById(last.season_id) || {}).name, user: mini(last.user_id), runnerUp: mini(last.runner_up), at: last.decided_at } : null };
  });
  route('POST', '/api/wcs/enter', true, ({ user }) => {
    { const bb = banBody(user.id); if (bb) return R(403, bb); }
    const s = season(); if (!s || s.status !== 'qualification' || now() >= s.qual_end) return R(409, { error: 'wcs_not_qualification' });
    const el = eligible(user);
    if (!el.ok) { acLog(user.id, 'wcs_ineligible_attempt', { rating: el.rating, need: el.min, via: 'enter' }); return R(403, { error: 'wcs_not_eligible', rating: el.rating, need: el.need, minElo: el.min }); }
    const e = ensureEntry(s.id, user); return { ok: true, entry: e };
  });
  route('GET', '/api/wcs/halloffame', false, () => ({
    champions: db.prepare('SELECT * FROM wcs_champions ORDER BY season_id DESC').all().map((c) => ({ season: c.season_id, seasonName: (seasonById(c.season_id) || {}).name, champion: mini(c.user_id), runnerUp: mini(c.runner_up), at: c.decided_at, ratingAt: c.rating_at,
      wins: db.prepare("SELECT COUNT(*) n FROM user_titles WHERE user_id = ? AND title = 'wcs_champion'").get(c.user_id).n }))
  }));
  const FINISH = (s, e) => { if (!e) return null; if (s.champion_id === e.user_id) return 'champion'; if (!e.seed) return e.played ? 'qualification' : null; const er = e.eliminated_round; if (!er) return 'in_knockout'; const size = s.bracket_size / Math.pow(2, er - 1); return roundName(size); };
  function profileOf(uid) {
    const u = Q.userById.get(uid); if (!u) return null;
    const titles = db.prepare('SELECT title, season_id, awarded_at FROM user_titles WHERE user_id = ? ORDER BY awarded_at').all(uid).map((t) => ({ title: t.title, season: t.season_id, seasonName: (seasonById(t.season_id) || {}).name, at: t.awarded_at }));
    const seasons = db.prepare('SELECT e.*, s.name, s.status, s.champion_id, s.bracket_size FROM wcs_entries e JOIN wcs_seasons s ON s.id = e.season_id WHERE e.user_id = ? ORDER BY e.season_id DESC').all(uid)
      .map((e) => ({ season: e.season_id, name: e.name, played: e.played, wins: e.wins, losses: e.losses, draws: e.draws, points: e.points, seed: e.seed, result: FINISH({ champion_id: e.champion_id, status: e.status, bracket_size: e.bracket_size }, e) }));
    return { user: Object.assign(pubUser(u), { flag: u.country ? flagEmoji(u.country) : null }), titles, championships: titles.filter((t) => t.title === 'wcs_champion').length,
      badges: db.prepare('SELECT badge, earned_at FROM user_badges WHERE user_id = ? ORDER BY earned_at').all(uid), xp: u.xp, streak: { cur: u.streak_cur, best: u.streak_best }, seasons };
  }
  route('GET', '/api/wcs/player/:uid', 'opt', ({ params }) => { const p = profileOf(Number(params.uid)); return p || R(404, { error: 'not_found' }); });
  route('GET', '/api/me/xp', true, ({ user }) => ({ xp: Q.userById.get(user.id).xp, rows: db.prepare('SELECT amount, reason, ref, created_at FROM xp_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(user.id) }));
  route('GET', '/api/me/elo', true, ({ user }) => ({ rows: db.prepare('SELECT match_id, kind, before, after, delta, k, score, created_at FROM elo_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(user.id) }));

  /* ---- appeals ---- */
  route('POST', '/api/appeals', true, ({ user, body }) => {
    if (limited('appeal:' + user.id, 5, 86400000)) return R(429, { error: 'rate_limited' });
    const type = ['match', 'run', 'wcs', 'flag', 'other'].includes(body.refType) ? body.refType : null; if (!type) return R(400, { error: 'bad_request' });
    const text = cleanChat(String(body.body || ''), 500); if (!text || text.length < 10) return R(400, { error: 'appeal_text' });
    const ref = body.ref == null ? null : String(body.ref).slice(0, 64);
    const id = db.prepare('INSERT INTO appeals (user_id, ref_type, ref, body, created_at) VALUES (?, ?, ?, ?, ?)').run(user.id, type, ref, text, now()).lastInsertRowid;
    return { ok: true, id };
  });
  route('GET', '/api/appeals', true, ({ user }) => ({ rows: db.prepare('SELECT id, ref_type, ref, body, status, admin_note, created_at, resolved_at FROM appeals WHERE user_id = ? ORDER BY id DESC LIMIT 30').all(user.id) }));

  /* ---- admin (role checked from the database on every call; every action is audited) ---- */
  const adminOnly = (fn) => (a) => { if (!isAdmin(a.user)) { acLog(a.user.id, 'admin_denied', { path: a.req.url }); return R(403, { error: 'forbidden' }); } return fn(a); };
  route('GET', '/api/admin/summary', true, adminOnly(() => ({ season: seasonOut(season()), openLogs: db.prepare("SELECT COUNT(*) n FROM anticheat_logs WHERE status = 'open'").get().n,
    openAppeals: db.prepare("SELECT COUNT(*) n FROM appeals WHERE status = 'open'").get().n, eligible: db.prepare('SELECT COUNT(*) n FROM users WHERE rating >= ?').get(season().min_elo).n,
    audit: db.prepare('SELECT * FROM admin_audit ORDER BY id DESC LIMIT 20').all() })));
  route('POST', '/api/admin/wcs/config', true, adminOnly(({ user, body }) => {
    const s = season(); if (s.status !== 'qualification') return R(409, { error: 'config_locked' }); // bracket rules cannot change once the knockout started
    const topN = body.topN == null ? s.top_n : Number(body.topN), minM = body.minMatches == null ? s.min_matches : Number(body.minMatches), rh = body.roundHours == null ? s.round_hours : Number(body.roundHours);
    const qe = body.qualEnd == null ? s.qual_end : Number(body.qualEnd);
    if (![2, 4, 8, 16, 32, 64].includes(topN) || !(minM >= 1 && minM <= 50) || !(rh >= 1 && rh <= 168) || !(qe > now() && qe < now() + 90 * DAY)) return R(400, { error: 'bad_config' });
    db.prepare('UPDATE wcs_seasons SET top_n = ?, min_matches = ?, round_hours = ?, qual_end = ? WHERE id = ?').run(topN, minM, rh, qe, s.id);
    audit(user.id, 'wcs_config', { season: s.id, topN, minMatches: minM, roundHours: rh, qualEnd: qe }); broadcastUpdate();
    return { season: seasonOut(season()) };
  }));
  route('POST', '/api/admin/wcs/end-qualification', true, adminOnly(({ user }) => {
    const s = season(); if (s.status !== 'qualification') return R(409, { error: 'not_qualification' });
    const r = startKnockout(s, true); audit(user.id, 'wcs_end_qualification', Object.assign({ season: s.id }, r)); return Object.assign({ season: seasonOut(season()) }, r);
  }));
  route('GET', '/api/admin/anticheat', true, adminOnly(({ query }) => {
    const st = ['open', 'dismissed', 'confirmed'].includes(query.get('status')) ? query.get('status') : 'open';
    return { rows: db.prepare('SELECT a.*, u.username FROM anticheat_logs a LEFT JOIN users u ON u.id = a.user_id WHERE a.status = ? ORDER BY a.id DESC LIMIT 100').all(st) };
  }));
  route('POST', '/api/admin/anticheat/:id', true, adminOnly(({ user, params, body }) => {
    const row = db.prepare('SELECT * FROM anticheat_logs WHERE id = ?').get(Number(params.id)); if (!row) return R(404, { error: 'not_found' });
    const st = body.status; if (!['dismissed', 'confirmed'].includes(st)) return R(400, { error: 'bad_request' });
    db.transaction(() => {
      db.prepare('UPDATE anticheat_logs SET status = ?, reviewed_by = ?, reviewed_at = ?, note = ? WHERE id = ?').run(st, user.id, now(), String(body.note || '').slice(0, 300), row.id);
      if (row.kind === 'run_too_fast' && row.ref) db.prepare(`UPDATE solo_runs SET flagged = ?, status = CASE WHEN ? = 'confirmed' THEN 'void' ELSE status END WHERE id = ?`).run(st === 'confirmed' ? 1 : 0, st, row.ref);
    })();
    audit(user.id, 'anticheat_' + st, { log: row.id }); return { ok: true };
  }));
  route('GET', '/api/admin/appeals', true, adminOnly(() => ({ rows: db.prepare('SELECT a.*, u.username FROM appeals a JOIN users u ON u.id = a.user_id ORDER BY (a.status = \'open\') DESC, a.id DESC LIMIT 100').all() })));
  route('POST', '/api/admin/appeals/:id', true, adminOnly(({ user, params, body }) => {
    const st = body.status; if (!['accepted', 'rejected'].includes(st)) return R(400, { error: 'bad_request' });
    const ch = db.prepare("UPDATE appeals SET status = ?, admin_note = ?, resolved_at = ?, resolved_by = ? WHERE id = ? AND status = 'open'").run(st, String(body.note || '').slice(0, 300), now(), user.id, Number(params.id)).changes;
    if (!ch) return R(404, { error: 'not_found' });
    audit(user.id, 'appeal_' + st, { appeal: Number(params.id) }); return { ok: true };
  }));

  /* ---- automated tests only (SLA_TEST_HOOKS=1). Not reachable in production. ---- */
  if (TEST_HOOKS) {
    route('POST', '/api/_test/clock', false, ({ body }) => { ctx.setClock(Number(body.offsetMs) || 0); return { now: now(), off: ctx.getClock() }; });
    route('POST', '/api/_test/rating', false, ({ body }) => { db.prepare('UPDATE users SET rating = ? WHERE id = ?').run(Number(body.rating), Number(body.uid)); const u = Q.userById.get(Number(body.uid)); refreshClientUser(u); return { user: privUser(u) }; });
    route('POST', '/api/_test/admin', false, ({ body }) => { db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(Number(body.uid)); return { ok: true }; });
    route('POST', '/api/_test/tick', false, () => { tick(); return { ok: true }; });
    route('POST', '/api/_test/activity', false, ({ body }) => { db.prepare('INSERT OR IGNORE INTO activity_days (user_id, day, source, created_at) VALUES (?, ?, ?, ?)').run(Number(body.uid), String(body.day), 'test', now()); return { ok: true }; });
  }

  /* ---- WebSocket ---- */
  function onWs(c, m, room) {
    const u = c.user, uid = u.id;
    if (m.t === 'wcs_cancel') { wq.delete(uid); sendTo(uid, { t: 'wcs_queue', searching: false }); return; }
    if (m.t === 'wcs_find' || m.t === 'wcs_ready') { if (ctx.gate && ctx.gate(uid)) return; }
    if (m.t === 'wcs_find') {
      if (room || wq.has(uid)) return err(uid, 'busy');
      const why = canQueue(u); if (why) return err(uid, why);
      ensureEntry(season().id, u); wq.set(uid, { uid, since: now() });
      sendTo(uid, { t: 'wcs_queue', searching: true, waited: 0, pool: wq.size - 1 }); presence(uid); return;
    }
    if (m.t === 'wcs_ready') {
      const why = koReady(u); if (why) return err(uid, why);
      sendTo(uid, { t: 'wcs_update' });
    }
  }
  function tick() {
    try {
      const s = season();
      if (s && s.status === 'qualification' && now() >= s.qual_end) startKnockout(s, false);
      koDeadlines(); wqTick(); settleDays();
    } catch (e) { console.error('wcs tick', e); }
  }
  setInterval(tick, 2000).unref();

  return { loadAdmins, changeFlag, activity, acLog, onMatchFinished, resultFor, afterFinish, koLive, onWs, onClosed: (uid) => wq.delete(uid), queued: (uid) => wq.has(uid),
    _t: { dayKey, addDays, dayStart, dailyPlan, bracketOrder, scoreRun, startKnockout, season, tick, streakOf } };
};
