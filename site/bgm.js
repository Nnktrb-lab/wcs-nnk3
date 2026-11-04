/* WCS – Muzik latar (Background music) v4.4.1
 * Modul berasingan: tidak mengubah logik permainan, akaun atau data sedia ada.
 * Tiada storan pelayar: tetapan disimpan dalam tetapan akaun (disegerak ke pelayan) dan
 * MP3 milik pemain disimpan di pelayan (/api/me/music), hanya boleh dimainkan oleh pemiliknya.
 */
(function () {
  'use strict';
  if (window.__WCS_BGM__) return;
  window.__WCS_BGM__ = true;

  var BUILTIN = [
    { id: 'b1', file: 'music/gymnopedie-1-satie.mp3', title: 'Gymnopédie No. 1', artist: 'Erik Satie' },
    { id: 'b2', file: 'music/clair-de-lune-debussy.mp3', title: 'Clair de Lune', artist: 'Claude Debussy' },
    { id: 'b3', file: 'music/air-bach.mp3', title: 'Air (Suite No. 3)', artist: 'J. S. Bach' },
    { id: 'b4', file: 'music/nocturne-op9-2-chopin.mp3', title: 'Nocturne Op. 9 No. 2', artist: 'Frédéric Chopin' },
    { id: 'b5', file: 'music/canon-in-d-pachelbel.mp3', title: 'Canon in D', artist: 'Pachelbel · Kevin MacLeod' }
  ];

  var TXT = {
    ms: {
      title: 'Muzik latar', btn: 'Muzik latar', play: 'Main', pause: 'Jeda', prev: 'Sebelum', next: 'Seterusnya',
      shuffle: 'Rawak', repeat: 'Ulang', repeatOne: 'Ulang satu lagu', vol: 'Kelantangan', ready: 'Lagu sedia ada',
      mine: 'Lagu saya (MP3)', add: 'Tambah MP3 dari peranti', addHint: 'Pilih fail dari folder Muat Turun / Download atau mana-mana MP3 (maks 8 MB, 5 lagu). Lagu disimpan dalam akaun anda di pelayan dan hanya anda boleh memainkannya.', guest: 'Log masuk untuk menyimpan lagu sendiri. Tanpa log masuk, lagu dimainkan untuk sesi ini sahaja.', uploading: 'Memuat naik…', full: 'Had 5 lagu dicapai', big: 'Fail melebihi 8 MB',
      none: 'Tiada lagu sendiri lagi.', dl: 'Muat turun MP3', rm: 'Buang', off: 'Tiada lagu dimainkan', credits: 'Kredit lagu',
      added: 'lagu ditambah', bad: 'Fail ini bukan audio yang boleh dimainkan', close: 'Tutup', tapToPlay: 'Ketik di mana-mana untuk sambung muzik',
      saveFail: 'Lagu dimainkan untuk sesi ini sahaja (gagal disimpan di pelayan)'
    },
    en: {
      title: 'Background music', btn: 'Background music', play: 'Play', pause: 'Pause', prev: 'Previous', next: 'Next',
      shuffle: 'Shuffle', repeat: 'Repeat', repeatOne: 'Repeat one', vol: 'Volume', ready: 'Built-in songs',
      mine: 'My songs (MP3)', add: 'Add MP3 from device', addHint: 'Pick files from your Downloads folder or any MP3 (max 8 MB, 5 songs). Songs are stored in your account on the server and only you can play them.', guest: 'Sign in to keep your own songs. Without signing in, songs play for this session only.', uploading: 'Uploading…', full: 'Limit of 5 songs reached', big: 'File is larger than 8 MB',
      none: 'No songs of your own yet.', dl: 'Download MP3', rm: 'Remove', off: 'Nothing playing', credits: 'Music credits',
      added: 'song(s) added', bad: 'This file is not playable audio', close: 'Close', tapToPlay: 'Tap anywhere to resume music',
      saveFail: 'Song plays for this session only (could not be saved on the server)'
    }
  };
  function L() { return (document.documentElement.lang || 'ms').toLowerCase().indexOf('en') === 0 ? TXT.en : TXT.ms; }

  /* ---------- settings ---------- */
  var S = { on: false, vol: 0.45, id: 'b1', shuffle: false, repeat: 'all' };
  function appS() { try { return window.APP && APP.settings ? APP.settings() : null; } catch (e) { return null; } }
  function loadS() {
    var a = appS(), o = a && a.bgm; if (!o || typeof o !== 'object') return;
    for (var k in S) if (o[k] !== undefined) S[k] = o[k];
    S.vol = Math.min(1, Math.max(0, +S.vol || 0)); S.on = !!S.on; S.shuffle = !!S.shuffle; S.repeat = S.repeat === 'one' ? 'one' : 'all'; S.id = String(S.id || 'b1').slice(0, 24);
  }
  loadS();
  /* settings live in the account settings object (synced to the server), never in browser storage */
  function save() { var a = appS(); if (a) a.bgm = { on: S.on, vol: S.vol, id: S.id, shuffle: S.shuffle, repeat: S.repeat }; }

  /* ---------- user tracks (stored on the server, per account) ---------- */
  var mine = []; // {id,sid,title,url,persisted}
  function N() { return window.Net || null; }
  function authed() { var n = N(); return !!(n && n.user && n.user() && n.token && n.token()); }
  function apiUrl(p) { var n = N(); return n && n.url ? n.url(p) : p; }
  function hdr(extra) { var h = { authorization: 'Bearer ' + N().token() }; for (var k in extra || {}) h[k] = extra[k]; return h; }
  function loadMine() {
    mine.forEach(function (t) { if (t.url && t.sid) { try { URL.revokeObjectURL(t.url); } catch (e) {} } });
    mine = mine.filter(function (t) { return !t.sid; });
    if (!authed()) return Promise.resolve();
    return fetch(apiUrl('/api/me/music'), { headers: hdr(), cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : { rows: [] }; }).then(function (j) {
      (j.rows || []).forEach(function (r) { mine.push({ id: 's' + r.id, sid: r.id, title: r.title, url: null, persisted: true }); });
    }).catch(function () {});
  }
  function ensureUrl(t) {
    if (!t || t.url || t.file) return Promise.resolve(t);
    if (!t.sid || !authed()) return Promise.reject(new Error('no_auth'));
    return fetch(apiUrl('/api/me/music/' + t.sid), { headers: hdr(), cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('http'); return r.blob(); })
      .then(function (b) { t.url = URL.createObjectURL(b); return t; });
  }

  function all() { return BUILTIN.concat(mine); }
  function find(id) { var a = all(); for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; }
  function srcOf(t) { return t.url || t.file; }

  /* ---------- audio ---------- */
  var au = new Audio();
  au.preload = 'none';
  au.volume = S.vol;
  var cur = null, duck = 0, pendingResume = false;

  function setTrack(t, autoplay) {
    if (!t) return;
    cur = t; S.id = t.id; save();
    if (!t.file && !t.url) { ensureUrl(t).then(function () { if (cur === t) setTrack(t, autoplay); }).catch(function () { if (cur === t) setTrack(BUILTIN[0], autoplay); }); render(); return; }
    au.src = srcOf(t);
    au.loop = S.repeat === 'one';
    if (autoplay) doPlay();
    meta(); render();
  }
  function doPlay() {
    if (!cur) setTrack(find(S.id) || BUILTIN[0], false);
    var p = au.play();
    if (p && p.catch) p.catch(function (e) {
      if (e && e.name === 'NotAllowedError') { pendingResume = true; render(); }
    });
  }
  function play() { S.on = true; save(); doPlay(); render(); }
  function pause() { S.on = false; save(); au.pause(); pendingResume = false; render(); }
  function toggle() { if (au.paused) play(); else pause(); }
  function step(dir) {
    var a = all(); if (!a.length) return;
    var i = Math.max(0, a.indexOf(cur));
    var n;
    if (S.shuffle && a.length > 1) { do { n = Math.floor(Math.random() * a.length); } while (n === i); }
    else n = (i + dir + a.length) % a.length;
    S.on = true; setTrack(a[n], true);
  }
  au.addEventListener('ended', function () { if (S.repeat !== 'one') step(1); });
  au.addEventListener('play', function () { render(); });
  au.addEventListener('pause', function () { render(); });
  au.addEventListener('timeupdate', progress);
  au.addEventListener('loadedmetadata', progress);
  au.addEventListener('error', function () {
    if (!cur || !au.getAttribute('src')) return;
    if (S.on && all().length > 1) setTimeout(function () { step(1); }, 600);
  });

  // Lower music while other audio in the app (e.g. voice messages) is playing.
  function applyVol() { au.volume = duck > 0 ? S.vol * 0.15 : S.vol; }
  document.addEventListener('play', function (e) { var t = e.target; if (t !== au && t && t.tagName && /^(AUDIO|VIDEO)$/.test(t.tagName)) { duck++; applyVol(); } }, true);
  function unduck(e) { var t = e.target; if (t !== au && t && t.tagName && /^(AUDIO|VIDEO)$/.test(t.tagName) && duck > 0) { duck--; applyVol(); } }
  document.addEventListener('pause', unduck, true);
  document.addEventListener('ended', unduck, true);

  // Browsers block autoplay until the player interacts with the page.
  function gesture(e) {
    if (e && e.target && ((pop && pop.contains(e.target)) || (btn && btn.contains(e.target)))) return;
    if (S.on && au.paused && (pendingResume || !au.currentTime)) { pendingResume = false; doPlay(); }
  }
  document.addEventListener('pointerdown', gesture, true);
  document.addEventListener('keydown', gesture, true);

  function meta() {
    if (!('mediaSession' in navigator) || !cur) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: cur.title, artist: cur.artist || 'MP3', album: 'WCS – World Championship Sudoku' });
      navigator.mediaSession.setActionHandler('play', play);
      navigator.mediaSession.setActionHandler('pause', pause);
      navigator.mediaSession.setActionHandler('previoustrack', function () { step(-1); });
      navigator.mediaSession.setActionHandler('nexttrack', function () { step(1); });
    } catch (e) {}
  }

  /* ---------- UI ---------- */
  var css = '' +
    '.bgm-btn{position:relative}' +
    '.bgm-btn svg{width:16px;height:16px;display:block;margin:auto}' +
    '.bgm-btn.on{border-color:var(--accent);color:var(--accent2);box-shadow:0 0 0 1px var(--accent-soft) inset}' +
    '.bgm-btn.on::after{content:"";position:absolute;top:5px;right:6px;width:6px;height:6px;border-radius:50%;background:var(--ok)}' +
    '.bgm-pop{position:fixed;z-index:120;top:62px;right:14px;width:min(370px,calc(100vw - 20px));max-height:calc(100vh - 80px);overflow:auto;background:var(--panel);color:var(--text);border:1px solid var(--line2);border-radius:var(--radius);box-shadow:var(--shadow),var(--glow);padding:14px 14px 12px;font-family:var(--font)}' +
    '.bgm-pop[hidden]{display:none}' +
    '.bgm-hd{display:flex;align-items:center;gap:8px;margin-bottom:10px}' +
    '.bgm-hd>svg{width:18px;height:18px;flex:none;color:var(--accent2)}' +
    '.bgm-hd b{font-size:15px;flex:1}' +
    '.bgm-x{background:none;border:0;color:var(--muted);font-size:20px;line-height:1;padding:2px 6px;border-radius:8px}' +
    '.bgm-now{background:var(--panel2);border:1px solid var(--line);border-radius:var(--radius-sm);padding:10px 12px}' +
    '.bgm-now .t{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.bgm-now .a{color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.bgm-seek{display:flex;align-items:center;gap:8px;margin-top:8px;font:12px var(--mono);color:var(--faint)}' +
    '.bgm-pop input[type=range]{flex:1;accent-color:var(--accent);min-width:0}' +
    '.bgm-ctl{display:flex;align-items:center;justify-content:center;gap:8px;margin:10px 0 4px}' +
    '.bgm-ctl button{width:38px;height:38px;border-radius:50%;border:1px solid var(--line);background:var(--panel2);color:var(--text);display:grid;place-items:center;padding:0}' +
    '.bgm-ctl button svg{width:17px;height:17px}' +
    '.bgm-ctl .main{width:48px;height:48px;background:var(--btn-gold);border-color:transparent;color:#fff}' +
    '.bgm-ctl .act{color:var(--accent2);border-color:var(--accent)}' +
    '.bgm-ctl .rp1{position:relative}.bgm-ctl .rp1::after{content:"1";position:absolute;font:700 9px var(--font);right:7px;bottom:6px}' +
    '.bgm-vol{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px;margin:6px 0 2px}' +
    '.bgm-h{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);margin:12px 0 6px;font-weight:700}' +
    '.bgm-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}' +
    '.bgm-list li{display:flex;align-items:center;gap:6px;border:1px solid transparent;border-radius:var(--radius-sm);padding:2px 2px 2px 4px}' +
    '.bgm-list li.cur{background:var(--accent-soft);border-color:var(--line2)}' +
    '.bgm-list .pick{flex:1;min-width:0;text-align:left;background:none;border:0;padding:6px 4px;color:var(--text)}' +
    '.bgm-list .pick b{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.bgm-list .pick small{display:block;color:var(--muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.bgm-ic{flex:none;width:32px;height:32px;border-radius:8px;border:1px solid var(--line);background:var(--panel2);color:var(--muted);display:grid;place-items:center;padding:0;text-decoration:none}' +
    '.bgm-ic svg{width:15px;height:15px}' +
    '.bgm-ic:hover,.bgm-x:hover{color:var(--text);border-color:var(--line2)}' +
    '.bgm-add{width:100%;margin-top:8px;border:1px dashed var(--line2);background:var(--panel2);color:var(--text);border-radius:var(--radius-sm);padding:10px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:8px}' +
    '.bgm-add svg{width:16px;height:16px}' +
    '.bgm-note{font-size:11px;color:var(--faint);margin-top:6px;line-height:1.45}' +
    '.bgm-empty{font-size:12px;color:var(--muted);padding:4px 4px}' +
    '.bgm-ft{display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:11px;color:var(--faint)}' +
    '.bgm-ft a{color:var(--accent2)}' +
    '.bgm-tap{color:var(--accent2);font-size:12px;margin-top:6px}' +
    '@media (max-width:640px){.bgm-btn{min-width:36px!important;padding:0 8px!important}.bgm-pop{top:auto;bottom:calc(72px + env(safe-area-inset-bottom));right:10px;left:10px;width:auto;max-height:calc(100vh - 150px)}}';

  var I = {
    note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
    shuf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>',
    rep: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>',
    dl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
    rm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
    add: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    vol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="16" height="16"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14"/></svg>'
  };

  var btn, pop, fileIn, els = {};
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }

  function build() {
    var st = document.createElement('style'); st.id = 'bgm-css'; st.textContent = css; document.head.appendChild(st);

    btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'chip-btn bgm-btn'; btn.id = 'qMusic';
    btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = I.note;
    var quick = document.querySelector('.topbar .quick');
    if (quick) quick.insertBefore(btn, quick.firstChild);
    else { btn.style.cssText = 'position:fixed;right:14px;bottom:84px;z-index:119'; document.body.appendChild(btn); }

    pop = document.createElement('div');
    pop.className = 'bgm-pop'; pop.id = 'bgmPanel'; pop.hidden = true;
    pop.setAttribute('role', 'dialog');
    document.body.appendChild(pop);

    fileIn = document.createElement('input');
    fileIn.type = 'file'; fileIn.accept = 'audio/mpeg,audio/mp3,audio/*,.mp3,.m4a,.aac,.ogg,.wav'; fileIn.multiple = true; fileIn.hidden = true;
    fileIn.id = 'bgmFile';
    document.body.appendChild(fileIn);
    fileIn.addEventListener('change', function () { addFiles(fileIn.files); fileIn.value = ''; });

    btn.addEventListener('click', function (e) { e.stopPropagation(); open(pop.hidden); });
    document.addEventListener('click', function (e) { if (!pop.hidden && !pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) open(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !pop.hidden) { open(false); btn.focus(); } });
    pop.addEventListener('click', onPopClick);
    pop.addEventListener('input', onPopInput);

    new MutationObserver(function () { render(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  }

  function open(v) { pop.hidden = !v; btn.setAttribute('aria-expanded', v ? 'true' : 'false'); if (v) render(); }

  function row(t, isMine, curId) {
    var T = L();
    var right = isMine
      ? '<button type="button" class="bgm-ic" data-rm="' + esc(t.id) + '" aria-label="' + T.rm + ': ' + esc(t.title) + '" title="' + T.rm + '">' + I.rm + '</button>'
      : '<a class="bgm-ic" href="' + esc(t.file) + '" download aria-label="' + T.dl + ': ' + esc(t.title) + '" title="' + T.dl + '">' + I.dl + '</a>';
    return '<li class="' + (t.id === curId ? 'cur' : '') + '"><button type="button" class="pick" data-pick="' + esc(t.id) + '"><b>' + esc(t.title) + '</b><small>' + esc(t.artist || 'MP3') + '</small></button>' + right + '</li>';
  }

  function render() {
    if (!btn) return;
    var T = L(), playing = !au.paused;
    btn.classList.toggle('on', playing);
    btn.setAttribute('aria-label', T.btn); btn.title = T.btn;
    if (pop.hidden) return;
    var c = cur || find(S.id) || BUILTIN[0];
    var curId = c && c.id;
    var keepScroll = pop.scrollTop;
    pop.setAttribute('aria-label', T.title);
    pop.innerHTML =
      '<div class="bgm-hd">' + I.note + '<b>' + T.title + '</b><button type="button" class="bgm-x" data-a="close" aria-label="' + T.close + '">×</button></div>' +
      '<div class="bgm-now"><div class="t" id="bgmT">' + esc(c ? c.title : T.off) + '</div><div class="a">' + esc(c ? (c.artist || 'MP3') : '') + '</div>' +
      '<div class="bgm-seek"><span id="bgmCur">0:00</span><input type="range" id="bgmSeek" min="0" max="1000" value="0" aria-label="Seek"><span id="bgmDur">0:00</span></div>' +
      (pendingResume ? '<div class="bgm-tap">' + T.tapToPlay + '</div>' : '') + '</div>' +
      '<div class="bgm-ctl">' +
        '<button type="button" data-a="shuffle" class="' + (S.shuffle ? 'act' : '') + '" aria-pressed="' + S.shuffle + '" aria-label="' + T.shuffle + '" title="' + T.shuffle + '">' + I.shuf + '</button>' +
        '<button type="button" data-a="prev" aria-label="' + T.prev + '" title="' + T.prev + '">' + I.prev + '</button>' +
        '<button type="button" data-a="toggle" class="main" id="bgmPlay" aria-label="' + (playing ? T.pause : T.play) + '" title="' + (playing ? T.pause : T.play) + '">' + (playing ? I.pause : I.play) + '</button>' +
        '<button type="button" data-a="next" aria-label="' + T.next + '" title="' + T.next + '">' + I.next + '</button>' +
        '<button type="button" data-a="repeat" class="' + (S.repeat === 'one' ? 'act rp1' : '') + '" aria-pressed="' + (S.repeat === 'one') + '" aria-label="' + (S.repeat === 'one' ? T.repeatOne : T.repeat) + '" title="' + (S.repeat === 'one' ? T.repeatOne : T.repeat) + '">' + I.rep + '</button>' +
      '</div>' +
      '<label class="bgm-vol">' + I.vol + '<input type="range" id="bgmVol" min="0" max="100" value="' + Math.round(S.vol * 100) + '" aria-label="' + T.vol + '"><span id="bgmVolN" style="width:30px;text-align:right">' + Math.round(S.vol * 100) + '</span></label>' +
      '<div class="bgm-h">' + T.ready + '</div><ul class="bgm-list">' + BUILTIN.map(function (t) { return row(t, false, curId); }).join('') + '</ul>' +
      '<div class="bgm-h">' + T.mine + '</div>' +
      (mine.length ? '<ul class="bgm-list" id="bgmMine">' + mine.map(function (t) { return row(t, true, curId); }).join('') + '</ul>' : '<div class="bgm-empty">' + T.none + '</div>') +
      '<button type="button" class="bgm-add" data-a="add">' + I.add + T.add + '</button>' +
      '<div class="bgm-note">' + (authed() ? T.addHint : T.guest) + '</div>' +
      '<div class="bgm-ft"><a href="music/CREDITS.txt" target="_blank" rel="noopener">' + T.credits + '</a><span>CC0 · Public domain · CC BY 3.0</span></div>';
    pop.scrollTop = keepScroll;
    progress();
  }

  var seeking = false;
  function progress() {
    if (!pop || pop.hidden) return;
    var d = au.duration, c = au.currentTime;
    var a = document.getElementById('bgmCur'), b = document.getElementById('bgmDur'), s = document.getElementById('bgmSeek');
    if (a) a.textContent = fmt(c);
    if (b) b.textContent = isFinite(d) ? fmt(d) : '0:00';
    if (s && !seeking) s.value = isFinite(d) && d > 0 ? Math.round(c / d * 1000) : 0;
  }

  function onPopClick(e) {
    e.stopPropagation();
    var el = e.target.closest('[data-a],[data-pick],[data-rm]'); if (!el) return;
    var a = el.getAttribute('data-a');
    if (a === 'close') { open(false); btn.focus(); return; }
    if (a === 'toggle') { toggle(); return; }
    if (a === 'prev') { step(-1); return; }
    if (a === 'next') { step(1); return; }
    if (a === 'shuffle') { S.shuffle = !S.shuffle; save(); render(); return; }
    if (a === 'repeat') { S.repeat = S.repeat === 'one' ? 'all' : 'one'; au.loop = S.repeat === 'one'; save(); render(); return; }
    if (a === 'add') { fileIn.click(); return; }
    var p = el.getAttribute('data-pick');
    if (p) { var t = find(p); if (!t) return; if (cur === t) { toggle(); return; } S.on = true; save(); setTrack(t, true); return; }
    var r = el.getAttribute('data-rm');
    if (r) removeMine(r);
  }
  function onPopInput(e) {
    var t = e.target;
    if (t.id === 'bgmVol') { S.vol = (+t.value || 0) / 100; applyVol(); save(); var n = document.getElementById('bgmVolN'); if (n) n.textContent = t.value; }
    if (t.id === 'bgmSeek') {
      seeking = true;
      if (isFinite(au.duration) && au.duration > 0) au.currentTime = (+t.value / 1000) * au.duration;
      clearTimeout(onPopInput._t); onPopInput._t = setTimeout(function () { seeking = false; }, 250);
    }
  }

  function toast(msg, kind) {
    try { if (typeof window.toast === 'function') return window.toast(msg, kind); } catch (e) {}
    var d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText = 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:130;background:var(--panel2);color:var(--text);border:1px solid var(--line2);padding:8px 14px;border-radius:999px;font-size:13px;box-shadow:var(--shadow)';
    document.body.appendChild(d); setTimeout(function () { d.remove(); }, 2600);
  }

  function canPlay(f) {
    var ty = (f.type || '').toLowerCase();
    if (ty.indexOf('audio/') === 0) return au.canPlayType(ty) !== '' || /mpeg|mp3/.test(ty);
    return /\.(mp3|m4a|aac|ogg|oga|wav|flac|opus)$/i.test(f.name || '');
  }
  function addFiles(list) {
    var T = L(), files = Array.prototype.slice.call(list || []), ok = 0, first = null, fail = false;
    if (!files.length) return;
    if (!authed()) toast(T.guest, 'warn');
    else toast(T.uploading, '');
    var chain = Promise.resolve();
    files.forEach(function (f) {
      chain = chain.then(function () {
        if (!canPlay(f)) { toast(T.bad + ': ' + f.name, 'err'); return; }
        var title = (f.name || 'MP3').replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 80);
        if (!authed()) { var g = { id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), title: title, url: URL.createObjectURL(f), persisted: false }; mine.push(g); ok++; if (!first) first = g; return; }
        if (f.size > 8 * 1024 * 1024) { toast(T.big + ': ' + f.name, 'err'); return; }
        return fetch(apiUrl('/api/me/music?title=' + encodeURIComponent(title)), { method: 'POST', headers: hdr({ 'content-type': 'application/octet-stream' }), body: f }).then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            if (!r.ok) { if (j.error === 'music_full') toast(T.full, 'err'); else if (j.error === 'too_large') toast(T.big, 'err'); else if (j.error === 'music_bad') toast(T.bad + ': ' + f.name, 'err'); else fail = true; return; }
            var t = { id: 's' + j.id, sid: j.id, title: j.title, url: URL.createObjectURL(f), persisted: true }; mine.push(t); ok++; if (!first) first = t;
          });
        }).catch(function () { fail = true; });
      });
    });
    chain.then(function () {
      if (ok) toast(ok + ' ' + T.added, 'ok');
      if (fail) toast(T.saveFail, 'warn');
      if (first) { S.on = true; save(); setTrack(first, true); }
      render();
    });
  }
  function removeMine(id) {
    var i = -1; for (var k = 0; k < mine.length; k++) if (mine[k].id === id) i = k;
    if (i < 0) return;
    var t = mine[i];
    var wasCur = cur === t;
    mine.splice(i, 1);
    try { if (t.url) URL.revokeObjectURL(t.url); } catch (e) {}
    if (t.sid && authed()) fetch(apiUrl('/api/me/music/' + t.sid), { method: 'DELETE', headers: hdr() }).catch(function () {});
    if (wasCur) { var playing = !au.paused; au.pause(); au.removeAttribute('src'); cur = null; setTrack(BUILTIN[0], playing); }
    else render();
  }

  function start() {
    loadS();
    return loadMine().then(function () {
      var t = find(S.id) || BUILTIN[0];
      if (cur !== t) { if (t.file || t.url) { cur = t; au.src = srcOf(t); au.loop = S.repeat === 'one'; } else setTrack(t, false); }
      applyVol(); meta();
      if (S.on && au.paused) doPlay();
      render();
    });
  }
  function init() {
    build();
    start();
    render();
    /* signing in (or a restored session) brings the account's music settings and songs */
    var n = N(), lastUid = null;
    if (n && n.on) n.on('user', function (u) {
      var id = u ? u.id : null; if (id === lastUid) return; lastUid = id;
      if (!u) { mine.forEach(function (t) { if (t.sid && t.url) { try { URL.revokeObjectURL(t.url); } catch (e) {} } }); mine = mine.filter(function (t) { return !t.sid; }); if (cur && cur.sid) { au.pause(); cur = null; setTrack(BUILTIN[0], false); } render(); return; }
      setTimeout(start, 1500);
    });
  }

  window.WCSMusic = { play: play, pause: pause, next: function () { step(1); }, prev: function () { step(-1); }, state: function () { return { on: S.on, playing: !au.paused, track: cur && cur.id, vol: S.vol, mine: mine.length, saved: mine.filter(function (t) { return t.persisted; }).length }; }, _reload: start };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
