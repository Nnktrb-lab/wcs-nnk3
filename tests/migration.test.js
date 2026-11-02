'use strict';
/* Migration test: databases created by older releases (schema v1 from v3.0, schema v2 from v3.1/v3.2)
   are opened by the current db.js. All old rows must survive, new tables/columns must appear,
   a pre-migration backup must be written, and re-opening must be idempotent. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(ROOT, 'tests', '.mig-'));
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); } };

function oldDbModule(commit, tag) {
  const dir = path.join(TMP, tag, 'server'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'db.js'), execSync('git show ' + commit + ':server/db.js', { cwd: ROOT }));
  return require(path.join(dir, 'db.js'));
}

function seed(db, withAvatar) {
  const t = Date.now();
  const ins = db.prepare(`INSERT INTO users (username, username_lc, player_id, friend_code, pw_hash, recovery_hash, country, region, rating, peak, games, wins, losses, draws, casual_games, casual_wins, progress_json, progress_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  ins.run('Lama1', 'lama1', 'SLA-AAAA-0001', 'FC00001', 'hash1', 'rec1', 'MY', '14', 1236, 1250, 5, 4, 1, 0, 2, 1, '{"solved":12}', t, t - 1e6);
  ins.run('Lama2', 'lama2', 'SLA-AAAA-0002', 'FC00002', 'hash2', 'rec2', 'MY', '10', 1200, 1200, 0, 0, 0, 0, 3, 2, null, null, t - 9e5);
  db.prepare('INSERT INTO friendships (user_id, friend_id, created_at) VALUES (1, 2, ?), (2, 1, ?)').run(t, t);
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, 1, ?, ?)').run('tok1', t, t + 864e5);
  db.prepare(`INSERT INTO matches (id, ranked, mode, difficulty, puzzle, p1, p2, result, reason, started_at, ended_at, duration_ms) VALUES
    ('m1', 1, 'race', 'easy', 'p', 1, 2, 'p1', 'solved', ?, ?, 60000), ('m2', 0, 'race', 'easy', 'p', 2, 1, 'p2', 'solved', ?, ?, 50000)`).run(t - 5e5, t - 4e5, t - 3e5, t - 2e5);
  if (withAvatar) {
    db.prepare("UPDATE users SET avatar = 'p:7' WHERE id = 1").run();
    db.prepare('INSERT INTO avatars (user_id, mime, data, updated_at) VALUES (2, ?, ?, ?)').run('image/webp', Buffer.from([1, 2, 3, 4]), t);
    db.prepare("UPDATE users SET avatar = 'u:1' WHERE id = 2").run();
  }
}

function check(tag, file, fromVer, withAvatar) {
  const cur = require(path.join(ROOT, 'server', 'db.js'));
  const bdir = path.join(path.dirname(file), 'backups');
  const db = cur.open(file);
  const v = db.prepare("SELECT v FROM schema_meta WHERE k = 'version'").get().v;
  ok(v === String(cur.SCHEMA_VERSION) && cur.SCHEMA_VERSION === 4, tag + ': schema upgraded to v4', v);
  const users = db.prepare('SELECT * FROM users ORDER BY id').all();
  ok(users.length === 2 && users[0].username === 'Lama1' && users[0].rating === 1236 && users[0].games === 5 && users[0].pw_hash === 'hash1' && users[0].progress_json === '{"solved":12}', tag + ': accounts, Elo and progress intact');
  ok(users.every((u) => u.dm_policy === 'all'), tag + ': new dm_policy column defaults to "all"');
  ok(db.prepare('SELECT COUNT(*) n FROM friendships').get().n === 2, tag + ': friendships intact');
  ok(db.prepare('SELECT COUNT(*) n FROM sessions').get().n === 1, tag + ': sessions intact (no forced logout)');
  const m = db.prepare('SELECT * FROM matches ORDER BY id').all();
  ok(m.length === 2 && m[0].result === 'p1' && m[1].ranked === 0, tag + ': match history intact');
  if (withAvatar) {
    ok(users[0].avatar === 'p:7' && users[1].avatar === 'u:1', tag + ': avatar choice intact');
    const a = db.prepare('SELECT data FROM avatars WHERE user_id = 2').get(); ok(a && Buffer.compare(a.data, Buffer.from([1, 2, 3, 4])) === 0, tag + ': uploaded avatar bytes intact');
  } else ok(db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'avatar'), tag + ': v2 avatar column added too');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  ok(['dm_messages', 'voice_clips', 'blocks', 'avatars'].every((n) => tables.includes(n)), tag + ': new tables created', tables);
  ok(['wcs_seasons', 'wcs_entries', 'wcs_ko', 'wcs_champions', 'user_titles', 'elo_transactions', 'xp_transactions', 'flag_change_history', 'activity_days', 'streak_tokens', 'streak_recoveries', 'daily_tournaments', 'solo_runs', 'anticheat_logs', 'appeals', 'admin_audit', 'user_badges'].every((n) => tables.includes(n)), tag + ': v4 WCS tables created');
  const u4 = db.prepare('SELECT xp, role, streak_cur, wcs_titles FROM users ORDER BY id').all();
  ok(u4.every((u) => u.xp === 0 && u.role === 'player' && u.streak_cur === 0 && u.wcs_titles === 0), tag + ': v4 user columns default safely (XP 0, role player, no titles)', u4);
  ok(db.prepare("SELECT COUNT(*) n FROM matches WHERE kind IS NOT NULL").get().n === 2 || db.prepare('PRAGMA table_info(matches)').all().some((c) => c.name === 'kind'), tag + ': matches.kind column added');
  db.close();
  const backups = fs.existsSync(bdir) ? fs.readdirSync(bdir).filter((f) => f.startsWith('pre-migrate-v' + fromVer + '-to-v4')) : [];
  ok(backups.length === 1, tag + ': pre-migration backup written', backups);
  if (backups.length) {
    const Database = require('better-sqlite3');
    const b = new Database(path.join(bdir, backups[0]), { readonly: true });
    ok(b.prepare("SELECT v FROM schema_meta WHERE k = 'version'").get().v === String(fromVer) && b.prepare('SELECT COUNT(*) n FROM users').get().n === 2 && b.prepare('SELECT COUNT(*) n FROM matches').get().n === 2, tag + ': backup is a full copy of the old database');
    b.close();
  }
  const db2 = cur.open(file);
  ok(db2.prepare('SELECT COUNT(*) n FROM users').get().n === 2 && db2.prepare('SELECT COUNT(*) n FROM matches').get().n === 2, tag + ': re-open is idempotent');
  db2.close();
  ok(fs.readdirSync(bdir).filter((f) => f.startsWith('pre-migrate') && f.endsWith('.db')).length === 1, tag + ': no extra backup on re-open', fs.readdirSync(bdir));
}

try {
  const v1 = oldDbModule('4911cad', 'v1'); ok(v1.SCHEMA_VERSION === 1, 'old v3.0 db.js is schema 1');
  const f1 = path.join(TMP, 'd1', 'data.db'); fs.mkdirSync(path.dirname(f1), { recursive: true });
  let d = v1.open(f1); seed(d, false); d.close();
  check('v1→v4', f1, 1, false);

  const v2 = oldDbModule('f74d95c', 'v2'); ok(v2.SCHEMA_VERSION === 2, 'old v3.2 db.js is schema 2');
  const f2 = path.join(TMP, 'd2', 'data.db'); fs.mkdirSync(path.dirname(f2), { recursive: true });
  d = v2.open(f2); seed(d, true); d.close();
  check('v2→v4', f2, 2, true);

  const v3 = oldDbModule('1b74bde', 'v3'); ok(v3.SCHEMA_VERSION === 3, 'old v3.4 db.js is schema 3');
  const f3 = path.join(TMP, 'd3', 'data.db'); fs.mkdirSync(path.dirname(f3), { recursive: true });
  d = v3.open(f3); seed(d, true); d.close();
  check('v3→v4', f3, 3, true);
} catch (e) { fail++; console.log('FAIL exception', e && e.stack); }
fs.rmSync(TMP, { recursive: true, force: true });
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
