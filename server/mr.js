'use strict';
/* WCS v4.4 – Multiplayer Ranked (MR): turn-based 2v2 / 3v3 team Sudoku.
   Server-authoritative:
   - Every team gets its own copy of the same puzzle. Only the server knows the solution; a client only ever
     receives its own team's board and the other team's progress percentage.
   - Turn order A1 → B1 → A2 → B2 (→ A3 → B3). Only the player whose turn it is may place a digit; one move per turn.
     A turn lasts TURN_MS; a timeout simply passes the turn (no mistake).
   - 3 mistakes eliminate a player. A team wins when its board is complete, or when every member of the
     other team is eliminated / has left. After MATCH_LIMIT_MS the team with more progress wins.
   - Elo is the same single Elo as Ranked 1v1 (standard Elo against the other team's average rating).
   - Banned players cannot queue, create, join, ready or start; a ban during a match voids it (no Elo, no coins).
   - Voice signalling is relayed only between members of the same team. Chat respects mutes. */
const crypto = require('crypto');

const SIZES = [2, 3];
const MODES = ['classic', 'killer'];
const DIFFS = ['easy', 'medium', 'hard', 'master', 'extreme'];
const KILLER_DIFFS = ['medium', 'hard'];
const TURN_MS = +process.env.SLA_MR_TURN_MS || 30000;
const COUNTDOWN_MS = +process.env.SLA_MR_COUNTDOWN_MS || 5000;
const MATCH_LIMIT_MS = +process.env.SLA_MR_LIMIT_MS || 60 * 60 * 1000;
const DISC_FORFEIT_MS = +process.env.SLA_MR_DISC_MS || 90000;
const LOBBY_GRACE_MS = +process.env.SLA_MR_LOBBY_GRACE_MS || 20000;
const RESULT_BACK_MS = +process.env.SLA_MR_BACK_MS || 20000;
const PRIVATE_RATED_CAP = 3;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_SIGNAL = 16 * 1024;

function clampDiff(mode, diff) {
  if (mode !== 'killer') return diff;
  if (KILLER_DIFFS.includes(diff)) return diff;
  return diff === 'easy' ? 'medium' : 'hard';
}

