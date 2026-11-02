/* ===================== 18. NET: SLA server API + WebSocket (accounts, ranked, friends, leaderboard) ===================== */
window.__API_BASE__ = window.__API_BASE__ || '__PORT_8000__';
var Net = (function () {
  'use strict';
  var TK = 'sla.auth.v3';
  var base = null, avail = 'checking', token = null, user = null, ws = null, wsState = 'off', backoff = 1000, rt = null, handlers = {}, serverInfo = null, manualOff = false;
  function on(type, fn) { (handlers[type] = handlers[type] || []).push(fn); }
  function emit(type, m) { (handlers[type] || []).concat(handlers['*'] || []).forEach(function (fn) { try { fn(m, type); } catch (e) { console.error('Net handler', type, e); } }); }
  function candidates() {
    var b = String(window.__API_BASE__ || '');
    if (location.protocol === 'file:') return [];
    if (b && !/^__PORT_\d+__$/.test(b)) return [b.replace(/\/+$/, '')];
    return ['.']; // same origin: the SLA server serves this page itself (local run / published with backend)
  }
  function url(p) { return (base || '.') + p; }
  function probe() {
    var list = candidates();
    if (!list.length) { avail = 'none'; emit('status'); return Promise.resolve(false); }
    var tryOne = function (i) {
      if (i >= list.length) { avail = 'none'; emit('status'); return false; }
      var ctl = window.AbortController ? new AbortController() : null, to = setTimeout(function () { if (ctl) ctl.abort(); }, 6000);
      return fetch(list[i] + '/api/health', { cache: 'no-store', signal: ctl ? ctl.signal : undefined }).then(function (r) { clearTimeout(to); return r.ok ? r.json() : null; }).then(function (j) {
        if (j && j.ok && /^3\./.test(j.version || '')) { base = list[i]; serverInfo = j; avail = 'ok'; emit('status'); return true; }
        return tryOne(i + 1);
      }).catch(function () { clearTimeout(to); return tryOne(i + 1); });
    };
    return tryOne(0);
  }
  function api(method, path, body) {
    if (avail !== 'ok') return Promise.resolve({ ok: false, status: 0, body: { error: 'no_server' } });
    var h = { 'content-type': 'application/json' }; if (token) h.authorization = 'Bearer ' + token;
    return fetch(url(path), { method: method, headers: h, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && token && path.indexOf('/api/auth/') !== 0) { dropSession(); }
        return { ok: r.ok, status: r.status, body: j || {} };
      });
    }).catch(function () { return { ok: false, status: 0, body: { error: 'network' } }; });
  }
  function setSession(tk, u) { token = tk; user = u; Store.set(TK, { token: tk, uid: u.id, username: u.username }); emit('user', u); connect(); }
  function dropSession() { token = null; user = null; Store.del(TK); closeWs(); emit('user', null); }
  function setUser(u) { if (!u) return; user = u; emit('user', u); }
  /* ---------- WebSocket ---------- */
  function wsUrl() { var u = new URL(url('/ws'), location.href); u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'; return u.toString(); }
  function connect() {
    if (!token || avail !== 'ok' || manualOff) return;
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    clearTimeout(rt); wsState = 'connecting'; emit('ws');
    var s; try { s = new WebSocket(wsUrl()); } catch (e) { schedule(); return; }
    ws = s;
    s.onopen = function () { s.send(JSON.stringify({ t: 'auth', token: token })); };
    s.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!m || typeof m.t !== 'string') return;
      if (m.t === 'hello') { wsState = 'on'; backoff = 1000; user = m.user; emit('user', user); emit('ws'); }
      if (m.t === 'me' && m.user) { user = m.user; emit('user', user); }
      if (m.t === 'replaced') { wsState = 'replaced'; manualOff = true; emit('ws'); }
      emit(m.t, m);
    };
    s.onclose = function (ev) {
      if (ws !== s) return;
      ws = null;
      if (ev.code === 4001) { wsState = 'off'; dropSession(); toast(t('ac_session_end'), 'warn'); return; }
      if (wsState === 'replaced' || manualOff) { emit('ws'); emit('ws_closed', { code: ev.code }); return; }
      wsState = 'retry'; emit('ws'); emit('ws_closed', { code: ev.code }); schedule();
    };
    s.onerror = function () { };
  }
  function schedule() { clearTimeout(rt); rt = setTimeout(connect, backoff); backoff = Math.min(15000, backoff * 1.7); }
  function closeWs() { clearTimeout(rt); var s = ws; ws = null; wsState = 'off'; if (s) { try { s.close(1000); } catch (e) { } } emit('ws'); }
  function reconnectNow() { manualOff = false; backoff = 1000; if (wsState === 'replaced') wsState = 'off'; connect(); }
  function send(o) { if (ws && ws.readyState === 1 && wsState === 'on') { ws.send(JSON.stringify(o)); return true; } return false; }
  function init() {
    var saved = Store.get(TK); if (saved && typeof saved.token === 'string' && saved.token.length >= 40) token = saved.token;
    document.addEventListener('visibilitychange', function () { if (!document.hidden && token && !ws && !manualOff) { backoff = 1000; connect(); } });
    window.addEventListener('online', function () { if (token && !ws) { backoff = 1000; connect(); } });
    return probe().then(function (okk) {
      if (!okk || !token) return;
      return api('GET', '/api/me').then(function (r) { if (r.ok && r.body.user) { user = r.body.user; emit('user', user); connect(); } });
    });
  }
  return {
    init: init, on: on, api: api, send: send, setSession: setSession, dropSession: dropSession, setUser: setUser, reconnectNow: reconnectNow, probe: probe,
    avail: function () { return avail; }, user: function () { return user; }, token: function () { return token; }, wsState: function () { return wsState; },
    ready: function () { return wsState === 'on' && !!user; }, info: function () { return serverInfo; }, base: function () { return base; }
  };
})();

