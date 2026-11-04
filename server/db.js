'use strict';
/* SQLite storage. Migrations are additive only (CREATE IF NOT EXISTS / ADD COLUMN);
   nothing is ever dropped or renamed so older app versions keep working. */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const SCHEMA_VERSION = 6;

function open(file) {
  const dbFile = file || process.env.SLA_DB || path.join(__dirname, '..', 'data.db');
  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 3000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      username_lc TEXT NOT NULL UNIQUE,
      player_id TEXT NOT NULL UNIQUE,
      friend_code TEXT NOT NULL UNIQUE,
      pw_hash TEXT NOT NULL,
      recovery_hash TEXT NOT NULL,
      country TEXT,
      region TEXT,
      rating INTEGER NOT NULL DEFAULT 1200,
      peak INTEGER NOT NULL DEFAULT 1200,
      games INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      draws INTEGER NOT NULL DEFAULT 0,
      casual_games INTEGER NOT NULL DEFAULT 0,
      casual_wins INTEGER NOT NULL DEFAULT 0,
      abandons INTEGER NOT NULL DEFAULT 0,
      progress_json TEXT,
      progress_at INTEGER,
      created_at INTEGER NOT NULL,
      last_seen INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_users_rating ON users(rating DESC);
    CREATE INDEX IF NOT EXISTS ix_users_country ON users(country, rating DESC);
    CREATE INDEX IF NOT EXISTS ix_users_region ON users(country, region, rating DESC);
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_used INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS login_attempts (
      k TEXT PRIMARY KEY,
      fails INTEGER NOT NULL DEFAULT 0,
      first_at INTEGER NOT NULL,
      locked_until INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS friend_requests (
      from_id INTEGER NOT NULL REFERENCES users(id),
      to_id INTEGER NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,
      PRIMARY KEY (from_id, to_id)
    );
    CREATE TABLE IF NOT EXISTS friendships (
      user_id INTEGER NOT NULL REFERENCES users(id),
      friend_id INTEGER NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, friend_id)
    );
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      ranked INTEGER NOT NULL,
      mode TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      puzzle_id TEXT,
      puzzle TEXT NOT NULL,
      p1 INTEGER NOT NULL REFERENCES users(id),
      p2 INTEGER NOT NULL REFERENCES users(id),
      result TEXT,
      reason TEXT,
      p1_before INTEGER, p1_after INTEGER, p2_before INTEGER, p2_after INTEGER,
      p1_k INTEGER, p2_k INTEGER,
      p1_mistakes INTEGER, p2_mistakes INTEGER,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      duration_ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_matches_p1 ON matches(p1, ended_at DESC);
    CREATE INDEX IF NOT EXISTS ix_matches_p2 ON matches(p2, ended_at DESC);
  `);
  /* Safety copy before any schema upgrade of an existing database (never overwritten, never deleted automatically). */
  const prevVer = db.prepare('SELECT v FROM schema_meta WHERE k = ?').get('version');
  if (prevVer && Number(prevVer.v) < SCHEMA_VERSION && dbFile !== ':memory:') {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      const d = path.join(path.dirname(path.resolve(dbFile)), 'backups'); fs.mkdirSync(d, { recursive: true });
      fs.copyFileSync(dbFile, path.join(d, 'pre-migrate-v' + prevVer.v + '-to-v' + SCHEMA_VERSION + '-' + Date.now() + '.db'));
    } catch (e) { console.error('pre-migration backup failed', e.message); }
  }
  /* v2 (additive only, never drops data): profile avatars */
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('avatar')) db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS avatars (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      mime TEXT NOT NULL,
      data BLOB NOT NULL,
      updated_at INTEGER NOT NULL
    );`);
  /* v3 (additive only): direct messages, voice clips, blocks, DM privacy */
  const cols3 = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols3.includes('dm_policy')) db.exec("ALTER TABLE users ADD COLUMN dm_policy TEXT NOT NULL DEFAULT 'all'");
  db.exec(`
    CREATE TABLE IF NOT EXISTS voice_clips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id),
      to_id INTEGER REFERENCES users(id),
      mime TEXT NOT NULL,
      data BLOB NOT NULL,
      duration_ms INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      used_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_voice_owner ON voice_clips(owner_id, created_at);
    CREATE TABLE IF NOT EXISTS dm_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id INTEGER NOT NULL REFERENCES users(id),
      to_id INTEGER NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL,
      body TEXT,
      voice_id INTEGER REFERENCES voice_clips(id),
      cmid TEXT,
      created_at INTEGER NOT NULL,
      read_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_dm_pair ON dm_messages(from_id, to_id, id);
    CREATE INDEX IF NOT EXISTS ix_dm_to ON dm_messages(to_id, read_at);
    CREATE TABLE IF NOT EXISTS blocks (
      user_id INTEGER NOT NULL REFERENCES users(id),
      blocked_id INTEGER NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, blocked_id)
    );
  `);
  /* v4 (additive only): WCS – World Championship Sudoku. Seasons, qualification, knockout bracket, champions & titles,
     daily tournaments + server-verified solo runs, daily streak + recovery tokens, XP / Elo ledgers, badges,
     country-flag lock (365 days) with history, anti-cheat logs, appeals, admin audit. */
  const addCol = (t, c, def) => { const have = db.prepare(`PRAGMA table_info(${t})`).all().map((x) => x.name); if (!have.includes(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`); };
  addCol('users', 'xp', 'INTEGER NOT NULL DEFAULT 0');
  addCol('users', 'role', "TEXT NOT NULL DEFAULT 'player'");
  addCol('users', 'country_flag', 'TEXT');
  addCol('users', 'last_flag_change', 'INTEGER');
  addCol('users', 'next_flag_change', 'INTEGER');
  addCol('users', 'streak_cur', 'INTEGER NOT NULL DEFAULT 0');
  addCol('users', 'streak_best', 'INTEGER NOT NULL DEFAULT 0');
  addCol('users', 'wcs_titles', 'INTEGER NOT NULL DEFAULT 0');
  addCol('matches', 'kind', 'TEXT');
  addCol('matches', 'season_id', 'INTEGER');
  addCol('matches', 'ko_id', 'INTEGER');
  db.exec(`
    CREATE TABLE IF NOT EXISTS flag_change_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
      old_code TEXT, new_code TEXT NOT NULL, kind TEXT NOT NULL, changed_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS ix_flag_user ON flag_change_history(user_id, changed_at);
    CREATE TABLE IF NOT EXISTS elo_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), match_id TEXT NOT NULL,
      kind TEXT NOT NULL, before INTEGER NOT NULL, after INTEGER NOT NULL, delta INTEGER NOT NULL, k INTEGER, score REAL, expected REAL,
      created_at INTEGER NOT NULL, UNIQUE(user_id, match_id));
    CREATE TABLE IF NOT EXISTS xp_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), amount INTEGER NOT NULL,
      reason TEXT NOT NULL, ref TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(user_id, reason, ref));
    CREATE TABLE IF NOT EXISTS user_badges (
      user_id INTEGER NOT NULL REFERENCES users(id), badge TEXT NOT NULL, ref TEXT, earned_at INTEGER NOT NULL, PRIMARY KEY (user_id, badge));
    CREATE TABLE IF NOT EXISTS activity_days (
      user_id INTEGER NOT NULL REFERENCES users(id), day TEXT NOT NULL, source TEXT NOT NULL, ref TEXT, created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, day));
    CREATE TABLE IF NOT EXISTS streak_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), granted_at INTEGER NOT NULL,
      used_at INTEGER, used_day TEXT);
    CREATE INDEX IF NOT EXISTS ix_tokens_user ON streak_tokens(user_id, granted_at);
    CREATE TABLE IF NOT EXISTS streak_recoveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), day TEXT NOT NULL, token_id INTEGER NOT NULL,
      used_at INTEGER NOT NULL, UNIQUE(user_id, day));
    CREATE TABLE IF NOT EXISTS daily_tournaments (
      day TEXT PRIMARY KEY, kind TEXT NOT NULL, rules_json TEXT NOT NULL, events_json TEXT NOT NULL, difficulty TEXT NOT NULL,
      puzzle_id TEXT, puzzle TEXT NOT NULL, solution TEXT NOT NULL, created_at INTEGER NOT NULL, settled_at INTEGER);
    CREATE TABLE IF NOT EXISTS solo_runs (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), kind TEXT NOT NULL, day TEXT, n INTEGER,
      difficulty TEXT NOT NULL, puzzle_id TEXT, puzzle TEXT NOT NULL, solution TEXT NOT NULL, grid TEXT NOT NULL,
      started_at INTEGER NOT NULL, ended_at INTEGER, limit_ms INTEGER, status TEXT NOT NULL, mistakes INTEGER NOT NULL DEFAULT 0,
      hints INTEGER NOT NULL DEFAULT 0, moves INTEGER NOT NULL DEFAULT 0, time_ms INTEGER, score INTEGER, detail_json TEXT, flagged INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS ix_runs_user ON solo_runs(user_id, kind, day);
    CREATE INDEX IF NOT EXISTS ix_runs_day ON solo_runs(kind, day, score DESC);
    CREATE TABLE IF NOT EXISTS wcs_seasons (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, status TEXT NOT NULL, qual_start INTEGER NOT NULL, qual_end INTEGER NOT NULL,
      top_n INTEGER NOT NULL, min_matches INTEGER NOT NULL, round_hours INTEGER NOT NULL, min_elo INTEGER NOT NULL, rules_json TEXT NOT NULL,
      bracket_size INTEGER, ko_start INTEGER, champion_id INTEGER, runner_up_id INTEGER, finished_at INTEGER, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS wcs_entries (
      season_id INTEGER NOT NULL REFERENCES wcs_seasons(id), user_id INTEGER NOT NULL REFERENCES users(id), joined_at INTEGER NOT NULL,
      elo_at_join INTEGER NOT NULL, played INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0,
      draws INTEGER NOT NULL DEFAULT 0, points INTEGER NOT NULL DEFAULT 0, solve_ms INTEGER NOT NULL DEFAULT 0, last_at INTEGER,
      seed INTEGER, eliminated_round INTEGER, PRIMARY KEY (season_id, user_id));
    CREATE TABLE IF NOT EXISTS wcs_ko (
      id INTEGER PRIMARY KEY AUTOINCREMENT, season_id INTEGER NOT NULL REFERENCES wcs_seasons(id), round INTEGER NOT NULL, slot INTEGER NOT NULL,
      p1 INTEGER REFERENCES users(id), p2 INTEGER REFERENCES users(id), seed1 INTEGER, seed2 INTEGER, status TEXT NOT NULL,
      winner INTEGER, reason TEXT, match_id TEXT, opens_at INTEGER NOT NULL, deadline INTEGER NOT NULL, ready1_at INTEGER, ready2_at INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0, ended_at INTEGER, UNIQUE(season_id, round, slot));
    CREATE TABLE IF NOT EXISTS wcs_champions (
      season_id INTEGER PRIMARY KEY REFERENCES wcs_seasons(id), user_id INTEGER NOT NULL REFERENCES users(id), runner_up INTEGER,
      final_ko_id INTEGER, decided_at INTEGER NOT NULL, rating_at INTEGER, country TEXT);
    CREATE TABLE IF NOT EXISTS user_titles (
      user_id INTEGER NOT NULL REFERENCES users(id), title TEXT NOT NULL, season_id INTEGER NOT NULL, awarded_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, title, season_id));
    CREATE TABLE IF NOT EXISTS anticheat_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id), kind TEXT NOT NULL, detail TEXT, ref TEXT,
      created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', reviewed_by INTEGER, reviewed_at INTEGER, note TEXT);
    CREATE INDEX IF NOT EXISTS ix_ac_status ON anticheat_logs(status, created_at);
    CREATE TABLE IF NOT EXISTS appeals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), ref_type TEXT NOT NULL, ref TEXT, body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', admin_note TEXT, created_at INTEGER NOT NULL, resolved_at INTEGER, resolved_by INTEGER);
    CREATE TABLE IF NOT EXISTS admin_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER NOT NULL, action TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL);
  `);
  /* v5 / WCS v4.4 (additive only): coins + shop + borders, player bans, player reports, richer audit */
  const cols5 = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols5.includes('coins')) db.exec('ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT 0');
  if (!cols5.includes('border')) db.exec("ALTER TABLE users ADD COLUMN border TEXT NOT NULL DEFAULT 'none'");
  const colsA = db.prepare('PRAGMA table_info(admin_audit)').all().map((c) => c.name);
  if (!colsA.includes('target_id')) db.exec('ALTER TABLE admin_audit ADD COLUMN target_id INTEGER');
  db.exec(`
    CREATE INDEX IF NOT EXISTS ix_audit_target ON admin_audit(target_id, created_at);
    CREATE INDEX IF NOT EXISTS ix_audit_action ON admin_audit(action, created_at);
    CREATE TABLE IF NOT EXISTS coin_tx (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), amount INTEGER NOT NULL,
      balance INTEGER NOT NULL, reason TEXT NOT NULL, ref TEXT NOT NULL, day TEXT, created_at INTEGER NOT NULL,
      UNIQUE(user_id, reason, ref));
    CREATE INDEX IF NOT EXISTS ix_coin_user ON coin_tx(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS owned_borders (
      user_id INTEGER NOT NULL REFERENCES users(id), border_id TEXT NOT NULL, source TEXT NOT NULL, price INTEGER NOT NULL DEFAULT 0,
      acquired_at INTEGER NOT NULL, PRIMARY KEY (user_id, border_id));
    CREATE TABLE IF NOT EXISTS player_bans (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
      reason_code TEXT NOT NULL, reason_text TEXT, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, duration_ms INTEGER NOT NULL,
      admin_id INTEGER NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'active',
      revoked_at INTEGER, revoked_by INTEGER, revoke_note TEXT, report_id INTEGER, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS ix_bans_user ON player_bans(user_id, status, ends_at);
    CREATE INDEX IF NOT EXISTS ix_bans_status ON player_bans(status, ends_at);
    CREATE TABLE IF NOT EXISTS player_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reporter_id INTEGER NOT NULL REFERENCES users(id), target_id INTEGER NOT NULL REFERENCES users(id),
      category TEXT NOT NULL, body TEXT, match_id INTEGER, status TEXT NOT NULL DEFAULT 'open',
      admin_note TEXT, resolved_by INTEGER, resolved_at INTEGER, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS ix_reports_status ON player_reports(status, created_at);
    CREATE INDEX IF NOT EXISTS ix_reports_target ON player_reports(target_id, created_at);
  `);
  /* v6 / WCS v4.4 build 2 (additive only): Multiplayer Ranked, board themes, titles, history privacy,
     mutes, support reports, server-side music library, remember-me sessions */
  const cols6 = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  [['board_theme', "TEXT NOT NULL DEFAULT 'default'"], ['active_title', 'TEXT'], ['history_privacy', "TEXT NOT NULL DEFAULT 'public'"],
    ['mr_games', 'INTEGER NOT NULL DEFAULT 0'], ['mr_wins', 'INTEGER NOT NULL DEFAULT 0'], ['mr_losses', 'INTEGER NOT NULL DEFAULT 0'], ['mr_draws', 'INTEGER NOT NULL DEFAULT 0']].forEach(([c, d]) => { if (!cols6.includes(c)) db.exec('ALTER TABLE users ADD COLUMN ' + c + ' ' + d); });
  db.exec(`
    CREATE TABLE IF NOT EXISTS owned_themes (
      user_id INTEGER NOT NULL REFERENCES users(id), theme_id TEXT NOT NULL, source TEXT NOT NULL, price INTEGER NOT NULL DEFAULT 0,
      acquired_at INTEGER NOT NULL, PRIMARY KEY (user_id, theme_id));
    CREATE TABLE IF NOT EXISTS user_mutes (
      user_id INTEGER NOT NULL REFERENCES users(id), target_id INTEGER NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, target_id));
    CREATE TABLE IF NOT EXISTS mr_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT, size INTEGER NOT NULL, mode TEXT NOT NULL, diff TEXT NOT NULL, private INTEGER NOT NULL DEFAULT 0,
      rated INTEGER NOT NULL DEFAULT 1, players_key TEXT, winner TEXT, reason TEXT, puzzle TEXT, solution TEXT, cages TEXT,
      started_at INTEGER NOT NULL, ended_at INTEGER, duration_ms INTEGER);
    CREATE INDEX IF NOT EXISTS ix_mr_key ON mr_matches(players_key, started_at);
    CREATE TABLE IF NOT EXISTS mr_players (
      match_id INTEGER NOT NULL REFERENCES mr_matches(id), user_id INTEGER NOT NULL REFERENCES users(id), team TEXT NOT NULL, seat INTEGER NOT NULL,
      rating_before INTEGER, rating_after INTEGER, delta INTEGER, coins INTEGER NOT NULL DEFAULT 0, mistakes INTEGER NOT NULL DEFAULT 0,
      moves INTEGER NOT NULL DEFAULT 0, result TEXT, PRIMARY KEY (match_id, user_id));
    CREATE INDEX IF NOT EXISTS ix_mrp_user ON mr_players(user_id, match_id DESC);
    CREATE TABLE IF NOT EXISTS support_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id), category TEXT NOT NULL, body TEXT NOT NULL, client TEXT,
      status TEXT NOT NULL DEFAULT 'open', admin_note TEXT, resolved_by INTEGER, resolved_at INTEGER, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS ix_support_status ON support_reports(status, created_at);
    CREATE TABLE IF NOT EXISTS user_music (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), title TEXT NOT NULL, mime TEXT NOT NULL,
      size INTEGER NOT NULL, data BLOB NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS ix_music_user ON user_music(user_id, id);
    CREATE TABLE IF NOT EXISTS user_wallpaper (
      user_id INTEGER PRIMARY KEY REFERENCES users(id), data TEXT NOT NULL, size INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  `);
  const cur = db.prepare('SELECT v FROM schema_meta WHERE k = ?').get('version');
  if (!cur) db.prepare('INSERT INTO schema_meta (k, v) VALUES (?, ?)').run('version', String(SCHEMA_VERSION));
  else if (Number(cur.v) < SCHEMA_VERSION) db.prepare('UPDATE schema_meta SET v = ? WHERE k = ?').run(String(SCHEMA_VERSION), 'version');
  return db;
}

/* Online backup: consistent copy while the server keeps running. */
function backup(db, dir) {
  const d = dir || path.join(__dirname, '..', 'backups');
  fs.mkdirSync(d, { recursive: true });
  const name = path.join(d, 'sla-' + new Date().toISOString().replace(/[:.]/g, '-') + '.db');
  return db.backup(name).then(() => {
    const files = fs.readdirSync(d).filter((f) => f.startsWith('sla-') && f.endsWith('.db')).sort();
    while (files.length > 14) fs.unlinkSync(path.join(d, files.shift()));
    return name;
  });
}

module.exports = { open, backup, SCHEMA_VERSION };
