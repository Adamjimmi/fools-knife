// Клиент «Нож дурака» для веб-версии: лобби и игра через комнаты платформы (room), хост считает игру у себя.
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const { W, H, GROUND, STUMP_TOP, STUMP_W, FACE_X, BULL_Y, HAND, SUITS, TIERS, ABILITIES, QUALITIES, FLAWS } = KG;

  // ---------- Состояние ----------
  let R = null;              // лобби-комната платформы
  let myPeer = null;
  let lobbyPeers = [];
  let net = null;            // { isHost, hostPeer, room, srvId }
  let eng = null;            // движок (только у хоста или в игре с ботом)
  let room = null;           // публичное состояние для отрисовки
  let roomAt = 0;
  let myId = 'local';
  let logLines = [];
  let anims = [], floaters = [], booms = [];
  let aim = { active: false, angle: -0.6, power: 0 };
  let oppAim = null, lastAimSent = 0, morphing = false;
  let heartbeat = null, joinRetry = null;
  const slotKeys = {};
  const seenThrows = new Set();

  const ITCH = !!window.ND_ITCH;
  // ---------- язык ----------
  let LANG = (() => { try { const v = localStorage.getItem('nd-lang'); if (v === 'ru' || v === 'en') return v; } catch (e) {} return /^(ru|uk|be|kk)/i.test(navigator.language || '') ? 'ru' : 'en'; })();
  const T = (ru, en) => (LANG === 'en' ? en : ru);
  const EN = KG.EN;
  const cardName = (c) => (LANG === 'en' ? (EN.names[c.name] || c.name) : c.name);
  const suitName = (k) => (LANG === 'en' ? EN.suits[k] : KG.SUITS[k].name);
  const tierName = (k) => (LANG === 'en' ? EN.tiers[k][0] : KG.TIERS[k].name);
  const tierRank = (k) => (LANG === 'en' ? EN.tiers[k][1] : KG.TIERS[k].rank);
  const abil = (k) => (LANG === 'en' ? EN.abilities[k] : [KG.ABILITIES[k].name, KG.ABILITIES[k].desc]);
  const qual = (k) => (LANG === 'en' ? EN.qualities[k] : [KG.QUALITIES[k].name, KG.QUALITIES[k].desc]);
  const flaw = (k) => (LANG === 'en' ? EN.flaws[k] : [KG.FLAWS[k].name, KG.FLAWS[k].desc]);
  const reasonText = (r) => (!r ? '' : LANG === 'en' ? (EN.reasons[r.code] || r.reason || '') : (KG.RU_REASONS[r.code] || r.reason || ''));
  const BOT = () => T('Бот Ножовщик', 'Knife Bot');
  const pname = (p) => (p.isBot ? BOT() : p.name);
  const ERRS = { badpw: ['Неверный пароль', 'Wrong password'], full: ['Сервер заполнен', 'Server is full'], playing: ['Игра уже идёт', 'Match already in progress'] };

  function fmtLog(e) {
    if (typeof e === 'string') return e;
    if (!e || typeof e !== 'object') return '';
    const who = e.b ? BOT() : String(e.n || '');
    const card = KG.CARD_BY_ID[e.c];
    const cn = card ? `${cardName(card)} ${KG.SUITS[card.suit].sym}` : T('нож', 'knife');
    switch (e.k) {
      case 'join': return T(`${e.n} зашёл на сервер`, `${e.n} joined the server`);
      case 'bot': return T('Бот Ножовщик сел за стол', 'Knife Bot joined the table');
      case 'leave': return T(`${who} покинул сервер`, `${who} left the server`);
      case 'start': { const s = KG.SUITS[e.suit] || { sym: '' }; return T(`Матч на ${e.size} ножей начался! Козырь — ${s.sym} ${suitName(e.suit)}. В руке до ${e.hand} карт.`, `A ${e.size}-knife match has begun! Trump: ${s.sym} ${suitName(e.suit)}. Hand size up to ${e.hand}.`); }
      case 'timeout': return T(`${who}: время вышло — ${cn} сгорел`, `${who}: time is up — ${cn} is lost`);
      case 'throw': return `${who} · ${cn}: ${reasonText({ code: e.code })}${e.pts ? ' +' + e.pts : ''}${e.steal ? T(` (украл ${e.steal})`, ` (stole ${e.steal})`) : ''}${e.streak > 1 ? T(` · серия ×${e.streak}`, ` · streak ×${e.streak}`) : ''}`;
      case 'end': return T(`Ножи кончились. ${e.w ? `Победил ${e.b ? BOT() : e.w}` : 'Ничья!'} (${e.s1} : ${e.s2})`, `All knives thrown. ${e.w ? `${e.b ? BOT() : e.w} wins` : 'Draw!'} (${e.s1} : ${e.s2})`);
    }
    return '';
  }

  // статичный текст страницы
  const RULES = {
    ru: `<li>Матчи на 20, 30 или 50 ножей. В каждой колоде 4 туза, остальное — хорошие и плохие ножи всех четырёх мастей.</li>
      <li>Нижняя карта колоды открыта — её масть становится <b>козырем</b>. Козырные ножи получают +1 способность, +1 хорошее качество и летят ровнее.</li>
      <li>Каждый раунд оба добирают карты до лимита руки: <b>2</b> в матче на 20, <b>3</b> — на 30, <b>5</b> — на 50.</li>
      <li>Бросаете <b>одновременно</b>. Выбери карту — она станет ножом; зажми мышь на поле, тяни назад и отпусти.</li>
      <li><b>Попал — бросаешь ещё</b>, пока есть карты в руке. Промахнулся — твой раунд окончен. Раунд кончается, когда закончили оба.</li>
      <li><b>Ножи сталкиваются в воздухе.</b> Сбитый нож соперника не приносит ему очков, а ты получаешь половину его очков и бросаешь дальше.</li>
      <li>Нож вращается и втыкается только лезвием. Красная полоса — яблочко (×2), белая — ×1,5, торец — ×1.</li>
      <li>Когда все ножи брошены, побеждает тот, у кого больше очков.</li>`,
    en: `<li>Matches of 20, 30 or 50 knives. Every deck has 4 aces; the rest are good and bad knives of all four suits.</li>
      <li>The bottom card of the deck is face up — its suit is the <b>trump</b>. Trump knives get +1 ability, +1 good quality and fly steadier.</li>
      <li>Each round both players refill their hand: up to <b>2</b> cards in a 20-knife match, <b>3</b> in 30, <b>5</b> in 50.</li>
      <li>You throw <b>at the same time</b>. Pick a card — it turns into a knife; hold the mouse on the field, drag back and release.</li>
      <li><b>Hit — throw again</b> while you have cards. Miss — your round is over. The round ends when both players are done.</li>
      <li><b>Knives collide in mid-air.</b> A knocked-down knife scores nothing for your opponent, and you get half its points and keep throwing.</li>
      <li>Knives spin and stick only blade-first. Red band — bullseye (×2), white band — ×1.5, top of the stump — ×1.</li>
      <li>When every knife has been thrown, the higher score wins.</li>`,
  };
  function setText(sel, ru, en, prop) { document.querySelectorAll(sel).forEach(el => { el[prop || 'textContent'] = T(ru, en); }); }
  function applyStatic() {
    document.documentElement.lang = LANG;
    document.title = T('Нож дурака', "Fool's Knife");
    setText('.logo h1', 'Нож дурака', "Fool's Knife");
    setText('.logo .tag', '20, 30 или 50 ножей · козырь · пни · кто больше настрелял — тот не дурак', "20, 30 or 50 knives · trumps · stumps · whoever scores less is the fool");
    const h2 = document.querySelectorAll('#lobby .panel:first-child h2');
    if (h2[0]) h2[0].textContent = T('Твоё имя', 'Your name');
    if (h2[1]) h2[1].textContent = T('Создать сервер', 'Create a server');
    setText('#lobby .row-between h2', 'Список серверов', 'Server list');
    setText('#lobby .row-between span', 'обновляется сам', 'updates automatically');
    setText('#nick', 'Например, Сеня-Метатель', 'e.g. Knife Master', 'placeholder');
    setText('#room-name', 'Название сервера', 'Server name', 'placeholder');
    setText('#room-pass', 'Пароль (необязательно)', 'Password (optional)', 'placeholder');
    const opts = document.querySelectorAll('#deck-size option');
    [['20', 2], ['30', 3], ['50', 5]].forEach(([n, h], i) => { if (opts[i]) opts[i].textContent = T(`Матч на ${n} ножей · рука ${h}`, `${n}-knife match · hand ${h}`); });
    setText('#btn-create', 'Создать сервер', 'Create server');
    setText('#lobby .or', 'или', 'or');
    setText('#btn-bot', 'Быстрая игра против бота', 'Quick match vs bot');
    const note = document.querySelector('#lobby .note');
    if (note) note.textContent = ITCH ? T('Создай сервер — он сразу появится в списке у всех, кто сейчас открыл игру. Можно поставить пароль, чтобы зашёл только твой друг.', 'Create a server and it shows up instantly for everyone who has the game open. Set a password so only your friend can join.')
      : T('Чтобы играть с другом, поделись этой страницей (кнопка «Поделиться» в claude.ai, роль не ниже «Участник»). Сервер виден в списке у всех, у кого игра открыта прямо сейчас.', 'To play with a friend, share this page (the Share button on claude.ai, role Contributor or higher). Your server is listed for everyone who has the game open right now.');
    setText('.rules summary', 'Правила', 'Rules');
    const ul = document.querySelector('.rules ul'); if (ul) ul.innerHTML = RULES[LANG];
    const th = document.querySelectorAll('.servers thead th');
    [['Сервер', 'Server'], ['Хост', 'Host'], ['Игроки', 'Players'], ['Статус', 'Status']].forEach(([r, e], i) => { if (th[i]) th[i].textContent = T(r, e); });
    setText('#btn-leave', '← Выйти', '← Leave');
    const hs = document.querySelectorAll('.hud-item > span');
    [['Раунд', 'Round'], ['Козырь', 'Trump'], ['В колоде', 'Deck'], ['Твоя серия', 'Your streak'], ['Таймер', 'Timer']].forEach(([r, e], i) => { if (hs[i]) hs[i].textContent = T(r, e); });
    setText('.log-box h3', 'Ход игры', 'Match log');
    setText('#chat-input', 'Сообщение…', 'Message…', 'placeholder');
    const sl = document.querySelectorAll('.slot-label');
    if (sl[0]) sl[0].textContent = T('Твоя рука', 'Your hand');
    if (sl[1]) sl[1].textContent = T('Колода', 'Deck');
    setText('#modal h2', 'Пароль сервера', 'Server password');
    setText('#modal-input', 'Пароль', 'Password', 'placeholder');
    setText('#modal-cancel', 'Отмена', 'Cancel');
    setText('#modal-ok', 'Войти', 'Join');
    document.querySelectorAll('.lang-toggle').forEach(b => { b.innerHTML = `<span class="${LANG === 'ru' ? 'on' : ''}">RU</span><span class="${LANG === 'en' ? 'on' : ''}">EN</span>`; });
  }
  function setLang(l) {
    LANG = l; try { localStorage.setItem('nd-lang', l); } catch (e) {}
    applyStatic();
    serversKey = ''; renderServers();
    Object.keys(slotKeys).forEach(k => delete slotKeys[k]);
    if (room) renderRoom();
    setConn(R ? (R.connected ? R.connected() : true) : false, R ? undefined : connNoText());
  }
  function addLangToggles() {
    const mk = () => { const b = document.createElement('button'); b.className = 'lang-toggle'; b.type = 'button'; b.title = 'Язык / Language'; b.onclick = () => setLang(LANG === 'ru' ? 'en' : 'ru'); return b; };
    document.querySelector('.logo').appendChild(mk());
    const tb = document.querySelector('.topbar'); tb.insertBefore(mk(), tb.querySelector('.hud'));
  }
  const connNoText = () => ITCH ? T('● нет связи с сервером сообщений — можно играть с ботом (перезагрузи страницу, чтобы попробовать снова)', '● cannot reach the message server — you can play the bot (reload the page to retry)') : T('● онлайн недоступен — можно играть с ботом', '● online is unavailable — you can play the bot');
  const nick = () => ($('#nick').value.trim() || T('Игрок', 'Player')).slice(0, 20);
  try { const s = localStorage.getItem('nd-nick'); if (s) $('#nick').value = s; } catch (e) {}
  $('#nick').addEventListener('change', () => { try { localStorage.setItem('nd-nick', nick()); } catch (e) {} if (R) R.presence({ nick: nick() }).catch(() => {}); });

  // ---------- Подключение к платформе ----------
  function setConn(on, text) {
    const c = $('#conn');
    c.textContent = text || (on ? T('● онлайн — мультиплеер доступен', '● online — multiplayer ready') : T('● подключение…', '● connecting…'));
    c.style.color = on ? '#6fcf7c' : '#d2a24a';
  }
  async function initRoom() {
    setConn(false, T('● подключение к мультиплееру…', '● connecting to multiplayer…'));
    try { R = (window.claude && window.claude.use) ? await window.claude.use('room') : null; } catch (e) { R = null; }
    if (!R && window.NDMqtt) { try { R = await window.NDMqtt.connect(); } catch (e) { R = null; } }
    if (!R) { setConn(false, connNoText()); renderServers(); return; }
    R.onPeers((ch) => {
      lobbyPeers = ch.peers;
      const me = ch.peers.find(p => p.sameTab);
      if (me) myPeer = me.peer;
      renderServers();
    }, () => { R = null; setConn(false, connNoText()); renderServers(); });
    R.onConnection((c) => setConn(c));
    R.presence({ nick: nick() }).catch(() => {});
  }

  // ---------- Лобби ----------
  const ST = () => ({ lobby: T('Ожидание', 'Waiting'), playing: T('Идёт игра', 'In progress'), over: T('Завершена', 'Finished') });
  let serversKey = '';
  function renderServers() {
    const tb = $('#server-list');
    const list = lobbyPeers.filter(p => p.presence && p.presence.srv && typeof p.presence.srv === 'object' && p.presence.srv.id);
    const key = (R ? '1' : '0') + JSON.stringify(lobbyPeers.map(p => [p.peer, p.sameTab, p.presence && p.presence.nick, p.presence && p.presence.srv]));
    if (key === serversKey) return;
    serversKey = key;
    tb.innerHTML = '';
    $('#no-servers').style.display = list.length ? 'none' : 'block';
    $('#no-servers').textContent = R ? T('Пока нет ни одного сервера. Создай свой!', 'No servers yet. Create your own!') : ITCH ? T('Не удалось подключиться к онлайну. Проверь интернет и перезагрузи страницу. С ботом можно играть и без сети.', 'Could not connect to online play. Check your connection and reload the page. You can play the bot offline.') : T('Онлайн недоступен: страница открыта по публичной ссылке или без входа в claude.ai. Для игры с другом владелец страницы должен поделиться ею лично (роль «Участник»), а друг — войти в свой аккаунт claude.ai.', 'Online play is unavailable: this page was opened via a public link or without signing in to claude.ai. To play with a friend, the page owner must share it with them directly (Contributor role) and the friend must sign in to claude.ai.');
    const others = lobbyPeers.filter(p => !p.sameTab);
    $('#online').textContent = !R ? '' : others.length ? T(`Сейчас на странице ещё ${others.length}: `, `Also here right now (${others.length}): `) + others.map(p => String((p.presence && p.presence.nick) || T('Игрок', 'Player')).slice(0, 20)).join(', ') : T('Кроме тебя на странице сейчас никого нет', 'Nobody else is here right now');
    for (const p of list) {
      const r = p.presence.srv;
      const host = String(p.presence.nick || T('Игрок', 'Player')).slice(0, 20);
      const mine = p.sameTab;
      const can = !mine && r.players < 2 && r.state !== 'playing';
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.locked ? '🔒 ' : ''}${esc(String(r.name).slice(0, 32))}${mine ? ` <small style="color:var(--muted)">${T('(твой)', '(yours)')}</small>` : ''}<br><small style="color:var(--muted)">🗡 ${[20, 30, 50].includes(+r.size) ? +r.size : 20} ${T('ножей', 'knives')}</small></td><td>${esc(host)}${p.guest ? ' 🌐' : ''}</td><td>${+r.players || 0}/2${r.hasBot ? ' 🤖' : ''}</td>
        <td class="st-${esc(r.state)}">${ST()[r.state] || '—'}${r.state === 'playing' ? ` · ${T('р.', 'r.')}${+r.round || 0}` : ''}</td>
        <td><button class="btn small ${can ? 'gold' : ''}" ${can ? '' : 'disabled'}>${T('Войти', 'Join')}</button></td>`;
      tr.querySelector('button').onclick = () => {
        if (r.locked) askPassword((pw) => joinServer(p.peer, r, pw));
        else joinServer(p.peer, r, '');
      };
      tb.appendChild(tr);
    }
  }

  function askPassword(cb) {
    const m = $('#modal');
    m.classList.remove('hidden');
    $('#modal-input').value = '';
    $('#modal-input').focus();
    $('#modal-ok').onclick = () => { m.classList.add('hidden'); cb($('#modal-input').value); };
    $('#modal-cancel').onclick = () => m.classList.add('hidden');
  }
  $('#modal-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#modal-ok').click(); });

  $('#btn-create').onclick = () => createServer(false);
  $('#btn-bot').onclick = () => createServer(true);
  $('#btn-leave').onclick = () => leave();

  function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id)); }
  const rid = () => Math.random().toString(36).slice(2, 10);

  // ---------- Хост ----------
  async function createServer(withBot) {
    if (net || eng) return;
    const online = !withBot;
    if (online && (!R || !myPeer)) { toast(R ? T('Подключение ещё не готово, попробуй через секунду', 'Still connecting, try again in a second') : T('Мультиплеер недоступен в этом окне. Сыграй с ботом.', 'Multiplayer is unavailable here. Play the bot.')); return; }
    myId = online ? myPeer : 'local';
    const id = rid();
    const name = ($('#room-name').value.trim() || T(`Сервер ${nick()}`, `${nick()}'s server`)).slice(0, 32);
    logLines = [];
    const size = +$('#deck-size').value || 20;
    eng = NDEngine.create({ id, size, name: withBot ? T(`${nick()} против бота`, `${nick()} vs bot`) : name, password: withBot ? '' : $('#room-pass').value.trim().slice(0, 32), hostId: myId }, {
      state: hostPush,
      log: (t) => { addLog(t); if (net) net.room.emit('lg', { t }).catch(() => {}); },
      throwEv: (m) => { onThrow(m); if (net) net.room.emit('th', m).catch(() => {}); },
      aim: (m) => { oppAim = { angle: m.a, power: m.p, at: performance.now() }; if (net) net.room.emit('am', m).catch(() => {}); },
    });
    if (online) {
      let nr;
      try { nr = await R.join('nd-' + id); } catch (e) { toast(T('Не удалось создать сервер', 'Could not create the server') + (e && e.code ? ` (${e.code})` : '') + T(', попробуй ещё раз', ', please try again')); eng.destroy(); eng = null; return; }
      net = { isHost: true, hostPeer: myPeer, room: nr, srvId: id };
      nr.on('jn', (m) => {
        if (m.sameTab) return;
        const d = m.data || {};
        if (!eng.checkPassword(String(d.pw || ''))) return nr.emit('er', { to: m.peer, code: 'badpw', msg: 'Неверный пароль', fatal: true }).catch(() => {});
        const r = eng.addPlayer(m.peer, String(d.nick || 'Player').replace(/[<>]/g, '').slice(0, 20) || 'Player');
        if (!r.ok) nr.emit('er', { to: m.peer, code: r.code, msg: r.msg, fatal: true }).catch(() => {});
        else hostPush();
      });
      nr.on('ac', (m) => {
        if (m.sameTab) return;
        const d = m.data || {};
        if (d.k === 'take') eng.take(m.peer, String(d.c || ''));
        if (d.k === 'throw') eng.doThrow(m.peer, d.a, d.p);
      });
      nr.on('am', (m) => { if (!m.sameTab) oppAim = { angle: +(m.data && m.data.a) || 0, power: +(m.data && m.data.p) || 0, at: performance.now() }; });
      nr.on('ch', (m) => addChat(m.data && m.data.n, m.data && m.data.t));
      nr.onPeers((ch) => { for (const p of ch.left) if (eng && eng.g.players.some(x => x.id === p.peer)) eng.removePlayer(p.peer); });
      heartbeat = setInterval(() => { if (net && eng) net.room.emit('st', eng.pub()).catch(() => {}); }, 2500);
    }
    eng.addPlayer(myId, nick());
    if (withBot) { eng.addBot(); eng.start(); }
    enterRoom();
  }

  function hostPush() {
    if (!eng) return;
    const s = eng.pub();
    applyState(s);
    if (net && net.isHost) {
      net.room.emit('st', s).catch(() => {});
      R.presence({ nick: nick(), srv: eng.summary() }).catch(() => {});
    }
  }

  // ---------- Гость ----------
  async function joinServer(hostPeer, srv, pw) {
    if (net || eng || !R || !myPeer) return;
    myId = myPeer;
    let nr;
    try { nr = await R.join('nd-' + String(srv.id).replace(/[^a-z0-9]/g, '').slice(0, 40)); } catch (e) { toast(T('Не удалось подключиться к серверу', 'Could not connect to the server') + (e && e.code ? ` (${e.code})` : '')); return; }
    net = { isHost: false, hostPeer, room: nr, srvId: srv.id };
    logLines = [];
    nr.on('st', (m) => { if (m.peer === hostPeer) applyState(m.data); });
    nr.on('th', (m) => { if (m.peer === hostPeer) onThrow(m.data); });
    nr.on('lg', (m) => { if (m.peer === hostPeer && m.data) addLog(m.data.t); });
    nr.on('am', (m) => { if (!m.sameTab && m.data) oppAim = { angle: +m.data.a || 0, power: +m.data.p || 0, at: performance.now() }; });
    nr.on('ch', (m) => addChat(m.data && m.data.n, m.data && m.data.t));
    nr.on('er', (m) => {
      if (m.peer !== hostPeer || !m.data || m.data.to !== myPeer) return;
      toast(ERRS[m.data.code] ? T(...ERRS[m.data.code]) : String(m.data.msg || T('Ошибка', 'Error')));
      if (m.data.fatal) leave(true);
    });
    nr.onPeers((ch) => { if (ch.left.some(p => p.peer === hostPeer)) { toast(T('Хост закрыл сервер', 'The host closed the server')); leave(true); } });
    const send = () => nr.emit('jn', { nick: nick(), pw }).catch((e) => {
      if (e && e.code === 'not_permitted') { toast(T('Нет прав на игру: владелец страницы должен дать тебе роль «Участник» (или выше)', 'No permission to play: the page owner must give you the Contributor role (or higher)')); leave(true); }
    });
    send();
    let tries = 0;
    joinRetry = setInterval(() => {
      if (room && room.players.some(p => p.id === myId)) { clearInterval(joinRetry); joinRetry = null; return; }
      if (++tries > 8) { clearInterval(joinRetry); joinRetry = null; toast(T('Сервер не отвечает', 'The server is not responding')); leave(true); return; }
      send();
    }, 1500);
  }

  function leave(silent) {
    if (heartbeat) clearInterval(heartbeat); heartbeat = null;
    if (joinRetry) clearInterval(joinRetry); joinRetry = null;
    if (eng) { eng.destroy(); eng = null; }
    if (net) { net.room.leave().catch(() => {}); net = null; }
    if (R) R.presence({ nick: nick(), srv: null }).catch(() => {});
    room = null; anims = []; floaters = []; booms = []; aim.active = false;
    Object.keys(slotKeys).forEach(k => delete slotKeys[k]);
    show('lobby');
    renderServers();
  }

  // ---------- Действия игрока ----------
  function act(k, data) {
    if (eng) {
      if (k === 'take') eng.take(myId, data && data.c);
      if (k === 'throw') eng.doThrow(myId, data.a, data.p);
      if (k === 'start') eng.start();
      if (k === 'addBot') eng.addBot();
      if (k === 'kickBot') eng.kickBot();
    } else if (net) {
      net.room.emit('ac', Object.assign({ k }, data || {})).catch((e) => { if (e && e.code === 'not_permitted') toast(T('Нет прав на ход: нужна роль «Участник»', 'No permission to move: Contributor role required')); });
    }
  }

  function enterRoom() {
    show('room');
    $('#chat').innerHTML = '';
    $('#chat-form').style.display = net ? '' : 'none';
  }

  // ---------- Состояние ----------
  const cardOf = (id) => id && KG.CARD_BY_ID[id] ? KG.cardWithStats(KG.CARD_BY_ID[id], room ? room.trumpSuit : null) : null;
  function applyState(s) {
    if (!s || !Array.isArray(s.players)) return;
    const prev = room;
    if (prev && prev.ep !== s.ep) anims = [];
    room = s; roomAt = performance.now();
    syncFlights(s);
    if (!prev) enterRoom();
    if (prev && prev.state !== 'playing' && room.state === 'playing') { anims = []; floaters = []; }
    renderRoom();
  }
  function addLog(t) { logLines.push(t); if (logLines.length > 40) logLines.shift(); if (room) renderLog(); }

  // ---------- DOM комнаты ----------
  const me = () => room && room.players.find(p => p.id === myId);
  const opp = () => room && room.players.find(p => p.id !== myId);
  const PCOL = (id) => (id === myId ? '#5fb8ff' : '#ff7a59');

  function renderLog() { $('#log').innerHTML = logLines.slice(-14).map(l => `<div>${esc(fmtLog(l))}</div>`).join(''); $('#log').scrollTop = 1e6; }

  function renderRoom() {
    if (!room) return;
    $('#room-title').textContent = (room.locked ? '🔒 ' : '') + room.name + ` · ${room.size} ${T('ножей', 'knives')}`;
    $('#hud-round').textContent = room.round || '—';
    const ts = room.trumpSuit ? SUITS[room.trumpSuit] : null;
    $('#hud-trump').innerHTML = ts ? `<span class="${ts.red ? 'red' : ''}">${ts.sym}</span>&nbsp;${suitName(room.trumpSuit)}` : '—';
    $('#hud-deck').textContent = room.state === 'lobby' ? room.size : room.deckCount;
    const m = me();
    $('#hud-turn').textContent = m && m.streak ? `×${m.streak}` : '—';
    const STAT = { aim: T('🎯 бросает', '🎯 throwing'), flying: T('🗡 нож летит', '🗡 knife in flight'), done: T('✓ закончил', '✓ done'), wait: '…', idle: '' };
    $('#scores').innerHTML = room.players.map(p => `
      <div class="pl ${p.status === 'aim' || p.status === 'flying' ? 'turn' : ''}">
        <div class="dot" style="background:${PCOL(p.id)}"></div>
        <div class="nm">${esc(pname(p))}${p.id === myId ? T(' (ты)', ' (you)') : ''}${p.isBot ? ' 🤖' : ''}${p.id === room.hostId ? ' 👑' : ''}
          <small>${T('попаданий', 'hits')}: ${+p.hits || 0}${room.state === 'playing' ? ` · ${T('в руке', 'in hand')}: ${p.hand.length}${STAT[p.status] ? ' · ' + STAT[p.status] : ''}${p.streak > 1 ? ` · ${T('серия', 'streak')} ×${p.streak}` : ''}` : ''}</small></div>
        <div class="sc">${+p.score || 0}</div>
      </div>`).join('') + (room.players.length < 2 ? `<div class="pl"><div class="nm" style="color:var(--muted)">${T('Свободное место…', 'Open seat…')}</div></div>` : '');
    renderLog();
    renderSlots();
    renderOverlay();
  }

  function renderOverlay() {
    const ov = $('#overlay');
    const isHost = room.hostId === myId;
    if (room.state === 'lobby') {
      const full = room.players.length === 2;
      const hasBot = room.players.some(p => p.isBot);
      ov.innerHTML = `<h2>${full ? T('Все на месте!', 'Everyone is here!') : T('Ждём соперника…', 'Waiting for an opponent…')}</h2>
        <p>${full ? (isHost ? T('Можно начинать матч.', 'You can start the match.') : T('Ждём, пока хост начнёт матч.', 'Waiting for the host to start.')) : T('Твой сервер виден в списке у всех, кто сейчас открыл эту игру. Не хочешь ждать — позови бота.', 'Your server is listed for everyone who has the game open. Tired of waiting? Add the bot.')}</p>
        <div class="btns">
          ${isHost && !full ? `<button class="btn" data-a="addBot">🤖 ${T('Добавить бота', 'Add bot')}</button>` : ''}
          ${isHost && hasBot ? `<button class="btn" data-a="kickBot">${T('Убрать бота', 'Remove bot')}</button>` : ''}
          ${isHost ? `<button class="btn gold" data-a="start" ${full ? '' : 'disabled'}>${T('Начать матч', 'Start match')}</button>` : ''}
        </div>`;
      ov.classList.remove('hidden');
    } else if (room.state === 'over') {
      const [a, b] = [me(), opp()];
      const iWon = room.winnerId === myId;
      const wp = room.players.find(p => p.id === room.winnerId);
      const why = room.endReason === 'forfeit' ? T('Соперник сбежал — победа засчитана', 'Your opponent left — win by forfeit') : room.endReason === 'win' && wp ? T(`Победил ${pname(wp)}`, `${pname(wp)} wins`) : '';
      ov.innerHTML = `<h2>${room.winnerId == null ? T('Ничья!', 'Draw!') : iWon ? T('Победа! 🏆', 'Victory! 🏆') : T('Ты — дурак 🤡', "You're the fool 🤡")}</h2>
        <p>${esc(why)}</p>
        <div class="final">
          ${a ? `<div class="${room.winnerId === a.id ? 'win' : ''}">${esc(pname(a))}<b>${+a.score || 0}</b></div>` : ''}
          ${b ? `<div class="${room.winnerId === b.id ? 'win' : ''}">${esc(pname(b))}<b>${+b.score || 0}</b></div>` : ''}
        </div>
        <div class="btns">
          ${isHost && room.players.length === 2 ? `<button class="btn gold" data-a="start">${T('Реванш', 'Rematch')}</button>` : ''}
          ${isHost && room.players.length < 2 ? `<button class="btn" data-a="addBot">🤖 ${T('Добавить бота', 'Add bot')}</button>` : ''}
          <button class="btn" data-a="leave">${T('В лобби', 'To lobby')}</button>
        </div>`;
      ov.classList.remove('hidden');
    } else ov.classList.add('hidden');
    ov.querySelectorAll('[data-a]').forEach(b => b.onclick = () => b.dataset.a === 'leave' ? leave() : act(b.dataset.a));
  }

  function renderSlots() {
    const m = me(), o = opp();
    $('#opp-label').textContent = o ? T(`Рука: ${pname(o)}`, `Hand: ${pname(o)}`) : T('Соперник', 'Opponent');
    setSlot('#my-slot', m, true);
    setSlot('#opp-slot', o, false);
    const dk = `${room.state}|${room.deckCount}|${room.trumpCard}|${room.trumpSuit}`;
    if (slotKeys.deck !== dk) {
      slotKeys.deck = dk;
      const el = $('#deck-slot'); el.innerHTML = '';
      const st = document.createElement('div'); st.className = 'deck-stack';
      const tc = cardOf(room.trumpCard);
      if (room.state !== 'lobby' && tc && room.deckCount > 0) { const c = cardEl(tc); c.classList.add('trump-under'); st.appendChild(c); }
      const n = room.state === 'lobby' ? 20 : room.deckCount;
      const backs = n > 1 ? Math.min(4, Math.ceil((n - 1) / 4)) : 0;
      for (let i = 0; i < backs; i++) {
        const b = document.createElement('div'); b.className = 'card-back back'; b.textContent = '🗡';
        b.style.left = (i * 2) + 'px'; b.style.top = (-i * 2) + 'px'; st.appendChild(b);
      }
      const cnt = document.createElement('div'); cnt.className = 'deck-count'; cnt.textContent = n; st.appendChild(cnt);
      if (room.trumpSuit) {
        const s = SUITS[room.trumpSuit];
        const t = document.createElement('div'); t.className = 'trump-big';
        t.innerHTML = `${T('Козырь', 'Trump')}: <b class="${s.red ? 'red' : ''}" style="font-size:18px">${s.sym}</b>`; st.appendChild(t);
      }
      el.appendChild(st);
    }
  }

  function setSlot(sel, p, mine) {
    const el = $(sel);
    const key = !p ? 'none' : `${room.state}|${p.hand.join(',')}|${p.active}|${p.status}|${room.trumpSuit}|${room.phase}`;
    if (slotKeys[sel] === key) return;
    slotKeys[sel] = key;
    el.innerHTML = '';
    if (!p || room.state !== 'playing') {
      el.innerHTML = `<div class="slot-empty">${!p ? T('Нет игрока', 'No player') : T(`Карты появятся, когда начнётся матч (в руке до ${room.handMax})`, `Cards appear when the match starts (hand up to ${room.handMax})`)}</div>`;
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'hand n' + Math.max(1, p.hand.length);
    if (!p.hand.length) { el.innerHTML = `<div class="slot-empty">${p.status === 'flying' ? T('Нож в полёте', 'Knife in flight') : T('Карт нет', 'No cards')}</div>`; return; }
    const canTake = mine && p.status === 'aim' && !p.active;
    for (const id of p.hand) {
      const card = cardOf(id); if (!card) continue;
      if (id === p.active) { wrap.appendChild(knifeTile(card, mine)); continue; }
      if (!mine) { const b = document.createElement('div'); b.className = 'card-back'; b.textContent = '🗡'; wrap.appendChild(b); continue; }
      const c = cardEl(card);
      if (canTake) {
        c.classList.add('clickable', 'pulse');
        c.title = T('Нажми, чтобы взять этот нож', 'Click to take this knife');
        c.onclick = () => {
          if (morphing) return;
          morphing = true; c.classList.add('morph'); sfx('take');
          setTimeout(() => { morphing = false; act('take', { c: id }); }, 450);
        };
      } else if (p.active) c.classList.add('dim');
      wrap.appendChild(c);
    }
    el.appendChild(wrap);
  }

  function knifeTile(card, mine) {
    const k = document.createElement('div');
    k.className = 'knife-hand';
    const cv = document.createElement('canvas'); cv.width = 320; cv.height = 220;
    const cx = cv.getContext('2d'); cx.translate(160, 110); cx.rotate(-0.5); cx.scale(2.6, 2.6);
    KG.drawKnife(cx, card, { trump: card.stats.trump });
    k.appendChild(cv);
    const s = SUITS[card.suit];
    k.insertAdjacentHTML('beforeend', `<div class="kn">${esc(cardName(card))} ${s.sym}</div>
      <div class="kd">${mine ? T('Зажми мышь на поле, тяни назад и отпусти', 'Hold the mouse on the field, drag back and release') : T('В руке у соперника', "In your opponent's hand")}</div>`);
    k.title = [...card.stats.abilities.map(a => '✦ ' + abil(a)[0]), ...card.stats.qualities.map(q => '+ ' + qual(q)[0]), ...card.stats.flaws.map(f => '− ' + flaw(f)[0])].join('\n');
    return k;
  }

  function cardEl(card) {
    const st = card.stats;
    const s = SUITS[card.suit];
    const c = document.createElement('div');
    c.className = `card tier-${card.tier} ${s.red ? 'red-suit' : ''} ${st.trump ? 'trump' : ''}`;
    const items = [];
    st.abilities.forEach((a, i) => items.push(`<li class="ab">✦ ${abil(a)[0]}${st.trump && i === st.abilities.length - 1 ? ' <span class="x">★</span>' : ''} — ${abil(a)[1]}</li>`));
    st.qualities.forEach((q, i) => items.push(`<li class="q">+ ${qual(q)[0]}${st.trump && i === st.qualities.length - 1 ? ' <span class="x">★</span>' : ''} — ${qual(q)[1]}</li>`));
    st.flaws.forEach(f => items.push(`<li class="fl">− ${flaw(f)[0]} — ${flaw(f)[1]}</li>`));
    if (st.trump) items.push(`<li class="ab">★ ${T('Козырь: летит ровнее, меньше ветра', 'Trump: steadier flight, less wind')}</li>`);
    c.innerHTML = `
      <div class="corner"><span>${tierRank(card.tier)}${s.sym}</span>${st.trump ? `<span class="badge">${T('КОЗЫРЬ', 'TRUMP')}</span>` : ''}<span>${s.sym}</span></div>
      <canvas width="312" height="156"></canvas>
      <div class="cname">${esc(cardName(card))}</div>
      <div class="ctier">${tierName(card.tier)} · ${suitName(card.suit)}</div>
      <ul>${items.join('')}</ul>
      <div class="nums"><span>${T('Очки', 'Pts')} ${st.points}</span><span>${T('Разброс', 'Spread')} ${st.spread}°</span><span>${T('Окно', 'Window')} ${st.stick >= 360 ? '360' : '±' + Math.round(st.stick / 2)}°</span></div>`;
    const cv = c.querySelector('canvas'), cx = cv.getContext('2d');
    cx.translate(156, 80); cx.rotate(-0.32); cx.scale(2.3, 2.3);
    KG.drawKnife(cx, card, { trump: st.trump });
    return c;
  }

  // чат
  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#chat-input').value.trim().slice(0, 200);
    if (v && net) net.room.emit('ch', { n: nick(), t: v }).catch(() => {});
    $('#chat-input').value = '';
  });
  function addChat(from, text) {
    if (!text) return;
    const d = document.createElement('div'); d.innerHTML = `<b>${esc(String(from || T('Игрок', 'Player')).slice(0, 20))}:</b> ${esc(String(text).slice(0, 200))}`;
    $('#chat').appendChild(d); $('#chat').scrollTop = 1e6;
  }

  // ---------- Холст ----------
  const cv = $('#cv'), ctx = cv.getContext('2d');
  const view = (owner, x, y, r) => (owner === myId || !room || !room.players.some(p => p.id === myId)) ? { x, y, r } : { x: W - x, y, r: Math.PI - r };
  function toWorld(e) {
    const rc = cv.getBoundingClientRect();
    return { x: (e.clientX - rc.left) * (W / rc.width), y: (e.clientY - rc.top) * (H / rc.height) };
  }

  const myAnim = () => anims.some(a => a.owner === myId);
  const canAim = () => room && room.state === 'playing' && room.phase === 'play' && me() && me().status === 'aim' && me().active && !myAnim();

  cv.addEventListener('pointerdown', (e) => {
    if (!room || room.state !== 'playing') return;
    if (room.phase === 'play' && me() && me().status === 'aim' && !me().active) { toast(T('Сначала выбери карту внизу — она станет ножом', 'First pick a card below — it turns into a knife')); return; }
    if (!canAim()) return;
    const p = toWorld(e);
    aim = { active: true, sx: p.x, sy: p.y, cx: p.x, cy: p.y, csx: e.clientX, csy: e.clientY, angle: aim.angle, power: 0 };
    try { cv.setPointerCapture(e.pointerId); } catch (er) {}
  });
  cv.addEventListener('pointermove', (e) => {
    if (!aim.active) return;
    const p = toWorld(e);
    aim.cx = p.x; aim.cy = p.y;
    const dx = aim.sx - p.x, dy = aim.sy - p.y;
    aim.power = Math.min(1, Math.hypot(dx, dy) / 230);
    let a = Math.atan2(dy, dx);
    if (dx <= 0) a = dy < 0 ? -1.45 : 0.6;
    aim.angle = Math.max(-1.45, Math.min(0.6, a));
    const now = performance.now();
    if (net && now - lastAimSent > 120) { lastAimSent = now; net.room.emit('am', { o: myId, a: aim.angle, p: aim.power }).catch(() => {}); }
  });
  const release = () => {
    if (!aim.active) return;
    aim.active = false;
    if (aim.power >= 0.08 && canAim()) { act('throw', { a: aim.angle, p: aim.power }); sfx('whoosh'); }
  };
  cv.addEventListener('pointerup', release);
  cv.addEventListener('pointercancel', () => { aim.active = false; });

  function onThrow(m) {
    if (!m) return;
    const key = (m.ep || '') + '|' + m.id;
    if (seenThrows.has(key)) return;
    seenThrows.add(key);
    if (m.o === myId) aim.active = false; else oppAim = null;
    const base = KG.CARD_BY_ID[m.c];
    let full = [];
    if (base && m.a != null) full = KG.simulate({ angle: +m.a, power: +m.p, stats: KG.knifeStats(base, m.ts), wind: +m.w || 0, seed: m.s | 0 }).frames;
    const cut = m.cut != null ? +m.cut : null;
    const frames = cut != null && full.length ? KG.knockFrames(full, cut) : full;
    // этот бросок сбил чужой нож — перестраиваем его полёт
    if (m.knock) knockAnim(m.knock.id, +m.knock.at, m.knock.res);
    const el = Math.max(0, +m.el || 0);
    const a = { owner: m.o, full, cut, frames, result: m.res || {}, card: base, trump: base && base.suit === m.ts, throwId: m.id, streak: +m.streak || 0, t0: performance.now() - el, boomAt: cut != null && !(m.res && m.res.knocked) ? cut : -1 };
    if (!frames.length) finishAnim(a);
    else if (el / 1000 * 60 >= frames.length) return;     // уже долетел, пока сообщение шло
    else anims.push(a);
  }
  function knockAnim(id, at, res) {
    const other = anims.find(x => x.throwId === id);
    if (!other || other.cut === at || !other.full.length) return;
    other.cut = at; other.frames = KG.knockFrames(other.full, at);
    other.result = res || { hit: false, reason: 'Сбит в воздухе!', code: 'knocked' }; other.streak = 0;
  }
  // подхватить ножи в полёте из состояния (если сообщение о броске потерялось)
  function syncFlights(s) {
    if (!Array.isArray(s.fl)) return;
    for (const f of s.fl) {
      if (!f || f.id == null) continue;
      const key = (f.ep || '') + '|' + f.id;
      if (!seenThrows.has(key)) onThrow(f);
      else if (f.cut != null) {
        const an = anims.find(x => x.throwId === f.id);
        if (an && an.cut == null) knockAnim(f.id, +f.cut, f.res);
      }
    }
  }

  function finishAnim(a) {
    anims = anims.filter(x => x !== a);
    const last = a.frames[a.frames.length - 1];
    const v = last ? view(a.owner, last.x, last.y, 0) : view(a.owner, HAND.x, HAND.y - 40, 0);
    const res = a.result;
    let text = reasonText(res), color = '#ffffff';
    if (res.knock) {
      text = `+${+res.points || 0} ${text}`; color = '#7fd8ff';
      if (a.streak > 1) floaters.push({ text: T(`Серия ×${a.streak}!`, `Streak ×${a.streak}!`), x: Math.max(120, Math.min(W - 120, v.x)), y: Math.max(90, v.y - 70), t0: performance.now(), color: '#ff9b3d' });
    } else if (res.hit) {
      text = `+${+res.points || 0} ${text}${res.steal ? T(` (украл ${+res.steal})`, ` (stole ${+res.steal})`) : ''}`;
      color = res.zone === 'bull' ? '#ffd77a' : '#9ff0a6'; sfx('thunk');
      if (a.streak > 1) floaters.push({ text: T(`Серия ×${a.streak}!`, `Streak ×${a.streak}!`), x: Math.max(120, Math.min(W - 120, v.x)), y: Math.max(90, v.y - 70), t0: performance.now(), color: '#ff9b3d' });
    } else { color = '#ff9f8f'; sfx('clank'); }
    floaters.push({ text, x: Math.max(120, Math.min(W - 120, v.x)), y: Math.max(60, v.y - 30), t0: performance.now(), color });
  }

  // фон
  const bg = document.createElement('canvas'); bg.width = W; bg.height = H;
  (function drawBg() {
    const g = bg.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, GROUND);
    sky.addColorStop(0, '#f2a65a'); sky.addColorStop(0.55, '#e7c38a'); sky.addColorStop(1, '#c9b48e');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,240,200,.85)'; g.beginPath(); g.arc(500, 180, 60, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#9a7c63';
    g.beginPath(); g.moveTo(0, 360);
    for (let x = 0; x <= W; x += 50) g.lineTo(x, 330 - Math.sin(x * 0.011) * 50 - Math.sin(x * 0.03) * 14);
    g.lineTo(W, GROUND); g.lineTo(0, GROUND); g.fill();
    g.fillStyle = '#5d6b46';
    for (let x = -20; x < W + 40; x += 26) { const h = 60 + ((x * 37) % 45); g.beginPath(); g.moveTo(x, 430); g.lineTo(x + 14, 430 - h); g.lineTo(x + 28, 430); g.fill(); }
    g.fillStyle = '#4c5a39'; g.fillRect(0, 425, W, GROUND - 425);
    const gr = g.createLinearGradient(0, GROUND, 0, H);
    gr.addColorStop(0, '#5f7d3a'); gr.addColorStop(0.12, '#4b3826'); gr.addColorStop(1, '#2c1f14');
    g.fillStyle = gr; g.fillRect(0, GROUND, W, H - GROUND);
    g.strokeStyle = '#7da04a'; g.lineWidth = 2;
    for (let x = 0; x < W; x += 7) { g.beginPath(); g.moveTo(x, GROUND + 2); g.lineTo(x + 2, GROUND - 4 - (x * 13) % 6); g.stroke(); }
    stump(g, FACE_X); stump(g, W - FACE_X - STUMP_W);
  })();
  function stump(g, x) {
    const w = STUMP_W, top = STUMP_TOP;
    const gr = g.createLinearGradient(x, 0, x + w, 0);
    gr.addColorStop(0, '#5a3a20'); gr.addColorStop(0.5, '#7b5130'); gr.addColorStop(1, '#4a2f19');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(x, top); g.lineTo(x + w, top); g.lineTo(x + w + 6, GROUND); g.lineTo(x - 6, GROUND); g.fill();
    g.beginPath(); g.moveTo(x - 6, GROUND); g.quadraticCurveTo(x - 18, GROUND - 4, x - 24, GROUND + 2); g.lineTo(x + 4, GROUND); g.fill();
    g.beginPath(); g.moveTo(x + w + 6, GROUND); g.quadraticCurveTo(x + w + 18, GROUND - 4, x + w + 24, GROUND + 2); g.lineTo(x + w - 4, GROUND); g.fill();
    g.strokeStyle = 'rgba(30,18,8,.45)'; g.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) { const xx = x + 6 + i * 11; g.beginPath(); g.moveTo(xx, top + 6); g.bezierCurveTo(xx + 3, top + 60, xx - 3, top + 120, xx + 1, GROUND - 2); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,.75)'; g.fillRect(x - 1, BULL_Y - 50, w + 2, 100);
    g.fillStyle = 'rgba(122,82,48,.95)'; g.fillRect(x - 1, BULL_Y - 34, w + 2, 68);
    g.fillStyle = 'rgba(255,255,255,.75)'; g.fillRect(x - 1, BULL_Y - 34, w + 2, 2); g.fillRect(x - 1, BULL_Y + 32, w + 2, 2);
    g.fillStyle = '#c8302a'; g.fillRect(x - 1, BULL_Y - 16, w + 2, 32);
    g.fillStyle = '#c9a272'; g.beginPath(); g.ellipse(x + w / 2, top, w / 2, 9, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(110,70,35,.7)'; g.lineWidth = 1;
    for (let r = 4; r < w / 2; r += 6) { g.beginPath(); g.ellipse(x + w / 2, top, r, r * 0.26, 0, 0, Math.PI * 2); g.stroke(); }
  }

  function drawPerson(x, color, name, facing, armAngle, holding, card, isTurn) {
    const g = ctx;
    g.save(); g.translate(x, GROUND);
    g.strokeStyle = '#2a1d13'; g.lineWidth = 7; g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, -80); g.lineTo(-12 * facing, 0); g.moveTo(0, -80); g.lineTo(12 * facing, 0); g.stroke();
    g.strokeStyle = color; g.lineWidth = 16;
    g.beginPath(); g.moveTo(0, -84); g.lineTo(0, -150); g.stroke();
    g.fillStyle = '#f0c9a0'; g.beginPath(); g.arc(0, -170, 15, 0, Math.PI * 2); g.fill();
    g.fillStyle = color; g.beginPath(); g.arc(0, -176, 15, Math.PI, 0); g.fill();
    const sx = 0, sy = -145;
    let ex = (HAND.x - 45) * facing, ey = HAND.y - GROUND;
    if (armAngle != null) { ex = sx - Math.cos(armAngle) * 34 * facing; ey = sy - Math.sin(armAngle) * 34 - 10; }
    g.strokeStyle = '#2a1d13'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.stroke();
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(18 * facing, -105); g.stroke();
    if (holding && card) {
      g.save(); g.translate(ex, ey);
      const ang = armAngle != null ? armAngle : -0.9;
      g.rotate(facing === 1 ? ang : Math.PI - ang);
      g.translate(18, 0);
      KG.drawKnife(g, card, { trump: card.stats && card.stats.trump });
      g.restore();
    }
    g.restore();
    g.font = '15px "Russo One", sans-serif'; g.textAlign = 'center';
    const label = name + (isTurn ? ' ◆' : '');
    const lw = g.measureText(label).width;
    const lx = Math.max(lw / 2 + 8, Math.min(W - lw / 2 - 8, x));
    g.lineWidth = 4; g.strokeStyle = 'rgba(30,18,8,.8)'; g.strokeText(label, lx, GROUND - 205);
    g.fillStyle = isTurn ? '#ffe39a' : '#f6ead8'; g.fillText(label, lx, GROUND - 205);
  }

  function drawWind() {
    if (!room || room.state !== 'playing' || room.phase === 'idle') return;
    const w = +room.wind || 0;
    const g = ctx, cx = 500, cy = 40;
    g.save();
    g.fillStyle = 'rgba(30,20,10,.55)'; g.beginPath(); (g.roundRect ? g.roundRect(cx - 95, cy - 22, 190, 44, 12) : g.rect(cx - 95, cy - 22, 190, 44)); g.fill();
    g.fillStyle = '#fff'; g.font = '12px Rubik, sans-serif'; g.textAlign = 'center';
    g.fillText(T(`Ветер ${Math.abs(w * 10).toFixed(1)} м/с ${w > 0.02 ? '— тебе в спину' : w < -0.02 ? '— тебе в лицо' : ''}`, `Wind ${Math.abs(w * 10).toFixed(1)} m/s ${w > 0.02 ? '— at your back' : w < -0.02 ? '— in your face' : ''}`), cx, cy - 6);
    const len = 70 * Math.abs(w);
    g.strokeStyle = '#bfe6ff'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(cx - len * Math.sign(w), cy + 10); g.lineTo(cx + len * Math.sign(w), cy + 10); g.stroke();
    if (Math.abs(w) > 0.02) {
      const tx = cx + len * Math.sign(w);
      g.beginPath(); g.moveTo(tx, cy + 10); g.lineTo(tx - 8 * Math.sign(w), cy + 4); g.lineTo(tx - 8 * Math.sign(w), cy + 16); g.closePath(); g.fillStyle = '#bfe6ff'; g.fill();
    }
    g.restore();
  }

  function drawPreview() {
    const m = me();
    const card = m && cardOf(m.active);
    if (!aim.active || !card || aim.power < 0.04) return;
    const st = card.stats;
    const { frames, result } = KG.simulate({ angle: aim.angle, power: aim.power, stats: st, wind: +room.wind || 0, noNoise: true });
    const n = Math.max(3, Math.ceil(frames.length * st.preview));
    const full = st.preview >= 1;
    const col = full ? (result.hit ? '120,255,140' : '255,120,110') : '255,255,255';
    for (let i = 0; i < n && i < frames.length; i += 3) {
      const f = frames[i];
      ctx.fillStyle = `rgba(${col},${0.9 - (i / n) * 0.6})`;
      ctx.beginPath(); ctx.arc(f.x, f.y, 2.6, 0, Math.PI * 2); ctx.fill();
    }
    for (let i = 10; i < n && i < frames.length; i += 10) {
      const f = frames[i];
      ctx.save(); ctx.globalAlpha = 0.35; ctx.translate(f.x, f.y); ctx.rotate(f.r); KG.drawKnife(ctx, card); ctx.restore();
    }
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(aim.sx, aim.sy); ctx.lineTo(aim.cx, aim.cy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(20,12,6,.7)'; ctx.fillRect(20, 20, 160, 46);
    ctx.fillStyle = `hsl(${120 - aim.power * 120},80%,55%)`; ctx.fillRect(28, 46, 144 * aim.power, 12);
    ctx.strokeStyle = '#fff'; ctx.strokeRect(28, 46, 144, 12);
    ctx.fillStyle = '#fff'; ctx.font = '12px Rubik, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(T(`Сила ${Math.round(aim.power * 100)}%   Угол ${Math.round(-aim.angle * 180 / Math.PI)}°`, `Power ${Math.round(aim.power * 100)}%   Angle ${Math.round(-aim.angle * 180 / Math.PI)}°`), 28, 38);
    ctx.restore();
  }

  function frame(now) {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bg, 0, 0);
    if (room) {
      const m = me(), o = opp();
      for (const s of room.stuck || []) {
        if (!Array.isArray(s)) continue;
        const [pi, cid, tr, x, y, r, tid] = s;
        if (anims.some(a => a.throwId === tid)) continue;
        const card = KG.CARD_BY_ID[cid]; const owner = room.players[pi];
        if (!card || !owner) continue;
        const v = view(owner.id, +x, +y, +r);
        ctx.save(); ctx.translate(v.x, v.y); ctx.rotate(v.r); KG.drawKnife(ctx, card, { trump: !!tr }); ctx.restore();
      }
      const playing = room.state === 'playing';
      if (m) {
        const holding = playing && m.status === 'aim' && !!m.active;
        drawPerson(45, PCOL(myId), pname(m), 1, aim.active ? aim.angle : null, holding, cardOf(m.active), m.status === 'aim');
      }
      if (o) {
        const holding = playing && o.status === 'aim' && !!o.active;
        const oa = oppAim && o.status === 'aim' && now - oppAim.at < 1500 ? oppAim.angle : null;
        drawPerson(W - 45, PCOL(o.id), pname(o), -1, oa, holding, cardOf(o.active), o.status === 'aim');
        if (oa != null) {
          ctx.fillStyle = 'rgba(20,12,6,.6)'; ctx.fillRect(W - 180, 20, 160, 22);
          ctx.fillStyle = '#ff7a59'; ctx.fillRect(W - 176, 26, 152 * Math.max(0, Math.min(1, oppAim.power)), 10);
        }
      }
      drawWind();
      drawPreview();
      for (const an of [...anims]) {
        const i = Math.floor(((now - an.t0) / 1000) * 60);
        const ci = Math.min(i, an.frames.length - 1);
        const f = an.frames[ci];
        if (f) {
          for (let k = 1; k <= 6; k++) {
            const pf = an.frames[Math.max(0, ci - k * 2)];
            const pv = view(an.owner, pf.x, pf.y, 0);
            ctx.fillStyle = `rgba(255,255,255,${0.25 - k * 0.035})`;
            ctx.beginPath(); ctx.arc(pv.x, pv.y, 4 - k * 0.4, 0, Math.PI * 2); ctx.fill();
          }
          const v = view(an.owner, f.x, f.y, f.r);
          if (an.card) { ctx.save(); ctx.translate(v.x, v.y); ctx.rotate(v.r); KG.drawKnife(ctx, an.card, { trump: an.trump }); ctx.restore(); }
        }
        if (an.boomAt >= 0 && i >= an.boomAt) {
          const bf = an.frames[an.boomAt]; an.boomAt = -1;
          if (bf) { const bv = view(an.owner, bf.x, bf.y, 0); booms.push({ x: bv.x, y: bv.y, t0: now }); floaters.push({ text: T('💥 Дзынь!', '💥 Clang!'), x: bv.x, y: bv.y - 40, t0: now, color: '#ffffff' }); sfx('clank'); }
        }
        if (i >= an.frames.length) finishAnim(an);
      }
      booms = booms.filter(b => now - b.t0 < 450);
      for (const b of booms) {
        const t = (now - b.t0) / 450;
        ctx.save(); ctx.globalAlpha = 1 - t; ctx.strokeStyle = '#fff4b0'; ctx.lineWidth = 3;
        for (let k = 0; k < 10; k++) { const an2 = k * Math.PI / 5; const r1 = 8 + t * 30, r2 = 18 + t * 55; ctx.beginPath(); ctx.moveTo(b.x + Math.cos(an2) * r1, b.y + Math.sin(an2) * r1); ctx.lineTo(b.x + Math.cos(an2) * r2, b.y + Math.sin(an2) * r2); ctx.stroke(); }
        ctx.restore();
      }
      floaters = floaters.filter(fl => now - fl.t0 < 2000);
      for (const fl of floaters) {
        const t = (now - fl.t0) / 2000;
        ctx.save(); ctx.globalAlpha = 1 - t * t;
        ctx.font = '26px "Russo One", sans-serif'; ctx.textAlign = 'center';
        ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(30,15,5,.85)'; ctx.strokeText(fl.text, fl.x, fl.y - t * 50);
        ctx.fillStyle = fl.color; ctx.fillText(fl.text, fl.x, fl.y - t * 50);
        ctx.restore();
      }
      if (playing && m && m.status === 'aim' && m.left) {
        const left = Math.max(0, m.left - (now - roomAt));
        $('#hud-timer').textContent = Math.ceil(left / 1000) + ' c';
        $('#hud-timer').style.color = left < 8000 ? '#ff6b5b' : '';
      } else $('#hud-timer').textContent = '—';
      $('#hint').textContent = hintText();
    }
    requestAnimationFrame(frame);
  }
  function hintText() {
    if (!room || room.state !== 'playing') return '';
    const m = me(), o = opp();
    if (!m) return '';
    if (room.phase === 'draw') return T(`Раунд ${room.round}: добор карт до ${room.handMax}`, `Round ${room.round}: drawing up to ${room.handMax}`);
    if (room.phase === 'end') return T('Раунд окончен', 'Round over');
    if (m.status === 'aim') {
      if (!m.active) return m.streak ? T(`Попал! Серия ×${m.streak} — выбери следующий нож`, `Hit! Streak ×${m.streak} — pick your next knife`) : T('👇 Выбери карту внизу — она превратится в нож', '👇 Pick a card below — it turns into a knife');
      return aim.active ? T('Отпусти, чтобы бросить', 'Release to throw') : T('Зажми мышь на поле и тяни назад-вниз, чтобы прицелиться', 'Hold the mouse on the field and drag back-down to aim');
    }
    if (m.status === 'flying') return '';
    if (m.status === 'done' && o && (o.status === 'aim' || o.status === 'flying')) return T(`Твой раунд окончен. ${pname(o)} ещё бросает…`, `Your round is over. ${pname(o)} is still throwing…`);
    return '';
  }

  // ---------- Звук и утилиты ----------
  let ac;
  function sfx(kind) {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
      o.connect(g); g.connect(ac.destination);
      const P = { whoosh: ['sawtooth', 500, 120, 0.25, 0.06], thunk: ['square', 140, 60, 0.18, 0.18], clank: ['triangle', 900, 400, 0.2, 0.08], take: ['sine', 400, 900, 0.18, 0.07] }[kind];
      o.type = P[0]; o.frequency.setValueAtTime(P[1], t); o.frequency.exponentialRampToValueAtTime(P[2], t + P[3]);
      g.gain.setValueAtTime(P[4], t); g.gain.exponentialRampToValueAtTime(0.001, t + P[3]);
      o.start(t); o.stop(t + P[3] + 0.02);
    } catch (e) {}
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2800); }

  addLangToggles();
  applyStatic();
  renderServers();
  initRoom();
  requestAnimationFrame(frame);
})();
