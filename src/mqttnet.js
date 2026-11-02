// Сетевой слой для itch.io: минимальный MQTT 3.1.1 клиент поверх WebSocket + адаптер
// с тем же интерфейсом, что и комнаты claude.ai (presence / onPeers / join / emit / on).
window.NDMqtt = (() => {
  'use strict';
  const BROKERS = [
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://broker.emqx.io:8084/mqtt',
    'wss://test.mosquitto.org:8081/mqtt',
  ];
  const BASE = 'nozh-duraka-game/v1';
  const enc = new TextEncoder(), dec = new TextDecoder();

  // ---------- кодирование пакетов ----------
  function varLen(n) { const out = []; do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; out.push(b); } while (n > 0); return out; }
  function str(s) { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; }
  function bin(b) { return [b.length >> 8, b.length & 255, ...b]; }
  function packet(type, body) { return new Uint8Array([type, ...varLen(body.length), ...body]); }

  function Client(url, clientId, will, onReady, onClose) {
    const ws = new WebSocket(url, ['mqtt']);
    ws.binaryType = 'arraybuffer';
    let buf = new Uint8Array(0), pid = 1, ping = null, ready = false;
    const subs = [];      // [{filter, fn}]
    const self = {
      get ready() { return ready; },
      publish(topic, payload, retain) {
        if (ws.readyState !== 1) return;
        const p = typeof payload === 'string' ? enc.encode(payload) : payload;
        ws.send(packet(0x30 | (retain ? 1 : 0), [...str(topic), ...p]));
      },
      subscribe(filter, fn) {
        subs.push({ filter, fn });
        if (ws.readyState === 1 && ready) sendSub(filter);
      },
      unsubscribe(filter) {
        for (let i = subs.length - 1; i >= 0; i--) if (subs[i].filter === filter) subs.splice(i, 1);
        if (ws.readyState === 1) { const id = pid++ & 0xffff || 1; ws.send(packet(0xA2, [id >> 8, id & 255, ...str(filter)])); }
      },
      close() { try { if (ws.readyState === 1) ws.send(new Uint8Array([0xE0, 0])); ws.close(); } catch (e) {} },
    };
    function sendSub(filter) { const id = pid++ & 0xffff || 1; ws.send(packet(0x82, [id >> 8, id & 255, ...str(filter), 0])); }
    const match = (filter, topic) => {
      const f = filter.split('/'), t = topic.split('/');
      if (f.length !== t.length) return false;
      return f.every((x, i) => x === '+' || x === t[i]);
    };
    ws.onopen = () => {
      // CONNECT: clean session, will (retain), keepalive 30 c
      let flags = 0x02;
      const payload = [...str(clientId)];
      if (will) { flags |= 0x04 | 0x20; payload.push(...str(will.topic), ...bin(enc.encode(will.payload || ''))); }
      ws.send(packet(0x10, [...str('MQTT'), 4, flags, 0, 30, ...payload]));
    };
    ws.onmessage = (e) => {
      const chunk = new Uint8Array(e.data);
      const nb = new Uint8Array(buf.length + chunk.length); nb.set(buf); nb.set(chunk, buf.length); buf = nb;
      for (;;) {
        if (buf.length < 2) return;
        let mult = 1, len = 0, i = 1, b;
        do { if (i >= buf.length) return; b = buf[i++]; len += (b & 127) * mult; mult *= 128; } while (b & 128);
        if (buf.length < i + len) return;
        const type = buf[0] >> 4, flags = buf[0] & 15, body = buf.subarray(i, i + len);
        buf = buf.slice(i + len);
        if (type === 2) {            // CONNACK
          if (body[1] !== 0) { ws.close(); return; }
          ready = true;
          for (const s of subs) sendSub(s.filter);
          ping = setInterval(() => { if (ws.readyState === 1) ws.send(new Uint8Array([0xC0, 0])); }, 20000);
          onReady && onReady();
        } else if (type === 3) {     // PUBLISH
          const tl = (body[0] << 8) | body[1];
          const topic = dec.decode(body.subarray(2, 2 + tl));
          let off = 2 + tl;
          const qos = (flags >> 1) & 3;
          if (qos > 0) off += 2;
          const payload = dec.decode(body.subarray(off));
          for (const s of subs.slice()) if (match(s.filter, topic)) { try { s.fn(topic, payload); } catch (er) { console.error(er); } }
        }
      }
    };
    ws.onclose = () => { ready = false; if (ping) clearInterval(ping); onClose && onClose(); };
    ws.onerror = () => {};
    return self;
  }

  // ---------- адаптер «комнат» ----------
  async function connect() {
    const peer = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
    const lobbyTopic = `${BASE}/l/${peer}`;
    let client = null, brokerIdx = 0, connected = false, myPresence = {};
    const connFns = [], lobbyPeersFns = [];
    const lobby = new Map();              // peer -> {presence, seen}
    const rooms = new Map();              // name -> room internals
    const subsWanted = [];                // [{filter, fn}] для переподключения

    const mkPeer = (id, presence) => Object.freeze({ peer: id, isMe: id === peer, sameTab: id === peer, kind: 'viewer', guest: false, by: null, presence: presence || {}, updatedAt: Date.now() });
    const setConn = (c) => { if (c !== connected) { connected = c; connFns.forEach(f => f(c)); } };

    function lobbySnapshot() {
      const list = [mkPeer(peer, myPresence)];
      for (const [id, v] of lobby) if (id !== peer) list.push(v.p);
      return list;
    }
    function emitLobby(joined = [], left = []) {
      const peers = lobbySnapshot();
      lobbyPeersFns.forEach(f => f({ peers, joined, left, updated: [] }));
    }
    function publishPresence() { if (client && client.ready) client.publish(lobbyTopic, JSON.stringify({ p: myPresence }), true); }

    function subscribe(filter, fn) { subsWanted.push({ filter, fn }); if (client) client.subscribe(filter, fn); }
    function unsubscribe(filter) { for (let i = subsWanted.length - 1; i >= 0; i--) if (subsWanted[i].filter === filter) subsWanted.splice(i, 1); if (client) client.unsubscribe(filter); }

    function onLobbyMsg(topic, payload) {
      const id = topic.split('/').pop();
      if (id === peer) return;
      if (!payload) { const v = lobby.get(id); if (v) { lobby.delete(id); emitLobby([], [v.p]); } return; }
      let d; try { d = JSON.parse(payload); } catch (e) { return; }
      const isNew = !lobby.has(id);
      const p = mkPeer(id, d && typeof d.p === 'object' ? d.p : {});
      lobby.set(id, { p, seen: Date.now() });
      emitLobby(isNew ? [p] : [], []);
    }

    function open() {
      const url = BROKERS[brokerIdx % BROKERS.length];
      let opened = false;
      client = Client(url, 'nd-' + peer, { topic: lobbyTopic, payload: '' }, () => {
        opened = true; setConn(true); publishPresence();
      }, () => {
        setConn(false);
        if (!opened) brokerIdx++;          // брокер недоступен — пробуем следующий
        setTimeout(open, opened ? 1500 : 800);
      });
      for (const s of subsWanted) client.subscribe(s.filter, s.fn);
    }

    subscribe(`${BASE}/l/+`, onLobbyMsg);
    open();
    // обновлять своё присутствие и чистить пропавших
    setInterval(publishPresence, 10000);
    setInterval(() => {
      const now = Date.now(), left = [];
      for (const [id, v] of lobby) if (now - v.seen > 35000) { lobby.delete(id); left.push(v.p); }
      if (left.length) emitLobby([], left);
    }, 5000);
    window.addEventListener('pagehide', () => { try { client.publish(lobbyTopic, '', true); client.close(); } catch (e) {} });

    // ждём первого подключения (до 8 с)
    await new Promise((res) => { const t0 = Date.now(); const iv = setInterval(() => { if (connected || Date.now() - t0 > 8000) { clearInterval(iv); res(); } }, 100); });
    if (!connected) throw new Error('no broker');

    function join(name) {
      if (rooms.has(name)) return Promise.resolve(rooms.get(name).api);
      const evTopic = `${BASE}/r/${name}/ev`, hbTopic = `${BASE}/r/${name}/hb`;
      const handlers = {}, peersFns = [], members = new Map();
      const snapshot = () => [mkPeer(peer, {}), ...[...members.keys()].filter(id => id !== peer).map(id => members.get(id).p)];
      const fire = (joined, left) => { const peers = snapshot(); peersFns.forEach(f => f({ peers, joined, left, updated: [] })); };
      const onEv = (t, payload) => {
        let d; try { d = JSON.parse(payload); } catch (e) { return; }
        if (!d || typeof d.t !== 'string') return;
        const msg = { topic: d.t, data: d.d, peer: d.f, isMe: d.f === peer, sameTab: d.f === peer, kind: 'viewer', guest: false, by: null };
        (handlers[d.t] || []).slice().forEach(h => h(msg));
        touch(d.f);
      };
      const touch = (id) => {
        if (!id || id === peer) return;
        if (!members.has(id)) { const p = mkPeer(id, {}); members.set(id, { p, seen: Date.now() }); fire([p], []); }
        else members.get(id).seen = Date.now();
      };
      const onHb = (t, payload) => {
        let d; try { d = JSON.parse(payload); } catch (e) { return; }
        if (!d || !d.f || d.f === peer) return;
        if (d.bye) { const v = members.get(d.f); if (v) { members.delete(d.f); fire([], [v.p]); } return; }
        touch(d.f);
      };
      subscribe(evTopic, onEv); subscribe(hbTopic, onHb);
      const hb = () => client && client.publish(hbTopic, JSON.stringify({ f: peer }));
      hb();
      const hbIv = setInterval(hb, 2000);
      const pruneIv = setInterval(() => {
        const now = Date.now(), left = [];
        for (const [id, v] of members) if (now - v.seen > 8000) { members.delete(id); left.push(v.p); }
        if (left.length) fire([], left);
      }, 2000);
      const api = Object.freeze({
        name,
        emit: (topic, data) => { if (!connected) return Promise.resolve(); client.publish(evTopic, JSON.stringify({ f: peer, t: topic, d: data })); return Promise.resolve(); },
        on: (topic, fn) => { (handlers[topic] = handlers[topic] || []).push(fn); return () => { handlers[topic] = (handlers[topic] || []).filter(x => x !== fn); }; },
        onPeers: (fn) => { peersFns.push(fn); setTimeout(() => fn({ peers: snapshot(), joined: snapshot(), left: [], updated: [] }), 0); return () => {}; },
        peers: snapshot,
        presence: () => Promise.resolve(),
        connected: () => connected,
        onConnection: (fn) => { connFns.push(fn); setTimeout(() => fn(connected), 0); return () => {}; },
        leave: () => {
          clearInterval(hbIv); clearInterval(pruneIv);
          if (client) client.publish(hbTopic, JSON.stringify({ f: peer, bye: 1 }));
          unsubscribe(evTopic); unsubscribe(hbTopic);
          rooms.delete(name);
          return Promise.resolve();
        },
      });
      rooms.set(name, { api });
      return Promise.resolve(api);
    }

    return Object.freeze({
      presence: (patch) => {
        myPresence = Object.assign({}, myPresence, patch);
        for (const k of Object.keys(myPresence)) if (myPresence[k] === null) delete myPresence[k];
        publishPresence(); emitLobby();
        return Promise.resolve();
      },
      onPeers: (fn) => { lobbyPeersFns.push(fn); setTimeout(() => fn({ peers: lobbySnapshot(), joined: lobbySnapshot(), left: [], updated: [] }), 0); return () => {}; },
      peers: lobbySnapshot,
      onConnection: (fn) => { connFns.push(fn); setTimeout(() => fn(connected), 0); return () => {}; },
      connected: () => connected,
      join,
    });
  }
  return { connect };
})();
