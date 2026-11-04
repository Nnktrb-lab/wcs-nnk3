/* =====================================================================
   WCS 4.4.1 client module – MR (Multiplayer Ranked 2v2/3v3), team voice, public profile, mute,
   board themes, titles, privacy, Help/Rules/About. Every value shown here comes from the server.
   No browser storage is used (MR preferences live in the synced settings object).
   Uses the globals of index.html: Net, APP, I18N, t, el, clear, toast, modal, confirmBox, Avatar, Geo, $, errText.
   ===================================================================== */
(function () {
  'use strict';
  if (!window.Net || !window.I18N) return;
  var VERSION = '4.4.1';
  var DIFFS = ['easy', 'medium', 'hard', 'master', 'extreme'];

  /* ---------------- i18n ---------------- */
  Object.assign(I18N.bm, {
    w41_coins: 'Coin', w41_shop: 'Kedai & Koleksi', w41_borders: 'Border Profil', w41_themes: 'Tema Papan', w41_titles: 'Title', w41_coin_hist: 'Sejarah Coin',
    w41_free: 'Percuma', w41_coin: 'Coin', w41_premium: 'Premium / Acara', w41_owned: 'Dimiliki', w41_locked: 'Dikunci', w41_buy: 'Beli', w41_use: 'Guna', w41_in_use: 'Sedang digunakan',
    w41_buy_q: 'Beli {n} dengan {p} coin?', w41_bought: 'Berjaya dibeli.', w41_no_coins: 'Coin tidak mencukupi.', w41_event_only: 'Hanya melalui acara khas (tidak boleh dibeli dengan coin).',
    w42_border: 'Border', w42_my_borders: 'Border saya', w42_border_set: 'Border dikemas kini', w41_how_veteran: 'Ganjaran pencapaian: 100 perlawanan.', w41_how_mr_champion: 'Ganjaran pencapaian: 25 kemenangan MR.', w41_how_season_title: 'Ganjaran musim: menerima title ladder pada akhir musim.', w41_how_wcs_finalist: 'Ganjaran acara: Finalis WCS.',
    w41_how_founder: 'Ganjaran acara.', w41_how_wcs_champion: 'Ganjaran acara: Juara WCS.',
    w41_profile: 'Profil Pemain', w41_view_profile: 'Lihat profil', w41_my_public: 'Lihat profil awam saya', w41_active_title: 'Title aktif', w41_none: 'Tiada',
    w41_ranked: 'Ranked 1v1', w41_mr: 'Multiplayer Ranked', w41_classic: 'Sudoku Klasik', w41_killer: 'Sudoku Killer', w41_games: 'Perlawanan', w41_wins: 'Menang', w41_losses: 'Kalah', w41_draws: 'Seri',
    w41_winrate: 'Win rate', w41_peak: 'Puncak', w41_total: 'Jumlah', w41_history: 'Sejarah perlawanan', w41_hist_hidden: 'Sejarah perlawanan pemain ini disembunyikan ({p}).',
    w41_priv: 'Privasi sejarah permainan', w41_priv_public: 'Awam – semua pemain', w41_priv_friends: 'Rakan sahaja', w41_priv_private: 'Peribadi – saya sahaja', w41_priv_saved: 'Tetapan privasi disimpan.',
    w41_report: 'Laporkan', w41_report_t: 'Laporkan pemain', w41_report_reason: 'Sebab', w41_report_note: 'Butiran (pilihan)', w41_report_sent: 'Laporan dihantar kepada pentadbir.',
    w41_r_cheating: 'Menipu', w41_r_abuse: 'Kata-kata kesat', w41_r_spam: 'Spam', w41_r_name: 'Nama tidak sesuai', w41_r_avatar: 'Avatar tidak sesuai', w41_r_afk: 'AFK / tidak bermain', w41_r_other: 'Lain-lain',
    w41_mute: 'Senyapkan', w41_unmute: 'Nyahsenyap', w41_muted: 'Pemain disenyapkan (chat & suara MR).', w41_unmuted: 'Pemain dinyahsenyap.',
    w41_win: 'Menang', w41_loss: 'Kalah', w41_draw: 'Seri', w41_vs: 'lawan', w41_coins_got: '+{n} coin',
    w41_t_first_victory: 'First Victory', w41_t_sudoku_beginner: 'Sudoku Beginner', w41_t_sudoku_master: 'Sudoku Master', w41_t_sudoku_expert: 'Sudoku Expert', w41_t_killer_specialist: 'Killer Specialist',
    w41_t_ranked_champion: 'Ranked Champion', w41_t_mr_champion: 'MR Champion', w41_t_wcs_finalist: 'WCS Finalist', w41_t_wcs_champion: 'WCS Champion', w41_t_winning_streak: 'Winning Streak',
    w41_t_veteran_player: 'Veteran Player', w41_t_state_champion: 'State Champion', w41_t_national_champion: 'National Champion', w41_t_global_champion: 'Global Champion',
    w41_c_first_victory: 'Menang satu perlawanan.', w41_c_sudoku_beginner: 'Main 5 perlawanan.', w41_c_sudoku_master: 'Menang perlawanan Master.', w41_c_sudoku_expert: 'Menang perlawanan Expert.',
    w41_c_killer_specialist: 'Menang 10 perlawanan Killer.', w41_c_ranked_champion: 'Capai 2000 Elo Ranked.', w41_c_mr_champion: 'Menang 25 perlawanan MR.', w41_c_wcs_finalist: 'Mara ke Grand Final WCS.',
    w41_c_wcs_champion: 'Menjadi Juara WCS.', w41_c_winning_streak: '5 kemenangan berturut-turut.', w41_c_veteran_player: 'Main 100 perlawanan.',
    w41_c_state_champion: 'Top 20 negeri anda (live).', w41_c_national_champion: 'Top 50 negara anda (live).', w41_c_global_champion: 'Top 100 dunia (live).',
    w41_title_set: 'Title aktif dikemas kini.', w41_title_hist: 'Title musim lepas (Hall of Fame)', w41_ladder: 'Musim ranking {n} tamat {d}. Elo tidak di-reset.',
    w41_cr_ranked_win: 'Menang Ranked', w41_cr_mr_win: 'Menang MR', w41_cr_wcs_win: 'Menang WCS', w41_cr_wcs_champion: 'Juara WCS', w41_cr_wcs_finalist: 'Finalis WCS', w41_cr_daily_podium: 'Podium Harian', w41_cr_purchase: 'Pembelian', w41_cr_test: 'Ujian',
    w41_collection: 'Koleksi, Title & Privasi',
    w45_theme_set: 'Tema papan dikemas kini.', w45_theme_note: 'Tema papan hanya menukar warna papan Sudoku. Ia dipaparkan dalam permainan solo, Ranked dan MR.', w45_priv_note: 'Elo, rank dan border sentiasa awam. Pentadbir sentiasa boleh melihat sejarah untuk siasatan.', w45_mutes: 'Pemain disenyapkan', w45_no_mutes: 'Tiada pemain disenyapkan.',
    /* MR */
    mr_title: 'Multiplayer Ranked (MR)', mr_sub: 'Pertandingan berpasukan 2v2 / 3v3 secara bergilir. Elo dikongsi dengan Ranked 1v1 (satu Elo yang sama).', mr_elo: 'Elo', mr_rank: 'Kedudukan MR',
    mr_size: 'Format', mr_mode: 'Jenis Sudoku', mr_diff: 'Kesukaran', mr_find: 'Cari Perlawanan', mr_cancel: 'Batal', mr_create: 'Cipta Lobi', mr_join: 'Sertai', mr_code_ph: 'Kod lobi',
    mr_searching: 'Mencari pemain… {p}/{n} dalam barisan', mr_lobby: 'Lobi MR', mr_code: 'Kod', mr_team_a: 'Pasukan A', mr_team_b: 'Pasukan B', mr_empty: 'Slot kosong', mr_ready: 'Sedia', mr_unready: 'Batal sedia',
    mr_leave: 'Keluar lobi', mr_switch: 'Tukar ke pasukan ini', mr_invite: 'Jemput rakan', mr_joined: '{j}/{n} pemain', mr_rated: 'Dikira Elo', mr_unrated: 'Tidak dikira Elo (had 3 perlawanan peribadi/24 jam bagi set pemain yang sama)',
    mr_countdown: 'Bermula dalam {s}…', mr_generating: 'Menjana puzzle…', mr_chat_ph: 'Mesej lobi…', mr_send: 'Hantar', mr_team_chat: 'Pasukan sahaja',
    mr_turn_you: 'Giliran ANDA', mr_turn_of: 'Giliran {n}', mr_mistakes: 'Kesalahan', mr_elim: 'TERSINGKIR', mr_forfeit: 'KELUAR', mr_progress: 'Kemajuan', mr_your_board: 'Papan pasukan anda',
    mr_surrender: 'Menyerah', mr_surrender_q: 'Menyerah? Anda akan dikira keluar dan tidak boleh bermain lagi dalam perlawanan ini.', mr_result_win: 'Pasukan anda MENANG', mr_result_loss: 'Pasukan anda KALAH', mr_result_draw: 'SERI',
    mr_reason_finish: 'Papan diselesaikan', mr_reason_eliminated: 'Semua ahli pasukan tersingkir', mr_reason_time: 'Had masa – kemajuan tertinggi', mr_back: 'Kembali ke lobi dalam 20 saat.',
    mr_lb: 'Leaderboard MR', mr_hist: 'Sejarah MR', mr_none: 'Belum ada perlawanan MR.', mr_invited: '{n} menjemput anda ke lobi MR {s}v{s}.', mr_accept: 'Sertai', mr_decline: 'Tolak', mr_inv_sent: 'Jemputan dihantar kepada {n}.',
    mr_rules: 'Giliran A1 → B1 → A2 → B2 (→ A3 → B3). Satu langkah setiap giliran, {s} saat setiap giliran (tamat masa = giliran berlalu tanpa kesalahan). 3 kesalahan = tersingkir. Pasukan menang jika papan selesai dahulu; kalah jika semua ahli tersingkir.',
    mr_notes: 'Nota pensel hanya pada peranti anda.', mr_login: 'Log masuk dan sambung ke pelayan untuk bermain MR.', mr_not_turn: 'Bukan giliran anda.',
    mr_voice: 'Suara pasukan', mr_voice_on: 'Hidupkan mikrofon', mr_voice_off: 'Matikan suara', mr_voice_mute: 'Senyap', mr_voice_unmute: 'Nyahsenyap', mr_voice_note: 'Suara hanya disambungkan kepada ahli pasukan anda (pelayan menolak isyarat ke pasukan lawan).',
    mr_voice_denied: 'Kebenaran mikrofon ditolak – anda masih boleh mendengar pasukan.', mr_vol: 'Kelantangan',
    mr_pencil: 'Pensel',
    /* help */
    h_help: 'Bantuan & Maklumat', h_howto: 'Cara Bermain', h_rules: 'Peraturan', h_faq: 'Soalan Lazim', h_report: 'Laporkan Masalah', h_about: 'Tentang',
    h_howto_b: 'Isi setiap baris, lajur dan kotak 3×3 dengan nombor 1–9 tanpa ulangan. Pilih cell, kemudian tekan nombor. Tekan Pensel (ON) untuk menulis nota kecil; Pensel OFF untuk jawapan sebenar. Killer: jumlah nombor dalam setiap sangkar mesti sama dengan angka di penjuru sangkar dan nombor tidak berulang dalam sangkar.',
    h_rules_b: 'Ranked 1v1: 3 kesalahan = kalah; tiada pause; Elo dikira oleh pelayan menggunakan formula Elo standard (K = 40 untuk 30 perlawanan pertama, kemudian K = 20). Menang lawan yang lebih kuat memberi lebih banyak mata. MR 2v2/3v3: Elo yang sama, dikira berbanding purata Elo pasukan lawan. Elo tidak pernah di-reset; musim hanya memulakan semula kedudukan musim. Tindakan BAN tidak mengubah Elo, coin atau statistik.',
    h_faq_b: [['Bagaimana mendapat coin?', 'Perlawanan Ranked 1v1 dan MR yang dikira: menang {w}, seri {d}, kalah {l} coin (had {c} coin sehari daripada perlawanan). Perlawanan kurang 30 saat tidak diberi coin.'],
      ['Adakah Elo saya akan di-reset?', 'Tidak. Elo, coin dan sejarah tidak di-reset semasa kemas kini atau musim baharu.'],
      ['Bagaimana title State/National/Global diberi?', 'Secara automatik oleh pelayan: Top 20 negeri, Top 50 negara dan Top 100 dunia (pemain Ranked). Pada akhir musim, pemegang direkodkan dalam Hall of Fame.'],
      ['Siapa boleh melihat sejarah saya?', 'Pilih Awam, Rakan sahaja atau Peribadi di halaman Profil. Elo dan rank sentiasa awam.']],
    h_report_cat: 'Kategori', h_cat_bug: 'Pepijat / ralat', h_cat_match: 'Masalah perlawanan', h_cat_account: 'Akaun', h_cat_payment: 'Coin / kedai', h_cat_other: 'Lain-lain', h_report_ph: 'Terangkan masalah (sekurang-kurangnya 10 aksara)…', h_report_send: 'Hantar laporan', h_report_ok: 'Laporan #{n} diterima. Terima kasih.',
    h_ver: 'Versi', h_dev: 'Pembangun', h_server: 'Pelayan', h_privacy: 'Privasi', h_terms: 'Terma', h_online: 'dalam talian', h_players: 'pemain berdaftar', h_uptime: 'masa hidup',
    h_privacy_b: 'Kami menyimpan nama pengguna, ID pemain, negara/negeri pilihan anda, statistik perlawanan, coin dan mesej. Kata laluan disimpan sebagai hash. Tiada data dijual. Sejarah perlawanan mengikut tetapan privasi anda.',
    h_terms_b: 'Bermain secara adil. Penipuan, bot, akaun berganda untuk farming Elo/coin dan kata-kata kesat boleh menyebabkan keputusan dibatalkan atau akaun disekat. Coin tiada nilai wang sebenar.'
  });
  Object.assign(I18N.en, {
    w41_coins: 'Coins', w41_shop: 'Shop & Collection', w41_borders: 'Profile Borders', w41_themes: 'Board Themes', w41_titles: 'Titles', w41_coin_hist: 'Coin history',
    w41_free: 'Free', w41_coin: 'Coin', w41_premium: 'Premium / Event', w41_owned: 'Owned', w41_locked: 'Locked', w41_buy: 'Buy', w41_use: 'Use', w41_in_use: 'In use',
    w41_buy_q: 'Buy {n} for {p} coins?', w41_bought: 'Purchased.', w41_no_coins: 'Not enough coins.', w41_event_only: 'Event reward only (cannot be bought with coins).',
    w42_border: 'Border', w42_my_borders: 'My borders', w42_border_set: 'Border updated', w41_how_veteran: 'Achievement reward: 100 matches.', w41_how_mr_champion: 'Achievement reward: 25 MR wins.', w41_how_season_title: 'Season reward: receive a ladder title at season end.', w41_how_wcs_finalist: 'Event reward: WCS Finalist.',
    w41_how_founder: 'Event reward.', w41_how_wcs_champion: 'Event reward: WCS Champion.',
    w41_profile: 'Player Profile', w41_view_profile: 'View profile', w41_my_public: 'View my public profile', w41_active_title: 'Active title', w41_none: 'None',
    w41_ranked: 'Ranked 1v1', w41_mr: 'Multiplayer Ranked', w41_classic: 'Classic Sudoku', w41_killer: 'Killer Sudoku', w41_games: 'Games', w41_wins: 'Wins', w41_losses: 'Losses', w41_draws: 'Draws',
    w41_winrate: 'Win rate', w41_peak: 'Peak', w41_total: 'Total', w41_history: 'Match history', w41_hist_hidden: 'This player\'s match history is hidden ({p}).',
    w41_priv: 'Match history privacy', w41_priv_public: 'Public – everyone', w41_priv_friends: 'Friends only', w41_priv_private: 'Private – only me', w41_priv_saved: 'Privacy setting saved.',
    w41_report: 'Report', w41_report_t: 'Report player', w41_report_reason: 'Reason', w41_report_note: 'Details (optional)', w41_report_sent: 'Report sent to the admins.',
    w41_r_cheating: 'Cheating', w41_r_abuse: 'Abusive language', w41_r_spam: 'Spam', w41_r_name: 'Inappropriate name', w41_r_avatar: 'Inappropriate avatar', w41_r_afk: 'AFK / not playing', w41_r_other: 'Other',
    w41_mute: 'Mute', w41_unmute: 'Unmute', w41_muted: 'Player muted (MR chat & voice).', w41_unmuted: 'Player unmuted.',
    w41_win: 'Win', w41_loss: 'Loss', w41_draw: 'Draw', w41_vs: 'vs', w41_coins_got: '+{n} coins',
    w41_t_first_victory: 'First Victory', w41_t_sudoku_beginner: 'Sudoku Beginner', w41_t_sudoku_master: 'Sudoku Master', w41_t_sudoku_expert: 'Sudoku Expert', w41_t_killer_specialist: 'Killer Specialist',
    w41_t_ranked_champion: 'Ranked Champion', w41_t_mr_champion: 'MR Champion', w41_t_wcs_finalist: 'WCS Finalist', w41_t_wcs_champion: 'WCS Champion', w41_t_winning_streak: 'Winning Streak',
    w41_t_veteran_player: 'Veteran Player', w41_t_state_champion: 'State Champion', w41_t_national_champion: 'National Champion', w41_t_global_champion: 'Global Champion',
    w41_c_first_victory: 'Win a match.', w41_c_sudoku_beginner: 'Play 5 matches.', w41_c_sudoku_master: 'Win a Master match.', w41_c_sudoku_expert: 'Win an Expert match.',
    w41_c_killer_specialist: 'Win 10 Killer matches.', w41_c_ranked_champion: 'Reach 2000 Ranked Elo.', w41_c_mr_champion: 'Win 25 MR matches.', w41_c_wcs_finalist: 'Reach a WCS Grand Final.',
    w41_c_wcs_champion: 'Become WCS Champion.', w41_c_winning_streak: '5 wins in a row.', w41_c_veteran_player: 'Play 100 matches.',
    w41_c_state_champion: 'Top 20 of your state (live).', w41_c_national_champion: 'Top 50 of your country (live).', w41_c_global_champion: 'Top 100 worldwide (live).',
    w41_title_set: 'Active title updated.', w41_title_hist: 'Past season titles (Hall of Fame)', w41_ladder: 'Ranking season {n} ends {d}. Elo is never reset.',
    w41_cr_ranked_win: 'Ranked win', w41_cr_mr_win: 'MR win', w41_cr_wcs_win: 'WCS win', w41_cr_wcs_champion: 'WCS Champion', w41_cr_wcs_finalist: 'WCS Finalist', w41_cr_daily_podium: 'Daily podium', w41_cr_purchase: 'Purchase', w41_cr_test: 'Test',
    w41_collection: 'Collection, Titles & Privacy',
    w45_theme_set: 'Board theme updated.', w45_theme_note: 'Board themes only change the colours of the Sudoku board. They apply to solo, Ranked and MR games.', w45_priv_note: 'Elo, rank and border are always public. Admins can always see history for investigations.', w45_mutes: 'Muted players', w45_no_mutes: 'No muted players.',
    mr_title: 'Multiplayer Ranked (MR)', mr_sub: 'Turn-based 2v2 / 3v3 team matches. Uses the same Elo as Ranked 1v1 (one shared Elo).', mr_elo: 'Elo', mr_rank: 'MR rank',
    mr_size: 'Format', mr_mode: 'Sudoku type', mr_diff: 'Difficulty', mr_find: 'Find Match', mr_cancel: 'Cancel', mr_create: 'Create Lobby', mr_join: 'Join', mr_code_ph: 'Lobby code',
    mr_searching: 'Searching… {p}/{n} in queue', mr_lobby: 'MR Lobby', mr_code: 'Code', mr_team_a: 'Team A', mr_team_b: 'Team B', mr_empty: 'Empty slot', mr_ready: 'Ready', mr_unready: 'Unready',
    mr_leave: 'Leave lobby', mr_switch: 'Switch to this team', mr_invite: 'Invite friends', mr_joined: '{j}/{n} players', mr_rated: 'Counts for Elo', mr_unrated: 'Not rated (limit 3 private games / 24 h for the same player set)',
    mr_countdown: 'Starting in {s}…', mr_generating: 'Generating puzzle…', mr_chat_ph: 'Lobby message…', mr_send: 'Send', mr_team_chat: 'Team only',
    mr_turn_you: 'YOUR turn', mr_turn_of: '{n}\'s turn', mr_mistakes: 'Mistakes', mr_elim: 'ELIMINATED', mr_forfeit: 'LEFT', mr_progress: 'Progress', mr_your_board: 'Your team board',
    mr_surrender: 'Surrender', mr_surrender_q: 'Surrender? You will be counted as out and cannot play again in this match.', mr_result_win: 'Your team WON', mr_result_loss: 'Your team LOST', mr_result_draw: 'DRAW',
    mr_reason_finish: 'Board completed', mr_reason_eliminated: 'Every member of a team was eliminated', mr_reason_time: 'Time limit – highest progress', mr_back: 'Back to the lobby in 20 seconds.',
    mr_lb: 'MR Leaderboard', mr_hist: 'MR history', mr_none: 'No MR matches yet.', mr_invited: '{n} invites you to a {s}v{s} MR lobby.', mr_accept: 'Join', mr_decline: 'Decline', mr_inv_sent: 'Invite sent to {n}.',
    mr_rules: 'Turns A1 → B1 → A2 → B2 (→ A3 → B3). One move per turn, {s} seconds per turn (timeout = the turn passes, no mistake). 3 mistakes = eliminated. A team wins by completing its board first and loses when all members are eliminated.',
    mr_notes: 'Pencil notes stay on your device.', mr_login: 'Sign in and connect to the server to play MR.', mr_not_turn: 'Not your turn.',
    mr_voice: 'Team voice', mr_voice_on: 'Turn on microphone', mr_voice_off: 'Turn voice off', mr_voice_mute: 'Mute', mr_voice_unmute: 'Unmute', mr_voice_note: 'Voice is only connected to your own team (the server refuses signalling to the other team).',
    mr_voice_denied: 'Microphone permission denied – you can still hear your team.', mr_vol: 'Volume',
    mr_pencil: 'Pencil',
    h_help: 'Help & Information', h_howto: 'How to Play', h_rules: 'Rules', h_faq: 'FAQ', h_report: 'Report a Problem', h_about: 'About',
    h_howto_b: 'Fill every row, column and 3×3 box with 1–9 without repeats. Select a cell, then press a number. Pencil ON writes small notes; Pencil OFF enters real answers. Killer: the digits in each cage must add up to the number in its corner and cannot repeat inside the cage.',
    h_rules_b: 'Ranked 1v1: 3 mistakes = loss; no pauses; Elo is computed by the server with the standard Elo formula (K = 40 for the first 30 games, then K = 20). Beating a stronger opponent earns more. MR 2v2/3v3: the same Elo, computed against the opposing team average. Elo is never reset; a new season only restarts season standings. A BAN never changes Elo, coins or statistics.',
    h_faq_b: [['How do I earn coins?', 'Rated Ranked 1v1 and MR matches: win {w}, draw {d}, loss {l} coins (cap {c} coins per day from matches). Matches shorter than 30 seconds pay no coins.'],
      ['Will my Elo be reset?', 'No. Elo, coins and history are never reset by updates or new seasons.'],
      ['How are State/National/Global titles given?', 'Automatically by the server: Top 20 per state, Top 50 per country and Top 100 worldwide (ranked players). At season end the holders are recorded in the Hall of Fame.'],
      ['Who can see my history?', 'Choose Public, Friends only or Private on the Profile page. Elo and rank are always public.']],
    h_report_cat: 'Category', h_cat_bug: 'Bug / error', h_cat_match: 'Match problem', h_cat_account: 'Account', h_cat_payment: 'Coins / shop', h_cat_other: 'Other', h_report_ph: 'Describe the problem (at least 10 characters)…', h_report_send: 'Send report', h_report_ok: 'Report #{n} received. Thank you.',
    h_ver: 'Version', h_dev: 'Developer', h_server: 'Server', h_privacy: 'Privacy', h_terms: 'Terms', h_online: 'online', h_players: 'registered players', h_uptime: 'uptime',
    h_privacy_b: 'We store your username, player ID, chosen country/state, match statistics, coins and messages. Passwords are stored as hashes. No data is sold. Match history follows your privacy setting.',
    h_terms_b: 'Play fair. Cheating, bots, multi-accounting to farm Elo/coins and abusive language can void results or suspend accounts. Coins have no real-money value.'
  });
  var tt = function (k, p) { return t(k, p); };
  var diffName = function (d) { return t('d_' + d); };
  var BD_NAMES = { none: ['Tiada', 'None'], jalur: ['Jalur Gemilang', 'Jalur Gemilang'], mrstar: ['Bintang MR', 'MR Star'], legend: ['Legenda Musim', 'Season Legend'], veteran: ['Veteran', 'Veteran'], finalist: ['Finalis WCS', 'WCS Finalist'], champion: ['Juara WCS', 'WCS Champion'], founder: ['Pengasas', 'Founder'],
    gold: ['Emas', 'Gold'], silver: ['Perak', 'Silver'], bronze: ['Gangsa', 'Bronze'], diamond: ['Berlian', 'Diamond'], frost: ['Fros', 'Frost'], royal: ['Diraja', 'Royal'], galaxy: ['Galaksi', 'Galaxy'], phoenix: ['Phoenix', 'Phoenix'], inferno: ['Inferno', 'Inferno'], neon: ['Neon', 'Neon'], jade: ['Jed', 'Jade'], sakura: ['Sakura', 'Sakura'], ruby: ['Delima', 'Ruby'], aurora: ['Aurora', 'Aurora'], azure: ['Biru Langit', 'Azure'], emerald: ['Zamrud', 'Emerald'], violet: ['Ungu', 'Violet'], coral: ['Karang', 'Coral'] };
  var TH_NAMES = { default: ['Asal', 'Default'], paper: ['Kertas', 'Paper'], ocean: ['Lautan', 'Ocean'], forest: ['Hutan', 'Forest'], sunset: ['Senja', 'Sunset'], midnight: ['Tengah Malam', 'Midnight'], sakura: ['Sakura', 'Sakura'], matrix: ['Matrix', 'Matrix'] };
  var RAR = { common: ['Biasa', 'Common'], rare: ['Jarang', 'Rare'], mythic: ['Mitos', 'Mythic'], legendary: ['Legenda', 'Legendary'] };
  function rarName(r) { var n = RAR[r]; return n ? n[S().lang === 'en' ? 1 : 0] : ''; }
  function rarBadge(r) { return r ? el('span', { class: 'rar ' + r, text: rarName(r) }) : null; }
  var BD_RAR = {};
  function themeName(k) { var n = TH_NAMES[k]; return n ? n[S().lang === 'en' ? 1 : 0] : (k.charAt(0).toUpperCase() + k.slice(1)); }
  function borderName(k) { var n = BD_NAMES[k]; return n ? n[S().lang === 'en' ? 1 : 0] : (k.charAt(0).toUpperCase() + k.slice(1)); }
  function titleName(x) { if (!x) return ''; var id = typeof x === 'string' ? x : x.id; var n = tt('w41_t_' + id); if (x.scope && x.scope !== 'global') n += ' · ' + scopeName(x.scope); return n; }
  function scopeName(sc) { var p = String(sc).split('-'); if (p.length === 1) return Geo.cname(p[0]); return Geo.rname(p[0], p.slice(1).join('-')); }
  function api(m, p, b) { return Net.api(m, p, b); }
  function fmtDate(ts) { try { return new Date(ts).toLocaleDateString(S().lang === 'bm' ? 'ms-MY' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } }
  function S() { return (window.APP && APP.settings) ? APP.settings() : { lang: 'bm' }; }

  /* ---------------- CSS ---------------- */
  var css = [
    /* borders */
    '.avx[data-pu]{cursor:pointer}',
    '.bd-swatch{width:44px;height:44px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:var(--panel2);font-weight:700;color:var(--muted);flex:none}',
    /* board themes (only colour variables; layout untouched) */
    '[data-bt="paper"] .board{--cell:#fbf7ee;--box:#5b4a33;--given:#2b2216;--player:#1d4ed8}',
    '[data-bt="ocean"] .board{--cell:#eef8fc;--box:#0e7490;--given:#083344;--player:#0284c7;--cell-hl:#d8f0f8;--cell-same:#b9e3f2;--cell-sel:#7dd3fc}',
    '[data-bt="forest"] .board{--cell:#f1f7ee;--box:#3f6212;--given:#1a2e05;--player:#15803d;--cell-hl:#e1eed9;--cell-same:#c8e2b9;--cell-sel:#9ccc7e}',
    '[data-bt="sunset"] .board{--cell:#fff6ec;--box:#c2410c;--given:#431407;--player:#ea580c;--cell-hl:#ffe9d2;--cell-same:#fed7aa;--cell-sel:#fdba74}',
    '[data-bt="midnight"] .board{--cell:#0f172a;--box:#334155;--given:#e2e8f0;--player:#7dd3fc;--cell-hl:#1e293b;--cell-same:#1e3a5f;--cell-sel:#1d4ed8}',
    '[data-bt="sakura"] .board{--cell:#fff1f4;--box:#be185d;--given:#500724;--player:#db2777;--cell-hl:#ffe4ea;--cell-same:#fecdd9;--cell-sel:#f9a8c0}',
    '[data-bt="matrix"] .board{--cell:#03140a;--box:#14532d;--given:#86efac;--player:#22c55e;--cell-hl:#052e16;--cell-same:#064e3b;--cell-sel:#166534}',
    /* pencil ON/OFF state */
    '#tPencil,#vmPencil,.mr-pencil{position:relative}',
    '#tPencil::after,#vmPencil::after,.mr-pencil::after{content:"OFF";margin-left:6px;font-size:10px;font-weight:800;letter-spacing:.06em;padding:2px 6px;border-radius:999px;background:var(--panel2);color:var(--muted);border:1px solid var(--line2)}',
    '#tPencil.on,#vmPencil.on,.mr-pencil.on{background:color-mix(in srgb,#f59e0b 22%,var(--panel));border-color:#f59e0b;color:var(--text)}',
    '#tPencil.on::after,#vmPencil.on::after,.mr-pencil.on::after{content:"ON";background:#f59e0b;color:#1a1200;border-color:#f59e0b}',
    /* top coin chip */
    '#qCoins{display:inline-flex;align-items:center;gap:5px;font-variant-numeric:tabular-nums}',
    '#qCoins i{width:14px;height:14px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#fde68a,#d97706);display:inline-block;box-shadow:0 0 0 1px #b45309 inset}',
    /* generic */
    '.w41-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}',
    '.w41-item{border:1px solid var(--line);border-radius:var(--radius-sm);padding:12px;display:flex;flex-direction:column;align-items:center;gap:8px;background:var(--panel);text-align:center}',
    '.w41-item.cur{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}',
    '.w41-item .small{min-height:16px}',
    '.w41-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}',
    '.w41-tabs button.on{background:var(--accent-soft);border-color:var(--accent)}',
    '.w41-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin:8px 0}',
    '.w41-stat{background:var(--panel2);border-radius:10px;padding:8px 10px}',
    '.w41-stat b{display:block;font-size:17px;font-variant-numeric:tabular-nums}',
    '.w41-stat small{color:var(--muted);font-size:11.5px}',
    '.w41-title{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,#f59e0b 18%,var(--panel2));color:var(--text);border:1px solid color-mix(in srgb,#f59e0b 45%,transparent)}',
    '.w41-hist{width:100%;border-collapse:collapse;font-size:12.5px}',
    '.w41-hist td{padding:6px 4px;border-top:1px solid var(--line)}',
    '.w41-res-win{color:var(--ok);font-weight:700}.w41-res-loss{color:var(--err);font-weight:700}.w41-res-draw{color:var(--muted);font-weight:700}',
    '.modal.w41-wide{max-width:min(720px,94vw);width:100%;max-height:88vh;overflow:auto}',
    '.w41-prof-h{display:flex;gap:14px;align-items:center;margin-bottom:8px}',
    '.w41-prof-h .avx{width:64px;height:64px;font-size:26px}',
    '.w41-sec{margin-top:14px}.w41-sec h4{margin:0 0 6px;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}',
    '.w41-faq details{border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin-bottom:6px;background:var(--panel)}',
    '.w41-faq summary{cursor:pointer;font-weight:600}',
    /* MR */
    '#mrRoot{display:flex;flex-direction:column;gap:14px}',
    '.mr-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}',
    '.mr-elo{display:flex;gap:10px;flex-wrap:wrap}',
    '.mr-cfg{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}',
    '.mr-cfg label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--muted)}',
    '.mr-cfg select,.mr-cfg input{min-height:40px}',
    '.mr-teams{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
    '@media(max-width:640px){.mr-teams{grid-template-columns:1fr}}',
    '.mr-team{border:1px solid var(--line);border-radius:var(--radius-sm);padding:10px;background:var(--panel)}',
    '.mr-team.A{border-top:3px solid #3b82f6}.mr-team.B{border-top:3px solid #ef4444}',
    '.mr-team h4{margin:0 0 8px;display:flex;justify-content:space-between;align-items:center;font-size:14px}',
    '.mr-pl{display:flex;align-items:center;gap:8px;padding:6px;border-radius:10px;min-height:46px}',
    '.mr-pl.turn{background:color-mix(in srgb,var(--accent) 22%,transparent);box-shadow:0 0 0 1px var(--accent) inset}',
    '.mr-pl.out{opacity:.55}',
    '.mr-pl .w{flex:1;min-width:0;display:flex;flex-direction:column}',
    '.mr-pl .w b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.mr-pl .tags{display:flex;gap:4px;flex-wrap:wrap;align-items:center}',
    '.mr-tag{font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:999px;background:var(--panel2);color:var(--muted)}',
    '.mr-tag.ok{background:color-mix(in srgb,var(--ok) 22%,transparent);color:var(--ok)}',
    '.mr-tag.bad{background:color-mix(in srgb,var(--err) 20%,transparent);color:var(--err)}',
    '.mr-tag.spk{background:#22c55e;color:#052e16}',
    '.mr-empty{color:var(--faint);font-style:italic;padding:12px 6px}',
    '.mr-chat{border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--panel);display:flex;flex-direction:column;max-height:260px}',
    '.mr-chat .log{overflow:auto;padding:8px;display:flex;flex-direction:column;gap:4px;min-height:80px;font-size:13px}',
    '.mr-chat form{display:flex;gap:6px;padding:8px;border-top:1px solid var(--line)}',
    '.mr-chat input[type=text]{flex:1;min-width:0}',
    '.mr-game{display:grid;grid-template-columns:minmax(0,560px) minmax(240px,1fr);gap:16px;align-items:start}',
    '@media(max-width:900px){.mr-game{grid-template-columns:1fr}}',
    '.mr-turn{padding:10px 12px;border-radius:12px;background:var(--panel2);font-weight:700;display:flex;justify-content:space-between;align-items:center;gap:8px}',
    '.mr-turn.me{background:color-mix(in srgb,var(--accent) 30%,var(--panel));box-shadow:var(--glow)}',
    '.mr-tbar{height:5px;border-radius:3px;background:var(--line);overflow:hidden;margin-top:6px}.mr-tbar i{display:block;height:100%;background:var(--accent);transition:width .25s linear}',
    '.mr-board .cell .cg{position:absolute;inset:1px;border:1.5px dashed transparent;pointer-events:none;z-index:1}',
    '.mr-board .cell .cs{position:absolute;top:1px;left:2px;font-size:9px;font-weight:700;color:var(--muted);z-index:3;line-height:1}',
    '.mr-board .cell .nt{position:absolute;inset:3px;display:grid;grid-template-columns:repeat(3,1fr);font-size:9px;color:var(--muted);z-index:2;line-height:1}',
    '.mr-board .cell .nt span{display:flex;align-items:center;justify-content:center}',
    '.mr-board .cell.flash-bad{background:var(--err-soft)}',
    '.mr-pad{display:grid;grid-template-columns:repeat(9,1fr);gap:6px;margin-top:10px}',
    '.mr-pad button{min-height:46px;font-size:18px;font-weight:700}',
    '@media(max-width:520px){.mr-pad{grid-template-columns:repeat(5,1fr)}}',
    '.mr-prog{display:flex;gap:8px;align-items:center;font-size:12.5px}.mr-prog .bar{flex:1;height:8px;border-radius:4px;background:var(--line);overflow:hidden}.mr-prog .bar i{display:block;height:100%}',
    '.mr-vol{width:70px}',
    '.mr-lb td{padding:5px 4px;border-top:1px solid var(--line);font-size:13px}'
  ].join('\n');
  var st = document.createElement('style'); st.id = 'wcs41-css'; st.textContent = css; var pro = document.getElementById('proCss'); if (pro) document.head.insertBefore(st, pro); else document.head.appendChild(st);

  /* ---------------- coin chip + board theme ---------------- */
  function applyUser(u) {
    var q = document.querySelector('.topbar .quick');
    var chip = document.getElementById('qCoins');
    if (q && !chip) {
      chip = el('button', { class: 'chip-btn', id: 'qCoins', type: 'button', 'aria-label': 'Coins', onclick: function () { openShop(); } }, [el('i'), el('span', { text: '0' })]);
      q.insertBefore(chip, q.firstChild);
    }
    if (chip) { chip.classList.toggle('hidden', !u); chip.querySelector('span').textContent = u ? String(u.coins || 0) : '0'; chip.title = tt('w41_coins'); }
    document.documentElement.setAttribute('data-bt', (u && u.boardTheme) || 'default');
  }
  Net.on('user', function (u) { applyUser(u); });
  applyUser(Net.user());

  /* ---------------- generic modal with wide layout ---------------- */
  function bigModal(title, body, actions) {
    var close = modal(title, body, actions || [{ label: t('close') }]);
    var m = document.querySelector('#modalRoot .modal'); if (m) m.classList.add('w41-wide');
    return close;
  }
  function statBox(label, val) { return el('div', { class: 'w41-stat' }, [el('b', { text: String(val) }), el('small', { text: label })]); }

  /* =====================================================================
     PUBLIC PROFILE
     ===================================================================== */
  function openProfile(uid) {
    uid = Number(uid); if (!uid) return;
    if (Net.avail() !== 'ok') { toast(errText('no_server'), 'warn'); return; }
    api('GET', '/api/profile/' + uid).then(function (r) {
      if (!r.ok) { toast(errText(r.body.error), 'err'); return; }
      var p = r.body, u = p.user, body = el('div');
      var at = u.activeTitle;
      body.appendChild(el('div', { class: 'w41-prof-h' }, [Avatar.node(u, 'mini-av'), el('div', {}, [
        el('div', {}, [el('b', { style: 'font-size:18px', text: (u.flag ? u.flag + ' ' : '') + u.username })]),
        el('div', { class: 'tiny muted', text: u.playerId + (u.country ? ' · ' + Geo.cname(u.country) + (u.region ? ' / ' + Geo.rname(u.country, u.region) : '') : '') }),
        at ? el('span', { class: 'w41-title', text: titleName(at) }) : null])]));
      body.appendChild(el('div', { class: 'w41-stats' }, [statBox('Elo', u.rating), statBox('Tier', String(u.tier || '').toUpperCase()), statBox(tt('w41_total') + ' · ' + tt('w41_games'), p.totals.games),
        statBox(tt('w41_wins'), p.totals.wins), statBox(tt('w41_winrate') + ' (1v1)', p.ranked.winRate + '%')]));
      var sec = function (h, kids) { return el('div', { class: 'w41-sec' }, [el('h4', { text: h })].concat(kids)); };
      body.appendChild(sec(tt('w41_ranked'), [el('div', { class: 'w41-stats' }, [statBox(tt('w41_games'), p.ranked.games), statBox(tt('w41_wins'), p.ranked.wins), statBox(tt('w41_losses'), p.ranked.losses), statBox(tt('w41_draws'), p.ranked.draws), statBox(tt('w41_peak'), p.ranked.peak)])]));
      body.appendChild(sec(tt('w41_mr'), [el('div', { class: 'w41-stats' }, [statBox(tt('w41_games'), p.mr.games), statBox(tt('w41_wins'), p.mr.wins), statBox(tt('w41_losses'), p.mr.losses), statBox(tt('w41_winrate'), p.mr.winRate + '%'), statBox(tt('w41_peak'), p.mr.peak)])]));
      body.appendChild(sec(tt('w41_classic') + ' / ' + tt('w41_killer'), [el('div', { class: 'w41-stats' }, [statBox(tt('w41_classic') + ' · ' + tt('w41_games'), p.classic.games), statBox(tt('w41_classic') + ' · ' + tt('w41_wins'), p.classic.wins),
        statBox(tt('w41_killer') + ' · ' + tt('w41_games'), p.killer.games), statBox(tt('w41_killer') + ' · ' + tt('w41_wins'), p.killer.wins)])]));
      if (p.titles.length) body.appendChild(sec(tt('w41_titles'), [el('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, p.titles.map(function (x) { return el('span', { class: 'w41-title', text: x.live && x.live.length ? x.live.map(titleName).join(', ') : titleName(x.id) }); }))]));
      if (p.titleHistory && p.titleHistory.length) body.appendChild(sec(tt('w41_title_hist'), [el('div', { class: 'small' }, p.titleHistory.slice(0, 10).map(function (h) { return el('div', { text: titleName({ id: h.title, scope: h.scope }) + ' ' + h.season + ' · #' + h.rank }); }))]));
      body.appendChild(sec(tt('w41_history'), [p.historyVisible ? histTable(p.history) : el('p', { class: 'muted small', text: tt('w41_hist_hidden', { p: tt('w41_priv_' + p.historyPolicy) }) })]));
      var acts = [{ label: t('close') }];
      if (!p.self && Net.user()) {
        acts.unshift({ label: p.muted ? tt('w41_unmute') : tt('w41_mute'), fn: function () { api('POST', '/api/mute', { uid: u.id, on: !p.muted }).then(function (x) { if (x.ok) { toast(tt(p.muted ? 'w41_unmuted' : 'w41_muted'), 'ok'); MR.refreshMutes(); } else toast(errText(x.body.error), 'err'); }); } });
        acts.unshift({ label: tt('w41_report'), cls: 'danger', fn: function () { if (window.V44 && V44.report) V44.report(u); } });
      }
      bigModal(tt('w41_profile'), body, acts);
    });
  }
  function histTable(rows) {
    if (!rows || !rows.length) return el('p', { class: 'muted small', text: tt('mr_none') });
    var tb = el('tbody');
    rows.forEach(function (h) {
      tb.appendChild(el('tr', {}, [el('td', { class: 'w41-res-' + h.res, text: tt('w41_' + h.res) }),
        el('td', { text: (h.type === 'mr' ? 'MR ' + h.size + 'v' + h.size : (h.kind === 'ranked' ? 'Ranked' : h.kind === 'custom' ? 'Custom' : String(h.kind || '1v1').toUpperCase())) + ' · ' + (h.mode === 'killer' ? 'Killer ' : '') + diffName(h.diff) }),
        el('td', { text: h.opp ? tt('w41_vs') + ' ' + h.opp.username : '' }),
        el('td', { text: h.eloDelta == null ? '' : (h.eloDelta > 0 ? '+' : '') + h.eloDelta + ' Elo' }),
        el('td', { text: h.coins ? '+' + h.coins + ' c' : '' }), el('td', { class: 'muted', text: fmtDate(h.at) })]));
    });
    return el('table', { class: 'w41-hist' }, [tb]);
  }
  /* any avatar that carries a player id opens the public profile (own sidebar / profile editor excluded) */
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('.avx[data-pu]');
    if (!a || a.id === 'spAv' || a.id === 'pfAv' || a.closest('.w41-prof-h') || a.closest('#avPicker')) return;
    if (a.closest('.side-prof')) return;
    /* avatars inside something that already reacts to a click (rows, member chips, buttons) keep their original behaviour */
    for (var n = a; n && n !== document.body; n = n.parentElement) { if (n.hasAttribute('data-clk') || n.onclick || /^(BUTTON|A|LABEL|SELECT|INPUT)$/.test(n.tagName) || n.getAttribute('role') === 'button') return; }
    e.preventDefault(); e.stopPropagation(); openProfile(a.getAttribute('data-pu'));
  });
  /* existing player cards / DM headers get a "View profile" button */
  var mo = new MutationObserver(function () {
    var h = document.querySelector('#modalRoot .pcard-h'); if (!h || h.parentNode.querySelector('.w41-vp')) return;
    var a = h.querySelector('.avx[data-pu]'); if (!a) return;
    var b = el('button', { class: 'btn sm w41-vp', type: 'button', text: tt('w41_view_profile'), onclick: function () { var id = a.getAttribute('data-pu'); clear($('modalRoot')); openProfile(id); } });
    h.parentNode.insertBefore(b, h.nextSibling);
  });
  mo.observe(document.getElementById('modalRoot') || document.body, { childList: true, subtree: true });
  (function dmHeader() { var d = document.getElementById('dmAv'); if (d) d.addEventListener('click', function () { var id = d.getAttribute('data-pu'); if (id) openProfile(id); }); })();

  /* =====================================================================
     SHOP EXTRAS (inside the v4.4 shop view): board themes, titles, privacy
     ===================================================================== */
  var shopTab = 'border', ABOUT = null;
  function turnSec() { return ABOUT && ABOUT.mr && ABOUT.mr.turnSec ? ABOUT.mr.turnSec : 30; }
  function loadAbout() { return api('GET', '/api/about').then(function (r) { if (r.ok) ABOUT = r.body; return ABOUT; }); }
  function openShop(tab) {
    if (!Net.user()) { toast(tt('mr_login'), 'warn'); return; }
    shopTab = tab || 'border';
    if (window.APP && APP.showView) APP.showView('shop');
    setTimeout(function () { var x = document.getElementById(shopTab === 'border' ? 'shopRoot' : 'w45Shop'); if (x && x.scrollIntoView) x.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 250);
  }
  function equip(o, done) {
    api('POST', '/api/me/cosmetics', o).then(function (r) {
      if (r.ok) { Net.setUser(r.body.user); toast(o.title !== undefined ? tt('w41_title_set') : tt('w45_theme_set'), 'ok'); if (done) done(); }
      else toast(errText(r.body.error), 'err');
    });
  }
  /* rendered under the border shop every time the v4.4 shop renders */
  function shopExtras(R) {
    if (!R || !Net.user()) return;
    var old = document.getElementById('w45Shop'); if (old) old.remove();
    var box = el('div', { class: 'panel', id: 'w45Shop' });
    var tabs = el('div', { class: 'w41-tabs', role: 'tablist' });
    var body = el('div', { id: 'w45ShopBody' });
    [['theme', 'w41_themes'], ['title', 'w41_titles'], ['privacy', 'w41_priv']].forEach(function (x) {
      tabs.appendChild(el('button', { class: 'btn sm' + (cur() === x[0] ? ' on' : ''), type: 'button', role: 'tab', 'data-tab': x[0], text: tt(x[1]), onclick: function () { shopTab = x[0]; shopExtras(R); } }));
    });
    function cur() { return shopTab === 'border' || shopTab === 'coins' ? 'theme' : shopTab; }
    box.appendChild(el('h2', {}, [el('span', { class: 'dot' }), el('span', { text: tt('w41_collection') })]));
    box.appendChild(tabs); box.appendChild(body); R.appendChild(box);
    body.appendChild(el('p', { class: 'muted small', text: '…' }));
    var tab = cur();
    if (tab === 'theme') api('GET', '/api/themes').then(function (r) {
      clear(body); if (!r.ok) { body.appendChild(el('p', { class: 'muted small', text: errText(r.body.error) })); return; }
      var d = r.body, g = el('div', { class: 'w41-grid' });
      d.themes.forEach(function (th) {
        var on = d.equipped === th.id, act;
        if (on) act = el('span', { class: 'small ok-t', text: tt('w41_in_use') });
        else if (th.owned) act = el('button', { class: 'btn sm primary', type: 'button', text: tt('w41_use'), onclick: function () { equip({ boardTheme: th.id }, function () { shopExtras(R); }); } });
        else act = el('button', { class: 'btn sm' + (d.coins >= th.price ? ' primary' : ''), type: 'button', disabled: d.coins >= th.price ? null : 'disabled', text: tt('w41_buy') + ' · ' + th.price, onclick: function () {
          confirmBox(tt('w41_buy_q', { n: themeName(th.id), p: th.price }), function () {
            api('POST', '/api/themes/buy', { id: th.id }).then(function (x) {
              if (!x.ok) { toast(x.body.error === 'no_coins' ? tt('w41_no_coins') : errText(x.body.error), 'err'); return; }
              toast(tt('w41_bought') + ' · ' + themeName(th.id), 'ok');
              if (window.V44 && V44.showShop) V44.showShop(); else shopExtras(R);
            });
          });
        } });
        g.appendChild(el('div', { class: 'w41-item' + (on ? ' cur' : ''), 'data-theme': th.id }, [rarBadge(th.rarity), el('span', { class: 'bd-swatch th-sw', style: themeSwatch(th.id) }), el('b', { text: themeName(th.id) }),
          el('span', { class: 'small muted', text: th.owned ? tt('w41_owned') : th.price + ' coin' }), act]));
      });
      body.appendChild(el('p', { class: 'small muted', text: tt('w45_theme_note') }));
      body.appendChild(g);
    });
    else if (tab === 'title') api('GET', '/api/me/titles').then(function (r) {
      clear(body); if (!r.ok) { body.appendChild(el('p', { class: 'muted small', text: errText(r.body.error) })); return; }
      var d = r.body, g2 = el('div', { class: 'w41-grid' });
      g2.appendChild(el('div', { class: 'w41-item' + (!d.active ? ' cur' : '') }, [el('b', { text: tt('w41_none') }), !d.active ? el('span', { class: 'small ok-t', text: tt('w41_in_use') }) : el('button', { class: 'btn sm', type: 'button', text: tt('w41_use'), onclick: function () { equip({ title: null }, function () { shopExtras(R); }); } })]));
      d.list.forEach(function (x) {
        var on = d.active === x.id, name = x.live && x.live.length ? x.live.map(titleName).join(', ') : tt('w41_t_' + x.id);
        g2.appendChild(el('div', { class: 'w41-item' + (on ? ' cur' : '') + (x.unlocked ? '' : ' locked'), 'data-title': x.id }, [el('span', { class: 'w41-title', text: name }), el('span', { class: 'small muted', text: tt('w41_c_' + x.id) }),
          on ? el('span', { class: 'small ok-t', text: tt('w41_in_use') }) : x.unlocked ? el('button', { class: 'btn sm primary', type: 'button', text: tt('w41_use'), onclick: function () { equip({ title: x.id }, function () { shopExtras(R); }); } }) : el('span', { class: 'small muted', text: tt('w41_locked') })]));
      });
      body.appendChild(g2);
      if (d.history && d.history.length) { body.appendChild(el('h4', { style: 'margin:14px 0 6px', text: tt('w41_title_hist') })); d.history.forEach(function (h) { body.appendChild(el('div', { class: 'small', text: titleName({ id: h.title, scope: h.scope }) + ' · ' + h.season })); }); }
    });
    else {
      clear(body);
      var u = Net.user();
      var priv = el('select', { id: 'w41Priv' }, ['public', 'friends', 'private'].map(function (x) { return el('option', { value: x, text: tt('w41_priv_' + x) }); }));
      priv.value = u.historyPrivacy || 'public';
      priv.onchange = function () { api('POST', '/api/me/privacy', { history: priv.value }).then(function (r) { toast(r.ok ? tt('w41_priv_saved') : errText(r.body.error), r.ok ? 'ok' : 'err'); if (r.ok) api('GET', '/api/me').then(function (m) { if (m.ok && m.body.user) Net.setUser(m.body.user); }); }); };
      body.appendChild(el('label', { class: 'small w45-field' }, [el('span', { text: tt('w41_priv') }), priv]));
      body.appendChild(el('p', { class: 'small muted', text: tt('w45_priv_note') }));
      body.appendChild(el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;margin-top:10px' }, [
        el('button', { class: 'btn', type: 'button', text: tt('w41_my_public'), onclick: function () { openProfile(u.id); } }),
        el('button', { class: 'btn', type: 'button', text: tt('w45_mutes'), onclick: mutesDialog })]));
    }
  }
  function mutesDialog() {
    api('GET', '/api/mutes').then(function (r) {
      if (!r.ok) return; var list = el('div', { class: 'w45-mutes' });
      if (!r.body.ids.length) list.appendChild(el('p', { class: 'muted small', text: tt('w45_no_mutes') }));
      r.body.ids.forEach(function (id) {
        var row = el('div', { class: 'row', style: 'gap:8px;justify-content:space-between;align-items:center;margin-bottom:6px' }, [el('span', { class: 'small', text: '#' + id }),
          el('button', { class: 'btn sm', type: 'button', text: tt('w41_unmute'), onclick: function () { api('POST', '/api/mute', { uid: id, on: false }).then(function (x) { if (x.ok) { row.remove(); MR.refreshMutes(); toast(tt('w41_unmuted'), 'ok'); } }); } })]);
        list.appendChild(row);
        api('GET', '/api/profile/' + id).then(function (p) { if (p.ok) row.firstChild.textContent = p.body.user.username + ' · ' + p.body.user.playerId; });
      });
      modal(tt('w45_mutes'), list, [{ label: t('close') }]);
    });
  }
  function themeSwatch(k) {
    var c = { default: 'linear-gradient(135deg,var(--cell) 50%,var(--box) 50%)', paper: 'linear-gradient(135deg,#fbf7ee 50%,#5b4a33 50%)', midnight: 'linear-gradient(135deg,#0f172a 50%,#7dd3fc 50%)', ocean: 'linear-gradient(135deg,#eef8fc 50%,#0e7490 50%)', forest: 'linear-gradient(135deg,#f1f7ee 50%,#3f6212 50%)', sunset: 'linear-gradient(135deg,#fff6ec 50%,#c2410c 50%)', sakura: 'linear-gradient(135deg,#fff1f4 50%,#db2777 50%)', matrix: 'linear-gradient(135deg,#03140a 50%,#22c55e 50%)' }[k];
    return 'background:' + (c || 'var(--panel2)') + ';border-radius:10px';
  }
  /* Profile page panel: active title, board theme, MR record, quick links */
  function profilePanel() {
    var v = document.getElementById('view-profile'); if (!v) return;
    var p = document.getElementById('w41Prof');
    if (!p) { p = el('div', { class: 'panel', id: 'w41Prof', style: 'margin-bottom:14px' }); v.insertBefore(p, v.firstChild); }
    var u = Net.user();
    if (!u) { clear(p); p.classList.add('hidden'); return; } p.classList.remove('hidden');
    var sig = [u.id, u.coins, u.rating, u.historyPrivacy, u.boardTheme, u.mrGames, u.activeTitle && u.activeTitle.id, S().lang].join('|');
    if (p.getAttribute('data-sig') === sig) return; p.setAttribute('data-sig', sig); clear(p);
    p.appendChild(el('h2', {}, [el('span', { class: 'dot' }), el('span', { text: tt('w41_collection') })]));
    p.appendChild(el('div', { class: 'w41-stats' }, [statBox(tt('w41_active_title'), u.activeTitle ? titleName(u.activeTitle) : tt('w41_none')), statBox(tt('w41_themes'), themeName(u.boardTheme || 'default')),
      statBox(tt('w41_coins'), u.coins || 0), statBox('MR · ' + tt('w41_games'), u.mrGames || 0), statBox('MR · ' + tt('w41_wins'), u.mrWins || 0), statBox(tt('w41_priv'), tt('w41_priv_' + (u.historyPrivacy || 'public')).split(' – ')[0])]));
    p.appendChild(el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;margin-top:8px' }, [
      el('button', { class: 'btn primary', type: 'button', text: tt('w41_shop'), onclick: function () { openShop('border'); } }),
      el('button', { class: 'btn', type: 'button', text: tt('w41_themes'), onclick: function () { openShop('theme'); } }),
      el('button', { class: 'btn', type: 'button', text: tt('w41_titles'), onclick: function () { openShop('title'); } }),
      el('button', { class: 'btn', type: 'button', text: tt('w41_priv'), onclick: function () { openShop('privacy'); } }),
      el('button', { class: 'btn', type: 'button', text: tt('w41_my_public'), onclick: function () { openProfile(u.id); } })]));
  }

  /* =====================================================================
     SETTINGS: How to Play, Rules, FAQ, Report a Problem, About
     ===================================================================== */
  function helpPanel() {
    var v = document.getElementById('view-settings'); if (!v) return;
    var p = document.getElementById('w41Help');
    if (!p) { p = el('div', { class: 'panel', id: 'w41Help', style: 'margin-top:14px' }); v.appendChild(p); }
    clear(p);
    p.appendChild(el('h2', {}, [el('span', { class: 'dot' }), el('span', { text: tt('h_help') })]));
    var mk = function (h, kids) { return el('details', {}, [el('summary', { text: h })].concat(kids)); };
    var faq = el('div', { class: 'w41-faq' });
    faq.appendChild(mk(tt('h_howto'), [el('p', { class: 'small', text: tt('h_howto_b') })]));
    var mrRules = el('p', { class: 'small', text: tt('mr_rules', { s: turnSec() }) });
    faq.appendChild(mk(tt('h_rules'), [el('p', { class: 'small', text: tt('h_rules_b') }), mrRules]));
    var faqBox = el('div');
    function fillFaq() {
      clear(faqBox); var c = (ABOUT && ABOUT.coins) || { win: 30, draw: 15, loss: 5, dailyCap: 300 };
      (I18N[S().lang === 'en' ? 'en' : 'bm'].h_faq_b || []).forEach(function (q) { faqBox.appendChild(el('p', { class: 'small' }, [el('b', { text: q[0] }), el('br'), document.createTextNode(q[1].replace('{w}', c.win).replace('{d}', c.draw).replace('{l}', c.loss).replace('{c}', c.dailyCap))])); });
    }
    fillFaq();
    faq.appendChild(mk(tt('h_faq'), [faqBox]));
    var cat = el('select', { id: 'w45SupCat' }, ['bug', 'match', 'account', 'payment', 'other'].map(function (c) { return el('option', { value: c, text: tt('h_cat_' + c) }); }));
    var ta = el('textarea', { rows: '4', maxlength: '1000', id: 'w45SupText', style: 'width:100%', placeholder: tt('h_report_ph') });
    var send = el('button', { class: 'btn primary', type: 'button', id: 'w45SupSend', text: tt('h_report_send'), onclick: function () {
      if (!Net.user()) { toast(tt('mr_login'), 'warn'); return; }
      send.disabled = true;
      api('POST', '/api/support/report', { category: cat.value, body: ta.value, client: (navigator.userAgent || '').slice(0, 160) + ' · ' + VERSION }).then(function (r) {
        send.disabled = false; if (r.ok) { ta.value = ''; toast(tt('h_report_ok', { n: r.body.id }), 'ok'); } else toast(r.body.error === 'report_text' ? tt('h_report_ph') : errText(r.body.error), 'err');
      });
    } });
    faq.appendChild(mk(tt('h_report'), [el('div', { class: 'w45-field' }, [el('label', { class: 'small', text: tt('h_report_cat') }), cat, ta, send])]));
    var aboutBox = el('div', { class: 'small' });
    faq.appendChild(mk(tt('h_about'), [aboutBox]));
    p.appendChild(faq);
    loadAbout().then(function (a) {
      a = a || {}; fillFaq(); mrRules.textContent = tt('mr_rules', { s: turnSec() });
      clear(aboutBox);
      [[tt('h_ver'), 'WCS – World Championship Sudoku ' + VERSION + (a.version ? ' (server ' + a.version + ', schema ' + a.schema + ')' : '')],
        [tt('h_dev'), 'NNK TRB Lab (Nnktrb-lab)'],
        [tt('h_server'), a.version ? (a.online + ' ' + tt('h_online') + ' · ' + a.players + ' ' + tt('h_players') + ' · ' + tt('h_uptime') + ' ' + Math.round(a.uptimeS / 60) + ' min') : errText('no_server')],
        [tt('h_privacy'), tt('h_privacy_b')], [tt('h_terms'), tt('h_terms_b')]].forEach(function (x) { aboutBox.appendChild(el('p', {}, [el('b', { text: x[0] + ': ' }), document.createTextNode(x[1])])); });
    });
  }

  /* =====================================================================
     MR – Multiplayer Ranked
     ===================================================================== */
  var MR = (function () {
    var root = null, lobby = null, game = null, queueSt = null, sel = -1, pencil = false, notes = {}, cfg = { size: 2, mode: 'classic', diff: 'medium' }, tab = 'lb', mutes = {};
    var tick = null, lastResult = null, cageOf = null, cageSum = null;
    function loadCfg() { var sv = S().mrCfg; if (sv && (sv.size === 2 || sv.size === 3) && /^(classic|killer)$/.test(sv.mode) && DIFFS.indexOf(sv.diff) >= 0) cfg = { size: sv.size, mode: sv.mode, diff: sv.diff }; }
    function saveCfg() { try { var st = S(); if (st && window.APP && APP.settings) st.mrCfg = { size: cfg.size, mode: cfg.mode, diff: cfg.diff }; } catch (e) { } }
    function refreshMutes() { if (!Net.user()) return; api('GET', '/api/mutes').then(function (r) { if (r.ok) { mutes = {}; r.body.ids.forEach(function (i) { mutes[i] = 1; }); Voice.applyMutes(); } }); }
    function me() { var u = Net.user(); return u ? u.id : null; }
    function show() { loadCfg(); root = document.getElementById('mrRoot'); render(); if (Net.ready()) Net.send({ t: 'mr_sync' }); }
    function visible() { var v = document.getElementById('view-mr'); return v && v.classList.contains('active'); }
    function render() {
      root = root || document.getElementById('mrRoot'); if (!root) return;
      clear(root);
      var u = Net.user();
      var head = el('div', { class: 'panel' }, [el('div', { class: 'mr-head' }, [el('div', {}, [el('h2', {}, [el('span', { class: 'dot' }), el('span', { text: tt('mr_title') })]), el('p', { class: 'small muted', text: tt('mr_sub') })]),
        u ? el('div', { class: 'mr-elo' }, [statBox(tt('mr_elo'), u.rating || 1200), statBox(tt('w41_games'), u.mrGames || 0), statBox(tt('w41_wins'), u.mrWins || 0), statBox(tt('mr_rank'), myRank == null ? '-' : '#' + myRank)]) : null])]);
      root.appendChild(head);
      if (u && Net.wsState && Net.wsState() === 'replaced') { root.appendChild(el('div', { class: 'panel' }, [el('p', { text: t('ac_replaced') }), el('button', { class: 'btn primary', id: 'mrReconnect', type: 'button', text: t('ac_reconnect'), onclick: function () { Net.reconnectNow(); } })])); renderBoards(); return; }
      if (!u || !Net.ready()) { root.appendChild(el('div', { class: 'panel' }, [el('p', { text: tt('mr_login') })])); renderBoards(); return; }
      if (game && lobby && (lobby.phase === 'match' || lobby.phase === 'result')) { renderGame(); return; }
      if (lobby) { renderLobby(); return; }
      /* config */
      var size = el('select', { id: 'mrSize' }, [el('option', { value: '2', text: '2 vs 2' }), el('option', { value: '3', text: '3 vs 3' })]); size.value = String(cfg.size);
      var mode = el('select', { id: 'mrMode' }, [el('option', { value: 'classic', text: 'Classic' }), el('option', { value: 'killer', text: 'Killer' })]); mode.value = cfg.mode;
      var diff = el('select', { id: 'mrDiff' }, DIFFS.map(function (d) { return el('option', { value: d, text: diffName(d) }); })); diff.value = cfg.diff;
      var upd = function () { cfg = { size: Number(size.value), mode: mode.value, diff: diff.value }; saveCfg(); };
      size.onchange = mode.onchange = diff.onchange = upd;
      var code = el('input', { type: 'text', id: 'mrCode', maxlength: '6', placeholder: tt('mr_code_ph'), style: 'text-transform:uppercase;width:120px' });
      var searching = queueSt && queueSt.searching;
      var box = el('div', { class: 'panel' }, [el('div', { class: 'mr-cfg' }, [el('label', {}, [el('span', { text: tt('mr_size') }), size]), el('label', {}, [el('span', { text: tt('mr_mode') }), mode]), el('label', {}, [el('span', { text: tt('mr_diff') }), diff]),
        searching ? el('button', { class: 'btn danger', id: 'mrCancel', type: 'button', text: tt('mr_cancel'), onclick: function () { Net.send({ t: 'mr_cancel' }); } })
          : el('button', { class: 'btn primary', id: 'mrFind', type: 'button', text: tt('mr_find'), onclick: function () { upd(); Net.send({ t: 'mr_find', size: cfg.size, mode: cfg.mode, diff: cfg.diff }); } }),
        el('button', { class: 'btn', id: 'mrCreate', type: 'button', text: tt('mr_create'), disabled: searching ? 'disabled' : null, onclick: function () { upd(); Net.send({ t: 'mr_create', size: cfg.size, mode: cfg.mode, diff: cfg.diff }); } }),
        el('span', { class: 'row', style: 'gap:6px' }, [code, el('button', { class: 'btn', id: 'mrJoin', type: 'button', text: tt('mr_join'), disabled: searching ? 'disabled' : null, onclick: function () { Net.send({ t: 'mr_join', code: code.value.trim().toUpperCase() }); } })])]),
        searching ? el('p', { class: 'small', id: 'mrSearching', text: tt('mr_searching', { p: queueSt.pool, n: queueSt.need }) + ' · ' + queueSt.size + 'v' + queueSt.size + ' · ' + (queueSt.mode === 'killer' ? 'Killer ' : '') + diffName(queueSt.diff) }) : null,
        el('p', { class: 'small muted', text: tt('mr_rules', { s: turnSec() }) })]);
      root.appendChild(box);
      renderBoards();
    }
    var myRank = null;
    function renderBoards() {
      var wrap = el('div', { class: 'panel' }), tabs = el('div', { class: 'w41-tabs' }, [['lb', 'mr_lb'], ['hist', 'mr_hist']].map(function (x) { return el('button', { class: 'btn sm' + (tab === x[0] ? ' on' : ''), type: 'button', text: tt(x[1]), onclick: function () { tab = x[0]; render(); } }); }));
      var body = el('div'); wrap.appendChild(tabs); wrap.appendChild(body); root.appendChild(wrap);
      if (tab === 'lb') api('GET', '/api/mr/leaderboard').then(function (r) {
        if (!r.ok) return; if (r.body.me) { var nr = r.body.me.pos; if (nr !== myRank) { myRank = nr; } }
        if (!r.body.rows.length) { body.appendChild(el('p', { class: 'muted small', text: tt('mr_none') })); return; }
        var tb = el('tbody'); r.body.rows.forEach(function (p) { tb.appendChild(el('tr', {}, [el('td', { text: '#' + p.pos }), el('td', {}, [el('span', { class: 'row', style: 'gap:6px;align-items:center' }, [Avatar.node(p, 'mini-av'), el('b', { text: (p.flag ? p.flag + ' ' : '') + p.username }), p.title ? el('span', { class: 'w41-title', text: titleName(p.title) }) : null])]), el('td', { text: String(p.mrRating) }), el('td', { class: 'muted', text: p.wins + '/' + p.games })])); });
        body.appendChild(el('table', { class: 'w41-hist mr-lb' }, [tb]));
      });
      else api('GET', '/api/mr/history').then(function (r) { if (r.ok) body.appendChild(histTable(r.body.rows)); });
    }
    function plRow(p, turnUid) {
      var tags = [];
      if (lobby.phase === 'lobby' || lobby.phase === 'countdown') tags.push(el('span', { class: 'mr-tag' + (p.ready ? ' ok' : ''), text: p.ready ? tt('mr_ready') : '…' }));
      if (p.host) tags.push(el('span', { class: 'mr-tag', text: 'HOST' }));
      if (!p.connected) tags.push(el('span', { class: 'mr-tag bad', text: 'OFFLINE' }));
      tags.push(el('span', { class: 'mr-tag' + (p.mic === 'on' ? ' ok' : ''), 'data-mic': String(p.id), text: p.mic === 'on' ? 'MIC' : p.mic === 'muted' ? 'MIC OFF' : 'NO MIC' }));
      if (game) tags.push(el('span', { class: 'mr-tag' + (p.mistakes ? ' bad' : ''), text: tt('mr_mistakes') + ' ' + (game.mistakes[p.id] || 0) + '/3' }));
      if (game && game.out[p.id]) tags.push(el('span', { class: 'mr-tag bad', text: tt('mr_elim') }));
      if (game && game.forfeit[p.id]) tags.push(el('span', { class: 'mr-tag bad', text: tt('mr_forfeit') }));
      var vol = null;
      if (p.id !== me() && lobby.myTeam === p.team && Voice.has(p.id)) { vol = el('input', { type: 'range', class: 'mr-vol', min: '0', max: '1', step: '0.05', value: String(Voice.vol(p.id)), title: tt('mr_vol'), oninput: function (e) { Voice.setVol(p.id, Number(e.target.value)); } }); }
      return el('div', { class: 'mr-pl' + (turnUid === p.id ? ' turn' : '') + (game && (game.out[p.id] || game.forfeit[p.id]) ? ' out' : ''), 'data-uid': String(p.id) }, [Avatar.node(p, 'mini-av av-md'),
        el('div', { class: 'w' }, [el('b', { text: (p.flag ? p.flag + ' ' : '') + p.username + (p.id === me() ? ' (' + t('dm_you') + ')' : '') }), el('div', { class: 'tags' }, [p.title ? el('span', { class: 'w41-title', text: titleName(p.title) }) : null, el('span', { class: 'mr-tag', text: 'Elo ' + p.rating })].concat(tags))]), vol]);
    }
    function teamsEl(turnUid) {
      var mk = function (T) {
        var list = lobby[T], box = el('div', { class: 'mr-team ' + T }, [el('h4', {}, [el('span', { text: tt('mr_team_' + T.toLowerCase()) + (lobby.myTeam === T ? ' ★' : '') }),
          (lobby.phase === 'lobby' && lobby.private && lobby.myTeam !== T && list.length < lobby.size) ? el('button', { class: 'btn sm', type: 'button', text: tt('mr_switch'), onclick: function () { Net.send({ t: 'mr_team', team: T }); } }) : null])]);
        list.forEach(function (p) { box.appendChild(plRow(p, turnUid)); });
        for (var i = list.length; i < lobby.size; i++) box.appendChild(el('div', { class: 'mr-empty', text: tt('mr_empty') }));
        if (game) { var pr = game.progress[T] || 0; box.appendChild(el('div', { class: 'mr-prog' }, [el('span', { text: tt('mr_progress') }), el('span', { class: 'bar' }, [el('i', { style: 'width:' + pr + '%;background:' + (T === 'A' ? '#3b82f6' : '#ef4444') })]), el('b', { text: pr + '%' })])); }
        return box;
      };
      return el('div', { class: 'mr-teams' }, [mk('A'), mk('B')]);
    }
    function chatEl() {
      var log = el('div', { class: 'log', id: 'mrChatLog' });
      (lobby.chat || []).forEach(function (m) { log.appendChild(chatLine(m)); });
      var inp = el('input', { type: 'text', maxlength: '200', id: 'mrChatIn', placeholder: tt('mr_chat_ph') });
      var team = el('input', { type: 'checkbox', id: 'mrChatTeam' });
      var f = el('form', { onsubmit: function (e) { e.preventDefault(); var v = inp.value.trim(); if (!v) return; Net.send({ t: 'mr_chat', text: v, team: !!(game && team.checked) }); inp.value = ''; } },
        [inp, game ? el('label', { class: 'small row', style: 'gap:4px;align-items:center' }, [team, el('span', { text: tt('mr_team_chat') })]) : null, el('button', { class: 'btn sm', type: 'submit', text: tt('mr_send') })]);
      setTimeout(function () { log.scrollTop = log.scrollHeight; }, 0);
      return el('div', { class: 'mr-chat' }, [log, f]);
    }
    function chatLine(m) { return el('div', {}, [el('b', { text: m.from.username + (m.team ? ' [' + m.team + ']' : '') + ': ' }), document.createTextNode(m.text)]); }
    function voiceEl() {
      var on = Voice.active();
      return el('div', { class: 'panel' }, [el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;align-items:center' }, [el('b', { text: tt('mr_voice') }),
        on ? el('button', { class: 'btn sm', id: 'mrMute', type: 'button', text: Voice.muted() ? tt('mr_voice_unmute') : tt('mr_voice_mute'), onclick: function () { Voice.toggleMute(); render(); } }) : null,
        on ? el('button', { class: 'btn sm danger', type: 'button', text: tt('mr_voice_off'), onclick: function () { Voice.stop(); render(); } })
          : el('button', { class: 'btn sm primary', id: 'mrVoiceOn', type: 'button', text: tt('mr_voice_on'), onclick: function () { Voice.start().then(render); } })]),
        el('p', { class: 'tiny muted', text: tt('mr_voice_note') })]);
    }
    function renderLobby() {
      var L = lobby, mine = L.myTeam && L[L.myTeam].filter(function (p) { return p.id === me(); })[0];
      var top = el('div', { class: 'panel' }, [el('div', { class: 'row', style: 'justify-content:space-between;flex-wrap:wrap;gap:8px;align-items:center' }, [
        el('div', {}, [el('b', { text: tt('mr_lobby') + ' · ' + L.size + 'v' + L.size + ' · ' + (L.mode === 'killer' ? 'Killer ' : 'Classic ') + diffName(L.diff) }),
          el('div', { class: 'small muted', text: tt('mr_joined', { j: L.joined, n: L.total }) + ' · ' + (L.rated ? tt('mr_rated') : tt('mr_unrated')) })]),
        L.private ? el('div', { class: 'row', style: 'gap:6px;align-items:center' }, [el('span', { class: 'small', text: tt('mr_code') }), el('b', { id: 'mrLobbyCode', style: 'font-family:var(--mono);font-size:18px;letter-spacing:.12em', text: L.code }), el('button', { class: 'btn sm', type: 'button', text: '⧉', 'aria-label': 'Copy', onclick: function () { copyText(L.code); } })]) : null])]);
      root.appendChild(top);
      if (L.phase === 'countdown') root.appendChild(el('div', { class: 'mr-turn me', id: 'mrCountdown', text: tt('mr_countdown', { s: Math.max(0, Math.ceil((L.countdownEnd - Date.now() - skew) / 1000)) }) }));
      if (L.phase === 'generating') root.appendChild(el('div', { class: 'mr-turn', text: tt('mr_generating') }));
      root.appendChild(teamsEl(null));
      var acts = el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, [
        mine ? el('button', { class: 'btn ' + (mine.ready ? '' : 'primary'), id: 'mrReady', type: 'button', text: mine.ready ? tt('mr_unready') : tt('mr_ready'), onclick: function () { Net.send({ t: 'mr_ready', val: !mine.ready }); } }) : null,
        L.private && L.phase === 'lobby' ? el('button', { class: 'btn', id: 'mrInvite', type: 'button', text: tt('mr_invite'), onclick: inviteFriends }) : null,
        el('button', { class: 'btn danger', id: 'mrLeave', type: 'button', text: tt('mr_leave'), onclick: function () { Voice.stop(); Net.send({ t: 'mr_leave' }); } })]);
      root.appendChild(el('div', { class: 'panel' }, [acts, el('p', { class: 'small muted', style: 'margin-top:8px', text: tt('mr_rules', { s: turnSec() }) })]));
      root.appendChild(voiceEl());
      root.appendChild(chatEl());
    }
    function inviteFriends() {
      api('GET', '/api/friends').then(function (r) {
        if (!r.ok) return; var list = el('div');
        var on = r.body.friends.filter(function (f) { return f.status === 'online'; });
        if (!on.length) list.appendChild(el('p', { class: 'muted small', text: t('ol_none') }));
        on.forEach(function (f) { list.appendChild(el('div', { class: 'row', style: 'gap:8px;align-items:center;justify-content:space-between;margin-bottom:6px' }, [el('span', { class: 'row', style: 'gap:6px;align-items:center' }, [Avatar.node(f, 'mini-av'), el('b', { text: f.username })]), el('button', { class: 'btn sm primary', type: 'button', text: tt('mr_invite'), onclick: function () { Net.send({ t: 'mr_invite', uid: f.id }); } })])); });
        modal(tt('mr_invite'), list, [{ label: t('close') }]);
      });
    }
    /* ---------------- game ---------------- */
    function setupCages(cages) {
      cageOf = null; cageSum = null; if (!cages) return;
      cageOf = new Array(81).fill(-1); cageSum = {};
      cages.forEach(function (c, k) { c.cells.forEach(function (i) { cageOf[i] = k; }); cageSum[Math.min.apply(null, c.cells)] = c.sum; });
    }
    function renderGame() {
      var g = game, myTurn = g.turnUid === me() && !g.over, turnP = findP(g.turnUid);
      var meOut = g.out[me()] || g.forfeit[me()];
      var left = el('div');
      var tb = el('div', { class: 'mr-turn' + (myTurn ? ' me' : ''), id: 'mrTurn' }, [el('span', { text: g.over ? resultText() : myTurn ? tt('mr_turn_you') : tt('mr_turn_of', { n: turnP ? turnP.username + ' (' + turnP.team + ')' : '?' }) }), el('span', { id: 'mrTurnSec', style: 'font-variant-numeric:tabular-nums' })]);
      left.appendChild(tb); left.appendChild(el('div', { class: 'mr-tbar' }, [el('i', { id: 'mrTurnBar', style: 'width:100%' })]));
      left.appendChild(el('div', { class: 'small muted', style: 'margin:8px 0 4px', text: tt('mr_your_board') + ' · ' + (g.mode === 'killer' ? 'Killer ' : 'Classic ') + diffName(g.diff) }));
      var board = el('div', { class: 'board mr-board', id: 'mrBoard', role: 'grid' });
      for (var i = 0; i < 81; i++) board.appendChild(cellEl(i));
      left.appendChild(el('div', { class: 'board-wrap' }, [board]));
      var pad = el('div', { class: 'mr-pad' });
      for (var d = 1; d <= 9; d++) (function (d) { pad.appendChild(el('button', { class: 'btn', type: 'button', 'data-d': String(d), text: String(d), disabled: g.over || meOut ? 'disabled' : null, onclick: function () { input(d); } })); })(d);
      left.appendChild(pad);
      left.appendChild(el('div', { class: 'row', style: 'gap:8px;margin-top:8px;flex-wrap:wrap' }, [
        el('button', { class: 'btn mr-pencil' + (pencil ? ' on' : ''), id: 'mrPencil', type: 'button', text: tt('mr_pencil'), onclick: function () { pencil = !pencil; renderGame0(); } }),
        el('button', { class: 'btn', type: 'button', text: t('erase'), onclick: function () { if (sel >= 0) { delete notes[sel]; renderGame0(); } } }),
        !g.over && !meOut ? el('button', { class: 'btn danger', id: 'mrSurrender', type: 'button', text: tt('mr_surrender'), onclick: function () { confirmBox(tt('mr_surrender_q'), function () { Net.send({ t: 'mr_surrender' }); }); } }) : null,
        g.over ? el('button', { class: 'btn', type: 'button', text: tt('mr_leave'), onclick: function () { Voice.stop(); Net.send({ t: 'mr_leave' }); } }) : null]));
      left.appendChild(el('p', { class: 'tiny muted', text: tt('mr_notes') }));
      var right = el('div', { style: 'display:flex;flex-direction:column;gap:12px' }, [teamsEl(g.over ? null : g.turnUid), voiceEl(), chatEl()]);
      root.appendChild(el('div', { class: 'mr-game' }, [left, right]));
      if (g.over && lastResult) root.insertBefore(resultPanel(), root.children[1]);
      tickTurn();
    }
    function renderGame0() { if (!visible()) return; clear(root); render(); }
    function resultText() { var r = game.result; if (!r) return ''; return r.winner === 'draw' ? tt('mr_result_draw') : r.winner === game.myTeam ? tt('mr_result_win') : tt('mr_result_loss'); }
    function resultPanel() {
      var r = lastResult;
      return el('div', { class: 'panel', id: 'mrResult' }, [el('h2', { text: r.winner === 'draw' ? tt('mr_result_draw') : r.winner === r.myTeam ? tt('mr_result_win') : tt('mr_result_loss') }),
        el('p', { class: 'small', text: tt('mr_reason_' + r.reason) }),
        el('div', { class: 'w41-stats' }, [r.elo ? statBox(tt('mr_elo'), r.elo.before + ' → ' + r.elo.after + ' (' + (r.elo.delta > 0 ? '+' : '') + r.elo.delta + ')') : statBox(tt('mr_elo'), '-'), statBox(tt('w41_coins'), '+' + (r.coins || 0))]),
        el('p', { class: 'tiny muted', text: r.rated ? tt('mr_rated') : tt('mr_unrated') })]);
    }
    function findP(uid) { if (!lobby) return null; return lobby.A.concat(lobby.B).filter(function (p) { return p.id === uid; })[0] || null; }
    function cellEl(i) {
      var g = game, v = Number(g.board[i]) || 0, given = Number(g.puzzle[i]) > 0;
      var r = Math.floor(i / 9), c = i % 9;
      var cls = 'cell' + (c % 3 === 2 && c < 8 ? ' bR' : '') + (r % 3 === 2 && r < 8 ? ' bB' : '') + (given ? ' given' : v ? ' player' : '') + (i === sel ? ' sel' : '');
      if (sel >= 0 && i !== sel && (Math.floor(sel / 9) === r || sel % 9 === c || (Math.floor(Math.floor(sel / 9) / 3) === Math.floor(r / 3) && Math.floor((sel % 9) / 3) === Math.floor(c / 3)))) cls += ' hl';
      var sv = sel >= 0 ? Number(g.board[sel]) : 0; if (sv && v === sv && i !== sel) cls += ' same';
      if (g.lastMove && g.lastMove.team === g.myTeam && g.lastMove.i === i && g.lastMove.ok === false) cls += ' flash-bad';
      var kids = [];
      if (cageOf) {
        var k = cageOf[i], st = [];
        var nb = function (j) { return j >= 0 && j < 81 ? cageOf[j] : -2; };
        st.push('border-top-color:' + (r === 0 || nb(i - 9) !== k ? 'var(--muted)' : 'transparent'));
        st.push('border-bottom-color:' + (r === 8 || nb(i + 9) !== k ? 'var(--muted)' : 'transparent'));
        st.push('border-left-color:' + (c === 0 || nb(i - 1) !== k ? 'var(--muted)' : 'transparent'));
        st.push('border-right-color:' + (c === 8 || nb(i + 1) !== k ? 'var(--muted)' : 'transparent'));
        kids.push(el('span', { class: 'cg', style: st.join(';') }));
        if (cageSum[i] != null) kids.push(el('span', { class: 'cs', text: String(cageSum[i]) }));
      }
      if (v) kids.push(el('span', { class: 'v', text: String(v) }));
      else if (notes[i]) { var nt = el('span', { class: 'nt' }); for (var d = 1; d <= 9; d++) nt.appendChild(el('span', { text: notes[i][d] ? String(d) : '' })); kids.push(nt); }
      return el('div', { class: cls, 'data-i': String(i), role: 'gridcell', onclick: function () { sel = i; renderGame0(); } }, kids);
    }
    function input(d) {
      var g = game; if (!g || g.over || sel < 0) return;
      if (Number(g.puzzle[sel]) || Number(g.board[sel])) return;
      if (pencil) { notes[sel] = notes[sel] || {}; notes[sel][d] = !notes[sel][d]; renderGame0(); return; }
      if (g.turnUid !== me()) { toast(tt('mr_not_turn'), 'warn'); return; }
      Net.send({ t: 'mr_mv', i: sel, v: d });
    }
    document.addEventListener('keydown', function (e) {
      if (!game || !visible() || /input|textarea|select/i.test((e.target && e.target.tagName) || '')) return;
      if (e.key >= '1' && e.key <= '9') { input(Number(e.key)); e.preventDefault(); }
      else if (e.key === 'p' || e.key === 'P') { pencil = !pencil; renderGame0(); }
      else if (/^Arrow/.test(e.key) && sel >= 0) { var r = Math.floor(sel / 9), c = sel % 9; if (e.key === 'ArrowUp') r = (r + 8) % 9; if (e.key === 'ArrowDown') r = (r + 1) % 9; if (e.key === 'ArrowLeft') c = (c + 8) % 9; if (e.key === 'ArrowRight') c = (c + 1) % 9; sel = r * 9 + c; renderGame0(); e.preventDefault(); }
    });
    var skew = 0;
    function tickTurn() {
      clearInterval(tick);
      var upd = function () {
        var s = document.getElementById('mrTurnSec'), b = document.getElementById('mrTurnBar'), cd = document.getElementById('mrCountdown');
        if (cd && lobby && lobby.countdownEnd) cd.textContent = tt('mr_countdown', { s: Math.max(0, Math.ceil((lobby.countdownEnd - Date.now() - skew) / 1000)) });
        if (!game || game.over || !s) return;
        var left = Math.max(0, game.turnEnd - (Date.now() + skew)); s.textContent = Math.ceil(left / 1000) + 's';
        if (b) b.style.width = Math.max(0, Math.min(100, 100 * left / (turnSec() * 1000))) + '%';
      };
      upd(); tick = setInterval(upd, 250);
    }
    /* ---------------- network ---------------- */
    Net.on('mr_lobby', function (m) {
      var prevTeam = lobby && lobby.myTeam; lobby = m;
      if (m.phase === 'lobby') { game = null; }
      if (prevTeam && prevTeam !== m.myTeam) Voice.restart();
      Voice.sync();
      if (m.phase === 'countdown') tickTurn();
      if (visible()) renderGame0(); else if (m.phase === 'countdown' || m.phase === 'match') { if (window.APP) APP.showView('mr'); }
    });
    Net.on('mr_state', function (m) {
      skew = m.serverTime - Date.now();
      if (m.full || !game || game.mid !== m.mid) { game = { mid: m.mid, puzzle: m.puzzle, cages: m.cages }; setupCages(m.cages); notes = {}; sel = -1; lastResult = null; }
      Object.assign(game, { mode: m.mode, diff: m.diff, myTeam: m.myTeam, turnUid: m.turnUid, turnEnd: m.turnEnd, over: m.over, board: m.board, progress: m.progress, mistakes: m.mistakes, out: m.out, forfeit: m.forfeit, order: m.order, lastMove: m.lastMove, result: m.result });
      if (m.lastMove && m.lastMove.team === m.myTeam && m.lastMove.ok && notes[m.lastMove.i]) delete notes[m.lastMove.i];
      if (m.lastMove && m.lastMove.uid === me() && m.lastMove.ok === false && !m.lastMove.timeout) toast(tt('mr_mistakes') + ' ' + (m.mistakes[me()] || 0) + '/3', 'err');
      if (visible()) renderGame0();
    });
    Net.on('mr_result', function (m) { lastResult = m; if (m.user) Net.setUser(m.user); if (visible()) renderGame0(); toast((m.winner === 'draw' ? tt('mr_result_draw') : m.winner === m.myTeam ? tt('mr_result_win') : tt('mr_result_loss')) + (m.coins ? ' · ' + tt('w41_coins_got', { n: m.coins }) : ''), m.winner === m.myTeam ? 'ok' : ''); });
    Net.on('mr_closed', function () { lobby = null; game = null; Voice.stop(); if (visible()) renderGame0(); });
    Net.on('mr_queue', function (m) { queueSt = m; if (visible() && !lobby) renderGame0(); });
    Net.on('mr_chat', function (m) {
      if (!lobby) return; if (!m.msg.team) { lobby.chat = (lobby.chat || []).concat([m.msg]).slice(-40); }
      var log = document.getElementById('mrChatLog'); if (log) { log.appendChild(chatLine(m.msg)); log.scrollTop = log.scrollHeight; }
    });
    Net.on('mr_mic', function (m) { if (!lobby) return; lobby.A.concat(lobby.B).forEach(function (p) { if (p.id === m.uid) p.mic = m.state; }); var tg = document.querySelector('[data-mic="' + m.uid + '"]'); if (tg) { tg.textContent = m.state === 'on' ? 'MIC' : m.state === 'muted' ? 'MIC OFF' : 'NO MIC'; tg.classList.toggle('ok', m.state === 'on'); tg.classList.toggle('spk', !!m.speaking); } });
    Net.on('mr_invite', function (m) {
      modal(tt('mr_title'), tt('mr_invited', { n: m.from.username, s: m.size }) + ' ' + (m.mode === 'killer' ? 'Killer ' : 'Classic ') + diffName(m.diff), [{ label: tt('mr_accept'), cls: 'primary', fn: function () { Net.send({ t: 'mr_join', code: m.code }); if (window.APP) APP.showView('mr'); } }, { label: tt('mr_decline') }]);
    });
    Net.on('mr_invite_sent', function (m) { toast(tt('mr_inv_sent', { n: m.to.username }), 'ok'); });
    Net.on('mrv_signal', function (m) { Voice.onSignal(m.from, m.data); });
    Net.on('mrv_peer_left', function (m) { Voice.drop(m.uid); });
    Net.on('hello', function () { refreshMutes(); Net.send({ t: 'mr_sync' }); if (visible()) renderGame0(); });
    Net.on('ws', function () { if (visible()) renderGame0(); });
    Net.on('user', function () { if (visible() && !game) renderGame0(); });
    return { show: show, render: renderGame0, refreshMutes: refreshMutes, lobby: function () { return lobby; }, game: function () { return game; }, mutes: function () { return mutes; }, me: me, _input: input, _sel: function (i) { sel = i; } };
  })();

  /* =====================================================================
     MR team voice – WebRTC mesh between members of the SAME team only.
     The server relays signalling only inside a team, so no peer connection to the other team can exist.
     ===================================================================== */
  var Voice = (function () {
    var local = null, joined = false, muted = false, peers = {}, ice = null, vols = {}, actx = null, spkT = null, lastSpk = false;
    function teammates() { var L = MR.lobby(); if (!L || !L.myTeam) return []; return L[L.myTeam].map(function (p) { return p.id; }).filter(function (id) { return id !== MR.me(); }); }
    function iceCfg() { if (ice) return Promise.resolve(ice); return api('GET', '/api/ice').then(function (r) { ice = r.ok && Array.isArray(r.body.iceServers) ? r.body.iceServers : [{ urls: 'stun:stun.l.google.com:19302' }]; return ice; }); }
    function send(to, data) { Net.send({ t: 'mrv_signal', to: to, data: data }); }
    function mic() { Net.send({ t: 'mr_mic', state: !joined ? 'off' : (!local || muted) ? 'muted' : 'on', speaking: lastSpk }); }
    function start() {
      if (joined) return Promise.resolve();
      if (typeof RTCPeerConnection === 'undefined') { toast(t('v_unsupported'), 'err'); return Promise.resolve(); }
      joined = true;
      var gm = navigator.mediaDevices && navigator.mediaDevices.getUserMedia ? navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }) : Promise.reject(new Error('no media'));
      return gm.then(function (s) { local = s; meter(); }).catch(function () { local = null; toast(tt('mr_voice_denied'), 'warn'); }).then(function () {
        mic(); teammates().forEach(function (id) { send(id, { type: 'hello' }); if (MR.me() < id) connect(id); });
      });
    }
    function connect(id) {
      return iceCfg().then(function (servers) {
        drop(id);
        var pc = new RTCPeerConnection({ iceServers: servers }), P = { pc: pc, audio: null };
        peers[id] = P;
        if (local) local.getTracks().forEach(function (tr) { pc.addTrack(tr, local); }); else pc.addTransceiver('audio', { direction: 'recvonly' });
        pc.onicecandidate = function (e) { if (e.candidate) send(id, { type: 'ice', c: e.candidate }); };
        pc.ontrack = function (e) {
          if (!P.audio) { P.audio = new Audio(); P.audio.autoplay = true; P.audio.setAttribute('playsinline', ''); }
          P.audio.srcObject = e.streams[0] || new MediaStream([e.track]); P.audio.volume = vols[id] == null ? 1 : vols[id]; P.audio.muted = !!MR.mutes()[id];
          var pr = P.audio.play(); if (pr && pr.catch) pr.catch(function () { });
          watch(id, P.audio.srcObject); MR.render();
        };
        pc.onconnectionstatechange = function () { if (pc.connectionState === 'failed') { drop(id); if (joined && MR.me() < id) setTimeout(function () { if (joined) connect(id); }, 1500); } };
        if (MR.me() < id) pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).then(function () { send(id, { type: 'offer', sdp: pc.localDescription }); }).catch(function () { });
        return P;
      });
    }
    function onSignal(from, d) {
      if (!joined || !d) return;
      if (teammates().indexOf(from) < 0) return; // defence in depth: never talk to anyone outside my team
      if (d.type === 'hello') { if (MR.me() < from) connect(from); else if (!peers[from]) send(from, { type: 'hello-back' }); return; }
      if (d.type === 'hello-back') { if (MR.me() < from) connect(from); return; }
      if (d.type === 'offer') {
        var go = function (P) { var pc = P.pc; pc.setRemoteDescription(d.sdp).then(function () { return pc.createAnswer(); }).then(function (a) { return pc.setLocalDescription(a); }).then(function () { send(from, { type: 'answer', sdp: pc.localDescription }); }).catch(function () { }); };
        connect(from).then(go); return;
      }
      var P = peers[from]; if (!P) return;
      if (d.type === 'answer') P.pc.setRemoteDescription(d.sdp).catch(function () { });
      else if (d.type === 'ice' && d.c) P.pc.addIceCandidate(d.c).catch(function () { });
    }
    function drop(id) { var P = peers[id]; if (!P) return; try { P.pc.close(); } catch (e) { } if (P.audio) { P.audio.srcObject = null; } if (P.an) P.an.stop = true; delete peers[id]; }
    function stop() { Object.keys(peers).forEach(function (k) { drop(Number(k)); }); if (local) local.getTracks().forEach(function (tr) { tr.stop(); }); local = null; if (joined) { joined = false; mic(); } clearInterval(spkT); lastSpk = false; }
    function restart() { if (!joined) return; var wasMuted = muted; stop(); muted = wasMuted; start(); }
    function sync() { if (!joined) return; var tm = teammates(); Object.keys(peers).forEach(function (k) { if (tm.indexOf(Number(k)) < 0) drop(Number(k)); }); }
    function toggleMute() { muted = !muted; if (local) local.getAudioTracks().forEach(function (tr) { tr.enabled = !muted; }); mic(); }
    function ctx() { if (!actx) { var A = window.AudioContext || window.webkitAudioContext; if (A) actx = new A(); } return actx; }
    function level(stream) { var c = ctx(); if (!c) return null; try { var src = c.createMediaStreamSource(stream), an = c.createAnalyser(); an.fftSize = 512; src.connect(an); var buf = new Uint8Array(an.fftSize); return function () { an.getByteTimeDomainData(buf); var s = 0; for (var i = 0; i < buf.length; i++) { var v = (buf[i] - 128) / 128; s += v * v; } return Math.sqrt(s / buf.length); }; } catch (e) { return null; } }
    function meter() { var f = level(local); if (!f) return; clearInterval(spkT); spkT = setInterval(function () { var on = !muted && f() > 0.04; if (on !== lastSpk) { lastSpk = on; mic(); mark(MR.me(), on); } }, 250); }
    function watch(id, stream) { var f = level(stream); if (!f) return; var P = peers[id]; if (!P) return; var was = false; var h = setInterval(function () { if (!peers[id] || peers[id] !== P) { clearInterval(h); return; } var on = f() > 0.04; if (on !== was) { was = on; mark(id, on); } }, 250); }
    function mark(id, on) { var tg = document.querySelector('[data-mic="' + id + '"]'); if (tg) tg.classList.toggle('spk', !!on); }
    function applyMutes() { Object.keys(peers).forEach(function (k) { var P = peers[k]; if (P.audio) P.audio.muted = !!MR.mutes()[k]; }); }
    return { start: start, stop: stop, restart: restart, sync: sync, onSignal: onSignal, drop: drop, toggleMute: toggleMute, applyMutes: applyMutes,
      active: function () { return joined; }, muted: function () { return muted || !local; }, has: function (id) { return !!(peers[id] && peers[id].audio); },
      vol: function (id) { return vols[id] == null ? 1 : vols[id]; }, setVol: function (id, v) { vols[id] = v; if (peers[id] && peers[id].audio) peers[id].audio.volume = v; } };
  })();

  /* ---------------- view hooks ---------------- */
  function onView(id, fn) {
    var v = document.getElementById(id); if (!v) return;
    new MutationObserver(function () { if (v.classList.contains('active')) fn(); }).observe(v, { attributes: true, attributeFilter: ['class'] });
    if (v.classList.contains('active')) fn();
  }
  onView('view-mr', function () { MR.show(); });
  onView('view-profile', profilePanel);
  onView('view-settings', helpPanel);
  Net.on('user', function () { var v = document.getElementById('view-profile'); if (v && v.classList.contains('active')) profilePanel(); });
  /* result coins for 1v1 */
  Net.on('result', function (m) { if (m && m.coins > 0) setTimeout(function () { toast(tt('w41_coins_got', { n: m.coins }), 'ok'); }, 900); });
  /* keep the coin chip in sync after any server-paid result (1v1, WCS, MR) */
  function syncMe() { if (!Net.user()) return; api('GET', '/api/me').then(function (r) { if (r.ok && r.body && r.body.user) Net.setUser(r.body.user); }); }
  Net.on('result', function () { setTimeout(syncMe, 600); });
  Net.on('mr_result', function () { setTimeout(syncMe, 600); });
  /* language changes re-render our panels */
  new MutationObserver(function () { var a = document.querySelector('.view.active'); if (!a) return; if (a.id === 'view-mr') MR.render(); if (a.id === 'view-profile') profilePanel(); if (a.id === 'view-settings') helpPanel(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  var navMr = document.querySelector('#nav [data-view="mr"] span'); if (navMr) navMr.textContent = t('nav_mr');

  window.WCS41 = window.V45 = { openProfile: openProfile, openShop: openShop, shopExtras: shopExtras, MR: MR, Voice: Voice, version: VERSION, about: function () { return ABOUT; } };
  loadAbout();
})();
