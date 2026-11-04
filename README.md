# WCS – World Championship Sudoku v4.0

*Only the Best Reach the Final.* (dahulu Sudoku Learning Academy; semua akaun, Elo dan sejarah dikekalkan)

Aplikasi pembelajaran Sudoku (HTML5 / CSS3 / Vanilla JS) dengan pelayan Node.js untuk akaun, Ranked, rakan dan papan pendahulu.

## Struktur

| Fail | Kegunaan |
|---|---|
| `site/sudoku-learning-academy.html` | Fail utama (salinan sama dengan `site/index.html`). Boleh dibuka terus (file://) untuk mod luar talian. |
| `site/geo.json` | Senarai negara & negeri (countries-states-cities-database oleh dr5hn, lesen ODbL). |
| `server/server.js` | HTTP + WebSocket: akaun, sesi, matchmaking, bilik, Elo, rakan, jemputan, papan pendahulu, sandaran awan, ICE. |
| `server/engine.js` | Memuatkan enjin Sudoku yang SAMA daripada fail HTML (penjana, pengesah, sangkar Killer). |
| `server/worker.js` | Penjanaan puzzle dalam worker thread. |
| `server/db.js` | Skema SQLite + migrasi tanpa memadam data, sandaran ke `backups/`. |
| `tests/server.test.js` | Ujian integrasi pelayan sebenar (HTTP + WS). |
| `tests/browser/*.js` | Ujian pelayar Playwright (dua pemain + luar talian). |

## Menjalankan

```bash
npm ci --omit=dev
node server/server.js          # PORT=8000 lalai; buka http://localhost:8000
```

Pembolehubah persekitaran pilihan: `PORT`, `SLA_DB` (lalai `data.db`), `SLA_REG_LIMIT` (pendaftaran/jam/IP, lalai 10),
`TURN_URLS` + `TURN_SECRET` (kelayakan TURN sementara, gaya coturn REST) atau `TURN_URLS` + `TURN_USERNAME` + `TURN_CREDENTIAL`.
Kelayakan TURN tidak pernah diletakkan dalam kod sumber klien; klien mengambilnya daripada `/api/ice` selepas log masuk.

## Skema pangkalan data (SQLite)

- `users` — id, username (unik, tidak sensitif huruf), player_id `SLA-XXXX-XXXX` (unik), friend_code `XXXX-XXXX` (unik), pw_hash (scrypt), recovery_hash (scrypt), country, region, rating (1200), peak, games, wins, losses, draws, casual_games, casual_wins, abandons, progress_json (sandaran awan), progress_at, created_at, last_seen.
- `sessions` — token_hash (SHA-256; token mentah tidak disimpan), user_id, created_at, expires_at, last_used.
- `login_attempts` — had cubaan gagal & penguncian sementara.
- `friend_requests`, `friendships` — permintaan dan rakan (dua arah).
- `matches` — mod, tahap, puzzle, pemain, keputusan, sebab, Elo sebelum/selepas, K, kesilapan, masa.
- `users.avatar` (v3.1, ditambah dengan `ALTER TABLE … ADD COLUMN`) — `null`, avatar sedia ada `p01`–`p24`, atau `u:<masa>` untuk gambar dimuat naik.
- `avatars` (v3.1) — user_id, mime (jpeg/png/webp disahkan melalui magic bytes), data (≤ 48 KB), updated_at. Dihidangkan oleh `GET /api/avatar/:id` dengan `nosniff` + CSP sandbox; ditukar melalui `PUT /api/me/avatar` (log masuk, had 12/10 minit).
- `schema_meta` — versi skema (kini 2). Migrasi hanya menggunakan `CREATE … IF NOT EXISTS` / `ADD COLUMN`; tiada pemadaman data. Data v2.2 di peranti (localStorage) tidak disentuh.

## Elo

E = 1/(1+10^((Lawan−Pemain)/400)), Baharu = Lama + K×(S−E), K=40 untuk 30 perlawanan pertama, kemudian 20.
Dikira di pelayan sahaja. Tahap: Bronze, Silver, Gold, Platinum, Diamond, Master, Grandmaster.

## Ujian

```bash
node tests/server.test.js                      # 203/203 lulus (tests/server-test-results.txt)
node tests/migration.test.js                   # 27/27 lulus (pangkalan data v1 & v2 → v3, data utuh)
node tests/browser/e2e.js http://localhost:8000/   # 123/123 lulus (tiga pelayar: A, B, C)
node tests/browser/solo.js                     # 25/25 lulus (file://, tanpa pelayan)
node tests/lounge.test.js                      # 54/54 lulus (bilik Lepak: had 5, penapis, suara, peribadi, hos)
node tests/browser/lounge-e2e.js http://localhost:8000/  # 34/34 lulus (tiga pelayar, desktop + mudah alih)
```

## v4.0 — WCS (World Championship Sudoku)

| Bahagian | Status | Butiran |
|---|---|---|
| Penjenamaan WCS | COMPLETE | Nama, tagline, tema hitam/emas/merah (gelap & cerah), logo mahkota, animasi juara. |
| Kelayakan ≥ 2,000 Elo | COMPLETE | Disemak di pelayan (HTTP + WebSocket); 1,999 ditolak, 2,000 dibuka automatik. |
| Peringkat kelayakan (mata) | COMPLETE | Menang 3 / Seri 1 / Kalah 0, W/L/D, kedudukan, kiraan masa, Qualified / Not Qualified; Top N & min perlawanan oleh admin. |
| Knockout + Grand Final | COMPLETE | Bracket automatik (saiz kuasa 2, bye untuk seed tinggi), READY, walkover & tie-break diumumkan awal, satu juara semusim. |
| Puzzle EXTREME sahaja | COMPLETE | Dijana pelayan, penyelesaian unik disahkan, langkah disahkan pelayan. |
| Gelaran WCS CHAMPION / GRANDMASTER SUDOKU | COMPLETE | Hanya untuk pemenang Grand Final; tidak boleh dibeli / dari XP; profil, Hall of Fame, papan pendahulu. |
| Daily Tournament | COMPLETE | Putaran Isnin–Ahad, 3 percubaan, puzzle sama, skor terbaik, papan sendiri, XP & lencana, MYT, acara rawak harian. |
| Daily Streak | COMPLETE | Hanya selesaian disahkan pelayan, kalendar, ganjaran 3/7/14/30/60/100 hari, 1 token / 30 hari (48 jam). |
| Kunci bendera 365 hari | COMPLETE | Dikunci di pelayan pada akaun; sejarah perubahan; paparan tarikh & kiraan masa. |
| Elo Bilik Custom (+0/-0) | COMPLETE | Punca: bilik custom ditanda `ranked:false`. Kini Elo sama seperti Ranked, sekali sahaja dalam transaksi DB, had anti-farming 5/pasangan/24 jam. |
| Anti-cheat, admin, rayuan | PARTIAL | Log automatik (terlalu pantas, banjir langkah, serah cepat), semakan admin, rayuan. Tiada pengesanan bot lanjutan. |
| Perlawanan WCS & Elo | Reka bentuk | Perlawanan WCS dikira dengan mata WCS, bukan Elo (supaya peserta tidak tersingkir kelayakan di tengah musim). |

Admin: tambah nama pengguna dalam `server/wcs-admins.json` (`{"admins":["nama"]}`) atau `SLA_ADMINS=nama1,nama2`.
Ujian: `tests/wcs.test.js` (116), `tests/server.test.js` (203), `tests/migration.test.js` (50, v1/v2/v3 → v4), `tests/lounge.test.js` (54).

## v3.4 — Bilik Lepak

| Ciri | Status |
|---|---|
| Tab **Mesej → Lepak**: bilik lepak untuk berbual sahaja (tiada permainan), **maksimum 5 pemain** (dikuatkuasakan di pelayan) | COMPLETE |
| Buat bilik (nama pilihan, ditapis), Awam / Peribadi, masuk dengan kod 6 aksara atau dari senarai bilik dibuka | COMPLETE |
| Teks (ditapis), emoji, 16 pelekat dan **mesej suara** dalam bilik; tanda ✓, "sedang menaip", titik belum dibaca, kertas dinding | COMPLETE |
| Jemput rakan dalam talian; bilik peribadi hanya untuk yang dijemput atau rakan hos (kod sahaja tidak cukup) | COMPLETE |
| Hos boleh keluarkan ahli (tidak boleh masuk semula), tukar nama & Awam/Peribadi; hos berpindah jika hos keluar | COMPLETE |
| Privasi: ahli baharu hanya nampak mesej selepas masuk; klip suara hanya boleh dimainkan oleh ahli yang ada ketika dihantar; pemain yang disekat hos tidak boleh masuk | COMPLETE |
| Bilik disimpan dalam memori pelayan (tidak masuk pangkalan data); ditutup selepas 2 jam tanpa aktiviti atau apabila pelayan dimulakan semula | BETA (sengaja tidak kekal) |
| Pangkalan data | Tiada perubahan skema dalam v3.4 |

## v3.3 — Mesej terus, mesej suara, ranking penuh

| Ciri | Status |
|---|---|
| Tab **Mesej**: hantar mesej kepada rakan atau mana-mana pemain berdaftar pada bila-bila masa, tanpa lobi (cari dengan Player ID / nama pengguna / kod rakan, atau dari kad pemain di Ranking) | COMPLETE |
| Mesej disimpan di pelayan (jadual `dm_messages`), tanda ✓ / ✓✓ dibaca, penunjuk "sedang menaip", lencana belum dibaca, muat mesej lama, emoji + 16 pelekat, kertas dinding yang sama | COMPLETE |
| Privasi: "Semua pemain" / "Rakan sahaja", sekat / nyahsekat, bukan rakan maks. 5 mesej sehingga dibalas, penapis pautan/e-mel/telefon/kata kesat di pelayan, had kadar | COMPLETE |
| **Mesej suara** (maks. 60 s) dalam Mesej dan sembang bilik 1vs1: mikrofon hanya dibuka selepas pemain menekan butang, boleh dengar dahulu / buang, klip ≤ 300 KB disahkan jenisnya di pelayan, hanya pengirim & penerima boleh memuat turun (log masuk wajib) | COMPLETE (memerlukan pelayan; P2P tanpa log masuk tiada mesej suara) |
| **Pembetulan ranking**: semua pemain berdaftar kini disenaraikan (pemain tanpa perlawanan Ranked ditanda "Belum ranked", tanpa kedudukan), skop baharu "Rakan", kad pemain dengan rekod bersemuka | COMPLETE |
| **Pembetulan sejarah**: panel 1vs1 kini menunjukkan semua perlawanan pelayan (Ranked + Santai); perlawanan yang terputus kerana pelayan dimulakan semula ditutup sebagai "BATAL" dan kelihatan dalam sejarah | COMPLETE |
| Perlawanan P2P (tanpa log masuk) | Tidak direkod di pelayan — sama seperti sebelum ini |
| Migrasi skema v2 → v3 | Tambahan sahaja (lajur `dm_policy`, jadual `dm_messages`, `voice_clips`, `blocks`); salinan penuh `backups/pre-migrate-v2-to-v3-*.db` dibuat sebelum naik taraf; tiada data dipadam |

## v3.2 — Sembang profesional

| Ciri | Status |
|---|---|
| Teks bebas (ditapis di pelayan) boleh ditaip & dihantar di lobi, semasa perlawanan (termasuk Ranked) dan skrin keputusan apabila lawan ada | COMPLETE |
| Status penghantaran mesej: menghantar (jam) → dihantar (✓) → dibaca (✓✓) → gagal (merah, dengan sebab) | COMPLETE |
| 16 pelekat (sticker) SVG biru/putih, disahkan di pelayan (`s01`–`s16`) | COMPLETE |
| Latar belakang sembang ala WhatsApp: 9 corak + gambar dari galeri + kawalan malapkan | COMPLETE (disimpan pada peranti sahaja, kunci `sla.chatbg.v1`) |
| Data lama (`sla.v2`, akaun, statistik) | Tidak diubah — tiada migrasi skema dalam v3.2 |

## v3.1 — Gambar profil

| Ciri | Status |
|---|---|
| 24 avatar sedia ada (SVG dua warna biru) | COMPLETE |
| Muat naik dari galeri (dipotong segi empat, dikecilkan ke JPEG ≤ 48 KB dalam pelayar) | COMPLETE |
| Ambil gambar dengan kamera (hanya selepas pemain menekan "Kamera"; kamera dihentikan selepas tangkap/batal; sandaran `capture` jika getUserMedia tiada) | COMPLETE |
| Buang gambar (kembali ke huruf awal) | COMPLETE |
| Avatar dipaparkan di sidebar, profil, lobi 1vs1, kepala sembang, papan pendahulu, senarai rakan & dalam talian | COMPLETE |
| Mod tetamu / luar talian | Tiada gambar profil (perlukan akaun pelayan) |