/* ---------- Geography (countries + top-level regions, dr5hn dataset, ODbL) ---------- */
var Geo = (function () {
  var data = null, prom = null;
  function load() {
    if (data) return Promise.resolve(data);
    if (!prom) prom = fetch('geo.json', { cache: 'force-cache' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { data = j || {}; return data; }).catch(function () { data = {}; return data; });
    return prom;
  }
  function flag(cc) { if (!cc || !/^[A-Z]{2}$/.test(cc)) return '🏳'; return String.fromCodePoint(0x1F1E6 + cc.charCodeAt(0) - 65, 0x1F1E6 + cc.charCodeAt(1) - 65); }
  function cname(cc) { return data && data[cc] ? data[cc][0] : (cc || ''); }
  function rname(cc, rc) { if (!data || !data[cc] || !rc) return rc || ''; var r = data[cc][1].filter(function (x) { return x[0] === rc; })[0]; return r ? r[1] : rc; }
  function fillCountries(sel, value, allowEmpty) {
    clear(sel);
    if (allowEmpty) sel.appendChild(el('option', { value: '', text: t('pick') }));
    Object.keys(data || {}).map(function (k) { return [k, data[k][0]]; }).sort(function (a, b) { return a[1].localeCompare(b[1]); }).forEach(function (c) { sel.appendChild(el('option', { value: c[0], text: flag(c[0]) + ' ' + c[1] })); });
    sel.value = value || '';
  }
  function fillRegions(sel, cc, value) {
    clear(sel); sel.appendChild(el('option', { value: '', text: t('pick') }));
    if (data && data[cc]) data[cc][1].slice().sort(function (a, b) { return a[1].localeCompare(b[1]); }).forEach(function (r) { sel.appendChild(el('option', { value: r[0], text: r[1] })); });
    sel.value = value || ''; sel.disabled = !(data && data[cc] && data[cc][1].length);
  }
  return { load: load, flag: flag, cname: cname, rname: rname, fillCountries: fillCountries, fillRegions: fillRegions };
})();

function tierKey(r) { var T = [[2000, 'gm'], [1800, 'master'], [1600, 'diamond'], [1400, 'platinum'], [1200, 'gold'], [1000, 'silver'], [0, 'bronze']]; for (var i = 0; i < T.length; i++) if (r >= T[i][0]) return T[i][1]; return 'bronze'; }
var TIER_ABBR = { gm: 'GM', master: 'M', diamond: 'D', platinum: 'P', gold: 'G', silver: 'S', bronze: 'B' };
function copyText(s) { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(function () { toast(t('t_copied'), 'ok'); }, function () { toast(s); }); else toast(s); }
function errText(code) { var k = 'err_' + String(code || 'network'); var s = t(k); return s === k ? t('err_generic', { c: code }) : s; }

/* ===================== 19. ACCOUNT & PROFILE ===================== */
var Account = (function () {
  'use strict';
  var tab = 'login', hist = { page: 1, total: 0 };
  function U() { return Net.user(); }
  function setMsg(id, txt, kind) { var n = $(id); n.textContent = txt || ''; n.style.color = kind === 'err' ? 'var(--err)' : kind === 'ok' ? 'var(--accent)' : ''; }
  function validUser(u) { return /^[A-Za-z0-9_]{3,16}$/.test(u); }
  function validPw(p) { return typeof p === 'string' && p.length >= 8 && p.length <= 128 && /[A-Za-z]/.test(p) && /\d/.test(p); }
  function syncTabs() {
    document.querySelectorAll('#acTabs button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === tab); });
    $('acRecF').classList.toggle('hidden', tab !== 'recover');
    $('acPass2F').classList.toggle('hidden', tab === 'login');
    $('acGeoF').classList.toggle('hidden', tab !== 'register');
    $('acPassL').textContent = tab === 'recover' ? t('ac_pw_new') : t('ac_password');
    $('acPass').autocomplete = tab === 'login' ? 'current-password' : 'new-password';
    $('acSubmit').textContent = t(tab === 'login' ? 'ac_login_btn' : tab === 'register' ? 'ac_register_btn' : 'ac_recover_btn');
    $('acHint').textContent = tab === 'login' ? '' : t('ac_rules');
    setMsg('acMsg', '');
  }
  function showRecovery(code, title) {
    var box = el('div', {}, [el('p', { class: 'muted', text: t('ac_rc_info') }), el('div', { class: 'rc-box', text: code })]);
    modal(title || t('ac_rc_title'), box, [{ label: t('copy'), cls: 'primary', fn: function () { copyText(code); setTimeout(function () { showRecovery(code, title); }, 50); } }, { label: t('ac_rc_saved') }]);
  }
  function submit(e) {
    if (e) e.preventDefault();
    if (Net.avail() !== 'ok') { setMsg('acMsg', t('ac_no_server'), 'err'); return; }
    var u = $('acUser').value.trim(), p = $('acPass').value, p2 = $('acPass2').value;
    if (!validUser(u)) { setMsg('acMsg', t('err_bad_username'), 'err'); return; }
    if (tab !== 'login') { if (!validPw(p)) { setMsg('acMsg', t('err_weak_password'), 'err'); return; } if (p !== p2) { setMsg('acMsg', t('ac_pw_mismatch'), 'err'); return; } }
    else if (!p) { setMsg('acMsg', t('err_bad_credentials'), 'err'); return; }
    var btn = $('acSubmit'); btn.disabled = true; setMsg('acMsg', t('ac_wait'));
    var req;
    if (tab === 'login') req = Net.api('POST', '/api/auth/login', { username: u, password: p });
    else if (tab === 'register') {
      var cc = $('acCountry').value || null, rc = $('acRegion').value || null;
      req = Net.api('POST', '/api/auth/register', { username: u, password: p, country: cc, region: cc ? rc : null });
    } else req = Net.api('POST', '/api/auth/recover', { username: u, recoveryCode: $('acRec').value.trim(), newPassword: p });
    req.then(function (r) {
      btn.disabled = false;
      if (!r.ok) { setMsg('acMsg', r.status === 429 && r.body.error === 'locked' ? t('err_locked') : errText(r.body.error), 'err'); return; }
      $('acPass').value = ''; $('acPass2').value = ''; $('acRec').value = '';
      Net.setSession(r.body.token, r.body.user);
      setMsg('acMsg', '');
      toast(t('ac_welcome', { n: r.body.user.username }), 'ok');
      if (r.body.recoveryCode) showRecovery(r.body.recoveryCode, tab === 'register' ? t('ac_rc_title') : t('ac_rc_new_title'));
      render();
    });
  }
  function fillStats(u) {
    var g = clear($('pfStats'));
    var wr = u.games ? Math.round(1000 * u.wins / u.games) / 10 : 0;
    [['Elo', u.rating], [t('lb_tier'), t('tier_' + u.tier)], [t('ac_peak'), u.peak], [t('lb_games'), u.games], [t('lb_wins'), u.wins], [t('lb_losses'), u.losses], [t('ac_draws'), u.draws], [t('lb_winrate'), wr + '%'], ['K', u.k], [t('ac_casual'), (u.casualWins || 0) + '/' + (u.casualGames || 0)], [t('ac_abandons'), u.abandons || 0]].forEach(function (x) {
      g.appendChild(el('div', {}, [el('span', { text: x[0] }), el('b', { text: String(x[1]) })]));
    });
  }
  function histRow(r) {
    var res = r.result === 'W' ? t('rk_w') : r.result === 'L' ? t('rk_l') : t('rk_d');
    var d = r.delta == null ? '' : (r.delta >= 0 ? '+' : '') + r.delta;
    var when = new Date(r.endedAt), ds = when.toLocaleDateString(LANG === 'bm' ? 'ms-MY' : 'en-GB') + ' ' + (when.getHours() < 10 ? '0' : '') + when.getHours() + ':' + (when.getMinutes() < 10 ? '0' : '') + when.getMinutes();
    return el('div', { class: 'rk-row' }, [
      el('b', { class: r.result === 'L' ? 'err-t' : 'ok-t', text: res, style: 'min-width:62px' }),
      el('span', { class: 'rk-opp', text: (r.opp ? Geo.flag(r.opp.country) + ' ' + r.opp.username + ' (' + (r.opp.rating == null ? '-' : r.opp.rating) + ')' : '-') + ' · ' + t(r.mode === 'killer' ? 'killer' : 'classic') + ' ' + t('d_' + r.difficulty) + ' · ' + (r.ranked ? 'Ranked' : t('casual')) + ' · ' + t('r_' + r.reason) }),
      el('span', { class: 'small mono', text: d }), el('span', { class: 'tiny muted lb-hide', text: ds })
    ]);
  }
  function loadHist(page) {
    if (!U()) return;
    Net.api('GET', '/api/me/matches?page=' + page).then(function (r) {
      var box = clear($('pfHist'));
      if (!r.ok) { box.appendChild(el('div', { class: 'small muted', text: errText(r.body.error) })); return; }
      hist = { page: r.body.page, total: r.body.total };
      if (!r.body.rows.length) box.appendChild(el('div', { class: 'small muted', text: t('rk_nohist') }));
      r.body.rows.forEach(function (x) { box.appendChild(histRow(x)); });
      var pages = Math.max(1, Math.ceil(hist.total / 10));
      $('pfHPage').textContent = t('lb_pageof', { p: hist.page, n: pages });
      $('pfHPrev').disabled = hist.page <= 1; $('pfHNext').disabled = hist.page >= pages;
    });
  }
  function legacy() {
    var L = Store.get('sla.social.v1');
    var n = $('legacyTxt'); if (!n) return;
    if (!L || typeof L !== 'object') { n.textContent = t('ac_legacy_none'); return; }
    var hs = Array.isArray(L.hist) ? L.hist.length : 0;
    n.textContent = t('ac_legacy_txt', { r: L.rating != null ? L.rating : '-', w: L.wins || 0, l: L.losses || 0, g: L.games || 0, h: hs });
  }
  function render() {
    var u = U(), srv = Net.avail();
    $('acOut').classList.toggle('hidden', !!u);
    ['acIn', 'acSec', 'acCloud', 'acHistP'].forEach(function (id) { $(id).classList.toggle('hidden', !u); });
    $('acSrvNote').textContent = srv === 'ok' ? t('ac_srv_ok') : srv === 'checking' ? t('ac_checking') : t('ac_no_server');
    $('acSrvNote').className = 'note' + (srv === 'ok' ? '' : ' warn');
    $('acSubmit').disabled = srv !== 'ok';
    legacy();
    renderSide();
    if (!u) { syncTabs(); return; }
    $('pfAv').textContent = u.username.charAt(0).toUpperCase();
    $('pfName').textContent = u.username; $('pfFlag').textContent = u.country ? Geo.flag(u.country) : '';
    $('pfGeo').textContent = u.country ? Geo.cname(u.country) + (u.region ? ' · ' + Geo.rname(u.country, u.region) : '') : t('ac_nogeo');
    var ws = Net.wsState();
    $('pfStatus').textContent = ws === 'on' ? t('pr_on') : ws === 'replaced' ? t('ac_replaced') : ws === 'connecting' || ws === 'retry' ? t('sn_connecting') : t('pr_off');
    $('pfPid').textContent = u.playerId; $('pfFcode').textContent = u.friendCode || '-';
    fillStats(u);
    Geo.load().then(function () { Geo.fillCountries($('pfCountry'), u.country || '', true); Geo.fillRegions($('pfRegion'), u.country || '', u.region || ''); });
    $('cloudStat').textContent = u.progressAt ? t('ac_cloud_at', { d: new Date(u.progressAt).toLocaleString(LANG === 'bm' ? 'ms-MY' : 'en-GB') }) : t('ac_cloud_none');
  }
  function renderSide() {
    var u = U(), ws = Net.wsState(), on = ws === 'on';
    $('spAv').textContent = u ? u.username.charAt(0).toUpperCase() : '?';
    $('spName').textContent = u ? u.username : t('ac_guest');
    $('spPid').textContent = u ? u.playerId : (Net.avail() === 'ok' ? t('ac_login_btn') : t('ac_offline_mode'));
    $('spElo').textContent = u ? u.rating + ' Elo · ' + t('tier_' + u.tier) : t('ac_local_only');
    $('spSt').classList.toggle('on', !!u && on);
    $('qProfTxt').textContent = u ? u.username + ' · ' + u.rating : (Net.avail() === 'ok' ? t('ac_login_btn') : t('ac_offline_short'));
    $('qProfDot').classList.toggle('on', !!u && on);
  }
  function show() { render(); if (U()) loadHist(1); }
  function changePw() {
    var o = $('pwOld').value, n = $('pwNew').value;
    if (!validPw(n)) { setMsg('secMsg', t('err_weak_password'), 'err'); return; }
    Net.api('POST', '/api/auth/password', { oldPassword: o, newPassword: n }).then(function (r) {
      if (!r.ok) { setMsg('secMsg', errText(r.body.error), 'err'); return; }
      $('pwOld').value = ''; $('pwNew').value = '';
      if (r.body.token) Net.setSession(r.body.token, r.body.user || U());
      setMsg('secMsg', t('ac_pw_changed'), 'ok');
    });
  }
  function newRc() {
    var o = $('pwOld').value;
    if (!o) { setMsg('secMsg', t('ac_need_pw'), 'err'); $('pwOld').focus(); return; }
    Net.api('POST', '/api/auth/recovery-code', { password: o }).then(function (r) {
      if (!r.ok) { setMsg('secMsg', errText(r.body.error), 'err'); return; }
      $('pwOld').value = ''; setMsg('secMsg', ''); showRecovery(r.body.recoveryCode, t('ac_rc_new_title'));
    });
  }
  function logout(all) {
    var go = function () {
      if (window.MP && MP.active()) MP.leave(false);
      Net.api('POST', all ? '/api/auth/logout-all' : '/api/auth/logout').then(function () { Net.dropSession(); render(); toast(t('ac_logged_out')); });
    };
    if (all) confirmBox(t('ac_logout_all_q'), go); else go();
  }
  function cloudUp() {
    var d = Store.get(Store.KEY) || {};
    var payload = { stats: d.stats || APP.stats(), settings: Object.assign({}, d.settings || APP.settings()) };
    delete payload.settings.turn;
    Net.api('PUT', '/api/me/progress', { progress: payload }).then(function (r) {
      if (!r.ok) { toast(errText(r.body.error), 'err'); return; }
      var u = U(); if (u) { u.progressAt = r.body.at; Net.setUser(u); }
      toast(t('ac_cloud_done'), 'ok'); render();
    });
  }
  function cloudDown() {
    Net.api('GET', '/api/me/progress').then(function (r) {
      if (!r.ok) { toast(errText(r.body.error), 'err'); return; }
      if (!r.body.progress) { toast(t('ac_cloud_none'), 'warn'); return; }
      confirmBox(t('ac_cloud_restore_q', { d: new Date(r.body.at).toLocaleString(LANG === 'bm' ? 'ms-MY' : 'en-GB') }), function () {
        var cur = Store.get(Store.KEY) || {};
        Store.set('sla.v2.backup.' + Date.now(), cur);   // local safety copy, never deleted automatically
        var p = r.body.progress, s = Object.assign({}, cur.settings || {}, p.settings || {});
        if (cur.settings && cur.settings.turn) s.turn = cur.settings.turn;
        window.__slaHoldSave = true;
        Store.set(Store.KEY, { version: 2, settings: s, stats: Object.assign(Store.defaultStats(), p.stats || {}), game: cur.game || null });
        toast(t('ac_cloud_restored'), 'ok');
        setTimeout(function () { location.reload(); }, 700);
      });
    });
  }
  function saveGeo() {
    var cc = $('pfCountry').value || null, rc = $('pfRegion').value || null;
    Net.api('PATCH', '/api/me', { country: cc, region: cc ? rc : null }).then(function (r) {
      if (!r.ok) { toast(errText(r.body.error), 'err'); return; }
      Net.setUser(r.body.user); toast(t('ac_saved'), 'ok'); render();
    });
  }
  function init() {
    $('acTabs').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; tab = b.getAttribute('data-v'); syncTabs(); });
    $('acForm').addEventListener('submit', submit);
    ['acUser', 'acPass', 'acPass2', 'acRec', 'pwOld', 'pwNew'].forEach(function (id) { $(id).addEventListener('keydown', function (e) { e.stopPropagation(); }); });
    $('acCountry').onchange = function () { Geo.fillRegions($('acRegion'), this.value, ''); };
    $('pfCountry').onchange = function () { Geo.fillRegions($('pfRegion'), this.value, ''); };
    $('pfGeoSave').onclick = saveGeo;
    $('pfCopyPid').onclick = function () { var u = U(); if (u) copyText(u.playerId); };
    $('pfCopyF').onclick = function () { var u = U(); if (u) copyText(u.friendCode); };
    $('pwSave').onclick = changePw; $('rcNew').onclick = newRc;
    $('acLogout').onclick = function () { logout(false); }; $('acLogoutAll').onclick = function () { logout(true); };
    $('cloudUp').onclick = cloudUp; $('cloudDown').onclick = cloudDown;
    $('pfHPrev').onclick = function () { loadHist(Math.max(1, hist.page - 1)); }; $('pfHNext').onclick = function () { loadHist(hist.page + 1); };
    $('sideProf').onclick = function () { APP.showView('profile'); };
    $('qProf').onclick = function () { APP.showView('profile'); };
    Geo.load().then(function () { Geo.fillCountries($('acCountry'), 'MY', true); Geo.fillRegions($('acRegion'), 'MY', ''); });
    Net.on('user', function () { render(); });
    Net.on('ws', function () { renderSide(); if ($('view-profile').classList.contains('active')) render(); });
    Net.on('status', function () { render(); });
    Net.on('result', function () { if ($('view-profile').classList.contains('active')) setTimeout(function () { loadHist(1); }, 300); });
    syncTabs(); render();
  }
  return { init: init, render: render, show: show, renderSide: renderSide };
})();

