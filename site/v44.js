/* WCS v4.4 – client for: border shop + coins, ban notice, player reports, admin Ban / Audit / Reports tabs.
   The server decides everything (bans, prices, ownership, coins). This file only renders and sends intents. */
(function () {
  'use strict';
  Object.assign(I18N.bm, {
    nav_shop: 'Kedai', v44_shop_t: 'Kedai Border', v44_coins: 'Coin', v44_today: 'Hari ini dari perlawanan: {a} / {c}',
    v44_rules: 'Coin diberi oleh server: Ranked menang +{w}, seri +{d}, kalah +{l} · WCS menang +{ww} · Pertandingan Harian +{dy}. Had harian perlawanan {c}. Menyerah atau keluar dalam 30 saat tidak dapat Coin.',
    v44_login: 'Log masuk ke akaun server untuk membuka Kedai Border.', v44_all: 'Semua', r_common: 'Common', r_rare: 'Rare', r_mythic: 'Mythic', r_legendary: 'Legendary',
    v44_buy: 'Beli', v44_equip: 'Pakai', v44_equipped: 'Dipakai', v44_owned: 'Dimiliki', v44_new: 'BARU', v44_reward: 'Ganjaran', v44_soon: 'Akan datang',
    v44_buy_q: 'Beli border {n} dengan {p} Coin?', v44_bought: 'Border dibeli', v44_equip_ok: 'Border dipakai', v44_hist: 'Sejarah Coin', v44_hist_none: 'Belum ada transaksi.',
    v44_tx_welcome: 'Bonus selamat datang', v44_tx_match: 'Ganjaran perlawanan', v44_tx_daily: 'Pertandingan Harian', v44_tx_shop: 'Pembelian kedai', v44_preview: 'Pratonton',
    rw_veteran: '100 perlawanan (semua mod)', rw_founder: '100 akaun pertama WCS', rw_wcs_ko: 'Layak ke kalah mati WCS', rw_wcs_final: 'Mara ke Grand Final WCS', rw_wcs_champion: 'Juara WCS', rw_mr_champion: 'Menang 25 perlawanan MR 2v2/3v3',
    bd_none: 'Tiada border', bd_bronze: 'Gangsa', bd_silver: 'Perak', bd_jade: 'Jed', bd_gold: 'Emas', bd_neon: 'Neon', bd_frost: 'Fros', bd_ruby: 'Delima', bd_sakura: 'Sakura', bd_diamond: 'Berlian', bd_jalur: 'Jalur Gemilang',
    bd_veteran: 'Veteran', bd_galaxy: 'Galaksi', bd_aurora: 'Aurora', bd_royal: 'Diraja', bd_nebula: 'Mythic Nebula', bd_thunder: 'Mythic Thunder', bd_phantom: 'Mythic Phantom', bd_dragon: 'Mythic Dragon', bd_celestial: 'Mythic Celestial',
    bd_legend: 'Legend', bd_mrstar: 'MR Champion', bd_phoenix: 'Phoenix', bd_inferno: 'Inferno', bd_legend2: 'Legendary 2', bd_founder: 'Founder', bd_finalist: 'Finalist', bd_champion: 'Champion',
    v44_coins_won: '+{n} Coin',
    /* bans */
    v44_ban_t: 'Akaun anda sedang diban', v44_ban_body: 'Anda tidak boleh bermain Ranked, Custom Room, WCS atau Pertandingan Harian sehingga {e}.', v44_ban_reason: 'Sebab', v44_ban_left: 'Baki: {l}',
    v44_ban_bar: 'Diban daripada permainan kompetitif sehingga {e} · {r}', v44_ban_over: 'Tempoh ban tamat. Akses kompetitif dipulihkan.',
    v44_void_banned: 'Perlawanan dibatalkan: akaun anda telah diban.', v44_void_opp: 'Perlawanan dibatalkan kerana lawan dikenakan tindakan. Elo anda tidak berubah.',
    br_cheating: 'Menipu (cheat)', br_exploit: 'Eksploit', br_elo_manip: 'Manipulasi Elo', br_coin_manip: 'Manipulasi Coin', br_bug_abuse: 'Guna bug untuk kelebihan tidak adil', br_rules: 'Melanggar peraturan WCS', br_custom: 'Sebab tersuai',
    /* reports */
    v44_report: 'Laporkan', v44_report_t: 'Laporkan {n}', v44_report_cat: 'Kategori', v44_report_body: 'Terangkan apa yang berlaku (min 5 aksara)', v44_report_sent: 'Laporan dihantar kepada admin.',
    rc_cheating: 'Menipu (cheat)', rc_exploit: 'Eksploit', rc_elo_manip: 'Manipulasi Elo', rc_coin_manip: 'Manipulasi Coin', rc_bug_abuse: 'Guna bug', rc_abuse: 'Kelakuan buruk', rc_other: 'Lain-lain',
    e_report_dup: 'Anda sudah melaporkan pemain ini dalam 24 jam lepas.', e_report_self: 'Anda tidak boleh melaporkan diri sendiri.', e_report_short: 'Terangkan sekurang-kurangnya 5 aksara.', e_banned: 'Akaun anda sedang diban daripada permainan kompetitif.',
    e_already_banned: 'Pemain ini sudah mempunyai ban aktif.', e_ban_self: 'Anda tidak boleh ban diri sendiri.', e_ban_admin: 'Admin tidak boleh diban.', e_bad_duration: 'Tempoh tidak sah (1 jam hingga 365 hari).', e_reason_required: 'Tulis sebab tersuai (min 3 aksara).',
    e_note_required: 'Catatan UNBAN wajib (min 3 aksara).', e_not_active: 'Ban ini sudah tidak aktif.', e_no_coins: 'Coin tidak mencukupi.', e_owned: 'Anda sudah memiliki border ini.', e_reward_only: 'Border ini hanya untuk ganjaran.', e_not_owned: 'Anda belum memiliki border ini.', e_rate_limited: 'Terlalu banyak cubaan. Cuba sebentar lagi.',
    /* admin */
    adm_tab_season: 'Musim', adm_tab_reports: 'Laporan', adm_tab_ac: 'Anti-cheat', adm_tab_appeals: 'Rayuan', adm_tab_bans: 'Ban', adm_tab_audit: 'Audit',
    adm_search: 'Cari username atau Player ID', adm_find: 'Cari', adm_players: 'Pemain', adm_ban_btn: 'Ban', adm_unban_btn: 'UNBAN', adm_view: 'Lihat',
    adm_ban_t: 'Ban pemain', adm_ban_dur: 'Tempoh', adm_custom: 'Tersuai', adm_days: 'Hari', adm_hours: 'Jam', adm_reason: 'Sebab', adm_reason_txt: 'Butiran / sebab tersuai', adm_ban_ends: 'Tamat: {e}', adm_ban_go: 'Kenakan BAN',
    adm_unban_t: 'UNBAN {n}', adm_unban_note: 'Catatan pentadbiran (wajib)', adm_unban_go: 'Sahkan UNBAN', adm_ban_ok: 'BAN dikenakan', adm_unban_ok: 'BAN dibatalkan',
    adm_st_all: 'Semua', adm_st_active: 'Aktif', adm_st_expired: 'Tamat', adm_st_revoked: 'Dibatalkan', adm_st_open: 'Terbuka', adm_st_resolved: 'Selesai', adm_st_dismissed: 'Ditolak',
    adm_col_player: 'Pemain', adm_col_reason: 'Sebab', adm_col_start: 'Mula', adm_col_end: 'Tamat', adm_col_dur: 'Tempoh', adm_col_admin: 'Admin', adm_col_status: 'Status',
    adm_grant_t: 'Beri ganjaran acara', adm_grant_s: 'Beri border atau tema papan acara kepada pemain. Tidak mengubah Elo atau coin. Setiap pemberian direkodkan dalam audit.', adm_grant_user: 'Username, ID pemain atau ID', adm_grant_note: 'Nota (wajib, min 3 aksara)', adm_grant_btn: 'Beri', adm_grant_q: 'Beri {i} kepada {u}?', adm_grant_owned: 'Pemain sudah memiliki item ini.', adm_grant_ok: 'Ganjaran diberikan dan direkodkan dalam audit.', adm_note_req: 'Nota wajib (sekurang-kurangnya 3 aksara).',
    adm_sup_t: 'Laporan masalah (sokongan)', adm_note: 'Nota pentadbir', adm_reopen: 'Buka semula', sup_bug: 'Pepijat', sup_match: 'Perlawanan', sup_account: 'Akaun', sup_payment: 'Coin / kedai', sup_other: 'Lain-lain',
    adm_none: 'Tiada rekod.', adm_hist: 'Sejarah ban', adm_reports_on: 'Laporan terhadap pemain', adm_recent: 'Perlawanan terkini', adm_resolve: 'Selesai', adm_dismiss: 'Tolak', adm_from: 'daripada {n}',
    adm_audit_all: 'Semua tindakan', adm_audit_q: 'Tapis ikut pemain / admin', adm_before_after: '{a} → {b}', adm_revoked_by: 'Dibatalkan oleh {n}: {note}', adm_banned_now: 'Diban sehingga {e}', adm_loading: 'Memuatkan…', adm_err: 'Gagal memuatkan. Cuba lagi.',
    adm_cfg_hint: 'Minimum perlawanan 1–50 · Jam setiap pusingan 1–168', adm_cfg_bad: 'Nilai di luar julat dibenarkan.', adm_cfg_same: 'Tiada perubahan untuk disimpan.'
  });
  Object.assign(I18N.en, {
    nav_shop: 'Shop', v44_shop_t: 'Border Shop', v44_coins: 'Coins', v44_today: 'Today from matches: {a} / {c}',
    v44_rules: 'Coins are granted by the server: Ranked win +{w}, draw +{d}, loss +{l} · WCS win +{ww} · Daily Tournament +{dy}. Daily match cap {c}. Surrendering or leaving within 30 seconds earns nothing.',
    v44_login: 'Sign in to a server account to open the Border Shop.', v44_all: 'All', r_common: 'Common', r_rare: 'Rare', r_mythic: 'Mythic', r_legendary: 'Legendary',
    v44_buy: 'Buy', v44_equip: 'Equip', v44_equipped: 'Equipped', v44_owned: 'Owned', v44_new: 'NEW', v44_reward: 'Reward', v44_soon: 'Coming soon',
    v44_buy_q: 'Buy the {n} border for {p} Coins?', v44_bought: 'Border purchased', v44_equip_ok: 'Border equipped', v44_hist: 'Coin history', v44_hist_none: 'No transactions yet.',
    v44_tx_welcome: 'Welcome bonus', v44_tx_match: 'Match reward', v44_tx_daily: 'Daily Tournament', v44_tx_shop: 'Shop purchase', v44_preview: 'Preview',
    rw_veteran: '100 matches (all modes)', rw_founder: 'First 100 WCS accounts', rw_wcs_ko: 'Qualify for the WCS knockout', rw_wcs_final: 'Reach the WCS Grand Final', rw_wcs_champion: 'WCS Champion', rw_mr_champion: 'Win 25 MR 2v2/3v3 matches',
    bd_none: 'No border', bd_bronze: 'Bronze', bd_silver: 'Silver', bd_jade: 'Jade', bd_gold: 'Gold', bd_neon: 'Neon', bd_frost: 'Frost', bd_ruby: 'Ruby', bd_sakura: 'Sakura', bd_diamond: 'Diamond', bd_jalur: 'Jalur Gemilang',
    bd_veteran: 'Veteran', bd_galaxy: 'Galaxy', bd_aurora: 'Aurora', bd_royal: 'Royal', bd_nebula: 'Mythic Nebula', bd_thunder: 'Mythic Thunder', bd_phantom: 'Mythic Phantom', bd_dragon: 'Mythic Dragon', bd_celestial: 'Mythic Celestial',
    bd_legend: 'Legend', bd_mrstar: 'MR Champion', bd_phoenix: 'Phoenix', bd_inferno: 'Inferno', bd_legend2: 'Legendary 2', bd_founder: 'Founder', bd_finalist: 'Finalist', bd_champion: 'Champion',
    v44_coins_won: '+{n} Coins',
    v44_ban_t: 'Your account is banned', v44_ban_body: 'You cannot play Ranked, Custom Rooms, WCS or the Daily Tournament until {e}.', v44_ban_reason: 'Reason', v44_ban_left: 'Remaining: {l}',
    v44_ban_bar: 'Banned from competitive play until {e} · {r}', v44_ban_over: 'Your ban has ended. Competitive access restored.',
    v44_void_banned: 'Match cancelled: your account has been banned.', v44_void_opp: 'Match cancelled because your opponent was sanctioned. Your Elo did not change.',
    br_cheating: 'Cheating', br_exploit: 'Exploit', br_elo_manip: 'Elo manipulation', br_coin_manip: 'Coin manipulation', br_bug_abuse: 'Bug abuse for unfair advantage', br_rules: 'WCS rule violation', br_custom: 'Custom reason',
    v44_report: 'Report', v44_report_t: 'Report {n}', v44_report_cat: 'Category', v44_report_body: 'Describe what happened (min 5 characters)', v44_report_sent: 'Report sent to the admins.',
    rc_cheating: 'Cheating', rc_exploit: 'Exploit', rc_elo_manip: 'Elo manipulation', rc_coin_manip: 'Coin manipulation', rc_bug_abuse: 'Bug abuse', rc_abuse: 'Abusive behaviour', rc_other: 'Other',
    e_report_dup: 'You already reported this player in the last 24 hours.', e_report_self: 'You cannot report yourself.', e_report_short: 'Please write at least 5 characters.', e_banned: 'Your account is banned from competitive play.',
    e_already_banned: 'This player already has an active ban.', e_ban_self: 'You cannot ban yourself.', e_ban_admin: 'Admins cannot be banned.', e_bad_duration: 'Invalid duration (1 hour to 365 days).', e_reason_required: 'Write a custom reason (min 3 characters).',
    e_note_required: 'An UNBAN note is required (min 3 characters).', e_not_active: 'This ban is no longer active.', e_no_coins: 'Not enough Coins.', e_owned: 'You already own this border.', e_reward_only: 'This border is reward only.', e_not_owned: 'You do not own this border yet.', e_rate_limited: 'Too many attempts. Try again shortly.',
    adm_tab_season: 'Season', adm_tab_reports: 'Reports', adm_tab_ac: 'Anti-cheat', adm_tab_appeals: 'Appeals', adm_tab_bans: 'Bans', adm_tab_audit: 'Audit',
    adm_search: 'Search username or Player ID', adm_find: 'Search', adm_players: 'Players', adm_ban_btn: 'Ban', adm_unban_btn: 'UNBAN', adm_view: 'View',
    adm_ban_t: 'Ban player', adm_ban_dur: 'Duration', adm_custom: 'Custom', adm_days: 'Days', adm_hours: 'Hours', adm_reason: 'Reason', adm_reason_txt: 'Details / custom reason', adm_ban_ends: 'Ends: {e}', adm_ban_go: 'Apply BAN',
    adm_unban_t: 'UNBAN {n}', adm_unban_note: 'Administrative note (required)', adm_unban_go: 'Confirm UNBAN', adm_ban_ok: 'BAN applied', adm_unban_ok: 'BAN revoked',
    adm_st_all: 'All', adm_st_active: 'Active', adm_st_expired: 'Expired', adm_st_revoked: 'Revoked', adm_st_open: 'Open', adm_st_resolved: 'Resolved', adm_st_dismissed: 'Dismissed',
    adm_col_player: 'Player', adm_col_reason: 'Reason', adm_col_start: 'Start', adm_col_end: 'End', adm_col_dur: 'Duration', adm_col_admin: 'Admin', adm_col_status: 'Status',
    adm_grant_t: 'Grant event reward', adm_grant_s: 'Give an event border or board theme to a player. Never changes Elo or coins. Every grant is audit-logged.', adm_grant_user: 'Username, player ID or ID', adm_grant_note: 'Note (required, min 3 chars)', adm_grant_btn: 'Grant', adm_grant_q: 'Grant {i} to {u}?', adm_grant_owned: 'The player already owns this item.', adm_grant_ok: 'Reward granted and audit-logged.', adm_note_req: 'A note is required (at least 3 characters).',
    adm_sup_t: 'Problem reports (support)', adm_note: 'Admin note', adm_reopen: 'Reopen', sup_bug: 'Bug', sup_match: 'Match', sup_account: 'Account', sup_payment: 'Coins / shop', sup_other: 'Other',
    adm_none: 'No records.', adm_hist: 'Ban history', adm_reports_on: 'Reports against player', adm_recent: 'Recent matches', adm_resolve: 'Resolve', adm_dismiss: 'Dismiss', adm_from: 'from {n}',
    adm_audit_all: 'All actions', adm_audit_q: 'Filter by player / admin', adm_before_after: '{a} → {b}', adm_revoked_by: 'Revoked by {n}: {note}', adm_banned_now: 'Banned until {e}', adm_loading: 'Loading…', adm_err: 'Could not load. Try again.',
    adm_cfg_hint: 'Minimum matches 1–50 · Hours per round 1–168', adm_cfg_bad: 'Value outside the allowed range.', adm_cfg_same: 'Nothing changed.'
  });

  var RARITY = ['common', 'rare', 'mythic', 'legendary'];
  var BAN_REASONS = ['cheating', 'exploit', 'elo_manip', 'coin_manip', 'bug_abuse', 'rules', 'custom'];
  var REPORT_CATS = ['cheating', 'exploit', 'elo_manip', 'coin_manip', 'bug_abuse', 'abuse', 'other'];
  var BORDER_RE = /^[a-z0-9]{2,16}$/;
  var BORDER_IDS = ['none', 'bronze', 'silver', 'jade', 'gold', 'neon', 'frost', 'ruby', 'sakura', 'diamond', 'jalur', 'veteran', 'galaxy', 'aurora', 'royal', 'nebula', 'thunder', 'phantom', 'dragon', 'celestial', 'legend', 'mrstar', 'phoenix', 'inferno', 'legend2', 'founder', 'finalist', 'champion'];

  function api(m, p, b) { return Net.api(m, p, b); }
  function err(code) { var k = 'e_' + code, s = t(k); return s !== k ? s : (typeof errText === 'function' ? errText(code) : String(code)); }
  function fmt(ts) { return new Date(ts).toLocaleString(LANG === 'bm' ? 'ms-MY' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  function dur(ms) {
    if (ms <= 0) return '0';
    var d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4);
    var bm = LANG === 'bm', out = [];
    if (d) out.push(d + (bm ? ' hari' : (d === 1 ? ' day' : ' days')));
    if (h) out.push(h + (bm ? ' jam' : 'h'));
    if (!d && m) out.push(m + (bm ? ' minit' : 'm'));
    return out.join(' ') || (bm ? '< 1 minit' : '< 1m');
  }
  function reasonText(code, txt) { return t('br_' + code) + (txt ? ' — ' + txt : ''); }
  function borderName(id) { return t('bd_' + id); }

  /* --------------------------------------------------------------- border on avatars */
  function applyBorder(box, u) {
    if (!box || !box.classList) return box;
    Array.prototype.slice.call(box.classList).forEach(function (c) { if (c === 'bd' || c.indexOf('bd-') === 0) box.classList.remove(c); });
    var id = u && u.border;
    if (id && id !== 'none' && BORDER_RE.test(id)) { box.classList.add('bd'); box.classList.add('bd-' + id); }
    return box;
  }
  if (window.Avatar && Avatar.fill) {
    var origFill = Avatar.fill;
    Avatar.fill = function (box, u) { var r = origFill(box, u); applyBorder(box, u); return r; };
    var origNode = Avatar.node;
    Avatar.node = function (u, cls) { var n = origNode(u, cls); applyBorder(n, u); return n; };
    Avatar.border = applyBorder;
  }
  function preview(id, size) {
    var me = Net.user() || { username: '?' };
    var u = { id: me.id, username: me.username, avatar: me.avatar, border: id };
    var n = Avatar.node(u, 'shop-av' + (size ? ' ' + size : ''));
    return n;
  }

  /* --------------------------------------------------------------- shop */
  var shop = null, coins = null, filter = 'all', busy = false;
  function root() { return $('shopRoot'); }
  function showShop() {
    var R = root(); if (!R) return;
    if (!Net.user()) { clear(R).appendChild(el('div', { class: 'panel' }, [el('h2', {}, [el('span', { class: 'dot' }), el('span', { text: t('v44_shop_t') })]), el('p', { class: 'muted', text: t('v44_login') })])); return; }
    if (!shop) clear(R).appendChild(el('div', { class: 'panel' }, [el('p', { class: 'muted', text: t('adm_loading') })]));
    Promise.all([api('GET', '/api/shop'), api('GET', '/api/me/coins')]).then(function (rs) {
      if (!rs[0].ok) { clear(R).appendChild(el('div', { class: 'panel' }, [el('p', { class: 'muted', text: err(rs[0].body.error) })])); return; }
      shop = rs[0].body; coins = rs[1].ok ? rs[1].body : null; renderShop();
    });
  }
  function renderShop() {
    var R = clear(root()); if (!R || !shop) return;
    var me = Net.user();
    var head = el('div', { class: 'panel shop-head' }, [
      el('div', { class: 'shop-head-l' }, [preview(shop.equipped, 'xl'), el('div', {}, [el('h2', {}, [el('span', { class: 'dot' }), el('span', { text: t('v44_shop_t') })]), el('div', { class: 'small muted', text: (me ? me.username + ' · ' : '') + borderName(shop.equipped) })])]),
      el('div', { class: 'shop-coins' }, [el('span', { class: 'coin-ic', 'aria-hidden': 'true' }), el('b', { id: 'shopCoins', text: String(shop.coins) }), el('span', { class: 'small muted', text: t('v44_coins') })])
    ]);
    R.appendChild(head);
    if (coins) R.appendChild(el('div', { class: 'note shop-note' }, [el('div', { text: t('v44_today', { a: coins.today, c: coins.cap }) }), el('div', { class: 'tiny', text: t('v44_rules', { w: coins.rules.win, d: coins.rules.draw, l: coins.rules.loss, ww: coins.rules.wcsWin, dy: coins.rules.daily, c: coins.rules.dailyMatchCap }) })]));
    var seg = el('div', { class: 'seg shop-seg', role: 'tablist' });
    ['all'].concat(RARITY).forEach(function (r) { seg.appendChild(el('button', { class: filter === r ? 'on' : '', role: 'tab', 'aria-selected': filter === r ? 'true' : 'false', text: r === 'all' ? t('v44_all') : t('r_' + r), onclick: function () { filter = r; renderShop(); } })); });
    var grid = el('div', { class: 'shop-grid' });
    shop.borders.filter(function (b) { return filter === 'all' || b.rarity === filter; }).forEach(function (b) { grid.appendChild(cardNode(b)); });
    R.appendChild(el('div', { class: 'panel' }, [el('div', { class: 'shop-bar' }, [seg]), grid]));
    var hist = el('div', { class: 'panel' }, [el('h2', {}, [el('span', { class: 'dot' }), el('span', { text: t('v44_hist') })])]);
    if (!coins || !coins.tx.length) hist.appendChild(el('p', { class: 'muted small', text: t('v44_hist_none') }));
    else { var list = el('div', { class: 'coin-hist' }); coins.tx.forEach(function (x) { var why = t('v44_tx_' + x.reason); list.appendChild(el('div', { class: 'coin-row' }, [el('span', { class: 'small', text: (why === 'v44_tx_' + x.reason ? x.reason : why) + (x.reason === 'shop' ? ' · ' + (/^theme:/.test(String(x.ref)) ? t('w41_themes') + ' ' + String(x.ref).slice(6) : borderName(String(x.ref).replace('border:', ''))) : '') + (x.reason === 'match' && /^mr/.test(String(x.ref)) ? ' · MR' : '') }), el('span', { class: 'tiny muted', text: fmt(x.created_at) }), el('b', { class: x.amount < 0 ? 'neg' : 'pos', text: (x.amount > 0 ? '+' : '') + x.amount })])); }); hist.appendChild(list); }
    R.appendChild(hist);
    if (window.V45 && V45.shopExtras) { try { V45.shopExtras(R); } catch (e) { console.error('shop extras', e); } }
  }
  function cardNode(b) {
    var eq = shop.equipped === b.id;
    var tags = [el('span', { class: 'rar rar-' + b.rarity, text: t('r_' + b.rarity) })];
    if (b.isNew) tags.push(el('span', { class: 'badge acc', text: t('v44_new') }));
    if (b.price == null && b.id !== 'none') tags.push(el('span', { class: 'badge', text: t('v44_reward') }));
    var sub;
    if (b.owned) sub = el('span', { class: 'small ok-t', text: eq ? t('v44_equipped') : t('v44_owned') });
    else if (b.price == null) sub = el('span', { class: 'tiny muted', text: b.available ? t('rw_' + b.reward) : t('rw_' + b.reward) });
    else sub = el('span', { class: 'shop-price' }, [el('span', { class: 'coin-ic sm', 'aria-hidden': 'true' }), el('b', { text: String(b.price) })]);
    var btn;
    if (eq) btn = el('button', { class: 'btn sm', disabled: 'disabled', text: t('v44_equipped') });
    else if (b.owned) btn = el('button', { class: 'btn sm primary', text: t('v44_equip'), onclick: function () { equip(b); } });
    else if (b.price != null) btn = el('button', { class: 'btn sm' + (shop.coins >= b.price ? ' primary' : ''), disabled: shop.coins >= b.price ? null : 'disabled', text: t('v44_buy'), onclick: function () { buy(b); } });
    else btn = el('button', { class: 'btn sm', disabled: 'disabled', text: b.available ? t('v44_reward') : t('v44_soon') });
    return el('div', { class: 'shop-card r-' + b.rarity + (eq ? ' eq' : '') + (b.premium ? ' premium' : ''), 'data-border': b.id }, [
      el('div', { class: 'shop-stage' }, [preview(b.id, 'lg')]),
      el('div', { class: 'shop-info' }, [el('b', { class: 'shop-name', text: borderName(b.id) }), el('div', { class: 'shop-tags' }, tags), sub]),
      btn]);
  }
  function buy(b) {
    if (busy) return;
    confirmBox(t('v44_buy_q', { n: borderName(b.id), p: b.price }), function () {
      busy = true;
      api('POST', '/api/shop/buy', { id: b.id }).then(function (r) {
        busy = false;
        if (!r.ok) { toast(err(r.body.error), 'err'); return; }
        toast(t('v44_bought') + ' · ' + borderName(b.id), 'ok'); showShop();
      });
    });
  }
  function equip(b) {
    if (busy) return; busy = true;
    api('POST', '/api/me/border', { id: b.id }).then(function (r) {
      busy = false;
      if (!r.ok) { toast(err(r.body.error), 'err'); return; }
      toast(t('v44_equip_ok') + ' · ' + borderName(b.id), 'ok'); refreshMe(r.body.user); showShop();
    });
  }
  function refreshMe(u) {
    var me = Net.user(); if (!me || !u) return;
    Object.keys(u).forEach(function (k) { me[k] = u[k]; });
    if ($('spAv')) Avatar.fill($('spAv'), me);
    if ($('pfAv')) Avatar.fill($('pfAv'), me);
  }

  /* --------------------------------------------------------------- ban notice (server decides) */
  var ban = null, banTimer = null;
  function setBan(b) {
    ban = b && b.endsAt ? { endsAt: b.endsAt, reasonCode: b.reasonCode, reasonText: b.reasonText || '', skew: b.serverTime ? b.serverTime - Date.now() : 0 } : null;
    renderBar();
    clearInterval(banTimer);
    if (ban) banTimer = setInterval(renderBar, 30000);
  }
  function srvNow() { return Date.now() + (ban ? ban.skew : 0); }
  function renderBar() {
    var bar = $('banBar'); if (!bar) return;
    if (ban && srvNow() >= ban.endsAt) { ban = null; clearInterval(banTimer); toast(t('v44_ban_over'), 'ok'); }
    if (!ban) { bar.classList.add('hidden'); clear(bar); return; }
    clear(bar).appendChild(el('span', { class: 'ban-ic', 'aria-hidden': 'true', text: '⛔' }));
    bar.appendChild(el('span', { text: t('v44_ban_bar', { e: fmt(ban.endsAt), r: reasonText(ban.reasonCode, ban.reasonText) }) }));
    bar.appendChild(el('b', { class: 'ban-left', text: t('v44_ban_left', { l: dur(ban.endsAt - srvNow()) }) }));
    bar.classList.remove('hidden');
  }
  var lastModal = 0;
  function banModal(b) {
    if (!b) return; setBan(b);
    if (Date.now() - lastModal < 1500) return; lastModal = Date.now();
    var body = el('div', { class: 'ban-modal' }, [
      el('p', { text: t('v44_ban_body', { e: fmt(b.endsAt) }) }),
      el('p', { class: 'small' }, [el('b', { text: t('v44_ban_reason') + ': ' }), document.createTextNode(reasonText(b.reasonCode, b.reasonText))]),
      el('p', { class: 'small muted', text: t('v44_ban_left', { l: dur(b.endsAt - (b.serverTime || Date.now())) }) })]);
    modal(t('v44_ban_t'), body, [{ label: t('close') }]);
  }

  /* --------------------------------------------------------------- player report */
  function report(p) {
    if (!p || !Net.user()) return;
    var cat = el('select', { id: 'repCat' }); REPORT_CATS.forEach(function (c) { cat.appendChild(el('option', { value: c, text: t('rc_' + c) })); });
    var ta = el('textarea', { id: 'repBody', maxlength: '500', rows: '4', placeholder: t('v44_report_body') });
    ta.addEventListener('keydown', function (e) { e.stopPropagation(); });
    var msg = el('div', { class: 'small err-t', role: 'status' });
    var send = el('button', { class: 'btn danger', text: t('v44_report') });
    var close = sheet(t('v44_report_t', { n: p.username }), [el('label', { class: 'fld' }, [el('span', { text: t('v44_report_cat') }), cat]), el('label', { class: 'fld' }, [el('span', { text: t('v44_report_body') }), ta]), msg], [send]);
    send.onclick = function () {
      var b = ta.value.trim(); if (b.length < 5) { msg.textContent = err('report_short'); return; }
      send.disabled = true;
      api('POST', '/api/report', { uid: p.id || p.uid, category: cat.value, body: b }).then(function (r) {
        send.disabled = false;
        if (!r.ok) { msg.textContent = err(r.body.error); return; }
        close(); toast(t('v44_report_sent'), 'ok');
      });
    };
  }
  /* in-page dialog that stays open on validation errors (native confirm/prompt are not used) */
  function sheet(title, kids, actions) {
    var rootN = $('modalRoot'); clear(rootN);
    var acts = el('div', { class: 'acts' });
    var dlg = el('div', { class: 'modal v44-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [el('h3', { text: title }), el('div', { class: 'v44-form' }, kids), acts]);
    var bg = el('div', { class: 'modal-bg' }, [dlg]);
    function close() { clear(rootN); document.removeEventListener('keydown', onEsc, true); }
    function onEsc(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    document.addEventListener('keydown', onEsc, true);
    actions.forEach(function (a) { acts.appendChild(a); });
    acts.appendChild(el('button', { class: 'btn', text: t('cancel'), onclick: close }));
    bg.addEventListener('click', function (e) { if (e.target === bg) close(); });
    rootN.appendChild(bg);
    var f = dlg.querySelector('select,input,textarea'); if (f) f.focus();
    return close;
  }

  /* --------------------------------------------------------------- admin: ban dialog */
  function banDialog(player, opts, done) {
    opts = opts || {};
    var preset = '1';
    var segP = el('div', { class: 'seg adm-seg', role: 'radiogroup', 'aria-label': t('adm_ban_dur') });
    var days = el('input', { type: 'number', min: '0', max: '365', value: '0', inputmode: 'numeric', 'aria-label': t('adm_days') });
    var hours = el('input', { type: 'number', min: '0', max: '23', value: '12', inputmode: 'numeric', 'aria-label': t('adm_hours') });
    var custom = el('div', { class: 'adm-custom hidden' }, [el('label', { class: 'fld' }, [el('span', { text: t('adm_days') }), days]), el('label', { class: 'fld' }, [el('span', { text: t('adm_hours') }), hours])]);
    ['1', '3', '7', '14', '30', 'custom'].forEach(function (p) {
      var b = el('button', { type: 'button', role: 'radio', 'aria-checked': p === preset ? 'true' : 'false', class: p === preset ? 'on' : '', text: p === 'custom' ? t('adm_custom') : (LANG === 'bm' ? p + ' hari' : p + (p === '1' ? ' day' : ' days')) });
      b.onclick = function () { preset = p; Array.prototype.forEach.call(segP.children, function (x) { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b ? 'true' : 'false'); }); custom.classList.toggle('hidden', p !== 'custom'); upd(); };
      segP.appendChild(b);
    });
    var rs = el('select', {}); BAN_REASONS.forEach(function (r) { rs.appendChild(el('option', { value: r, text: t('br_' + r), selected: r === (opts.reason || 'cheating') ? 'selected' : null })); });
    var rt = el('textarea', { rows: '2', maxlength: '300', placeholder: t('adm_reason_txt') }); if (opts.text) rt.value = opts.text;
    [rt, days, hours].forEach(function (x) { x.addEventListener('keydown', function (e) { e.stopPropagation(); }); x.addEventListener('input', upd); });
    [days, hours].forEach(noWheel);
    var ends = el('div', { class: 'small adm-ends' }), msg = el('div', { class: 'small err-t', role: 'status' });
    function ms() { if (preset !== 'custom') return Number(preset) * 864e5; var d = parseInt(days.value, 10) || 0, h = parseInt(hours.value, 10) || 0; return d * 864e5 + h * 36e5; }
    function upd() { var m = ms(); ends.textContent = m >= 36e5 && m <= 365 * 864e5 ? t('adm_ban_ends', { e: fmt(Date.now() + m) }) + ' · ' + dur(m) : err('bad_duration'); }
    upd();
    var go = el('button', { class: 'btn danger', text: t('adm_ban_go') });
    var who = el('div', { class: 'adm-who' }, [Avatar.node({ id: player.uid || player.id, username: player.username, avatar: player.avatar, border: player.border }, 'mini-av av-lg'), el('div', {}, [el('b', { text: player.username }), el('div', { class: 'tiny muted mono', text: (player.playerId || '') + ' · #' + (player.uid || player.id) })])]);
    var close = sheet(t('adm_ban_t'), [who, el('div', { class: 'fld' }, [el('span', { text: t('adm_ban_dur') }), segP]), custom, ends, el('label', { class: 'fld' }, [el('span', { text: t('adm_reason') }), rs]), el('label', { class: 'fld' }, [el('span', { text: t('adm_reason_txt') }), rt]), msg], [go]);
    go.onclick = function () {
      var body = { reasonCode: rs.value, reasonText: rt.value.trim() };
      if (opts.reportId) body.reportId = opts.reportId;
      if (preset === 'custom') { body.preset = 'custom'; body.customDays = parseInt(days.value, 10) || 0; body.customHours = parseInt(hours.value, 10) || 0; } else body.preset = Number(preset);
      if (body.reasonCode === 'custom' && body.reasonText.length < 3) { msg.textContent = err('reason_required'); return; }
      go.disabled = true; msg.textContent = '';
      api('POST', '/api/admin/players/' + (player.uid || player.id) + '/ban', body).then(function (r) {
        go.disabled = false;
        if (!r.ok) { msg.textContent = err(r.body.error); return; }
        close(); toast(t('adm_ban_ok') + ' · ' + player.username + ' · ' + dur(r.body.ban.durationMs), 'ok'); if (done) done(r.body.ban);
      });
    };
  }
  function unbanDialog(b, done) {
    var note = el('textarea', { rows: '3', maxlength: '300', placeholder: t('adm_unban_note') });
    note.addEventListener('keydown', function (e) { e.stopPropagation(); });
    var msg = el('div', { class: 'small err-t', role: 'status' });
    var go = el('button', { class: 'btn primary', text: t('adm_unban_go') });
    var info = el('div', { class: 'small adm-ends', text: reasonText(b.reasonCode, b.reasonText) + ' · ' + fmt(b.startsAt) + ' → ' + fmt(b.endsAt) });
    var close = sheet(t('adm_unban_t', { n: b.username }), [info, el('label', { class: 'fld' }, [el('span', { text: t('adm_unban_note') }), note]), msg], [go]);
    go.onclick = function () {
      var n = note.value.trim(); if (n.length < 3) { msg.textContent = err('note_required'); return; }
      go.disabled = true;
      api('POST', '/api/admin/bans/' + b.id + '/unban', { note: n }).then(function (r) {
        go.disabled = false; if (!r.ok) { msg.textContent = err(r.body.error); return; }
        close(); toast(t('adm_unban_ok') + ' · ' + b.username, 'ok'); if (done) done(r.body.ban);
      });
    };
  }
  function noWheel(inp) { inp.addEventListener('wheel', function (e) { if (document.activeElement === inp) { e.preventDefault(); } }, { passive: false }); }

  /* --------------------------------------------------------------- admin tabs */
  function stBadge(s) { var cls = s === 'active' ? 'err' : s === 'revoked' ? 'info' : s === 'open' ? 'warn' : s === 'resolved' ? 'ok' : ''; return el('span', { class: 'badge ' + cls, text: t('adm_st_' + s) }); }
  function loadingP(box) { var p = el('p', { class: 'muted small', text: t('adm_loading') }); box.appendChild(p); return p; }
  function segOf(vals, cur, fn) { var s = el('div', { class: 'seg adm-seg' }); vals.forEach(function (v) { s.appendChild(el('button', { type: 'button', class: v === cur ? 'on' : '', text: t('adm_st_' + v), onclick: function () { fn(v); } })); }); return s; }

  var banState = { status: 'active', q: '' };
  function renderBans(box) {
    clear(box);
    var pSearch = el('div', { class: 'panel' }, [el('h2', {}, [el('span', { class: 'dot' }), el('span', { text: t('adm_players') })])]);
    var q = el('input', { type: 'search', placeholder: t('adm_search'), maxlength: '40', 'aria-label': t('adm_search') });
    q.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') find(); });
    var res = el('div', { class: 'adm-list' });
    pSearch.appendChild(el('form', { class: 'adm-search', onsubmit: function (e) { e.preventDefault(); find(); } }, [q, el('button', { class: 'btn primary', type: 'submit', text: t('adm_find') })]));
    pSearch.appendChild(res);
    function find() {
      clear(res); loadingP(res);
      api('GET', '/api/admin/players?q=' + encodeURIComponent(q.value.trim())).then(function (r) {
        clear(res); if (!r.ok) { res.appendChild(el('p', { class: 'muted small', text: t('adm_err') })); return; }
        if (!r.body.players.length) { res.appendChild(el('p', { class: 'muted small', text: t('adm_none') })); return; }
        r.body.players.forEach(function (p) { res.appendChild(playerRow(p, function () { renderBans(box); })); });
      });
    }
    find();
    var pBans = el('div', { class: 'panel' }, [el('h2', {}, [el('span', { class: 'dot' }), el('span', { text: t('adm_hist') })])]);
    var bq = el('input', { type: 'search', placeholder: t('adm_search'), maxlength: '40', value: banState.q, 'aria-label': t('adm_search') });
    bq.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') { banState.q = bq.value.trim(); loadBans(); } });
    var bseg = el('div');
    var list = el('div', { class: 'adm-list' });
    pBans.appendChild(el('div', { class: 'adm-bar' }, [bseg, el('form', { class: 'adm-search', onsubmit: function (e) { e.preventDefault(); banState.q = bq.value.trim(); loadBans(); } }, [bq, el('button', { class: 'btn', type: 'submit', text: t('adm_find') })])]));
    pBans.appendChild(list);
    function loadBans() {
      clear(bseg).appendChild(segOf(['active', 'expired', 'revoked', 'all'], banState.status, function (v) { banState.status = v; loadBans(); }));
      clear(list); loadingP(list);
      api('GET', '/api/admin/bans?status=' + banState.status + '&q=' + encodeURIComponent(banState.q)).then(function (r) {
        clear(list); if (!r.ok) { list.appendChild(el('p', { class: 'muted small', text: t('adm_err') })); return; }
        var c = r.body.counts; Array.prototype.forEach.call(bseg.querySelectorAll('button'), function (b, i) { var k = ['active', 'expired', 'revoked'][i]; if (k) b.textContent = t('adm_st_' + k) + ' (' + c[k] + ')'; });
        if (!r.body.bans.length) { list.appendChild(el('p', { class: 'muted small', text: t('adm_none') })); return; }
        list.appendChild(banTable(r.body.bans, loadBans));
      });
    }
    loadBans();
    box.appendChild(pSearch); box.appendChild(pBans); box.appendChild(grantPanel());
  }
  /* event rewards (borders / board themes) – server validates, audit-logged, never touches Elo or coins */
  function grantPanel() {
    var p = el('div', { class: 'panel', id: 'admGrant' }, [el('h2', {}, [el('span', { class: 'dot' }), el('span', { text: t('adm_grant_t') })]), el('p', { class: 'small muted', text: t('adm_grant_s') })]);
    var who = el('input', { type: 'text', id: 'admGrantUser', maxlength: '40', placeholder: t('adm_grant_user') });
    var kind = el('select', { id: 'admGrantKind' }, [el('option', { value: 'border', text: 'Border' }), el('option', { value: 'theme', text: t('w41_themes') })]);
    var item = el('select', { id: 'admGrantItem' });
    var note = el('input', { type: 'text', id: 'admGrantNote', maxlength: '300', placeholder: t('adm_grant_note') });
    [who, note].forEach(function (i) { i.addEventListener('keydown', function (e) { e.stopPropagation(); }); });
    function fill() {
      clear(item);
      if (kind.value === 'border') BORDER_IDS.filter(function (id) { return id !== 'none'; }).forEach(function (id) { item.appendChild(el('option', { value: id, text: borderName(id) })); });
      else ['paper', 'ocean', 'forest', 'sunset', 'sakura', 'midnight', 'matrix'].forEach(function (id) { item.appendChild(el('option', { value: id, text: id.charAt(0).toUpperCase() + id.slice(1) })); });
    }
    kind.onchange = fill; fill();
    var go = el('button', { class: 'btn primary', type: 'submit', id: 'admGrantGo', text: t('adm_grant_btn') });
    p.appendChild(el('form', { class: 'adm-grant', onsubmit: function (e) {
      e.preventDefault();
      if (note.value.trim().length < 3) { toast(t('adm_note_req'), 'warn'); return; }
      confirmBox(t('adm_grant_q', { i: item.options[item.selectedIndex].text, u: who.value.trim() }), function () {
        go.disabled = true;
        api('POST', '/api/admin/grant', { user: who.value.trim(), kind: kind.value, id: item.value, note: note.value.trim() }).then(function (r) {
          go.disabled = false;
          if (!r.ok) { toast(r.body.error === 'owned' ? t('adm_grant_owned') : err(r.body.error), 'err'); return; }
          toast(t('adm_grant_ok'), 'ok'); note.value = '';
        });
      });
    } }, [who, kind, item, note, go]));
    return p;
  }
  function banTable(bans, reload) {
    var wrap = el('div', { class: 'adm-cards' });
    bans.forEach(function (b) {
      wrap.appendChild(el('div', { class: 'adm-ban st-' + b.status }, [
        el('div', { class: 'adm-ban-h' }, [el('div', {}, [el('b', { text: b.username }), el('span', { class: 'tiny muted mono', text: ' ' + b.playerId + ' · #' + b.uid })]), stBadge(b.status)]),
        el('div', { class: 'adm-ban-g' }, [
          el('div', {}, [el('span', { text: t('adm_col_reason') }), el('b', { text: reasonText(b.reasonCode, b.reasonText) })]),
          el('div', {}, [el('span', { text: t('adm_col_start') }), el('b', { text: fmt(b.startsAt) })]),
          el('div', {}, [el('span', { text: t('adm_col_end') }), el('b', { text: fmt(b.endsAt) })]),
          el('div', {}, [el('span', { text: t('adm_col_dur') }), el('b', { text: dur(b.durationMs) })]),
          el('div', {}, [el('span', { text: t('adm_col_admin') }), el('b', { text: b.admin })])]),
        b.status === 'revoked' ? el('div', { class: 'tiny muted', text: t('adm_revoked_by', { n: b.revokedBy, note: b.revokeNote }) + ' · ' + fmt(b.revokedAt) }) : null,
        b.status === 'active' ? el('div', { class: 'row' }, [el('button', { class: 'btn sm', text: t('adm_unban_btn'), onclick: function () { unbanDialog(b, reload); } }), el('button', { class: 'btn sm', text: t('adm_view'), onclick: function () { playerDetail(b.uid); } })]) : el('div', { class: 'row' }, [el('button', { class: 'btn sm', text: t('adm_view'), onclick: function () { playerDetail(b.uid); } })])
      ]));
    });
    return wrap;
  }
  function playerRow(p, reload) {
    return el('div', { class: 'wcs-adm-r adm-prow' }, [
      el('div', { class: 'adm-who' }, [Avatar.node({ id: p.uid, username: p.username, avatar: p.avatar, border: p.border }, 'mini-av'), el('div', {}, [el('b', { text: p.username }), el('div', { class: 'tiny muted mono', text: p.playerId + ' · #' + p.uid + ' · Elo ' + p.rating + ' · ' + p.wins + '-' + p.losses + (p.draws ? '-' + p.draws : '') }), p.banned ? el('div', { class: 'tiny err-t', text: t('adm_banned_now', { e: fmt(p.banned.endsAt) }) }) : null])]),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn sm', text: t('adm_view'), onclick: function () { playerDetail(p.uid); } }),
        p.role === 'admin' ? el('span', { class: 'badge acc', text: 'ADMIN' }) : p.banned ? stBadge('active') : el('button', { class: 'btn sm danger', text: t('adm_ban_btn'), onclick: function () { banDialog(p, null, reload); } })])]);
  }
  function playerDetail(uid) {
    var box = el('div', { class: 'adm-detail' }); loadingP(box);
    var close = sheet(t('adm_players'), [box], []);
    api('GET', '/api/admin/players/' + uid).then(function (r) {
      clear(box); if (!r.ok) { box.appendChild(el('p', { class: 'muted', text: t('adm_err') })); return; }
      var p = r.body.player;
      box.appendChild(el('div', { class: 'adm-who' }, [Avatar.node({ id: p.uid, username: p.username, avatar: p.avatar, border: p.border }, 'mini-av av-lg'), el('div', {}, [el('b', { text: p.username }), el('div', { class: 'tiny muted mono', text: p.playerId + ' · #' + p.uid }), el('div', { class: 'tiny muted', text: 'Elo ' + p.rating + ' · ' + p.games + ' Ranked · ' + p.wins + '-' + p.losses + '-' + p.draws + ' · ' + p.coins + ' ' + t('v44_coins') })])]));
      if (p.role !== 'admin' && !p.banned) box.appendChild(el('div', { class: 'row' }, [el('button', { class: 'btn sm danger', text: t('adm_ban_btn'), onclick: function () { close(); banDialog(p, null, function () { playerDetail(uid); }); } })]));
      box.appendChild(el('h4', { text: t('adm_hist') }));
      if (!r.body.bans.length) box.appendChild(el('p', { class: 'tiny muted', text: t('adm_none') })); else box.appendChild(banTable(r.body.bans, function () { close(); playerDetail(uid); }));
      box.appendChild(el('h4', { text: t('adm_reports_on') }));
      if (!r.body.reports.length) box.appendChild(el('p', { class: 'tiny muted', text: t('adm_none') }));
      r.body.reports.forEach(function (x) { box.appendChild(el('div', { class: 'tiny adm-mini' }, [stBadge(x.status), document.createTextNode(' ' + t('rc_' + x.category) + ' · ' + t('adm_from', { n: x.reporter }) + ' · ' + fmt(x.createdAt) + ' — ' + x.body)])); });
      box.appendChild(el('h4', { text: t('adm_recent') }));
      if (!r.body.matches.length) box.appendChild(el('p', { class: 'tiny muted', text: t('adm_none') }));
      r.body.matches.forEach(function (m) { box.appendChild(el('div', { class: 'tiny adm-mini mono', text: fmt(m.at) + ' · ' + m.kind + ' · ' + m.mode + '/' + m.diff + ' · vs ' + m.opp + ' · ' + m.result + (m.reason ? ' (' + m.reason + ')' : '') + (m.before != null && m.after != null ? ' · ' + m.before + '→' + m.after : '') })); });
    });
  }
  var repState = 'open';
  function renderReports(box) {
    clear(box);
    var p = el('div', { class: 'panel' }, [el('h2', {}, [el('span', { class: 'dot' }), el('span', { text: t('adm_tab_reports') })])]);
    var segW = el('div'), list = el('div', { class: 'adm-list' });
    p.appendChild(el('div', { class: 'adm-bar' }, [segW])); p.appendChild(list); box.appendChild(p);
    function load() {
      clear(segW).appendChild(segOf(['open', 'resolved', 'dismissed', 'all'], repState, function (v) { repState = v; load(); }));
      clear(list); loadingP(list);
      api('GET', '/api/admin/player-reports?status=' + repState).then(function (r) {
        clear(list); if (!r.ok) { list.appendChild(el('p', { class: 'muted small', text: t('adm_err') })); return; }
        if (!r.body.reports.length) { list.appendChild(el('p', { class: 'muted small', text: t('adm_none') })); return; }
        r.body.reports.forEach(function (x) {
          var row = el('div', { class: 'wcs-adm-r' }, [
            el('div', {}, [el('div', {}, [el('b', { text: x.target }), el('span', { class: 'tiny muted mono', text: ' ' + x.targetPid + ' · ' }), el('span', { class: 'small', text: t('rc_' + x.category) }), document.createTextNode(' '), stBadge(x.status), x.targetBanned ? el('span', { class: 'badge err', text: 'BAN' }) : null]),
              el('div', { class: 'small', text: x.body }),
              el('div', { class: 'tiny muted', text: t('adm_from', { n: x.reporter }) + ' · ' + fmt(x.createdAt) + (x.resolvedBy ? ' · ' + x.resolvedBy + (x.adminNote ? ': ' + x.adminNote : '') : '') })]),
            el('div', { class: 'row' }, [
              x.status === 'open' && !x.targetBanned ? el('button', { class: 'btn sm danger', text: t('adm_ban_btn'), onclick: function () { banDialog({ uid: x.targetId, username: x.target, playerId: x.targetPid }, { reportId: x.id, reason: ['cheating', 'exploit', 'elo_manip', 'coin_manip', 'bug_abuse'].indexOf(x.category) >= 0 ? x.category : 'rules', text: 'Laporan #' + x.id }, load); } }) : null,
              x.status === 'open' ? el('button', { class: 'btn sm', text: t('adm_resolve'), onclick: function () { decide(x, 'resolved'); } }) : null,
              x.status === 'open' ? el('button', { class: 'btn sm', text: t('adm_dismiss'), onclick: function () { decide(x, 'dismissed'); } }) : null,
              el('button', { class: 'btn sm', text: t('adm_view'), onclick: function () { playerDetail(x.targetId); } })])]);
          list.appendChild(row);
        });
      });
    }
    function decide(x, s) { api('POST', '/api/admin/player-reports/' + x.id, { status: s }).then(function (r) { if (!r.ok) { toast(err(r.body.error), 'err'); return; } toast('✓', 'ok'); load(); }); }
    load();    box.appendChild(supportPanel());
  }
  var supState = 'open';
  function supportPanel() {
    var p = el('div', { class: 'panel', id: 'admSupport' }, [el('h2', {}, [el('span', { class: 'dot' }), el('span', { text: t('adm_sup_t') })])]);
    var segW = el('div'), list = el('div', { class: 'adm-list' });
    p.appendChild(el('div', { class: 'adm-bar' }, [segW])); p.appendChild(list);
    function load() {
      clear(segW).appendChild(segOf(['open', 'resolved', 'all'], supState, function (v) { supState = v; load(); }));
      clear(list); loadingP(list);
      api('GET', '/api/admin/support?status=' + supState).then(function (r) {
        clear(list); if (!r.ok) { list.appendChild(el('p', { class: 'muted small', text: t('adm_err') })); return; }
        if (!r.body.rows.length) { list.appendChild(el('p', { class: 'muted small', text: t('adm_none') })); return; }
        r.body.rows.forEach(function (x) {
          var note = el('input', { type: 'text', maxlength: '500', placeholder: t('adm_note'), value: x.note || '' });
          note.addEventListener('keydown', function (e) { e.stopPropagation(); });
          list.appendChild(el('div', { class: 'wcs-adm-r', 'data-sup': String(x.id) }, [
            el('div', {}, [el('div', {}, [el('b', { text: '#' + x.id + ' ' + (x.username || '?') }), el('span', { class: 'tiny muted mono', text: ' ' + (x.playerId || '') + ' · ' }), el('span', { class: 'small', text: t('sup_' + x.category) }), document.createTextNode(' '), stBadge(x.status)]),
              el('div', { class: 'small', style: 'white-space:pre-wrap', text: x.body }),
              el('div', { class: 'tiny muted', text: fmt(x.createdAt) + (x.client ? ' · ' + x.client : '') + (x.admin ? ' · ' + x.admin + (x.note ? ': ' + x.note : '') : '') })]),
            el('div', { class: 'row' }, [note,
              x.status === 'open' ? el('button', { class: 'btn sm primary', text: t('adm_resolve'), onclick: function () { decide(x, 'resolved', note.value); } })
                : el('button', { class: 'btn sm', text: t('adm_reopen'), onclick: function () { decide(x, 'open', note.value); } })])]));
        });
      });
    }
    function decide(x, st, n) { api('POST', '/api/admin/support/' + x.id, { status: st, note: n }).then(function (r) { if (!r.ok) { toast(err(r.body.error), 'err'); return; } toast('✓', 'ok'); load(); }); }
    load();
    return p;
  }
  var audState = { action: '', q: '' };
  function renderAudit(box) {
    clear(box);
    var p = el('div', { class: 'panel' }, [el('h2', {}, [el('span', { class: 'dot' }), el('span', { text: t('adm_tab_audit') })])]);
    var sel = el('select', { 'aria-label': t('adm_audit_all') }); sel.appendChild(el('option', { value: '', text: t('adm_audit_all') }));
    var q = el('input', { type: 'search', placeholder: t('adm_audit_q'), maxlength: '40', value: audState.q, 'aria-label': t('adm_audit_q') });
    q.addEventListener('keydown', function (e) { e.stopPropagation(); });
    var list = el('div', { class: 'adm-list' });
    p.appendChild(el('form', { class: 'adm-search', onsubmit: function (e) { e.preventDefault(); audState.q = q.value.trim(); load(); } }, [sel, q, el('button', { class: 'btn', type: 'submit', text: t('adm_find') })]));
    p.appendChild(list); box.appendChild(p);
    sel.onchange = function () { audState.action = sel.value; load(); };
    function load() {
      clear(list); loadingP(list);
      api('GET', '/api/admin/audit?action=' + encodeURIComponent(audState.action) + '&q=' + encodeURIComponent(audState.q)).then(function (r) {
        clear(list); if (!r.ok) { list.appendChild(el('p', { class: 'muted small', text: t('adm_err') })); return; }
        var have = Array.prototype.map.call(sel.options, function (o) { return o.value; });
        r.body.actions.forEach(function (a) { if (have.indexOf(a) < 0) sel.appendChild(el('option', { value: a, text: a })); }); sel.value = audState.action;
        if (!r.body.audit.length) { list.appendChild(el('p', { class: 'muted small', text: t('adm_none') })); return; }
        var tb = el('tbody');
        r.body.audit.forEach(function (a) {
          var d = a.detail || {}, info = [];
          if (d.reasonCode) info.push(t('br_' + d.reasonCode) + (d.reasonText ? ' — ' + d.reasonText : ''));
          if (d.durationMs) info.push(dur(d.durationMs));
          if (d.startsAt && d.endsAt) info.push(fmt(d.startsAt) + ' → ' + fmt(d.endsAt));
          if (d.note) info.push('“' + d.note + '”');
          if (d.statusBefore || d.statusAfter) info.push(t('adm_before_after', { a: d.statusBefore || '—', b: d.statusAfter || '—' }));
          if (!info.length) info.push(JSON.stringify(d).slice(0, 160));
          tb.appendChild(el('tr', {}, [el('td', { class: 'mono tiny', text: fmt(a.at) }), el('td', {}, [el('b', { text: a.action })]), el('td', { class: 'small', text: a.admin + ' (#' + a.adminId + ')' }), el('td', { class: 'small', text: a.target ? a.target + ' (#' + a.targetId + ')' : '—' }), el('td', { class: 'tiny', text: info.join(' · ') })]));
        });
        list.appendChild(el('div', { class: 'lb-wrap' }, [el('table', { class: 'tbl adm-tbl' }, [el('thead', {}, [el('tr', {}, [el('th', { text: LANG === 'bm' ? 'Masa' : 'Time' }), el('th', { text: LANG === 'bm' ? 'Tindakan' : 'Action' }), el('th', { text: t('adm_col_admin') }), el('th', { text: t('adm_col_player') }), el('th', { text: LANG === 'bm' ? 'Butiran' : 'Details' })])]), tb])]));
      });
    }
    load();
  }

  /* --------------------------------------------------------------- wiring */
  function init() {
    if (!window.Net) return;
    Net.on('error', function (m) { if (m && m.code === 'banned') banModal(m.ban); });
    Net.on('ban', function (m) { if (m.ban) banModal(m.ban); else { setBan(null); toast(t('v44_ban_over'), 'ok'); } });
    Net.on('match_void', function (m) { toast(m.why === 'banned' ? t('v44_void_banned') : t('v44_void_opp'), m.why === 'banned' ? 'err' : 'warn'); });
    Net.on('result', function (m) { if (m && m.coins) setTimeout(function () { toast(t('v44_coins_won', { n: m.coins }), 'ok'); }, 900); if (m && m.user) refreshMe(m.user); shop = null; });
    Net.on('me', function (m) { if (m && m.user) setBan(m.user.banned); });
    Net.on('hello', function (m) { if (m && m.user) setBan(m.user.banned); });
    Net.on('user', function (u) { setBan(u ? u.banned : null); shop = null; if (isShop()) showShop(); cloudOnUser(u); });
    setInterval(function () { cloudPush(false); }, 8000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') cloudPush('beacon'); });
    window.addEventListener('pagehide', function () { cloudPush('beacon'); });
  }

  /* --------------------------------------------------------------- cloud sync (replaces browser storage)
     Settings + statistics of a signed-in player are restored from the server once per sign-in and
     pushed back when they change. TURN secrets are never sent (server strips them as well). */
  var cloud = { uid: null, ready: false, last: '' };
  function payload() {
    var S = Object.assign({}, APP.settings()); delete S.turn;
    var g = null; try { g = APP.gameSnap ? APP.gameSnap() : null; } catch (e) { g = null; }
    return { stats: APP.stats(), settings: S, game: g };
  }
  function cloudOnUser(u) {
    if (!u) { cloud = { uid: null, ready: false, last: '' }; return; }
    if (cloud.uid === u.id) return;
    cloud = { uid: u.id, ready: false, last: '' };
    api('GET', '/api/me/progress').then(function (r) {
      if (cloud.uid !== u.id) return;
      if (r.ok && r.body.progress) { APP.adopt(r.body.progress); cloud.last = JSON.stringify(payload()); cloud.ready = true; }
      else if (r.ok) { cloud.ready = true; cloudPush(true); }
    });
  }
  function cloudPush(force) {
    if (!cloud.ready || !Net.user() || Net.user().id !== cloud.uid) return;
    var p = payload(), s = JSON.stringify(p);
    if (!force && s === cloud.last) return;
    cloud.last = s;
    if (force === 'beacon' && s.length < 60000 && window.fetch) {
      try { fetch(Net.url('/api/me/progress'), { method: 'PUT', keepalive: true, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + Net.token() }, body: JSON.stringify({ progress: p }) }).catch(function () { cloud.last = ''; }); return; } catch (e) { }
    }
    api('PUT', '/api/me/progress', { progress: p }).then(function (r) { if (!r.ok) cloud.last = ''; });
  }
  function isShop() { var v = $('view-shop'); return v && v.classList.contains('active'); }

  window.V44 = { init: init, showShop: showShop, report: report, banDialog: banDialog, playerDetail: playerDetail, applyBorder: applyBorder, noWheel: noWheel,
    admin: { bans: renderBans, reports: renderReports, audit: renderAudit }, cloudPush: cloudPush, _cloud: function () { return cloud; }, _state: function () { return { shop: shop, ban: ban }; } };
  document.addEventListener('DOMContentLoaded', function () { try { init(); } catch (e) { console.error('V44 init failed', e); } });
})();