function init(ctx) {
  const { db, Q, now, route, R, sendTo, clients, generate, kFactor, eloNew, expected, privUser, refreshClientUser, roomOf, queue, getWCS, isFriend, presence, limited, cleanText, lite } = ctx;
  const V44 = () => ctx.getV44();
  const lobbies = new Map();   // code -> lobby
  const userLobby = new Map(); // uid -> code
  const pools = new Map();     // "size|mode|diff" -> [uid]
  const userPool = new Map();  // uid -> key
  const graceTimers = new Map();
  const lastChat = new Map();
  const muteCache = new Map();

  function mutesOf(uid) {
    if (!muteCache.has(uid)) muteCache.set(uid, new Set(db.prepare('SELECT target_id FROM user_mutes WHERE user_id = ?').all(uid).map((r) => r.target_id)));
    return muteCache.get(uid);
  }
  function mutesChanged(uid) { muteCache.delete(uid); }

  const lobbyOf = (uid) => { const c = userLobby.get(uid); return c ? lobbies.get(c) : null; };
  const members = (L) => L.A.concat(L.B);
  const teamOf = (L, uid) => L.A.includes(uid) ? 'A' : L.B.includes(uid) ? 'B' : null;
  const wcsQueued = (uid) => { try { const W = getWCS(); return !!(W && W.queued && W.queued(uid)); } catch (e) { return false; } };
  function busy(uid) { return userLobby.has(uid) || userPool.has(uid); }
  function otherBusy(uid) { return queue.has(uid) || !!roomOf(uid) || wcsQueued(uid); }
  function err(uid, code, extra) { sendTo(uid, Object.assign({ t: 'error', code }, extra || {})); }
  function gate(uid) { const v = V44(); return !!(v && v.gate(uid)); }

  /* ------------------------------------------------------------------ views */
  function playerView(L, uid) {
    const u = Q.userById.get(uid); const base = lite(u);
    const G = L.game;
    return Object.assign(base, { team: teamOf(L, uid), ready: !!L.ready[uid], host: L.host === uid, connected: clients.has(uid), mic: L.mic[uid] || 'off',
      mistakes: G ? (G.mistakes[uid] || 0) : 0 });
  }
  function lobbyMsg(L, uid) {
    const myTeam = teamOf(L, uid), mutes = mutesOf(uid);
    return { t: 'mr_lobby', code: L.code, private: L.private, size: L.size, mode: L.mode, diff: L.diff, phase: L.phase,
      A: L.A.map((p) => playerView(L, p)), B: L.B.map((p) => playerView(L, p)), myTeam, joined: members(L).length, total: L.size * 2,
      rated: L.rated, countdownEnd: L.countdownEnd || null, serverTime: now(),
      chat: L.chat.filter((m) => !mutes.has(m.from.id)).slice(-40) };
  }
  function progressOf(G, T) {
    let tot = 0, got = 0;
    for (let i = 0; i < 81; i++) if (!G.puzzle[i]) { tot++; if (G.boards[T][i]) got++; }
    return tot ? Math.floor(100 * got / tot) : 100;
  }
  function stateMsg(L, uid, full) {
    const G = L.game, myTeam = teamOf(L, uid) || (G.left[uid] || null);
    const lm = G.lastMove ? (G.lastMove.team === myTeam ? G.lastMove : { uid: G.lastMove.uid, team: G.lastMove.team, ok: G.lastMove.ok, timeout: !!G.lastMove.timeout }) : null;
    return { t: 'mr_state', mid: G.id, full: !!full, puzzle: G.puzzle, cages: G.cages, mode: G.mode, diff: G.diff, myTeam,
      turnUid: G.over ? null : G.turnUid, turnEnd: G.turnEnd, over: G.over, board: myTeam ? G.boards[myTeam] : G.puzzle,
      progress: { A: progressOf(G, 'A'), B: progressOf(G, 'B') }, mistakes: G.mistakes, out: G.out, forfeit: G.forfeit, order: G.order,
      lastMove: lm, result: G.result, serverTime: now() };
  }
  function broadcastLobby(L) { members(L).forEach((p) => sendTo(p, lobbyMsg(L, p))); }
  function broadcastState(L, full) { members(L).forEach((p) => sendTo(p, stateMsg(L, p, full))); }
  function poolMsg(uid) {
    const key = userPool.get(uid); if (!key) return { t: 'mr_queue', searching: false };
    const [size, mode, diff] = key.split('|'); const arr = pools.get(key) || [];
    return { t: 'mr_queue', searching: true, pool: arr.length, need: Number(size) * 2, size: Number(size), mode, diff };
  }
  function broadcastPool(key) { (pools.get(key) || []).forEach((p) => sendTo(p, poolMsg(p))); }

  /* ------------------------------------------------------------------ lobby lifecycle */
  function newCode() { let c; do { c = Array.from(crypto.randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join(''); } while (lobbies.has(c)); return c; }
  function makeLobby(opts) {
    const L = { code: newCode(), private: !!opts.private, size: opts.size, mode: opts.mode, diff: clampDiff(opts.mode, opts.diff), phase: 'lobby',
      A: [], B: [], host: opts.host || null, ready: {}, mic: {}, chat: [], countdownEnd: null, game: null, rated: true, createdAt: now(), timers: {} };
    lobbies.set(L.code, L); return L;
  }
  function playersKey(L) { return members(L).slice().sort((a, b) => a - b).join(','); }
  function computeRated(L) {
    if (!L.private) { L.rated = true; return; }
    const n = db.prepare('SELECT COUNT(*) n FROM mr_matches WHERE players_key = ? AND private = 1 AND rated = 1 AND started_at > ?').get(playersKey(L), now() - 864e5).n;
    L.rated = n < PRIVATE_RATED_CAP;
  }
  function addMember(L, uid, team) {
    const T = team || (L.A.length <= L.B.length ? 'A' : 'B');
    if (L[T].length >= L.size) return false;
    L[T].push(uid); userLobby.set(uid, L.code); L.ready[uid] = false;
    const gt = graceTimers.get(uid); if (gt) { clearTimeout(gt); graceTimers.delete(uid); }
    presence(uid);
    return true;
  }
  function clearTimers(L) { Object.values(L.timers).forEach((t) => clearTimeout(t)); L.timers = {}; }
  function dropMember(L, uid, quiet) {
    ['A', 'B'].forEach((T) => { const i = L[T].indexOf(uid); if (i >= 0) L[T].splice(i, 1); });
    delete L.ready[uid]; delete L.mic[uid]; userLobby.delete(uid);
    if (!quiet) sendTo(uid, { t: 'mr_closed' });
    members(L).forEach((p) => sendTo(p, { t: 'mrv_peer_left', uid }));
    if (L.host === uid) L.host = members(L)[0] || null;
    presence(uid);
  }
  function closeLobby(L, why) {
    clearTimers(L);
    members(L).forEach((p) => { userLobby.delete(p); sendTo(p, { t: 'mr_closed', why: why || null }); presence(p); });
    L.A = []; L.B = []; lobbies.delete(L.code);
  }
  function cancelCountdown(L) { if (L.phase !== 'countdown') return; clearTimeout(L.timers.cd); delete L.timers.cd; L.phase = 'lobby'; L.countdownEnd = null; }
  function maybeCountdown(L) {
    if (L.phase !== 'lobby') return;
    if (L.A.length !== L.size || L.B.length !== L.size) return;
    if (!members(L).every((p) => L.ready[p])) return;
    const banned = members(L).filter((p) => V44() && V44().banOf(p));
    if (banned.length) { banned.forEach((p) => { gate(p); L.ready[p] = false; }); broadcastLobby(L); return; }
    computeRated(L);
    L.phase = 'countdown'; L.countdownEnd = now() + COUNTDOWN_MS;
    L.timers.cd = setTimeout(() => startGame(L), COUNTDOWN_MS);
    broadcastLobby(L);
  }
  function startGame(L) {
    delete L.timers.cd;
    if (L.phase !== 'countdown' || !lobbies.has(L.code)) return;
    const banned = members(L).filter((p) => V44() && V44().banOf(p));
    if (banned.length) { banned.forEach((p) => gate(p)); L.phase = 'lobby'; L.countdownEnd = null; members(L).forEach((p) => { L.ready[p] = false; }); broadcastLobby(L); return; }
    L.phase = 'generating'; broadcastLobby(L);
    const seq = L.genSeq = (L.genSeq || 0) + 1;
    generate(L.mode, L.diff).then((P) => {
      if (L.genSeq !== seq || L.phase !== 'generating' || !lobbies.has(L.code)) return;
      if (L.A.length !== L.size || L.B.length !== L.size) { L.phase = 'lobby'; broadcastLobby(L); return; }
      const order = [];
      for (let i = 0; i < L.size; i++) { order.push(L.A[i]); order.push(L.B[i]); }
      const t = now();
      const info = db.prepare('INSERT INTO mr_matches (size, mode, diff, private, rated, players_key, puzzle, solution, cages, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(L.size, P.mode, P.difficulty, L.private ? 1 : 0, L.rated ? 1 : 0, playersKey(L), P.puzzle.join(''), P.solution.join(''), P.cages ? JSON.stringify(P.cages) : null, t);
      const G = { id: Number(info.lastInsertRowid), mode: P.mode, diff: P.difficulty, puzzle: P.puzzle.slice(), solution: P.solution.slice(), cages: P.cages || null,
        boards: { A: P.puzzle.slice(), B: P.puzzle.slice() }, order, turnIdx: 0, turnUid: order[0], turnStart: t, turnEnd: t + TURN_MS,
        mistakes: {}, out: {}, forfeit: {}, moves: {}, fast: {}, left: {}, disc: {}, over: false, result: null, lastMove: null, startAt: t,
        teams: { A: L.A.slice(), B: L.B.slice() }, before: {} };
      order.forEach((p) => { G.mistakes[p] = 0; G.moves[p] = 0; G.fast[p] = 0; G.before[p] = Q.userById.get(p).rating; });
      L.game = G; L.phase = 'match';
      broadcastLobby(L); broadcastState(L, true);
      armTurn(L);
      L.timers.limit = setTimeout(() => timeLimit(L), MATCH_LIMIT_MS);
      members(L).forEach((p) => presence(p));
    }).catch((e) => {
      console.error('mr generate failed', e.message);
      if (L.genSeq !== seq) return;
      L.phase = 'lobby'; L.countdownEnd = null; members(L).forEach((p) => { L.ready[p] = false; err(p, 'gen_failed'); });
      broadcastLobby(L);
    });
  }

  /* ------------------------------------------------------------------ turns */
  const alive = (G, uid) => !G.out[uid] && !G.forfeit[uid];
  function armTurn(L) {
    const G = L.game; clearTimeout(L.timers.turn);
    const uid = G.turnUid, at = G.turnEnd;
    L.timers.turn = setTimeout(() => {
      if (L.game !== G || G.over || G.turnUid !== uid || G.turnEnd !== at) return;
      if (!clients.has(uid) && G.disc[uid] && now() - G.disc[uid] >= DISC_FORFEIT_MS) G.forfeit[uid] = true;
      G.lastMove = { uid, team: teamOf(L, uid) || G.left[uid], timeout: true, ok: null };
      if (!checkEnd(L)) nextTurn(L);
      broadcastState(L);
    }, Math.max(0, at - now()));
  }
  function nextTurn(L) {
    const G = L.game, n = G.order.length;
    for (let s = 1; s <= n; s++) {
      const idx = (G.turnIdx + s) % n, uid = G.order[idx];
      if (alive(G, uid)) { G.turnIdx = idx; G.turnUid = uid; G.turnStart = now(); G.turnEnd = now() + TURN_MS; armTurn(L); return; }
    }
  }
  function teamAlive(G, T) { return G.teams[T].some((p) => alive(G, p)); }
  function boardDone(G, T) { for (let i = 0; i < 81; i++) if (G.boards[T][i] !== G.solution[i]) return false; return true; }
  function checkEnd(L) {
    const G = L.game; if (G.over) return true;
    if (boardDone(G, 'A')) { endGame(L, 'A', 'finish'); return true; }
    if (boardDone(G, 'B')) { endGame(L, 'B', 'finish'); return true; }
    const a = teamAlive(G, 'A'), b = teamAlive(G, 'B');
    if (!a && !b) { endGame(L, 'draw', 'eliminated'); return true; }
    if (!a) { endGame(L, 'B', 'eliminated'); return true; }
    if (!b) { endGame(L, 'A', 'eliminated'); return true; }
    return false;
  }
  function timeLimit(L) {
    const G = L.game; if (!G || G.over) return;
    const pa = progressOf(G, 'A'), pb = progressOf(G, 'B');
    endGame(L, pa > pb ? 'A' : pb > pa ? 'B' : 'draw', 'time');
    broadcastState(L);
  }
  function onMove(L, uid, m) {
    const G = L.game;
    if (!G || G.over || L.phase !== 'match') return err(uid, 'mr_no_match');
    if (G.turnUid !== uid) return err(uid, 'mr_not_turn');
    const i = Number(m.i), v = Number(m.v);
    if (!Number.isInteger(i) || i < 0 || i > 80 || !Number.isInteger(v) || v < 1 || v > 9) return err(uid, 'bad_move');
    const T = teamOf(L, uid);
    if (G.puzzle[i] || G.boards[T][i]) return err(uid, 'bad_move');
    const ok = G.solution[i] === v;
    G.moves[uid] = (G.moves[uid] || 0) + 1;
    if (ok) {
      G.boards[T][i] = v;
      if (now() - G.turnStart < 700) G.fast[uid] = (G.fast[uid] || 0) + 1;
    } else {
      G.mistakes[uid] = (G.mistakes[uid] || 0) + 1;
      if (G.mistakes[uid] >= 3) G.out[uid] = true;
    }
    G.lastMove = { uid, team: T, i, ok };
    if (!checkEnd(L)) nextTurn(L);
    broadcastState(L);
  }
  function forfeitPlayer(L, uid) {
    const G = L.game; if (!G || G.over) return;
    G.forfeit[uid] = true;
    if (G.turnUid === uid && !checkEnd(L)) nextTurn(L); else checkEnd(L);
    broadcastState(L); broadcastLobby(L);
  }

  /* ------------------------------------------------------------------ result (single transaction) */
  const finishTx = db.transaction((L, winner, reason) => {
    const G = L.game;
    const row = db.prepare('SELECT ended_at FROM mr_matches WHERE id = ?').get(G.id);
    if (!row || row.ended_at) return null;
    const t = now(), dur = t - G.startAt;
    const rated = L.rated && winner !== 'void';
    const avg = (T) => Math.round(G.teams[T].reduce((s, p) => s + G.before[p], 0) / G.teams[T].length);
    const ra = avg('A'), rb = avg('B');
    const out = {};
    const insP = db.prepare('INSERT INTO mr_players (match_id, user_id, team, seat, rating_before, rating_after, delta, coins, mistakes, moves, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const insElo = db.prepare('INSERT INTO elo_transactions (user_id, match_id, kind, before, after, delta, k, score, expected, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const v = V44();
    ['A', 'B'].forEach((T) => {
      const oppAvg = T === 'A' ? rb : ra, myAvg = T === 'A' ? ra : rb;
      G.teams[T].forEach((uid, seat) => {
        const u = Q.userById.get(uid);
        const left = !!G.forfeit[uid] && !!G.left[uid];
        let res = winner === 'draw' ? 'draw' : winner === T ? 'win' : 'loss';
        if (winner === 'void') res = 'void';
        if (left && res === 'win') res = 'loss'; // leaving a match never earns a win
        const score = res === 'win' ? 1 : res === 'draw' ? 0.5 : 0;
        let after = u.rating, delta = 0, k = null, coins = 0;
        if (rated) {
          k = kFactor((u.games || 0) + (u.mr_games || 0));
          after = eloNew(u.rating, oppAvg, score, k); delta = after - u.rating;
          insElo.run(uid, 'mr:' + G.id, 'mr', u.rating, after, delta, k, score, expected(myAvg, oppAvg), t);
          db.prepare('UPDATE users SET rating = ?, peak = MAX(peak, ?), mr_games = mr_games + 1, mr_wins = mr_wins + ?, mr_losses = mr_losses + ?, mr_draws = mr_draws + ? WHERE id = ?')
            .run(after, after, res === 'win' ? 1 : 0, res === 'loss' ? 1 : 0, res === 'draw' ? 1 : 0, uid);
          if (v && dur >= 30000 && !left) {
            const amt = res === 'win' ? v.COIN.win : res === 'draw' ? v.COIN.draw : v.COIN.loss;
            coins = v.grantCoins(uid, amt, 'match', 'mr' + G.id, v.COIN.dailyMatchCap) || 0;
          }
        }
        insP.run(G.id, uid, T, seat, u.rating, after, delta, coins, G.mistakes[uid] || 0, G.moves[uid] || 0, res);
        out[uid] = { res, before: u.rating, after, delta, coins };
        if ((G.fast[uid] || 0) >= 12) { try { getWCS().acLog(uid, 'mr_fast_moves', { mid: G.id, fast: G.fast[uid], moves: G.moves[uid] }, 'mr' + G.id); } catch (e) { } }
      });
    });
    db.prepare('UPDATE mr_matches SET winner = ?, reason = ?, rated = ?, ended_at = ?, duration_ms = ? WHERE id = ?').run(winner, reason, rated ? 1 : 0, t, dur, G.id);
    return { rated, players: out };
  });
  function endGame(L, winner, reason) {
    const G = L.game; if (!G || G.over) return;
    clearTimeout(L.timers.turn); clearTimeout(L.timers.limit); delete L.timers.turn; delete L.timers.limit;
    G.over = true; G.turnUid = null; G.result = { winner, reason };
    let out = null;
    try { out = finishTx(L, winner, reason); } catch (e) { console.error('mr finish', e.message); }
    L.phase = 'result';
    const everyone = G.order.slice();
    everyone.forEach((uid) => {
      const u = Q.userById.get(uid); const c = clients.get(uid); if (c && u) c.user = u;
      const p = out && out.players[uid];
      sendTo(uid, { t: 'mr_result', mid: G.id, winner, reason, myTeam: G.teams.A.includes(uid) ? 'A' : 'B', rated: !!(out && out.rated),
        elo: p && out.rated ? { before: p.before, after: p.after, delta: p.delta } : null, coins: p ? p.coins : 0, user: u ? privUser(u) : null });
      if (u) refreshClientUser(u);
    });
    L.timers.back = setTimeout(() => backToLobby(L), RESULT_BACK_MS);
    members(L).forEach((p) => presence(p));
  }
  function backToLobby(L) {
    delete L.timers.back;
    if (!lobbies.has(L.code) || L.phase !== 'result') return;
    if (!L.private) { closeLobby(L, 'done'); return; }
    members(L).filter((p) => !clients.has(p)).forEach((p) => dropMember(L, p, true));
    if (!members(L).length) { lobbies.delete(L.code); return; }
    L.phase = 'lobby'; L.game = null; L.countdownEnd = null; members(L).forEach((p) => { L.ready[p] = false; });
    broadcastLobby(L);
  }
  function voidForBan(uid) {
    const L = lobbyOf(uid);
    if (userPool.has(uid)) leavePool(uid);
    if (!L) return;
    const G = L.game;
    if (G && !G.over) {
      clearTimeout(L.timers.turn); clearTimeout(L.timers.limit);
      G.over = true; G.result = { winner: 'void', reason: 'ban' };
      db.prepare("UPDATE mr_matches SET winner = 'void', reason = 'ban', rated = 0, ended_at = ?, duration_ms = ? WHERE id = ? AND ended_at IS NULL").run(now(), now() - G.startAt, G.id);
      members(L).forEach((p) => sendTo(p, { t: 'match_void', why: p === uid ? 'banned' : 'opp_banned' }));
      closeLobby(L, 'void_ban');
      return;
    }
    if (L.phase === 'countdown') cancelCountdown(L);
    dropMember(L, uid);
    if (!members(L).length) { closeLobby(L); return; }
    if (!L.private) { const rest = members(L).slice(); closeLobby(L, 'opp_banned'); rest.forEach((p) => sendTo(p, { t: 'match_void', why: 'opp_banned' })); return; }
    broadcastLobby(L);
  }

  /* ------------------------------------------------------------------ queue */
  function leavePool(uid) {
    const key = userPool.get(uid); if (!key) return;
    const arr = pools.get(key) || []; const i = arr.indexOf(uid); if (i >= 0) arr.splice(i, 1);
    userPool.delete(uid); sendTo(uid, { t: 'mr_queue', searching: false }); broadcastPool(key);
  }
  function tryMatch(key) {
    const arr = pools.get(key) || []; const [s, mode, diff] = key.split('|'); const size = Number(s);
    while (arr.length >= size * 2) {
      const take = arr.splice(0, size * 2);
      take.forEach((p) => userPool.delete(p));
      const ranked = take.map((p) => ({ p, r: Q.userById.get(p).rating })).sort((a, b) => b.r - a.r);
      const L = makeLobby({ private: false, size, mode, diff });
      const snake = size === 2 ? ['A', 'B', 'B', 'A'] : ['A', 'B', 'B', 'A', 'A', 'B'];
      ranked.forEach((x, i) => { addMember(L, x.p, snake[i]); L.ready[x.p] = true; sendTo(x.p, { t: 'mr_queue', searching: false }); });
      L.host = null;
      maybeCountdown(L);
    }
    broadcastPool(key);
  }
  function parseCfg(m) {
    const size = Number(m.size), mode = String(m.mode || ''), diff = String(m.diff || '');
    if (!SIZES.includes(size) || !MODES.includes(mode) || !DIFFS.includes(diff)) return null;
    return { size, mode, diff: clampDiff(mode, diff) };
  }

  /* ------------------------------------------------------------------ WS entry */
  function onMessage(c, m) {
    const uid = c.user.id; const L = lobbyOf(uid);
    switch (m.t) {
      case 'mr_sync': {
        sendTo(uid, poolMsg(uid));
        if (L) { sendTo(uid, lobbyMsg(L, uid)); if (L.game) sendTo(uid, stateMsg(L, uid, true)); }
        else sendTo(uid, { t: 'mr_closed', quiet: true });
        return;
      }
      case 'mr_find': {
        if (gate(uid)) return;
        if (L) return err(uid, 'mr_in_lobby');
        if (otherBusy(uid)) return err(uid, 'busy');
        const cfg = parseCfg(m); if (!cfg) return err(uid, 'bad_request');
        if (userPool.has(uid)) leavePool(uid);
        const key = cfg.size + '|' + cfg.mode + '|' + cfg.diff;
        if (!pools.has(key)) pools.set(key, []);
        pools.get(key).push(uid); userPool.set(uid, key);
        tryMatch(key);
        return;
      }
      case 'mr_cancel': return leavePool(uid);
      case 'mr_create': {
        if (gate(uid)) return;
        if (L) return err(uid, 'mr_in_lobby');
        if (otherBusy(uid)) return err(uid, 'busy');
        if (limited('mrc:' + uid, 10, 60000)) return err(uid, 'rate_limited');
        const cfg = parseCfg(m); if (!cfg) return err(uid, 'bad_request');
        if (userPool.has(uid)) leavePool(uid);
        const NL = makeLobby(Object.assign({ private: true, host: uid }, cfg));
        addMember(NL, uid, 'A'); computeRated(NL); broadcastLobby(NL);
        return;
      }
      case 'mr_join': {
        if (gate(uid)) return;
        if (L) return err(uid, 'mr_in_lobby');
        if (otherBusy(uid)) return err(uid, 'busy');
        if (limited('mrj:' + uid, 20, 60000)) return err(uid, 'rate_limited');
        const code = String(m.code || '').trim().toUpperCase();
        const T = lobbies.get(code);
        if (!T || !T.private) return err(uid, 'mr_no_lobby');
        if (T.phase !== 'lobby') return err(uid, 'mr_started');
        if (userPool.has(uid)) leavePool(uid);
        if (!addMember(T, uid)) return err(uid, 'mr_full');
        computeRated(T); broadcastLobby(T);
        return;
      }
      case 'mr_team': {
        if (!L || !L.private || L.phase !== 'lobby') return;
        if (gate(uid)) return;
        const T = m.team === 'B' ? 'B' : 'A'; if (teamOf(L, uid) === T || L[T].length >= L.size) return;
        const from = teamOf(L, uid); L[from].splice(L[from].indexOf(uid), 1); L[T].push(uid); L.ready[uid] = false;
        broadcastLobby(L); return;
      }
      case 'mr_ready': {
        if (!L) return;
        if (m.val && gate(uid)) return;
        if (L.phase === 'countdown' && !m.val) { L.ready[uid] = false; cancelCountdown(L); broadcastLobby(L); return; }
        if (L.phase !== 'lobby') return;
        L.ready[uid] = !!m.val; broadcastLobby(L); maybeCountdown(L); return;
      }
      case 'mr_leave': {
        if (userPool.has(uid)) leavePool(uid);
        if (!L) { sendTo(uid, { t: 'mr_closed' }); return; }
        if (L.phase === 'match' && L.game && !L.game.over) {
          const T = teamOf(L, uid); L.game.left[uid] = T;
          dropMember(L, uid); forfeitPlayer(L, uid); return;
        }
        if (L.phase === 'countdown') cancelCountdown(L);
        if (L.phase === 'generating') { L.genSeq++; L.phase = 'lobby'; }
        dropMember(L, uid);
        if (!members(L).length) { closeLobby(L); return; }
        if (!L.private && L.phase !== 'result') {
          /* a matchmade lobby that loses a player is dissolved; the others go back to the queue */
          const rest = members(L).slice(), key = L.size + '|' + L.mode + '|' + L.diff;
          closeLobby(L, 'player_left');
          rest.forEach((p) => { if (!clients.has(p) || (V44() && V44().banOf(p))) return; if (!pools.has(key)) pools.set(key, []); pools.get(key).push(p); userPool.set(p, key); });
          tryMatch(key); return;
        }
        broadcastLobby(L); return;
      }
      case 'mr_surrender': {
        if (!L || !L.game || L.game.over || !teamOf(L, uid)) return;
        forfeitPlayer(L, uid); return;
      }
      case 'mr_mv': { if (!L) return err(uid, 'mr_no_match'); return onMove(L, uid, m); }
      case 'mr_invite': {
        if (!L || !L.private || L.phase !== 'lobby') return err(uid, 'mr_no_lobby');
        if (limited('mri:' + uid, 15, 60000)) return err(uid, 'rate_limited');
        const to = Number(m.uid);
        if (!Number.isInteger(to) || to === uid || !isFriend(uid, to)) return err(uid, 'not_friends');
        if (!clients.has(to)) return err(uid, 'offline');
        if (busy(to) || otherBusy(to)) return err(uid, 'busy');
        if (mutesOf(to).has(uid)) { sendTo(uid, { t: 'mr_invite_sent', to: { username: Q.userById.get(to).username } }); return; }
        const me = Q.userById.get(uid);
        sendTo(to, { t: 'mr_invite', from: { id: uid, username: me.username }, code: L.code, size: L.size, mode: L.mode, diff: L.diff });
        sendTo(uid, { t: 'mr_invite_sent', to: { username: Q.userById.get(to).username } });
        return;
      }
      case 'mr_chat': {
        if (!L) return;
        const text = cleanText(m.text, 200); if (!text) return;
        const last = lastChat.get(uid) || 0; if (now() - last < 800) return err(uid, 'slow_down');
        lastChat.set(uid, now());
        const me = Q.userById.get(uid), T = teamOf(L, uid);
        const team = !!(m.team && L.game && T);
        const msg = { from: { id: uid, username: me.username }, text, team: team ? T : null, at: now() };
        const to = team ? L[T] : members(L);
        if (!team) { L.chat.push(msg); if (L.chat.length > 60) L.chat.shift(); }
        to.forEach((p) => { if (p === uid || !mutesOf(p).has(uid)) sendTo(p, { t: 'mr_chat', msg }); });
        return;
      }
      case 'mr_mic': {
        if (!L) return;
        const st = ['on', 'muted', 'off'].includes(m.state) ? m.state : 'off';
        const was = L.mic[uid]; L.mic[uid] = st;
        const T = teamOf(L, uid);
        /* speaking indicator only goes to teammates; mic state goes to everyone in the lobby */
        members(L).forEach((p) => sendTo(p, { t: 'mr_mic', uid, state: st, speaking: teamOf(L, p) === T ? !!m.speaking : false }));
        if (was === st && !m.speaking) return;
        return;
      }
      case 'mrv_signal': {
        if (!L) return;
        const to = Number(m.to), T = teamOf(L, uid);
        if (!T || teamOf(L, to) !== T || to === uid) return; // never across teams
        let size = 0; try { size = JSON.stringify(m.data || null).length; } catch (e) { return; }
        if (size > MAX_SIGNAL) return;
        if (limited('mrv:' + uid, 400, 60000)) return;
        sendTo(to, { t: 'mrv_signal', from: uid, data: m.data });
        return;
      }
    }
  }
  function onAuthed(uid) {
    const gt = graceTimers.get(uid); if (gt) { clearTimeout(gt); graceTimers.delete(uid); }
    const L = lobbyOf(uid); if (!L) return;
    if (L.game) delete L.game.disc[uid];
    broadcastLobby(L);
    if (L.game) sendTo(uid, stateMsg(L, uid, true));
  }
  function onClosed(uid) {
    if (userPool.has(uid)) { const key = userPool.get(uid); const arr = pools.get(key) || []; const i = arr.indexOf(uid); if (i >= 0) arr.splice(i, 1); userPool.delete(uid); broadcastPool(key); }
    const L = lobbyOf(uid); if (!L) return;
    L.mic[uid] = 'off';
    members(L).forEach((p) => { if (p !== uid) sendTo(p, { t: 'mrv_peer_left', uid }); });
    if (L.game && !L.game.over) { L.game.disc[uid] = now(); broadcastLobby(L); return; }
    if (L.phase === 'countdown') cancelCountdown(L);
    broadcastLobby(L);
    graceTimers.set(uid, setTimeout(() => {
      graceTimers.delete(uid);
      const L2 = lobbyOf(uid); if (!L2 || clients.has(uid)) return;
      if (L2.game && !L2.game.over) return;
      onMessage({ user: { id: uid } }, { t: 'mr_leave' });
    }, LOBBY_GRACE_MS));
  }

  /* ------------------------------------------------------------------ HTTP */
  route('GET', '/api/mr/leaderboard', 'opt', ({ user }) => {
    const rows = db.prepare('SELECT * FROM users WHERE mr_games > 0 ORDER BY rating DESC, mr_wins DESC, id ASC LIMIT 100').all();
    const out = rows.map((u, i) => Object.assign(lite(u), { pos: i + 1, mrRating: u.rating, wins: u.mr_wins, games: u.mr_games }));
    let me = null;
    if (user) {
      const u = Q.userById.get(user.id);
      if (u && u.mr_games > 0) me = { pos: db.prepare('SELECT COUNT(*) n FROM users WHERE mr_games > 0 AND (rating > ? OR (rating = ? AND (mr_wins > ? OR (mr_wins = ? AND id < ?))))').get(u.rating, u.rating, u.mr_wins, u.mr_wins, u.id).n + 1 };
    }
    return { rows: out, me };
  });
  function mrHistory(uid, limit) {
    return db.prepare(`SELECT p.*, m.size, m.mode, m.diff, m.ended_at, m.winner, m.reason FROM mr_players p JOIN mr_matches m ON m.id = p.match_id
                       WHERE p.user_id = ? AND m.ended_at IS NOT NULL ORDER BY m.ended_at DESC LIMIT ?`).all(uid, limit || 30)
      .filter((r) => r.result !== 'void')
      .map((r) => ({ type: 'mr', res: r.result, size: r.size, mode: r.mode, diff: r.diff, opp: null, eloDelta: r.rating_after == null ? null : r.delta, coins: r.coins, at: r.ended_at, team: r.team }));
  }
  route('GET', '/api/mr/history', true, ({ user }) => ({ rows: mrHistory(user.id, 30) }));
  route('GET', '/api/mr/status', true, ({ user }) => ({ busy: busy(user.id), lobby: userLobby.get(user.id) || null, turnMs: TURN_MS }));

  return { onMessage, onAuthed, onClosed, busy, voidForBan, mutesChanged, mrHistory, playing: (uid) => { const L = lobbyOf(uid); return !!(L && (L.phase === 'match' || L.phase === 'countdown' || L.phase === 'generating')); },
    _test: { lobbies, userLobby, pools, userPool, lobbyOf }, TURN_MS };
}

module.exports = { init, clampDiff, SIZES, MODES, DIFFS };