/* ===================== 20. LEADERBOARD (server data only) ===================== */
var Board = (function () {
  'use strict';
  var st = { scope: 'global', sort: 'rating', page: 1, q: '', country: '', region: '' }, qT = null, total = 0, size = 20;
  function load() {
    if (Net.avail() !== 'ok') { clear($('lbBody')); $('lbMsg').textContent = Net.avail() === 'checking' ? t('ac_checking') : t('ac_no_server'); $('lbMe').textContent = ''; $('lbPage').textContent = ''; $('lbPrev').disabled = $('lbNext').disabled = true; return; }
    var qs = '?scope=' + st.scope + '&sort=' + st.sort + '&page=' + st.page + '&size=' + size + (st.q ? '&q=' + encodeURIComponent(st.q) : '') + (st.scope !== 'global' && st.country ? '&country=' + st.country : '') + (st.scope === 'region' && st.region ? '&region=' + encodeURIComponent(st.region) : '');
    $('lbMsg').textContent = t('ac_wait');
    Net.api('GET', '/api/leaderboard' + qs).then(function (r) {
      var body = clear($('lbBody'));
      if (!r.ok) { $('lbMsg').textContent = errText(r.body.error); return; }
      var d = r.body; total = d.total;
      if (d.needGeo) { $('lbMsg').textContent = st.scope === 'region' ? t('lb_need_region') : t('lb_need_country'); }
      else $('lbMsg').textContent = d.rows.length ? t('lb_count', { n: d.totalScope }) : (st.q ? t('lb_nores') : t('lb_empty'));
      d.rows.forEach(function (p) {
        var tr = el('tr', { class: (p.me ? 'me' : '') + (p.position <= 3 ? ' top' : '') }, [
          el('td', { class: 'pos', text: String(p.position) }),
          el('td', {}, [el('div', { class: 'lb-pl' }, [el('span', { class: 'pres' + (p.online ? ' on' : ''), title: p.online ? t('pr_on') : t('pr_off') }), el('span', { class: 'flag', title: p.country ? Geo.cname(p.country) : '', text: p.country ? Geo.flag(p.country) : '·' }), el('span', { class: 'nm' }, [el('b', { text: p.username }), el('small', { text: p.playerId })])])]),
          el('td', { class: 'elo', text: String(p.rating) }),
          el('td', { class: 'lb-hide', text: t('tier_' + p.tier) }),
          el('td', { text: String(p.wins) }), el('td', { class: 'lb-hide', text: String(p.losses) }), el('td', { class: 'lb-hide', text: p.winRate + '%' })
        ]);
        body.appendChild(tr);
      });
      var pages = Math.max(1, Math.ceil(total / size));
      $('lbPage').textContent = t('lb_pageof', { p: st.page, n: pages });
      $('lbPrev').disabled = st.page <= 1; $('lbNext').disabled = st.page >= pages;
      var me = d.me, mt = $('lbMe');
      if (!Net.user()) mt.textContent = t('lb_login_pos');
      else if (!me || me.position == null) mt.textContent = me && me.unranked ? t('lb_me_unranked') : me && me.outOfScope ? t('lb_me_out') : '';
      else mt.textContent = t('lb_me', { p: me.position, r: me.rating, w: me.winRate });
    });
  }
  function syncUI() {
    document.querySelectorAll('#lbScope button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === st.scope); });
    $('lbCountryF').classList.toggle('hidden', st.scope === 'global');
    $('lbRegionF').classList.toggle('hidden', st.scope !== 'region');
    $('lbBadge').textContent = Net.avail() === 'ok' ? 'SERVER' : 'OFFLINE'; $('lbBadge').className = 'badge ' + (Net.avail() === 'ok' ? 'ok' : 'warn');
  }
  function show() {
    var u = Net.user();
    if (!st.country && u && u.country) { st.country = u.country; st.region = u.region || ''; }
    Geo.load().then(function () { Geo.fillCountries($('lbCountry'), st.country, true); Geo.fillRegions($('lbRegion'), st.country, st.region); });
    syncUI(); load();
  }
  function init() {
    $('lbScope').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; st.scope = b.getAttribute('data-v'); st.page = 1; syncUI(); load(); });
    $('lbCountry').onchange = function () { st.country = this.value; st.region = ''; Geo.fillRegions($('lbRegion'), st.country, ''); st.page = 1; load(); };
    $('lbRegion').onchange = function () { st.region = this.value; st.page = 1; load(); };
    $('lbSort').onchange = function () { st.sort = this.value; st.page = 1; load(); };
    $('lbQ').addEventListener('input', function () { var v = this.value.trim(); clearTimeout(qT); qT = setTimeout(function () { st.q = v; st.page = 1; load(); }, 350); });
    $('lbQ').addEventListener('keydown', function (e) { e.stopPropagation(); });
    $('lbPrev').onclick = function () { if (st.page > 1) { st.page--; load(); } };
    $('lbNext').onclick = function () { st.page++; load(); };
    Net.on('status', function () { if ($('view-rank').classList.contains('active')) show(); });
  }
  return { init: init, show: show, load: load };
})();

