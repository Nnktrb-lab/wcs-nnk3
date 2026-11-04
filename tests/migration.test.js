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

/* v4.4: the repository history before v4.0 is not available, so the upgrade is tested from the real
   v4.0 db.js (baseline commit) that production runs today: schema 4 → schema 5. */
function check(tag, file, fromVer, withAvatar) {
  const cur = require(path.join(ROOT, 'server', 'db.js'));
  const bdir = path.join(path.dirname(file), 'backups');
  const db = cur.open(file);
  const v = db.prepare("SELECT v FROM schema_meta WHERE k = 'version'").get().v;
  ok(v === String(cur.SCHEMA_VERSION) && cur.SCHEMA_VERSION === 5, tag + ': schema upgraded to v5', v);
  const users = db.prepare('SELECT * FROM users ORDER BY id').all();
  ok(users.length === 2 && users[0].username === 'Lama1' && users[0].rating === 1236 && users[0].peak === 1250 && users[0].games === 5 && users[0].wins === 4 && users[0].pw_hash === 'hash1' && users[0].progress_json === '{"solved":12}', tag + ': accounts, Elo and progress intact');
  ok(users[0].xp === 777 && users[0].role === 'admin' && users[1].role === 'player', tag + ': XP and roles intact', users.map((u) => [u.xp, u.role]));
  ok(db.prepare('SELECT COUNT(*) n FROM friendships').get().n === 2, tag + ': friendships intact');
  ok(db.prepare('SELECT COUNT(*) n FROM sessions').get().n === 1, tag + ': sessions intact (no forced logout)');
  const m = db.prepare('SELECT * FROM matches ORDER BY id').all();
  ok(m.length === 2 && m[0].result === 'p1' && m[1].ranked === 0, tag + ': match history intact');
  ok(db.prepare('SELECT COUNT(*) n FROM elo_transactions').get().n === 1 && db.prepare('SELECT COUNT(*) n FROM admin_audit').get().n === 1, tag + ': Elo ledger and old audit rows intact');
  if (withAvatar) {
    ok(users[0].avatar === 'p:7' && users[1].avatar === 'u:1', tag + ': avatar choice intact');
    const a = db.prepare('SELECT data FROM avatars WHERE user_id = 2').get(); ok(a && Buffer.compare(a.data, Buffer.from([1, 2, 3, 4])) === 0, tag + ': uploaded avatar bytes intact');
  }
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  ok(['coin_tx', 'owned_borders', 'player_bans', 'player_reports'].every((n) => tables.includes(n)), tag + ': v4.4 tables created', tables);
  ok(users.every((u) => u.coins === 0 && u.border === 'none'), tag + ': new columns default safely (0 coins, no border — nothing auto-given)');
  ok(db.prepare('PRAGMA table_info(admin_audit)').all().some((c) => c.name === 'target_id'), tag + ': admin_audit.target_id added');
  ok(db.prepare('SELECT COUNT(*) n FROM owned_borders').get().n === 0 && db.prepare('SELECT COUNT(*) n FROM player_bans').get().n === 0, tag + ': no borders or bans created by migration');
  db.close();
  const backups = fs.existsSync(bdir) ? fs.readdirSync(bdir).filter((f) => f.startsWith('pre-migrate-v' + fromVer + '-to-v5')) : [];
  ok(backups.length === 1, tag + ': pre-migration backup written', backups);
  if (backups.length) {
    const Database = require('better-sqlite3');
    const b = new Database(path.join(bdir, backups[0]), { readonly: true });
    ok(b.prepare("SELECT v FROM schema_meta WHERE k = 'version'").get().v === String(fromVer) && b.prepare('SELECT COUNT(*) n FROM users').get().n === 2 && b.prepare('SELECT COUNT(*) n FROM matches').get().n === 2, tag + ': backup is a full copy of the old database');
    b.close();
  }
  const db2 = cur.open(file);
  ok(db2.prepare('SELECT COUNT(*) n FROM users').get().n === 2 && db2.prepare('SELECT COUNT(*) n FROM matches').get().n === 2 && db2.prepare('SELECT rating FROM users WHERE id = 1').get().rating === 1236, tag + ': re-open is idempotent');
  db2.close();
  ok(fs.readdirSync(bdir).filter((f) => f.startsWith('pre-migrate') && f.endsWith('.db')).length === 1, tag + ': no extra backup on re-open', fs.readdirSync(bdir));
}

try {
  const base = execSync('git log --format=%h --grep="Baseline v4.0" -n 1', { cwd: ROOT }).toString().trim();
  const v4 = oldDbModule(base, 'v4'); ok(v4.SCHEMA_VERSION === 4, 'old v4.0 db.js is schema 4');
  const f4 = path.join(TMP, 'd4', 'data.db'); fs.mkdirSync(path.dirname(f4), { recursive: true });
  const d = v4.open(f4); seed(d, true);
  d.prepare("UPDATE users SET xp = 777, role = 'admin' WHERE id = 1").run();
  d.prepare('INSERT INTO elo_transactions (user_id, match_id, kind, delta, before, after, created_at) VALUES (1, ?, ?, 12, 1224, 1236, ?)').run('m1', 'ranked', Date.now());
  d.prepare("INSERT INTO admin_audit (admin_id, action, detail, created_at) VALUES (1, 'wcs_config', '{}', ?)").run(Date.now());
  d.close();
  check('v4→v5', f4, 4, true);
} catch (e) { fail++; console.log('FAIL exception', e && e.stack); }
fs.rmSync(TMP, { recursive: true, force: true });
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
