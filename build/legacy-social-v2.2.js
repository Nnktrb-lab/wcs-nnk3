/* ===================== 15. SOCIAL: presence, friends, ranked matchmaking, local Elo (serverless, public MQTT) ===================== */
var Social = (function () {
  var P = 'sla-academy/v2/', KEY = 'sla.social.v1';
  var BROKERS = [{ name: 'EMQX', url: 'wss://broker.emqx.io:8084/mqtt' }, { name: 'HiveMQ', url: 'wss://broker.hivemq.com:8884/mqtt' }];
  var ID_RE = /^[a-z0-9]{10}$/, CODE_RE = /^[a-z0-9]{6}$/, DIFFS = ['easy', 'medium', 'hard', 'master', 'extreme'];
  var prof = null, cli = null, conn = 'off', broker = '', retryT = null, retryN = 0, beatT = null, mmT = null, uiT = null;
  var online = {}, mm = null, lastBeat = 0, lastPres = '', rate = {}, phase = 'home', invPending = null;

  function now() { return Date.now(); }
  function save() { Store.set(KEY, prof); }
  function clampR(r) { r = Math.round(Number(r)); return isFinite(r) ? Math.max(100, Math.min(3000, r)) : 1200; }
  function nm(n) { return MP.cleanName(n) || '?'; }
  function myName() { return MP.myName(); }
  function fmtId(id) { return id ? (id.slice(0, 5) + '-' + id.slice(5)).toUpperCase() : '-'; }
  function load() {
    var p = Store.get(KEY);
    if (!p || typeof p !== 'object' || !ID_RE.test(p.id)) p = { id: MP.rid(10), rating: 1200, games: 0, wins: 0, losses: 0, peak: 1200, hist: [], friends: {}, inReq: {}, outReq: {}, done: {}, pending: null };
    ['friends', 'inReq', 'outReq', 'done'].forEach(function (k) { if (!p[k] || typeof p[k] !== 'object') p[k] = {}; });
    if (!Array.isArray(p.hist)) p.hist = [];
    p.rating = clampR(p.rating);
    prof = p;
    // Reloaded / closed mid ranked match: provisional loss stays (anti rage-quit).
    if (prof.pending) {
      prof.hist.unshift({ ts: prof.pending.ts, opp: prof.pending.on, or: prof.pending.or, res: 'L', delta: prof.pending.delta, r: prof.rating, ab: 1 });
      prof.done[prof.pending.mid] = 1; prof.pending = null; trim();
    }
    save();
  }
  function trim() {
    prof.hist = prof.hist.slice(0, 20);
    var k = Object.keys(prof.done); if (k.length > 60) k.slice(0, k.length - 60).forEach(function (x) { delete prof.done[x]; });
  }

  /* ---------- Elo ---------- */
  function kf() { return prof.games < 30 ? 40 : (prof.rating >= 2400 ? 10 : 20); }
  function expected(a, b) { return 1 / (1 + Math.pow(10, (b - a) / 400)); }
  function eloDelta(my, opp, score, k) { return Math.round(k * (score - expected(my, opp))); }
  var TIERS = [[2000, 'gm', 'GM'], [1800, 'master', 'M'], [1600, 'diamond', 'D'], [1400, 'platinum', 'P'], [1200, 'gold', 'G'], [1000, 'silver', 'S'], [0, 'bronze', 'B']];
  function tier(r) { for (var i = 0; i < TIERS.length; i++) if (r >= TIERS[i][0]) return { k: TIERS[i][1], ic: TIERS[i][2] }; return { k: 'bronze', ic: 'B' }; }
  function tierName(r) { return t('tier_' + tier(r).k); }
  function diffFor(avg) { return avg < 1100 ? 'easy' : avg < 1300 ? 'medium' : avg < 1500 ? 'hard' : avg < 1750 ? 'master' : 'extreme'; }

  function rankedStart(mid, rk) {
    if (!mid || prof.done[mid] || (prof.pending && prof.pending.mid === mid)) return;
    var k = kf(), d = eloDelta(prof.rating, clampR(rk.oppR), 0, k);
    prof.pending = { mid: mid, ts: now(), or: clampR(rk.oppR), on: nm(rk.oppName), base: prof.rating, k: k, delta: d };
    prof.rating = Math.max(100, prof.rating + d); prof.games++; prof.losses++;
    save(); presence(true); renderAll();
  }
  function rankedEnd(mid, won, rk) {
    if (!mid) return null;
    if (prof.done[mid]) { var h = prof.hist[0]; return h ? { delta: h.delta, rating: prof.rating } : null; }
    var base = prof.rating, k = kf();
    if (prof.pending && prof.pending.mid === mid) { base = prof.pending.base; k = prof.pending.k; prof.games--; prof.losses--; }
    var oppR = clampR(rk.oppR), d = eloDelta(base, oppR, won ? 1 : 0, k);
    prof.rating = Math.max(100, base + d); prof.games++; if (won) prof.wins++; else prof.losses++;
    prof.peak = Math.max(prof.peak || 1200, prof.rating);
    prof.pending = null; prof.done[mid] = 1;
    prof.hist.unshift({ ts: now(), opp: nm(rk.oppName), or: oppR, res: won ? 'W' : 'L', delta: d, r: prof.rating });
    trim(); save(); presence(true); renderAll();
    return { delta: d, rating: prof.rating };
  }

  /* ---------- Connection ---------- */
  function pub(topic, obj, retain) {
    if (!cli) return false;
    obj.v = 2; obj.f = prof.id;
    cli.publish(topic, JSON.stringify(obj), !!retain); return true;
  }
  function clearRetained(topic) { if (cli) cli.publish(topic, '', true); }
  function status() {
    if (MP.active()) { var ph = MP.phase(); return (ph === 'match' || ph === 'countdown' || ph === 'result') ? 'game' : 'room'; }
    return mm ? 'mm' : 'on';
  }
  function presence(force) {
    if (!cli) return;
    var s = status(), key = s + '|' + prof.rating + '|' + myName();
    if (!force && key === lastPres) return;
    lastPres = key;
    pub(P + 'u/' + prof.id + '/p', { n: myName(), r: prof.rating, s: s, ts: now() }, true);
    beat();
  }
  function beat() { lastBeat = now(); pub(P + 'lobby', { t: 'beat', n: myName(), r: prof.rating, s: status() }); }
  function subFriend(id) { if (cli && ID_RE.test(id)) cli.subscribe(P + 'u/' + id + '/p'); }
  function connect() {
    if (cli || conn === 'connecting') return;
    clearTimeout(retryT); conn = 'connecting'; renderAll();
    var will = { topic: P + 'u/' + prof.id + '/p', payload: JSON.stringify({ v: 2, s: 'off', ts: 0 }), retain: true };
    var tryB = function (i) {
      if (!APP.settings().online) { conn = 'off'; renderAll(); return; }
      if (i >= BROKERS.length) { conn = 'err'; renderAll(); scheduleRetry(); return; }
      var c = new MiniMqtt(BROKERS[i].url);
      c.connect('sla_s_' + prof.id + MP.rid(3), will).then(function () {
        if (!APP.settings().online) { c.end(); conn = 'off'; renderAll(); return; }
        cli = c; broker = BROKERS[i].name; conn = 'on'; retryN = 0; lastPres = '';
        c.onmessage = onMsg;
        c.onclose = function () { cli = null; conn = 'err'; online = {}; renderAll(); scheduleRetry(); };
        c.subscribe(P + 'u/' + prof.id + '/in'); c.subscribe(P + 'u/' + prof.id + '/req/+'); c.subscribe(P + 'u/' + prof.id + '/acc/+'); c.subscribe(P + 'lobby');
        if (mm) c.subscribe(P + 'mm');
        Object.keys(prof.friends).forEach(subFriend);
        presence(true); pub(P + 'lobby', { t: 'hi' });
        clearInterval(beatT); beatT = setInterval(function () { presence(true); prune(); renderAll(); }, 15000);
        renderAll();
      }).catch(function () { tryB(i + 1); });
    };
    tryB(0);
  }
  function scheduleRetry() {
    clearTimeout(retryT);
    if (!APP.settings().online) return;
    retryN++; retryT = setTimeout(connect, Math.min(30000, 2000 * Math.pow(2, Math.min(retryN, 4))));
  }
  function disconnect() {
    clearTimeout(retryT); clearInterval(beatT);
    if (cli) { try { cli.publish(P + 'u/' + prof.id + '/p', JSON.stringify({ v: 2, f: prof.id, s: 'off', ts: now() }), true); } catch (e) { } var c = cli; cli = null; setTimeout(function () { c.end(); }, 150); }
    conn = 'off'; online = {}; renderAll();
  }
  function setOnline(on) {
    if (!!APP.settings().online !== !!on) APP.setSetting('online', !!on);
    if (on) connect(); else { mmStop(); disconnect(); }
  }
  function prune() { var n = now(); Object.keys(online).forEach(function (id) { if (n - online[id].seen > 40000) delete online[id]; }); }
  function limited(from, ms) { var n = now(), k = from; if (rate[k] && n - rate[k] < ms) return true; rate[k] = n; return false; }

  /* ---------- Messages ---------- */
  function onMsg(topic, payload) {
    if (typeof payload !== 'string' || payload.length > 2048) return;
    var parts = topic.split('/');
    // friend presence: sla-academy/v2/u/<fid>/p
    if (parts.length === 5 && parts[2] === 'u' && parts[4] === 'p') {
      var fid = parts[3]; if (!prof.friends[fid] || !payload) return;
      var pm; try { pm = JSON.parse(payload); } catch (e) { return; }
      if (!pm || typeof pm !== 'object') return;
      if (pm.f && pm.f !== fid) return;
      var fr = prof.friends[fid];
      fr.s = ['on', 'mm', 'game', 'room', 'off'].indexOf(pm.s) >= 0 ? pm.s : 'off';
      fr.ts = Number(pm.ts) || 0;
      if (pm.n) fr.n = nm(pm.n);
      if (pm.r) fr.r = clampR(pm.r);
      scheduleRender(); return;
    }
    if (!payload) return;
    var m; try { m = JSON.parse(payload); } catch (e) { return; }
    if (!m || typeof m !== 'object' || typeof m.f !== 'string' || !ID_RE.test(m.f) || m.f === prof.id) return;
    var f = m.f, n = now();
    if (topic === P + 'lobby') {
      if (m.t === 'beat') {
        if (!online[f] && Object.keys(online).length >= 60) return;
        online[f] = { n: nm(m.n), r: clampR(m.r), s: ['on', 'mm', 'game', 'room'].indexOf(m.s) >= 0 ? m.s : 'on', seen: n };
        if (prof.friends[f]) { prof.friends[f].s = online[f].s; prof.friends[f].ts = n; prof.friends[f].r = online[f].r; }
        scheduleRender();
      } else if (m.t === 'hi' && n - lastBeat > 3000) setTimeout(beat, Math.random() * 1500);
      return;
    }
    if (topic === P + 'mm') {
      if (!mm) return;
      if (m.t === 'seek') { mm.seek[f] = { n: nm(m.n), r: clampR(m.r), ts: n }; }
      else if (m.t === 'cancel') delete mm.seek[f];
      return;
    }
    var base = P + 'u/' + prof.id + '/';
    if (topic.indexOf(base + 'req/') === 0) {
      if (parts[5] !== f) return; // sender must match topic
      if (prof.friends[f]) { pub(P + 'u/' + f + '/acc/' + prof.id, { n: myName(), r: prof.rating }, true); clearRetained(topic); return; }
      if (prof.outReq[f]) { acceptReq(f, { n: nm(m.n), r: clampR(m.r) }); return; }
      if (n - (Number(m.ts) || 0) > 30 * 864e5) { clearRetained(topic); return; }
      if (!prof.inReq[f] && Object.keys(prof.inReq).length >= 20) return;
      var isNew = !prof.inReq[f];
      prof.inReq[f] = { n: nm(m.n), r: clampR(m.r), ts: Number(m.ts) || n }; save();
      if (isNew) toast(t('fr_req_in', { n: prof.inReq[f].n }));
      renderAll(); return;
    }
    if (topic.indexOf(base + 'acc/') === 0) {
      if (parts[5] !== f) return;
      if (prof.outReq[f] || prof.friends[f]) {
        var isNew2 = !prof.friends[f];
        prof.friends[f] = Object.assign(prof.friends[f] || { since: n }, { n: nm(m.n), r: clampR(m.r) });
        delete prof.outReq[f]; save(); subFriend(f);
        if (isNew2) toast(t('fr_accepted', { n: prof.friends[f].n }), 'ok');
        renderAll();
      }
      clearRetained(topic); return;
    }
    if (topic === base + 'in') onDirect(m, f, n);
  }
  function onDirect(m, f, n) {
    if (limited(f + m.t, 300)) return;
    var name = nm(m.n), r = clampR(m.r);
    if (m.t === 'prop') {
      if (mm && !mm.lock && !MP.active() && Math.abs(r - prof.rating) <= win()) {
        mm.lock = { id: f, role: 'acc', exp: n + 6000, n: name, r: r };
        pub(P + 'u/' + f + '/in', { t: 'acc', n: myName(), r: prof.rating });
      } else pub(P + 'u/' + f + '/in', { t: 'no' });
    } else if (m.t === 'acc') {
      if (!mm || !mm.lock || mm.lock.id !== f || mm.lock.role !== 'prop' || MP.active()) { pub(P + 'u/' + f + '/in', { t: 'no' }); return; }
      var rk = { oppId: f, oppName: name, oppR: r, myR: prof.rating, diff: diffFor((prof.rating + r) / 2) };
      var code = MP.rid(6);
      mmStop(true); setMsg(t('rk_found', { n: name, r: r }));
      APP.showView('versus');
      MP.create({ code: code, meId: prof.id, expect: f, ranked: rk, onReady: function () { pub(P + 'u/' + f + '/in', { t: 'go', code: code, d: rk.diff, n: myName(), r: prof.rating }); }, onFail: function () { setMsg(t('rk_fail')); } });
      setTimeout(function () { var st = MP._debug.state(); if (st && st.code === code && !st.opp) { MP.leave(true); toast(t('rk_fail'), 'warn'); setMsg(t('rk_fail')); } }, 25000);
    } else if (m.t === 'no') {
      if (mm && mm.lock && mm.lock.id === f) { mm.lock = null; mm.skip[f] = n + 15000; }
    } else if (m.t === 'go') {
      if (!mm || !mm.lock || mm.lock.id !== f || mm.lock.role !== 'acc' || MP.active()) return;
      if (typeof m.code !== 'string' || !CODE_RE.test(m.code) || DIFFS.indexOf(m.d) < 0) return;
      var rk2 = { oppId: f, oppName: name, oppR: r, myR: prof.rating, diff: m.d };
      mmStop(true); setMsg(t('rk_found', { n: name, r: r }));
      APP.showView('versus');
      MP.join(m.code, { meId: prof.id, expect: f, ranked: rk2 });
    } else if (m.t === 'inv') {
      if (!prof.friends[f]) return; // only friends may invite
      if (typeof m.code !== 'string' || !CODE_RE.test(m.code)) return;
      if (MP.active() || mm || invPending) { pub(P + 'u/' + f + '/in', { t: 'invno', why: 'busy' }); return; }
      invPending = { f: f, code: m.code, exp: n + 60000 };
      var exp = setTimeout(function () { if (invPending && invPending.code === m.code) { invPending = null; clear($('modalRoot')); } }, 60000);
      modal(t('fr_inv_title'), t('fr_inv_body', { n: prof.friends[f].n || name }), [
        { label: t('fr_inv_ok'), cls: 'primary', fn: function () { clearTimeout(exp); invPending = null; if (MP.active()) return; APP.showView('versus'); MP.join(m.code, { meId: prof.id, expect: f }); } },
        { label: t('fr_inv_no'), fn: function () { clearTimeout(exp); invPending = null; pub(P + 'u/' + f + '/in', { t: 'invno', why: 'no' }); } }
      ]);
    } else if (m.t === 'invno') {
      var st = MP._debug.state();
      if (st && st.expect === f && !st.opp) { toast(t('fr_inv_declined', { n: (prof.friends[f] || {}).n || name }), 'warn'); MP.leave(true); }
    }
  }

  /* ---------- Matchmaking ---------- */
  function win() { return mm ? Math.min(1000, 100 + Math.floor((now() - mm.since) / 1000) * 10) : 100; }
  function findMatch() {
    if (MP.active()) { toast(t('rk_busy'), 'warn'); return; }
    if (mm) return;
    if (!myName()) { toast(t('rk_needname'), 'warn'); var ni = $('vsName'); if (ni) ni.focus(); return; }
    if (!APP.settings().online) setOnline(true);
    mm = { since: now(), seek: {}, lock: null, skip: {} };
    if (cli) cli.subscribe(P + 'mm');
    clearInterval(mmT); mmT = setInterval(mmTick, 2000); mmTick();
    presence(); renderAll();
  }
  function mmTick() {
    if (!mm) return;
    if (!cli) { renderAll(); return; }
    pub(P + 'mm', { t: 'seek', n: myName(), r: prof.rating });
    var n = now(), w = win();
    Object.keys(mm.seek).forEach(function (id) { if (n - mm.seek[id].ts > 7000) delete mm.seek[id]; });
    if (mm.lock && n > mm.lock.exp) { mm.skip[mm.lock.id] = n + 10000; mm.lock = null; }
    if (!mm.lock) {
      var best = null, bd = 1e9;
      Object.keys(mm.seek).forEach(function (id) {
        if (id <= prof.id) return; // only the lower id proposes, avoids crossed proposals
        if (mm.skip[id] && mm.skip[id] > n) return;
        var d = Math.abs(mm.seek[id].r - prof.rating);
        if (d <= w && d < bd) { bd = d; best = id; }
      });
      if (best) { mm.lock = { id: best, role: 'prop', exp: n + 5000, n: mm.seek[best].n, r: mm.seek[best].r }; pub(P + 'u/' + best + '/in', { t: 'prop', n: myName(), r: prof.rating }); }
    }
    renderAll();
  }
  function mmStop(silent) {
    if (!mm) return;
    clearInterval(mmT); mm = null;
    if (cli) pub(P + 'mm', { t: 'cancel' });
    if (!silent) setMsg('');
    presence(); renderAll();
  }

  /* ---------- Friends ---------- */
  function addFriend(raw) {
    var id = String(raw || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (!ID_RE.test(id)) { toast(t('fr_badid'), 'err'); return; }
    if (id === prof.id) { toast(t('fr_self'), 'warn'); return; }
    if (prof.friends[id]) { toast(t('fr_already'), 'warn'); return; }
    if (!cli) { toast(t('fr_need_online'), 'warn'); return; }
    if (prof.inReq[id]) { acceptReq(id); return; }
    if (Object.keys(prof.outReq).length >= 20) { toast(t('fr_too_many'), 'warn'); return; }
    prof.outReq[id] = { ts: now(), n: (online[id] || {}).n || '' }; save();
    pub(P + 'u/' + id + '/req/' + prof.id, { n: myName(), r: prof.rating, ts: now() }, true);
    cli.subscribe(P + 'u/' + id + '/p');
    toast(t('fr_sent'), 'ok'); renderAll();
  }
  function acceptReq(id, info) {
    if (!cli) { toast(t('fr_need_online'), 'warn'); return; }
    var q = info || prof.inReq[id] || {};
    prof.friends[id] = Object.assign(prof.friends[id] || { since: now() }, { n: q.n || '?', r: q.r || 1200 });
    delete prof.inReq[id]; delete prof.outReq[id]; save();
    pub(P + 'u/' + id + '/acc/' + prof.id, { n: myName(), r: prof.rating }, true);
    clearRetained(P + 'u/' + prof.id + '/req/' + id);
    subFriend(id); toast(t('fr_now', { n: prof.friends[id].n }), 'ok'); renderAll();
  }
  function rejectReq(id) {
    delete prof.inReq[id]; save();
    clearRetained(P + 'u/' + prof.id + '/req/' + id); renderAll();
  }
  function removeFriend(id) {
    var f = prof.friends[id]; if (!f) return;
    confirmBox(t('fr_remove_q', { n: f.n || fmtId(id) }), function () { delete prof.friends[id]; save(); renderAll(); });
  }
  function isOn(f) { return f && f.s && f.s !== 'off' && now() - (f.ts || 0) < 150000; }
  function invite(id) {
    var f = prof.friends[id]; if (!f) return;
    if (MP.active() || mm) { toast(t('rk_busy'), 'warn'); return; }
    if (!cli) { toast(t('fr_need_online'), 'warn'); return; }
    var code = MP.rid(6);
    APP.showView('versus');
    MP.create({ code: code, meId: prof.id, expect: id, onReady: function () { pub(P + 'u/' + id + '/in', { t: 'inv', code: code, n: myName(), r: prof.rating }); toast(t('fr_inv_sent', { n: f.n }), 'ok'); } });
    setTimeout(function () { var st = MP._debug.state(); if (st && st.code === code && !st.opp) { MP.leave(true); toast(t('fr_inv_expired'), 'warn'); } }, 65000);
  }

  /* ---------- UI ---------- */
  function dis(b, d) { b.disabled = !!d; return b; }
  function setMsg(s) { var m = $('rkMsg'); if (m) m.textContent = s; }
  function scheduleRender() { if (uiT) return; uiT = setTimeout(function () { uiT = null; renderAll(); }, 250); }
  function stLabel(s) { return t('pr_' + (s || 'off')); }
  function renderAll() {
    if (!prof || !$('rkPanel')) return;
    var tr = tier(prof.rating);
    $('rkRating').textContent = prof.rating;
    $('rkTier').textContent = tierName(prof.rating);
    $('rkTierIcon').textContent = tr.ic; $('rkTierIcon').className = 'rk-tier t-' + tr.k;
    $('rkRecord').textContent = t('rk_record', { w: prof.wins, l: prof.losses, g: prof.games, p: prof.peak || prof.rating, k: kf() });
    $('snOnline').checked = !!APP.settings().online;
    var ss = $('snStatus');
    ss.textContent = conn === 'on' ? t('sn_on', { b: broker, n: Object.keys(online).length }) : conn === 'connecting' ? t('sn_connecting') : conn === 'err' ? t('sn_err') : t('sn_off');
    ss.className = 'tiny ' + (conn === 'on' ? 'ok-t' : conn === 'err' ? 'err-t' : 'muted');
    $('rkFind').classList.toggle('hidden', !!mm); $('rkCancel').classList.toggle('hidden', !mm);
    $('rkFind').disabled = MP.active();
    if (mm) {
      var sec = Math.floor((now() - mm.since) / 1000), others = Object.keys(mm.seek).length;
      setMsg(!cli ? t('sn_connecting') : mm.lock ? t('rk_lock', { n: mm.lock.n, r: mm.lock.r }) : t('rk_searching', { s: fmtTime(sec * 1000), w: win(), c: others }));
    }
    var h = $('rkHist'); clear(h);
    if (!prof.hist.length) h.appendChild(el('div', { class: 'tiny muted', text: t('rk_nohist') }));
    prof.hist.slice(0, 10).forEach(function (x) {
      h.appendChild(el('div', { class: 'rk-row' }, [
        el('span', { class: 'badge ' + (x.res === 'W' ? 'ok' : 'err'), text: x.res === 'W' ? t('rk_w') : t('rk_l') }),
        el('span', { class: 'rk-opp', text: (x.opp || '?') + ' (' + x.or + ')' + (x.ab ? ' · ' + t('rk_abandon') : '') }),
        el('b', { class: x.delta >= 0 ? 'ok-t' : 'err-t', text: (x.delta >= 0 ? '+' : '') + x.delta }),
        el('span', { class: 'tiny muted', text: String(x.r) })
      ]));
    });
    // friends
    $('frMyId').textContent = fmtId(prof.id);
    var rq = $('frReqs'); clear(rq);
    var ins = Object.keys(prof.inReq), outs = Object.keys(prof.outReq);
    if (ins.length) {
      rq.appendChild(el('h3', { text: t('fr_reqs') + ' (' + ins.length + ')' }));
      ins.forEach(function (id) {
        var q = prof.inReq[id];
        rq.appendChild(el('div', { class: 'fr-row' }, [
          el('div', { class: 'fr-who' }, [el('b', { text: q.n }), el('span', { class: 'tiny muted', text: fmtId(id) + ' · ' + q.r })]),
          el('button', { class: 'btn sm primary', text: t('fr_accept'), onclick: function () { acceptReq(id); } }),
          el('button', { class: 'btn sm', text: t('fr_reject'), onclick: function () { rejectReq(id); } })
        ]));
      });
    }
    if (outs.length) rq.appendChild(el('div', { class: 'tiny muted', style: 'margin-top:6px', text: t('fr_out', { n: outs.length }) }));
    var fl = $('frList'); clear(fl);
    var fids = Object.keys(prof.friends);
    if (!fids.length) fl.appendChild(el('div', { class: 'tiny muted', text: t('fr_none') }));
    fids.sort(function (a, b) { return (isOn(prof.friends[b]) ? 1 : 0) - (isOn(prof.friends[a]) ? 1 : 0); }).forEach(function (id) {
      var f = prof.friends[id], on = isOn(f), s = on ? f.s : 'off';
      fl.appendChild(el('div', { class: 'fr-row' }, [
        el('i', { class: 'pres ' + (on ? 'on' : 'off') }),
        el('div', { class: 'fr-who' }, [el('b', { text: f.n || '?' }), el('span', { class: 'tiny muted', text: (f.r || 1200) + ' · ' + stLabel(s) })]),
        dis(el('button', { class: 'btn sm primary', text: t('fr_invite'), onclick: function () { invite(id); } }), !(on && (s === 'on' || s === 'mm') && cli && !MP.active())),
        el('button', { class: 'btn sm icon', 'aria-label': t('fr_remove'), title: t('fr_remove'), text: '×', onclick: function () { removeFriend(id); } })
      ]));
    });
    // online players
    prune();
    var ol = $('olList'); clear(ol);
    var oids = Object.keys(online).sort(function (a, b) { return online[b].r - online[a].r; });
    $('olCount').textContent = oids.length;
    if (!cli) ol.appendChild(el('div', { class: 'tiny muted', text: t('ol_off') }));
    else if (!oids.length) ol.appendChild(el('div', { class: 'tiny muted', text: t('ol_none') }));
    oids.slice(0, 30).forEach(function (id) {
      var o = online[id], fr = !!prof.friends[id], pend = !!prof.outReq[id];
      ol.appendChild(el('div', { class: 'fr-row' }, [
        el('i', { class: 'pres on' }),
        el('div', { class: 'fr-who' }, [el('b', { text: o.n }), el('span', { class: 'tiny muted', text: o.r + ' · ' + tierName(o.r) + ' · ' + stLabel(o.s) })]),
        dis(el('button', { class: 'btn sm', text: fr ? t('fr_is') : pend ? t('fr_pending') : t('fr_add'), onclick: function () { addFriend(id); } }), fr || pend)
      ]));
    });
  }
  function onPhase(ph) {
    if (ph !== phase) { var prev = phase; phase = ph; presence(); if (ph === 'home' && prev !== 'home' && !mm) setMsg(''); }
    var home = ph === 'home';
    var a = $('vsSocial'), b = $('rkPanel');
    if (a) a.classList.toggle('hidden', !home);
    if (b) b.classList.toggle('hidden', !home);
    if (home) scheduleRender();
  }
  function bindTurn() {
    var tu = APP.settings().turn || {};
    $('turnUrl').value = tu.url || ''; $('turnUser').value = tu.user || ''; $('turnPass').value = tu.pass || '';
    var st = function () { var c = APP.settings().turn; $('turnState').textContent = c && c.url ? t('turn_on') : t('turn_none'); };
    $('turnSave').onclick = function () {
      var url = $('turnUrl').value.trim();
      if (url && !/^(turns?|stun):[A-Za-z0-9.\-\[\]:]+(\?transport=(udp|tcp))?$/.test(url)) { toast(t('turn_bad'), 'err'); return; }
      APP.setSetting('turn', url ? { url: url, user: $('turnUser').value.slice(0, 120), pass: $('turnPass').value.slice(0, 200) } : null);
      toast(t('turn_saved'), 'ok'); st();
    };
    $('turnClear').onclick = function () { APP.setSetting('turn', null); $('turnUrl').value = $('turnUser').value = $('turnPass').value = ''; st(); };
    st();
  }
  function init() {
    load();
    $('snOnline').onchange = function () { setOnline(this.checked); };
    $('rkFind').onclick = findMatch;
    $('rkCancel').onclick = function () { mmStop(); };
    $('frAdd').onclick = function () { addFriend($('frIdIn').value); $('frIdIn').value = ''; };
    $('frIdIn').onkeydown = function (e) { if (e.key === 'Enter') $('frAdd').click(); e.stopPropagation(); };
    $('frCopy').onclick = function () {
      var s = fmtId(prof.id);
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(function () { toast(t('fr_copied'), 'ok'); }, function () { toast(s); });
      else toast(s);
    };
    window.addEventListener('beforeunload', function () { if (cli) { try { cli.publish(P + 'u/' + prof.id + '/p', JSON.stringify({ v: 2, f: prof.id, s: 'off', ts: now() }), true); } catch (e) { } } });
    bindTurn();
    if (APP.settings().online) connect();
    renderAll(); onPhase(MP.phase());
  }
  return {
    init: init, findMatch: findMatch, cancel: mmStop, onPhase: onPhase, rankedStart: rankedStart, rankedEnd: rankedEnd, render: renderAll,
    addFriend: addFriend, invite: invite, setOnline: setOnline, tierName: tierName, expected: expected, eloDelta: eloDelta, diffFor: diffFor,
    _debug: { prof: function () { return prof; }, online: function () { return online; }, mm: function () { return mm; }, conn: function () { return conn; } }
  };
})();