/* ===================== 21. SOCIAL: presence, friends, invites, ranked matchmaking (server-authoritative Elo) ===================== */
var Social = (function () {
  'use strict';
  var fr = { friends: [], incoming: [], outgoing: [] }, online = [], mm = null, mmT = null, olT = null, rkHist = [];
  var KILLER_DIFFS = ['medium', 'hard'], CLASSIC_DIFFS = ['easy', 'medium', 'hard', 'master', 'extreme'];
  function tierName(r) { return t('tier_' + tierKey(r)); }
  function srvOk() { return Net.avail() === 'ok'; }
  function fillDiffs(sel, mode, keep, withPick) {
    var cur = keep ? sel.value : '';
    clear(sel); if (withPick) sel.appendChild(el('option', { value: '', text: t('pick') }));
    (mode === 'killer' ? KILLER_DIFFS : mode === 'classic' ? CLASSIC_DIFFS : []).forEach(function (d) { sel.appendChild(el('option', { value: d, text: t('d_' + d) })); });
    sel.value = cur && Array.prototype.some.call(sel.options, function (o) { return o.value === cur; }) ? cur : (withPick ? '' : sel.options[0] ? sel.options[0].value : '');
  }
  function syncFind() {
    var ok = Net.ready() && !!$('rkMode').value && !!$('rkDiff').value && !mm && !(window.MP && MP.active());
    $('rkFind').disabled = !ok;
  }
  /* ---------- Ranked card ---------- */
  function renderCard() {
    var u = Net.user(), ws = Net.wsState();
    $('rkBadge').textContent = srvOk() ? 'SERVER' : 'OFFLINE'; $('rkBadge').className = 'badge ' + (srvOk() ? 'ok' : 'warn');
    if (u) {
      var tk = u.tier || tierKey(u.rating);
      $('rkRating').textContent = String(u.rating); $('rkTier').textContent = t('tier_' + tk);
      $('rkTierIcon').textContent = TIER_ABBR[tk]; $('rkTierIcon').className = 'rk-tier t-' + tk;
      $('rkRecord').textContent = t('rk_record', { w: u.wins, l: u.losses, g: u.games, p: u.peak, k: u.k }) + (u.draws ? ' · ' + t('ac_draws') + ' ' + u.draws : '');
    } else { $('rkRating').textContent = '—'; $('rkTier').textContent = t('rk_need_login'); $('rkTierIcon').textContent = '?'; $('rkTierIcon').className = 'rk-tier'; $('rkRecord').textContent = ''; }
    var st = !srvOk() ? (Net.avail() === 'checking' ? t('ac_checking') : t('ac_no_server')) : !u ? t('rk_need_login') : ws === 'on' ? t('sn_on2', { n: online.length }) : ws === 'replaced' ? t('ac_replaced') : t('sn_connecting');
    $('snStatus').textContent = st; $('snStatus').style.color = ws === 'on' && u ? 'var(--accent)' : '';
    $('rkLogin').classList.toggle('hidden', !!u || !srvOk());
    $('rkLogin').textContent = ws === 'replaced' && u ? t('ac_reconnect') : t('ac_login_btn');
    if (ws === 'replaced' && u) $('rkLogin').classList.remove('hidden');
    $('rkFind').classList.toggle('hidden', !!mm); $('rkCancel').classList.toggle('hidden', !mm);
    $('rkMode').disabled = !!mm; $('rkDiff').disabled = !!mm || !$('rkMode').value;
    if (mm) $('rkMsg').textContent = t('rk_searching', { s: Math.floor((Date.now() - mm.since) / 1000) + 's', w: mm.window, c: mm.pool, m: t(mm.mode), d: t('d_' + mm.diff) });
    syncFind(); renderHist();
  }
  function renderHist() {
    var box = clear($('rkHist'));
    if (!Net.user()) { box.appendChild(el('div', { class: 'small muted', text: t('rk_need_login') })); return; }
    if (!rkHist.length) { box.appendChild(el('div', { class: 'small muted', text: t('rk_nohist') })); return; }
    rkHist.slice(0, 8).forEach(function (r) {
      var d = r.delta == null ? '' : (r.delta >= 0 ? '+' : '') + r.delta;
      box.appendChild(el('div', { class: 'rk-row' }, [el('b', { class: r.result === 'L' ? 'err-t' : 'ok-t', text: r.result === 'W' ? t('rk_w') : r.result === 'L' ? t('rk_l') : t('rk_d'), style: 'min-width:62px' }),
        el('span', { class: 'rk-opp', text: (r.opp ? r.opp.username + ' (' + r.opp.rating + ')' : '-') + ' · ' + t(r.mode) + ' ' + t('d_' + r.difficulty) + (r.reason === 'left' ? ' · ' + t('rk_abandon') : '') }), el('span', { class: 'small mono', text: d + (r.after != null ? ' → ' + r.after : '') })]));
    });
  }
  function loadHist() { if (!Net.user()) { rkHist = []; renderHist(); return; } Net.api('GET', '/api/me/matches?ranked=1&page=1').then(function (r) { if (r.ok) { rkHist = r.body.rows; renderHist(); } }); }
  /* ---------- Matchmaking ---------- */
  function findMatch() {
    if (!Net.user()) { toast(t('rk_need_login'), 'warn'); APP.showView('profile'); return; }
    if (!Net.ready()) { toast(t('sn_connecting'), 'warn'); return; }
    if (window.MP && MP.active()) { toast(t('rk_busy'), 'warn'); return; }
    var mode = $('rkMode').value, diff = $('rkDiff').value;
    if (!mode || !diff) { toast(t('rk_pick_first'), 'warn'); return; }
    Net.send({ t: 'mm_find', mode: mode, diff: diff });
  }
  function cancel() { Net.send({ t: 'mm_cancel' }); }
  function onMm(m) {
    if (m.searching) { mm = { mode: m.mode, diff: m.diff, window: m.window, pool: m.pool, since: Date.now() - (m.waited || 0) }; clearInterval(mmT); mmT = setInterval(renderCard, 1000); }
    else { mm = null; clearInterval(mmT); $('rkMsg').textContent = ''; }
    renderCard();
  }
  /* ---------- Friends ---------- */
  function fmtCode(s) { s = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return s.length === 8 ? s.slice(0, 4) + '-' + s.slice(4) : null; }
  function addFriend(raw) {
    if (!Net.user()) { toast(t('rk_need_login'), 'warn'); return; }
    var code = fmtCode(raw); if (!code) { toast(t('fr_badid'), 'err'); return; }
    if (Net.user().friendCode === code) { toast(t('fr_self'), 'warn'); return; }
    Net.api('POST', '/api/friends/request', { code: code }).then(function (r) {
      if (!r.ok) { toast(r.status === 409 ? t('fr_already') : r.status === 404 ? t('fr_notfound') : errText(r.body.error), 'err'); return; }
      toast(r.body.friends === true ? t('fr_now', { n: '' }).trim() : t('fr_sent'), 'ok'); reloadFriends();
    });
  }
  function addById(uid) { Net.api('POST', '/api/friends/request', { userId: uid }).then(function (r) { if (!r.ok) { toast(r.status === 409 ? t('fr_already') : errText(r.body.error), 'err'); return; } toast(r.body.friends === true ? t('fr_now', { n: '' }).trim() : t('fr_sent'), 'ok'); reloadFriends(); loadOnline(); }); }
  function respond(uid, accept) { Net.api('POST', '/api/friends/respond', { userId: uid, accept: accept }).then(function (r) { if (r.ok) setFriends(r.body); else toast(errText(r.body.error), 'err'); }); }
  function cancelReq(uid) { Net.api('POST', '/api/friends/cancel', { userId: uid }).then(function (r) { if (r.ok) setFriends(r.body); }); }
  function removeFriend(f) { confirmBox(t('fr_remove_q', { n: f.username }), function () { Net.api('POST', '/api/friends/remove', { userId: f.id }).then(function (r) { if (r.ok) setFriends(r.body); }); }); }
  function reloadFriends() { Net.api('GET', '/api/friends').then(function (r) { if (r.ok) setFriends(r.body); }); }
  function setFriends(d) { if (d && d.friends) fr = { friends: d.friends, incoming: d.incoming || [], outgoing: d.outgoing || [] }; renderFriends(); }
  function statusTxt(s) { return t({ online: 'pr_on', searching: 'pr_mm', playing: 'pr_game', lobby: 'pr_room', offline: 'pr_off' }[s] || 'pr_off'); }
  function invite(f) {
    if (!Net.ready()) { toast(t('sn_connecting'), 'warn'); return; }
    if (window.MP && MP.active()) { toast(t('rk_busy'), 'warn'); return; }
    var mode = $('vsNewMode').value, diff = $('vsNewDiff').value;
    Net.send({ t: 'invite', uid: f.id, mode: mode, diff: diff });
    toast(t('fr_inv_sent', { n: f.username }) + ' (' + t(mode) + ' · ' + t('d_' + diff) + ')', 'ok');
  }
  function renderFriends() {
    var u = Net.user();
    $('frMyId').textContent = u ? u.friendCode : '-';
    $('frAdd').disabled = !u; $('frIdIn').disabled = !u;
    var rq = clear($('frReqs'));
    if (fr.incoming.length) {
      rq.appendChild(el('div', { class: 'small muted', text: t('fr_reqs'), style: 'margin-top:8px' }));
      fr.incoming.forEach(function (p) {
        rq.appendChild(el('div', { class: 'fr-row' }, [el('div', { class: 'fr-who' }, [el('b', { text: Geo.flag(p.country) + ' ' + p.username }), el('span', { class: 'tiny muted', text: p.playerId + ' · ' + p.rating })]),
          el('button', { class: 'btn sm primary', text: t('fr_accept'), onclick: function () { respond(p.id, true); } }), el('button', { class: 'btn sm', text: t('fr_reject'), onclick: function () { respond(p.id, false); } })]));
      });
    }
    if (fr.outgoing.length) {
      fr.outgoing.forEach(function (p) {
        rq.appendChild(el('div', { class: 'fr-row' }, [el('div', { class: 'fr-who' }, [el('b', { text: p.username }), el('span', { class: 'tiny muted', text: t('fr_pending') })]), el('button', { class: 'btn sm', text: t('cancel'), onclick: function () { cancelReq(p.id); } })]));
      });
    }
    var list = clear($('frList'));
    if (!u) { list.appendChild(el('div', { class: 'small muted', text: t('rk_need_login') })); return; }
    if (!fr.friends.length) list.appendChild(el('div', { class: 'small muted', text: t('fr_none') }));
    fr.friends.slice().sort(function (a, b) { return (b.status !== 'offline') - (a.status !== 'offline') || b.rating - a.rating; }).forEach(function (f) {
      var canInv = f.status === 'online' && Net.ready() && !(window.MP && MP.active());
      list.appendChild(el('div', { class: 'fr-row' }, [el('span', { class: 'pres' + (f.status !== 'offline' ? ' on' : '') }),
        el('div', { class: 'fr-who' }, [el('b', { text: Geo.flag(f.country) + ' ' + f.username + ' · ' + f.rating }), el('span', { class: 'tiny muted', text: statusTxt(f.status) + ' · ' + f.playerId })]),
        el('button', { class: 'btn sm primary', text: t('fr_invite'), disabled: canInv ? null : 'disabled', onclick: function () { invite(f); } }),
        el('button', { class: 'btn sm', text: '✕', 'aria-label': t('fr_remove'), title: t('fr_remove'), onclick: function () { removeFriend(f); } })]));
    });
    list.querySelectorAll('button[disabled="disabled"]').forEach(function (b) { b.disabled = true; });
  }
  function onPresence(m) { fr.friends.forEach(function (f) { if (f.id === m.uid) f.status = m.status; }); renderFriends(); }
  /* ---------- Online list ---------- */
  function loadOnline() {
    if (!Net.user() || !srvOk()) { online = []; renderOnline(); return; }
    Net.api('GET', '/api/online').then(function (r) { if (r.ok) { online = r.body.players; renderOnline(); renderCard(); } });
  }
  function renderOnline() {
    var box = clear($('olList')); $('olCount').textContent = String(online.length);
    if (!Net.user()) { box.appendChild(el('div', { class: 'small muted', text: t('rk_need_login') })); return; }
    if (!online.length) { box.appendChild(el('div', { class: 'small muted', text: t('ol_none') })); return; }
    online.forEach(function (p) {
      box.appendChild(el('div', { class: 'fr-row' }, [el('span', { class: 'pres on' }),
        el('div', { class: 'fr-who' }, [el('b', { text: Geo.flag(p.country) + ' ' + p.username + ' · ' + p.rating }), el('span', { class: 'tiny muted', text: statusTxt(p.status) + ' · ' + p.playerId })]),
        p.friend ? el('span', { class: 'badge ok', text: t('fr_is') }) : p.pending ? el('span', { class: 'badge', text: t('fr_pending') }) : el('button', { class: 'btn sm', text: t('fr_add'), onclick: function () { addById(p.id); } })]));
    });
  }
  /* ---------- Invites ---------- */
  var invClose = null;
  function onInvite(m) {
    if (window.MP && MP.active()) { Net.send({ t: 'invite_reply', code: m.code, accept: false }); return; }
    var from = m.from || {};
    invClose = modal(t('fr_inv_title'), t('fr_inv_body2', { n: from.username || '?', r: from.rating, m: t(m.mode), d: t('d_' + m.diff) }), [
      { label: t('fr_inv_ok'), cls: 'primary', fn: function () { APP.showView('versus'); Net.send({ t: 'invite_reply', code: m.code, accept: true }); } },
      { label: t('fr_inv_no'), fn: function () { Net.send({ t: 'invite_reply', code: m.code, accept: false }); } }]);
  }
  function onPhase(ph) {
    var home = ph === 'home';
    $('rkPanel').classList.toggle('hidden', !home);
    $('vsSocial').classList.toggle('hidden', !home);
    if (home) { renderCard(); renderFriends(); }
  }
  function renderAll() {
    fillDiffs($('rkDiff'), $('rkMode').value, true, true);
    renderCard(); renderFriends(); renderOnline();
  }
  function rankedStart() { } function rankedEnd() { return null; }
  function init() {
    $('rkMode').value = ''; fillDiffs($('rkDiff'), '', false, true);
    $('rkMode').onchange = function () { fillDiffs($('rkDiff'), this.value, false, true); renderCard(); };
    $('rkDiff').onchange = renderCard;
    $('rkFind').onclick = findMatch; $('rkCancel').onclick = cancel;
    $('rkLogin').onclick = function () { if (Net.user() && Net.wsState() === 'replaced') Net.reconnectNow(); else APP.showView('profile'); };
    $('frAdd').onclick = function () { addFriend($('frIdIn').value); $('frIdIn').value = ''; };
    $('frIdIn').onkeydown = function (e) { e.stopPropagation(); if (e.key === 'Enter') $('frAdd').click(); };
    $('frCopy').onclick = function () { var u = Net.user(); if (u) copyText(u.friendCode); };
    $('olRefresh').onclick = loadOnline;
    Net.on('mm', onMm);
    Net.on('mm_found', function (m) { mm = null; clearInterval(mmT); $('rkMsg').textContent = t('rk_found', { n: m.opp.username, r: m.opp.rating }); APP.showView('versus'); renderCard(); });
    Net.on('friends', function (m) {
      setFriends(m);
      if (m.kind === 'request' && m.from) toast(t('fr_req_in', { n: m.from.username }));
      if (m.kind === 'accepted' && m.from) toast(t('fr_accepted', { n: m.from.username }), 'ok');
    });
    Net.on('presence', onPresence);
    Net.on('invite', onInvite);
    Net.on('invite_cancel', function () { if (invClose) invClose(); });
    Net.on('invite_expired', function () { if (invClose) invClose(); toast(t('fr_inv_expired'), 'warn'); });
    Net.on('invite_declined', function (m) { toast(t('fr_inv_declined', { n: m.username || t('vs_opp') }), 'warn'); });
    Net.on('result', function (m) { if (m.ranked) setTimeout(loadHist, 300); });
    Net.on('error', function (m) {
      var known = { already_searching: 'err_already_searching', in_room: 'rk_busy', busy: 'rk_busy', rate: 't_ratelimit', not_friend: 'err_not_friend', friend_busy: 'err_friend_busy', friend_offline: 'err_friend_offline', bad_diff: 'rk_pick_first', bad_mode: 'rk_pick_first' };
      if (known[m.code]) toast(t(known[m.code]), 'warn');
    });
    Net.on('user', function (u) { renderCard(); if (!u) { fr = { friends: [], incoming: [], outgoing: [] }; online = []; rkHist = []; mm = null; renderAll(); } });
    Net.on('hello', function () { loadHist(); loadOnline(); reloadFriends(); });
    Net.on('ws', renderCard);
    Net.on('status', renderAll);
    olT = setInterval(function () { if (!document.hidden && $('view-versus').classList.contains('active') && Net.ready() && !(window.MP && MP.active())) loadOnline(); }, 15000);
    renderAll(); onPhase(MP.phase());
  }
  return { init: init, findMatch: findMatch, cancel: cancel, onPhase: onPhase, rankedStart: rankedStart, rankedEnd: rankedEnd, render: renderAll, addFriend: addFriend, invite: invite, tierName: tierName, fillDiffs: fillDiffs, loadOnline: loadOnline,
    _debug: { fr: function () { return fr; }, online: function () { return online; }, mm: function () { return mm; } } };
})();
