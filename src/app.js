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
  const LVL_NAME = { easy: ['лёгкий', 'easy'], medium: ['средний', 'medium'], hard: ['сложный', 'hard'] };
  const pname = (p) => (p.isBot ? BOT() + (p.lvl && LVL_NAME[p.lvl] ? ` (${T(...LVL_NAME[p.lvl])})` : '') : p.name);
  const X = window.NDX;
  const myLook = () => X.Profile.look();
  const botLevel = () => { const v = ($('#bot-level') || {}).value; return ['easy', 'medium', 'hard'].includes(v) ? v : 'medium'; };
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
    setText('#rotate p', 'Поверни телефон вертикально', 'Please turn your phone upright');
    const bl = document.querySelectorAll('#bot-level option');
    [['Бот: лёгкий', 'Bot: easy'], ['Бот: средний', 'Bot: medium'], ['Бот: сложный', 'Bot: hard']].forEach(([r, e], i) => { if (bl[i]) bl[i].textContent = T(r, e); });
    if (typeof renderProfileCard === 'function' && $('#profile-card')) { renderProfileCard(); paintSnd(); }
    if ($('#settings-modal')) paintExtra();
    if ($('#profile-modal') && !$('#profile-modal').classList.contains('hidden')) renderProfileModal();
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
  $('#nick').addEventListener('change', () => { queueBoardPush(); try { localStorage.setItem('nd-nick', nick()); } catch (e) {} if (R) R.presence({ nick: nick() }).catch(() => {}); });

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
    if (!R) { setConn(false, connNoText()); renderServers(); initBoard(); return; }
    R.onPeers((ch) => {
      lobbyPeers = ch.peers;
      const me = ch.peers.find(p => p.sameTab);
      if (me) myPeer = me.peer;
      renderServers();
    }, () => { R = null; setConn(false, connNoText()); renderServers(); });
    R.onConnection((c) => setConn(c));
    R.presence({ nick: nick() }).catch(() => {});
    initBoard();
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

  function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id)); if (id === 'lobby') X.Audio.setContext('lobby'); }
  const rid = () => Math.random().toString(36).slice(2, 10);

  // ---------- Хост ----------
  async function createServer(withBot, opts) {
    opts = opts || {};
    if (net || eng) return;
    const online = !withBot;
    if (online && (!R || !myPeer)) { toast(R ? T('Подключение ещё не готово, попробуй через секунду', 'Still connecting, try again in a second') : T('Мультиплеер недоступен в этом окне. Сыграй с ботом.', 'Multiplayer is unavailable here. Play the bot.')); return; }
    myId = online ? myPeer : 'local';
    const id = rid();
    const name = ($('#room-name').value.trim() || T(`Сервер ${nick()}`, `${nick()}'s server`)).slice(0, 32);
    logLines = [];
    const size = opts.size || +$('#deck-size').value || 20;
    eng = NDEngine.create({ id, size, arena: myLook().arena, botLevel: opts.level || botLevel(), name: withBot ? T(`${nick()} против бота`, `${nick()} vs bot`) : name, password: withBot ? '' : $('#room-pass').value.trim().slice(0, 32), hostId: myId }, {
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
        const r = eng.addPlayer(m.peer, String(d.nick || 'Player').replace(/[<>]/g, '').slice(0, 20) || 'Player', X.cleanLook(d.look));
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
    eng.addPlayer(myId, nick(), myLook());
    if (withBot) { eng.addBot(opts.level || botLevel()); eng.start(); }
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
    const send = () => nr.emit('jn', { nick: nick(), pw, look: myLook() }).catch((e) => {
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
    practice = null; showCoach(null);
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
      if (k === 'addBot') eng.addBot(botLevel());
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
    X.Audio.setContext('game', ['sunset', 'night', 'winter', 'desert'].includes(s.arena) ? s.arena : 'sunset');
    syncFlights(s);
    if (!prev) enterRoom();
    if (prev && prev.state !== 'playing' && room.state === 'playing') { anims = []; floaters = []; reward = null; matchStartXp = X.Profile.data.xp; }
    if (!prev && room.state === 'playing') matchStartXp = X.Profile.data.xp;
    if (prev && prev.state === 'playing' && room.state === 'over') onMatchOver();
    if (prev && room.state === 'playing' && room.phase === 'draw' && prev.phase !== 'draw') for (let i = 0; i < 3; i++) setTimeout(() => sfx('deal'), i * 90);
    renderRoom();
  }
  let reward = null;
  const doneMatches = new Set();
  function onMatchOver() {
    const m = me(), o = opp();
    if (!m || doneMatches.has(room.ep)) return;
    doneMatches.add(room.ep);
    const result = room.winnerId == null ? 'draw' : room.winnerId === myId ? 'win' : 'loss';
    const xpBefore = matchStartXp == null ? X.Profile.data.xp : matchStartXp, before = X.levelOf(xpBefore);
    const oppKind = o && o.isBot ? (o.lvl || 'medium') : 'human';
    X.Profile.onMatch(result, oppKind, room.size || 20, m.score);
    reward = { result, xp: X.Profile.data.xp - xpBefore, before, after: X.Profile.level, capped: oppKind !== 'human' && X.Profile.botCapped };
    matchXp = 0;
    sfx(result === 'win' ? 'win' : result === 'loss' ? 'lose' : 'achieve');
    if (result === 'win') X.burst('confetti', 0, 0, 140);
    renderOverlay();
  }
  let matchXp = 0, matchStartXp = null;
  X.Profile.on((ev) => {
    if (ev.type === 'level') { sfx('levelup'); toast(T(`Новый уровень: ${ev.level}!`, `Level up: ${ev.level}!`) + (ev.items.length ? T(' Открыто: ', ' Unlocked: ') + ev.items.map(itemName).join(', ') : '')); }
    if (ev.type === 'ach') { const a = X.ACH.find(x => x[0] === ev.id); if (a) { sfx('achieve'); toast('🏅 ' + T(a[1], a[2]) + (ev.items.length ? ' · ' + ev.items.map(itemName).join(', ') : '')); } }
    renderProfileCard();
    if (ev.type === 'xp' || ev.type === 'level') queueBoardPush();
  });
  function itemName(key) { const [slot, id] = key.split(':'); const it = X.ITEMS[slot].find(x => x[0] === id); return it ? T(it[2], it[3]) : id; }

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
        ${reward ? `<div class="reward">+${reward.xp} XP · ${T('уровень', 'level')} ${reward.after}${reward.after > reward.before ? ' ⬆' : ''}
          <div class="xpbar"><i style="width:${Math.round(X.Profile.progress().pct * 100)}%"></i></div>
          ${reward.capped ? `<div class="cap-note">${T(`🤖 С ботами опыт даётся только до ${X.Profile.BOT_XP_CAP} уровня. Дальше качайся в матчах с живыми игроками!`, `🤖 Bots only give XP up to level ${X.Profile.BOT_XP_CAP}. Play against real people to keep levelling up!`)}</div>` : ''}</div>` : ''}
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
      <div class="kd">${mine ? (DEV.touch ? T('Коснись поля, тяни палец назад и отпусти', 'Touch the field, drag back and release') : T('Зажми мышь на поле, тяни назад и отпусти', 'Hold the mouse on the field, drag back and release')) : T('В руке у соперника', "In your opponent's hand")}</div>`);
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
    if (aim.power >= 0.08 && canAim()) { act('throw', { a: aim.angle, p: aim.power }); }
  };
  cv.addEventListener('pointerup', release);
  cv.addEventListener('pointercancel', () => { aim.active = false; });

  function onThrow(m) {
    if (!m) return;
    const key = (m.ep || '') + '|' + m.id;
    if (seenThrows.has(key)) return;
    seenThrows.add(key);
    if (m.o === myId) aim.active = false; else oppAim = null;
    swingAt[m.o] = performance.now();
    if (m.a != null) sfx('whoosh');
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
  const swingAt = {};
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
    const dir = a.owner === myId || !room || !room.players.some(p => p.id === myId) ? 1 : -1;
    if (res.hit) { X.burst('chips', v.x, v.y, res.zone === 'bull' ? 16 : 9, dir); X.shake(res.zone === 'bull' ? 7 : 3); if (a.streak > 1) setTimeout(() => sfx('streak', a.streak), 120); }
    else if (res.code === 'bounce_face' || res.code === 'bounce_top') X.burst('sparks', v.x, v.y, 8);
    else if (res.code === 'ground' || res.code === 'knocked') { X.burst('dirt', v.x, v.y, 10); sfx('dirt'); }
    if (a.owner === myId && DEV.phone && vibrateOn()) { try { navigator.vibrate(res.knock ? [30, 40, 40] : res.zone === 'bull' ? 60 : res.hit ? 25 : 0); } catch (e) {} }
    if (a.owner === myId && res.code !== 'knocked') {
      const xp = X.Profile.onThrow(res, a.streak, !!(room && room.players.some(p => p.isBot)));
      coachAfterThrow();
      matchXp += 0;   // опыт уже начислен, итог считается по разнице
      if (xp > 1) floaters.push({ text: `+${xp} XP`, x: Math.max(120, Math.min(W - 120, v.x)), y: Math.max(110, v.y + 30), t0: performance.now(), color: '#c9b6ff', small: true });
    }
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
  const bgCache = {};
  function getBg(arena) {
    const id = ['sunset', 'night', 'winter', 'desert'].includes(arena) ? arena : 'sunset';
    if (bgCache[id]) return bgCache[id];
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    X.drawArena(g, id, W, H, GROUND);
    stump(g, FACE_X, id); stump(g, W - FACE_X - STUMP_W, id);
    return (bgCache[id] = c);
  }
  const bg = document.createElement('canvas'); bg.width = W; bg.height = H;
  (function drawBgOld() { return;
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
  function stump(g, x, arena) {
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
    if (arena === 'winter') { g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(x + w / 2, top - 3, w / 2 + 3, 10, 0, Math.PI, 0); g.fill(); g.fillRect(x - 3, top - 3, w + 6, 6); }
  }

  function drawPerson(x, color, name, facing, armAngle, holding, card, isTurn, look, swing, now) {
    const g = ctx;
    X.drawCharacter(g, { x, ground: GROUND, facing, color, look, arm: armAngle, swing, holdCard: holding ? card : null, now });
    g.save(); g.translate(-10000, GROUND);
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

  let lastTick = 0;
  function frame(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const [sx, sy] = X.shakeOffset(now);
    ctx.setTransform(1, 0, 0, 1, sx, sy);
    const arena = room && room.arena ? room.arena : myLook().arena;
    ctx.drawImage(getBg(arena), -8, -8, W + 16, H + 16);
    X.drawWeather(ctx, arena, now, W, H, GROUND);
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
        drawPerson(45, PCOL(myId), pname(m), 1, aim.active ? aim.angle : null, holding, cardOf(m.active), m.status === 'aim', m.look || myLook(), swingAt[myId] ? (now - swingAt[myId]) / 260 : null, now);
      }
      if (o) {
        const holding = playing && o.status === 'aim' && !!o.active;
        const oa = oppAim && o.status === 'aim' && now - oppAim.at < 1500 ? oppAim.angle : null;
        drawPerson(W - 45, PCOL(o.id), pname(o), -1, oa, holding, cardOf(o.active), o.status === 'aim', o.look, swingAt[o.id] ? (now - swingAt[o.id]) / 260 : null, now);
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
          const owner = room.players.find(p => p.id === an.owner);
          const skin = X.cleanLook(owner && owner.look).trail;
          const pts = [];
          for (let k = 1; k <= 7; k++) { const pf = an.frames[Math.max(0, ci - k * 2)]; pts.push(view(an.owner, pf.x, pf.y, 0)); }
          X.drawTrail(ctx, skin, pts, now);
          const v = view(an.owner, f.x, f.y, f.r);
          if (an.card) { ctx.save(); ctx.translate(v.x, v.y); ctx.rotate(v.r); KG.drawKnife(ctx, an.card, { trump: an.trump }); ctx.restore(); }
        }
        if (an.boomAt >= 0 && i >= an.boomAt) {
          const bf = an.frames[an.boomAt]; an.boomAt = -1;
          if (bf) { const bv = view(an.owner, bf.x, bf.y, 0); booms.push({ x: bv.x, y: bv.y, t0: now }); floaters.push({ text: T('💥 Дзынь!', '💥 Clang!'), x: bv.x, y: bv.y - 40, t0: now, color: '#ffffff' }); sfx('clang'); X.burst('sparks', bv.x, bv.y, 22); X.shake(9); }
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
      X.drawParts(ctx);
      floaters = floaters.filter(fl => now - fl.t0 < 2000);
      for (const fl of floaters) {
        const t = (now - fl.t0) / 2000;
        const pop = Math.min(1, (now - fl.t0) / 140);
        ctx.save(); ctx.globalAlpha = 1 - t * t;
        ctx.translate(fl.x, fl.y - t * 50); ctx.scale(0.6 + 0.4 * pop + (1 - pop) * 0.5, 0.6 + 0.4 * pop + (1 - pop) * 0.5); ctx.translate(-fl.x, -(fl.y - t * 50));
        ctx.font = (fl.small ? '18px' : '26px') + ' "Russo One", sans-serif'; ctx.textAlign = 'center';
        ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(30,15,5,.85)'; ctx.strokeText(fl.text, fl.x, fl.y - t * 50);
        ctx.fillStyle = fl.color; ctx.fillText(fl.text, fl.x, fl.y - t * 50);
        ctx.restore();
      }
      if (playing && m && m.status === 'aim' && m.left) {
        const left = Math.max(0, m.left - (now - roomAt));
        if (left < 5500 && left > 0 && Math.ceil(left / 1000) !== lastTick) { lastTick = Math.ceil(left / 1000); sfx('tick'); }
        $('#hud-timer').textContent = Math.ceil(left / 1000) + T(' с', ' s');
        $('#hud-timer').style.color = left < 8000 ? '#ff6b5b' : '';
      } else $('#hud-timer').textContent = '—';
      $('#hint').textContent = hintText();
    }
    else X.drawParts(ctx);
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
      if (aim.active) return T('Отпусти, чтобы бросить', 'Release to throw');
      return DEV.touch ? T('Коснись поля и тяни палец назад-вниз, чтобы прицелиться', 'Touch the field and drag your finger back-down to aim') : T('Зажми мышь на поле и тяни назад-вниз, чтобы прицелиться', 'Hold the mouse on the field and drag back-down to aim');
    }
    if (m.status === 'flying') return '';
    if (m.status === 'done' && o && (o.status === 'aim' || o.status === 'flying')) return T(`Твой раунд окончен. ${pname(o)} ещё бросает…`, `Your round is over. ${pname(o)} is still throwing…`);
    return '';
  }

  // ---------- Звук и утилиты ----------
  function sfx(kind, arg) { try { X.Audio.sfx(kind, arg); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2800); }



  // =================== УСТРОЙСТВО ===================
  const DEV = { touch: false, phone: false, tablet: false };
  function applyDevice() {
    const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const minSide = Math.min(screen.width || innerWidth, screen.height || innerHeight);
    DEV.touch = touch; DEV.phone = touch && minSide < 600; DEV.tablet = touch && !DEV.phone;
    const layoutPhone = DEV.phone || innerWidth <= 760;
    const h = document.documentElement;
    h.classList.toggle('touch', touch);
    h.classList.toggle('dev-phone', DEV.phone); h.classList.toggle('dev-tablet', DEV.tablet); h.classList.toggle('dev-desktop', !touch);
    h.classList.toggle('layout-phone', layoutPhone);
    h.classList.toggle('native-app', !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()));
  }
  window.addEventListener('resize', applyDevice);
  window.addEventListener('orientationchange', () => setTimeout(applyDevice, 200));
  const vibrateOn = () => { try { return localStorage.getItem('nd-vibrate') !== '0'; } catch (e) { return true; } };

  // =================== ТАБЛИЦА ЛИДЕРОВ ===================
  let BD = null, boardTimer = null, lastPush = '';
  async function initBoard() {
    if (BD) return;
    try {
      if (window.claude && window.claude.use) {
        const db = await window.claude.use('db'); const user = db ? await window.claude.use('user') : null;
        const uid = user ? await user.id() : null;
        if (db && uid) BD = { kind: 'db', db, me: uid };
      }
    } catch (e) {}
    if (!BD && R && R.kvPut) BD = { kind: 'mq', me: X.Profile.data.pid };
    queueBoardPush();
  }
  function boardEntry() { const d = X.Profile.data; return { n: nick(), lv: X.Profile.level, xp: d.xp, w: d.stats.wins, hat: myLook().hat, t: Date.now() }; }
  function queueBoardPush() { clearTimeout(boardTimer); boardTimer = setTimeout(pushBoard, 1500); }
  async function pushBoard() {
    if (!BD) return;
    const e = boardEntry(), key = e.n + '|' + e.xp + '|' + e.hat;
    if (key === lastPush) return;
    try { if (BD.kind === 'db') await BD.db.doc('lb/' + BD.me).set(e); else R.kvPut(BD.me, e); lastPush = key; } catch (err) {}
  }
  async function loadBoard() {
    let rows = [];
    if (BD && BD.kind === 'db') { const snap = await BD.db.collection('lb').orderBy('xp', 'desc').limit(100).get(); rows = snap.docs.map(d => Object.assign({ id: d.id }, d.data())); }
    else if (BD && BD.kind === 'mq') rows = await R.kvList(2500);
    const me = Object.assign({ id: BD ? BD.me : 'me' }, boardEntry());
    rows = rows.filter(r => r && r.id !== me.id).map(r => ({ id: String(r.id), n: String(r.n || T('Игрок', 'Player')).slice(0, 20), lv: Math.max(1, Math.min(30, +r.lv || 1)), xp: Math.max(0, +r.xp || 0), w: Math.max(0, +r.w || 0), hat: String(r.hat || 'none') }));
    rows.push(me);
    rows.sort((a, b) => b.xp - a.xp);
    return { rows: rows.slice(0, 100), me: me.id, rank: rows.findIndex(r => r.id === me.id) + 1 };
  }
  const HAT_ICON = { none: '', cap: '🧢', bandana: '🏴‍☠️', cowboy: '🤠', ushanka: '🧣', viking: '⚔️', tophat: '🎩', crown: '👑' };
  async function openBoard() {
    const m = $('#board-modal'); m.classList.remove('hidden');
    const body = m.querySelector('.pm-body');
    body.innerHTML = `<h2>🏆 ${T('Таблица лидеров', 'Leaderboard')}</h2><p class="pm-note">${T('Загрузка…', 'Loading…')}</p>`;
    let res;
    try { res = await Promise.race([loadBoard(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000))]); }
    catch (e) { body.innerHTML = `<h2>🏆 ${T('Таблица лидеров', 'Leaderboard')}</h2><p class="pm-note">${T('Не удалось загрузить таблицу. Проверь интернет и попробуй ещё раз.', 'Could not load the leaderboard. Check your connection and try again.')}</p>`; return; }
    const where = !BD ? T('Онлайн недоступен, поэтому здесь только твой результат.', 'Online is unavailable, so only your own result is shown.')
      : BD.kind === 'db' ? T('Все игроки, у которых есть доступ к этой странице игры на claude.ai.', 'Everyone who has access to this game page on claude.ai.')
      : T('Все игроки браузерной версии (itch.io, сайт) и Android-приложения.', 'All players of the browser version (itch.io, website) and the Android app.');
    body.innerHTML = `<h2>🏆 ${T('Таблица лидеров', 'Leaderboard')}</h2>
      <p class="pm-note">${where} ${T('Твоё место', 'Your rank')}: <b>${res.rank}</b> ${T('из', 'of')} ${res.rows.length}.</p>
      <div class="lb">${res.rows.map((r, i) => `<div class="lb-row ${r.id === res.me ? 'me' : ''}"><span class="lb-pos">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</span>
        <span class="lb-name">${HAT_ICON[r.hat] || ''} ${esc(r.n)}${r.id === res.me ? T(' (ты)', ' (you)') : ''}</span>
        <span class="lb-lvl">${T('ур.', 'lv.')} ${r.lv}</span><span class="lb-xp">${r.xp} XP</span><span class="lb-w">🏆 ${r.w}</span></div>`).join('')}</div>`;
  }

  // =================== НАСТРОЙКИ ===================
  function openSettings() { $('#settings-modal').classList.remove('hidden'); renderSettings(); }
  function renderSettings() {
    const b = $('#settings-modal .pm-body'); const a = X.Audio.state;
    const slider = (key, label) => `<label class="set-row"><span>${label}</span><input type="range" min="0" max="100" value="${a[key]}" data-vol="${key}"><b>${a[key]}</b></label>`;
    b.innerHTML = `<h2>⚙️ ${T('Настройки', 'Settings')}</h2>
      ${slider('vMaster', T('Общая громкость', 'Master volume'))}
      ${slider('vMusic', T('Музыка', 'Music'))}
      ${slider('vSfx', T('Эффекты', 'Sound effects'))}
      <label class="set-row"><span>${T('Трек', 'Track')}</span><select id="set-track"><option value="auto">${T('Авто: лобби и арена', 'Auto: lobby & arena')}</option>${Object.entries(X.Audio.TRACKS).map(([id, t]) => `<option value="${id}">${T(...t.name)}</option>`).join('')}</select></label>
      <label class="set-row"><span>${T('Звуки', 'Sound')}</span><input type="checkbox" id="set-snd" ${a.sound ? 'checked' : ''}></label>
      <label class="set-row"><span>${T('Музыка', 'Music')}</span><input type="checkbox" id="set-mus" ${a.music ? 'checked' : ''}></label>
      ${DEV.phone ? `<label class="set-row"><span>${T('Вибрация', 'Vibration')}</span><input type="checkbox" id="set-vib" ${vibrateOn() ? 'checked' : ''}></label>` : ''}
      <p class="pm-note">${T('Устройство', 'Device')}: ${DEV.phone ? T('телефон', 'phone') : DEV.tablet ? T('планшет', 'tablet') : T('компьютер', 'computer')} · ${T('раскладка подстраивается сама', 'layout adapts automatically')}</p>`;
    b.querySelectorAll('[data-vol]').forEach(r => r.oninput = () => { X.Audio.setVolume(r.dataset.vol, +r.value); r.nextElementSibling.textContent = r.value; });
    b.querySelectorAll('[data-vol]').forEach(r => r.onchange = () => sfx('thunk'));
    const tr = b.querySelector('#set-track'); tr.value = a.track; tr.onchange = () => X.Audio.setTrack(tr.value);
    b.querySelector('#set-snd').onchange = (e) => { X.Audio.setSound(e.target.checked); paintSnd(); };
    b.querySelector('#set-mus').onchange = (e) => { X.Audio.setMusic(e.target.checked); paintSnd(); };
    const vib = b.querySelector('#set-vib'); if (vib) vib.onchange = (e) => { try { localStorage.setItem('nd-vibrate', e.target.checked ? '1' : '0'); } catch (er) {} if (e.target.checked) try { navigator.vibrate(30); } catch (er) {} };
  }
  function buildExtraUI() {
    const mkModal = (id) => { const m = document.createElement('div'); m.id = id; m.className = 'modal hidden'; m.innerHTML = '<div class="panel pm"><button class="pm-close" type="button">✕</button><div class="pm-body"></div></div>';
      m.onclick = (e) => { if (e.target === m) m.classList.add('hidden'); }; m.querySelector('.pm-close').onclick = () => m.classList.add('hidden'); document.body.appendChild(m); };
    mkModal('board-modal'); mkModal('settings-modal'); mkModal('tut-modal');
    const coach = document.createElement('div'); coach.id = 'coach'; coach.className = 'coach hidden'; coach.innerHTML = '<span></span><button type="button" aria-label="close">✕</button>';
    coach.querySelector('button').onclick = () => { coach.classList.add('hidden'); practice = null; }; document.body.appendChild(coach);
    // кнопка обучения — сверху в меню (необязательная)
    const lg = document.querySelector('.logo .snd-box'); if (lg) { const t = document.createElement('button'); t.type = 'button'; t.className = 'snd-toggle tut-btn'; t.onclick = () => { sfx('click'); openTutorial(); }; lg.appendChild(t); }
    // кнопки рядом со звуком: настройки
    document.querySelectorAll('.snd-box').forEach(box => { const b = document.createElement('button'); b.type = 'button'; b.className = 'snd-toggle set'; b.textContent = '⚙️'; b.onclick = () => { sfx('click'); openSettings(); }; box.appendChild(b); });
    // таблица лидеров — в карточке профиля
    const card = $('#profile-card .pc-main'); const lb = document.createElement('button'); lb.type = 'button'; lb.className = 'btn small pc-lb'; lb.onclick = () => { sfx('click'); openBoard(); }; card.appendChild(lb);
    paintExtra();
  }
  function paintExtra() {
    const lb = $('.pc-lb'); if (lb) lb.textContent = T('🏆 Таблица лидеров', '🏆 Leaderboard');
    document.querySelectorAll('.snd-toggle.set').forEach(b => b.title = T('Настройки', 'Settings'));
    document.querySelectorAll('.tut-btn').forEach(b => { b.textContent = '❓ ' + T('Обучение', 'How to play'); b.title = T('Короткое обучение (необязательно)', 'Quick tutorial (optional)'); });
    if ($('#tut-modal') && !$('#tut-modal').classList.contains('hidden')) renderTutorial();
    if (!$('#settings-modal').classList.contains('hidden')) renderSettings();
  }


  // =================== ОБУЧЕНИЕ ===================
  const svgWrap = (inner) => `<svg viewBox="0 0 220 120" class="tut-art" aria-hidden="true">${inner}</svg>`;
  const ART = {
    goal: svgWrap(`<rect width="220" height="120" rx="12" fill="#f0a35e" opacity=".25"/><rect x="150" y="38" width="34" height="62" rx="4" fill="#7a4a2a"/><rect x="150" y="56" width="34" height="8" fill="#e9e1d3"/><rect x="150" y="64" width="34" height="9" fill="#c0392b"/><rect x="150" y="73" width="34" height="8" fill="#e9e1d3"/><ellipse cx="167" cy="38" rx="17" ry="5" fill="#9c6a40"/><g transform="translate(116 66) rotate(-6)"><rect x="0" y="-3" width="32" height="6" rx="2" fill="#c8d4dc"/><rect x="-14" y="-4" width="14" height="8" rx="2" fill="#3a2a22"/></g><circle cx="52" cy="62" r="9" fill="#5fb8ff"/><path d="M52 71 L52 98 M52 80 L74 70" stroke="#5fb8ff" stroke-width="4" stroke-linecap="round"/>`),
    cards: svgWrap(`<rect width="220" height="120" rx="12" fill="#1f5a3a" opacity=".5"/><g transform="translate(46 22) rotate(-8)"><rect width="52" height="76" rx="6" fill="#f7efd8" stroke="#d8a53a" stroke-width="2"/><text x="6" y="16" font-size="13" font-weight="700" fill="#222">A♣</text><rect x="14" y="30" width="26" height="6" rx="3" fill="#c8d4dc" transform="rotate(-20 27 33)"/></g><text x="108" y="64" font-size="26" fill="#f0be5a">→</text><g transform="translate(138 52) rotate(-28)"><rect x="0" y="-4" width="44" height="8" rx="3" fill="#c8d4dc"/><rect x="-16" y="-5" width="16" height="10" rx="3" fill="#3a2a22"/></g>`),
    throw: svgWrap(`<rect width="220" height="120" rx="12" fill="#2d3a55" opacity=".5"/><circle cx="150" cy="78" r="7" fill="#5fb8ff"/><circle cx="108" cy="98" r="9" fill="none" stroke="#f0be5a" stroke-width="2.5"/><path d="M150 78 L112 96" stroke="#f0be5a" stroke-width="3" stroke-dasharray="5 5"/><path d="M148 74 Q 90 10 28 52" stroke="#fff" stroke-width="2.5" fill="none" stroke-dasharray="2 6" stroke-linecap="round"/><path d="M30 45 L24 54 L36 55 Z" fill="#fff"/>`),
    wind: svgWrap(`<rect width="220" height="120" rx="12" fill="#f0a35e" opacity=".25"/><rect x="62" y="12" width="96" height="22" rx="8" fill="#3a2a22"/><text x="110" y="28" font-size="11" fill="#fff" text-anchor="middle">Wind 7 m/s →</text><path d="M30 60 H190 M170 52 L190 60 L170 68" stroke="#fff" stroke-width="3" fill="none" opacity=".6" stroke-linecap="round" stroke-linejoin="round"/><rect x="92" y="62" width="36" height="46" rx="4" fill="#7a4a2a"/><rect x="92" y="74" width="36" height="6" fill="#e9e1d3"/><rect x="92" y="80" width="36" height="8" fill="#c0392b"/><rect x="92" y="88" width="36" height="6" fill="#e9e1d3"/>`),
    trump: svgWrap(`<rect width="220" height="120" rx="12" fill="#3a1f4a" opacity=".45"/><g transform="translate(78 16)"><rect width="64" height="88" rx="7" fill="#f7efd8" stroke="#d8a53a" stroke-width="3"/><rect x="38" y="8" width="20" height="10" rx="4" fill="#d8a53a"/><text x="6" y="20" font-size="15" font-weight="700" fill="#222">B♠</text><text x="32" y="64" font-size="30" text-anchor="middle" fill="#333">♠</text></g>`),
    clash: svgWrap(`<rect width="220" height="120" rx="12" fill="#2d3a55" opacity=".5"/><g transform="translate(40 76) rotate(-30)"><rect width="46" height="7" rx="3" fill="#c8d4dc"/></g><g transform="translate(180 76) rotate(210)"><rect width="46" height="7" rx="3" fill="#ffb199"/></g><circle cx="110" cy="56" r="18" fill="none" stroke="#7fd8ff" stroke-width="3"/><text x="110" y="62" font-size="18" text-anchor="middle" fill="#7fd8ff">✦</text>`),
    xp: svgWrap(`<rect width="220" height="120" rx="12" fill="#3a2a5a" opacity=".45"/><text x="110" y="56" font-size="16" fill="#c9b6ff" text-anchor="middle">Lv. 5 → 6</text><rect x="40" y="68" width="140" height="12" rx="6" fill="#241a38"/><rect x="40" y="68" width="92" height="12" rx="6" fill="#9b7bff"/><text x="110" y="104" font-size="20" text-anchor="middle">🧢 🎩 👑</text>`),
  };
  const tutSteps = () => [
    { art: 'goal', t: T('Цель игры', 'The goal'), d: T('Бросай ножи в пень соперника. Когда все ножи брошены, побеждает тот, у кого больше очков, а проигравший — «дурак».', "Throw knives into the stump. When every knife is thrown, the player with more points wins and the other one is the fool.") },
    { art: 'cards', t: T('Карты становятся ножами', 'Cards turn into knives'), d: T('Выбери карту в руке — она превращается в нож. На карте написано: плюсы (+), минусы (−), очки, разброс и «окно» попадания. Чем сильнее нож, тем сложнее он в обращении.', 'Pick a card in your hand and it turns into a knife. The card lists perks (+), flaws (−), points, spread and the hit window. Stronger knives are usually trickier to handle.') },
    { art: 'throw', t: T('Как бросать', 'How to throw'), d: DEV.touch ? T('Коснись поля и тяни палец назад-вниз, как рогатку. Чем дальше оттянешь, тем сильнее бросок. Отпусти — нож полетит. Пунктир показывает направление.', 'Touch the field and drag your finger back-down like a slingshot. The further you pull, the stronger the throw. Release to throw. The dotted line shows the direction.') : T('Зажми мышь на поле и тяни назад-вниз, как рогатку. Чем дальше оттянешь, тем сильнее бросок. Отпусти кнопку — нож полетит. Пунктир показывает направление.', 'Hold the mouse on the field and drag back-down like a slingshot. The further you pull, the stronger the throw. Release to throw. The dotted line shows the direction.') },
    { art: 'wind', t: T('Ветер и пень', 'Wind and the stump'), d: T('Ветер сносит нож, его сила и направление показаны вверху поля. Попадай в красную полосу — яблочко (×2), белая полоса даёт ×1,5, торец — ×1. Мимо — ноль очков.', 'Wind pushes the knife; its strength and direction are shown at the top of the field. Hit the red band for a bullseye (×2), the white band gives ×1.5, the top of the stump ×1. A miss scores nothing.') },
    { art: 'trump', t: T('Козырь', 'The trump'), d: T('Масть нижней открытой карты колоды — козырь. Козырные ножи получают +1 способность, +1 хорошее качество и летят ровнее. Береги их для важных бросков.', 'The suit of the face-up bottom card is the trump. Trump knives get +1 ability, +1 good quality and fly steadier. Save them for the important throws.') },
    { art: 'clash', t: T('Одновременно, серии и сбивание', 'Together, streaks and knockdowns'), d: T('Оба бросают одновременно. Попал — бросаешь ещё, пока есть карты; промахнулся — твой раунд окончен. Ножи можно сбить в воздухе: сбитый нож не даёт очков, а ты получаешь половину его очков. 💡 Совет: чаще всего выгодно сбивать нож соперника плохим ножом. Плохими ножами трудно попасть в пень, зато хорошим ножом соперника по ним удобно бить в воздухе.', 'Both players throw at once. Hit — keep throwing while you have cards; miss — your round is over. Knives can be knocked out of the air: a knocked knife scores nothing and you get half its points. 💡 Tip: it is usually best to knock down your opponent\'s knife with a bad knife. Bad knives are hard to land in the stump anyway, but they are handy for swatting your opponent\'s good knife out of the air.') },
    { art: 'xp', t: T('Опыт и наряды', 'XP and outfits'), d: T('За попадания, серии и победы ты получаешь опыт, растёшь в уровнях и открываешь шляпы, одежду и арены (кнопка «Профиль»). С ботами опыт идёт до 5 уровня, дальше — в матчах с живыми игроками.', 'Hits, streaks and wins give XP. Level up to unlock hats, outfits and arenas (Profile button). Bots give XP up to level 5; after that, play real people.') },
  ];
  let tutI = 0;
  function openTutorial() { tutI = 0; $('#tut-modal').classList.remove('hidden'); renderTutorial(); }
  function renderTutorial() {
    const steps = tutSteps(), s = steps[tutI], last = tutI === steps.length - 1;
    const b = $('#tut-modal .pm-body');
    b.innerHTML = `<h2>❓ ${T('Обучение', 'How to play')}</h2>
      <div class="tut-step">${ART[s.art]}<h3>${s.t}</h3><p>${s.d}</p></div>
      <div class="tut-dots">${steps.map((_, i) => `<i class="${i === tutI ? 'on' : ''}" data-i="${i}"></i>`).join('')}</div>
      <div class="btns tut-btns">
        <button type="button" class="btn small" id="tut-prev" ${tutI === 0 ? 'disabled' : ''}>← ${T('Назад', 'Back')}</button>
        ${last ? `<button type="button" class="btn primary" id="tut-try">🎯 ${T('Потренироваться с ботом', 'Practice vs the bot')}</button>` : `<button type="button" class="btn primary" id="tut-next">${T('Далее', 'Next')} →</button>`}
      </div>
      <p class="pm-note">${T('Обучение необязательное: его можно закрыть в любой момент и вернуться кнопкой «Обучение».', 'The tutorial is optional: close it any time and come back with the How to play button.')}</p>`;
    b.querySelectorAll('.tut-dots i').forEach(d => d.onclick = () => { tutI = +d.dataset.i; renderTutorial(); });
    $('#tut-prev').onclick = () => { if (tutI > 0) { tutI--; sfx('click'); renderTutorial(); } };
    const nx = $('#tut-next'); if (nx) nx.onclick = () => { tutI++; sfx('click'); renderTutorial(); };
    const tr = $('#tut-try'); if (tr) tr.onclick = () => { $('#tut-modal').classList.add('hidden'); startPractice(); };
  }
  // тренировка: матч на 20 ножей с лёгким ботом и подсказками по ходу дела
  let practice = null;
  const COACH = () => [
    DEV.touch ? T('Это тренировка с лёгким ботом. Выбери карту внизу, потом коснись поля, тяни палец назад-вниз и отпусти.', 'This is practice vs the easy bot. Pick a card below, then touch the field, drag back-down and release.') : T('Это тренировка с лёгким ботом. Выбери карту внизу, потом зажми мышь на поле, тяни назад-вниз и отпусти.', 'This is practice vs the easy bot. Pick a card below, then hold the mouse on the field, drag back-down and release.'),
    T('Смотри на плашку «Ветер» вверху поля: ветер сносит нож, поэтому подстраивай угол.', 'Check the Wind label at the top of the field: wind pushes the knife, so adjust your angle.'),
    T('Попал — можешь бросать дальше, пока есть карты. Промах закончил твой раунд.', 'A hit lets you keep throwing while you have cards. A miss ends your round.'),
    T('Целься в красную полосу пня: яблочко даёт двойные очки.', 'Aim for the red band of the stump: a bullseye scores double.'),
    T('Отлично! Ты разобрался. Можно доиграть матч или выйти кнопкой «Выйти».', "Nice, you've got it. Finish the match or leave with the Leave button."),
  ];
  function showCoach(i) {
    const el = $('#coach'), tips = COACH(); if (!el) return;
    if (i == null || i >= tips.length) { el.classList.add('hidden'); return; }
    el.querySelector('span').textContent = '💡 ' + tips[i]; el.classList.remove('hidden');
  }
  function startPractice() {
    if (net || eng) return;
    practice = { throws: 0 };
    createServer(true, { level: 'easy', size: 20 });
    setTimeout(() => showCoach(0), 400);
  }
  function coachAfterThrow() {
    if (!practice) return;
    practice.throws++;
    showCoach(Math.min(practice.throws, 4));
    if (practice.throws >= 4) setTimeout(() => { if (practice && practice.throws >= 4) showCoach(null); }, 9000);
  }

  // =================== ПРОФИЛЬ, ГАРДЕРОБ, ЗВУК ===================
  function avatar(canvas, look, withBg) {
    const g = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h);
    const sc = h / 260;
    if (withBg) { const b = getBg(look.arena); g.drawImage(b, 330, 232, 260, 300, 0, 0, w, h); }
    g.setTransform(sc, 0, 0, sc, w / 2, 0);
    X.drawCharacter(g, { x: 0, ground: 245, facing: 1, color: '#5fb8ff', look, arm: null, swing: null, holdCard: null, now: performance.now() });
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  function renderProfileCard() {
    const el = $('#profile-card'); if (!el) return;
    const pr = X.Profile.progress();
    el.querySelector('.pc-lvl').textContent = T(`Уровень ${pr.L}`, `Level ${pr.L}`);
    el.querySelector('.pc-xp').textContent = pr.L >= 30 ? 'MAX' : `${pr.cur} / ${pr.need} XP`;
    el.querySelector('.xpbar i').style.width = Math.round(pr.pct * 100) + '%';
    el.querySelector('.pc-btn').textContent = T('👤 Профиль и гардероб', '👤 Profile & wardrobe');
    avatar(el.querySelector('canvas'), myLook(), true);
  }
  let pmTab = 'wardrobe', pmSlot = 'hat';
  function openProfile() { $('#profile-modal').classList.remove('hidden'); renderProfileModal(); }
  function renderProfileModal() {
    const M = $('#profile-modal .pm-body'); if (!M) return;
    const pr = X.Profile.progress(), d = X.Profile.data, look = myLook();
    const tabs = [['wardrobe', T('Гардероб', 'Wardrobe')], ['ach', T('Достижения', 'Achievements')], ['stats', T('Статистика', 'Stats')]];
    let body = '';
    if (pmTab === 'wardrobe') {
      body = `<div class="pm-slots">${X.SLOTS.map(sl => `<button class="chip-btn ${sl === pmSlot ? 'on' : ''}" data-slot="${sl}">${T(...X.SLOT_NAMES[sl])}</button>`).join('')}</div>
        <div class="pm-items">${X.ITEMS[pmSlot].map(([id, req, ru, en]) => {
          const ok = X.Profile.isUnlocked(pmSlot, id), on = look[pmSlot] === id;
          const lock = typeof req === 'number' ? T(`🔒 Уровень ${req}`, `🔒 Level ${req}`) : '🏅 ' + (() => { const a = X.ACH.find(x => x[0] === req); return a ? T(a[1], a[2]) : req; })();
          return `<button class="item ${ok ? '' : 'locked'} ${on ? 'on' : ''}" data-item="${id}" ${ok ? '' : 'disabled'}><b>${T(ru, en)}</b><small>${on ? T('✓ Надето', '✓ Equipped') : ok ? T('Надеть', 'Equip') : lock}</small></button>`;
        }).join('')}</div>`;
    } else if (pmTab === 'ach') {
      body = `<div class="pm-ach">${X.ACH.map(([id, ru, en, dru, den]) => `<div class="ach ${d.ach[id] ? 'got' : ''}"><span>${d.ach[id] ? '🏅' : '🔒'}</span><div><b>${T(ru, en)}</b><small>${T(dru, den)}</small></div></div>`).join('')}</div>`;
    } else {
      const st = d.stats, acc = st.throws ? Math.round(st.hits / st.throws * 100) : 0;
      const rows = [[T('Матчей', 'Matches'), st.matches], [T('Побед', 'Wins'), st.wins], [T('Поражений', 'Losses'), st.losses], [T('Ничьих', 'Draws'), st.draws],
        [T('Бросков', 'Throws'), st.throws], [T('Точность', 'Accuracy'), acc + '%'], [T('Яблочек', 'Bullseyes'), st.bulls], [T('Сбито ножей', 'Knives knocked'), st.knocks],
        [T('Лучшая серия', 'Best streak'), '×' + st.bestStreak], [T('Всего очков', 'Total points'), st.points]];
      body = `<div class="pm-stats">${rows.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('')}</div>`;
    }
    M.innerHTML = `<div class="pm-head"><canvas width="200" height="230"></canvas><div class="pm-info">
        <h2>${esc(nick())}</h2><div class="pm-lvl">${T('Уровень', 'Level')} ${pr.L}</div>
        <div class="xpbar big"><i style="width:${Math.round(pr.pct * 100)}%"></i></div><small>${pr.L >= 30 ? 'MAX' : `${pr.cur} / ${pr.need} XP`} · ${T('всего', 'total')} ${d.xp} XP</small>
        <p class="pm-note">${T('Опыт дают попадания, яблочки, сбитые ножи, серии и победы. Сложный бот и живые соперники дают больше. С ботами опыт идёт только до 5 уровня, дальше — только в матчах с людьми. Прогресс хранится в этом браузере.', 'You earn XP for hits, bullseyes, knockdowns, streaks and wins. The hard bot and human opponents give more. Bots only give XP up to level 5; after that, only matches against people count. Progress is saved in this browser.')}</p>
      </div></div>
      <div class="pm-tabs">${tabs.map(([id, n]) => `<button class="chip-btn ${id === pmTab ? 'on' : ''}" data-tab="${id}">${n}</button>`).join('')}</div>${body}`;
    avatar(M.querySelector('.pm-head canvas'), look, true);
    M.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { pmTab = b.dataset.tab; sfx('click'); renderProfileModal(); });
    M.querySelectorAll('[data-slot]').forEach(b => b.onclick = () => { pmSlot = b.dataset.slot; sfx('click'); renderProfileModal(); });
    M.querySelectorAll('[data-item]').forEach(b => b.onclick = () => { if (X.Profile.equip(pmSlot, b.dataset.item)) { sfx('take'); renderProfileModal(); renderProfileCard(); } });
  }
  function buildProfileUI() {
    const nickIn = $('#nick');
    const card = document.createElement('div'); card.id = 'profile-card'; card.className = 'profile-card';
    card.innerHTML = `<canvas width="72" height="84"></canvas><div class="pc-main"><div class="pc-top"><b class="pc-lvl"></b><small class="pc-xp"></small></div><div class="xpbar"><i></i></div><button class="btn small pc-btn" type="button"></button></div>`;
    nickIn.insertAdjacentElement('afterend', card);
    card.querySelector('.pc-btn').onclick = () => { sfx('click'); openProfile(); };
    card.querySelector('canvas').onclick = () => openProfile();
    const sel = document.createElement('select'); sel.id = 'bot-level';
    sel.innerHTML = '<option value="easy"></option><option value="medium"></option><option value="hard"></option>';
    try { sel.value = localStorage.getItem('nd-bot') || 'medium'; } catch (e) { sel.value = 'medium'; }
    sel.onchange = () => { try { localStorage.setItem('nd-bot', sel.value); } catch (e) {} };
    $('#btn-bot').insertAdjacentElement('beforebegin', sel);
    const modal = document.createElement('div'); modal.id = 'profile-modal'; modal.className = 'modal hidden';
    modal.innerHTML = '<div class="panel pm"><button class="pm-close" type="button">✕</button><div class="pm-body"></div></div>';
    modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
    modal.querySelector('.pm-close').onclick = () => modal.classList.add('hidden');
    document.body.appendChild(modal);
    // звук и музыка
    const mk = (kind) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'snd-toggle ' + kind;
      b.onclick = () => { if (kind === 'snd') X.Audio.setSound(!X.Audio.sound); else X.Audio.setMusic(!X.Audio.music); paintSnd(); }; return b; };
    const box = document.createElement('div'); box.className = 'snd-box'; box.append(mk('snd'), mk('mus'));
    document.querySelector('.logo').appendChild(box);
    const box2 = box.cloneNode(false); box2.append(mk('snd'), mk('mus'));
    const tb = document.querySelector('.topbar'); tb.insertBefore(box2, tb.querySelector('.hud'));
    paintSnd(); renderProfileCard();
    setInterval(() => { if (!$('#profile-modal').classList.contains('hidden')) { const c = $('#profile-modal .pm-head canvas'); if (c) avatar(c, myLook(), true); } }, 60);
  }
  function paintSnd() {
    document.querySelectorAll('.snd-toggle.snd').forEach(b => { b.textContent = X.Audio.sound ? '🔊' : '🔇'; b.title = T('Звуки', 'Sound'); b.classList.toggle('off', !X.Audio.sound); });
    document.querySelectorAll('.snd-toggle.mus').forEach(b => { b.textContent = '🎵'; b.title = T('Музыка', 'Music'); b.classList.toggle('off', !X.Audio.music); });
  }

  // =================== ЗАСТАВКА ПРИ ПЕРВОМ ЗАПУСКЕ (как в трейлере) ===================
  function playSplash() {
    const ov = document.createElement('div'); ov.id = 'splash';
    ov.innerHTML = '<canvas></canvas><div class="sp-hint">' + T('Нажми, чтобы пропустить', 'Tap to skip') + '</div>';
    document.body.appendChild(ov);
    const cv = ov.querySelector('canvas'), g = cv.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const fit = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); };
    fit(); window.addEventListener('resize', fit);
    const T0 = performance.now(), FLY = 1000, END = 3500;
    const title = T('НОЖ ДУРАКА', "FOOL'S KNIFE");
    const sub = T('Карточный дурак, где каждая карта — нож', 'Durak where every card is a knife');
    let done = false, hit = false, shake = 0, raf = 0, sparkT = -1;
    const finish = () => { if (done) return; done = true; cancelAnimationFrame(raf); ov.classList.add('out'); setTimeout(() => ov.remove(), 500); };
    ov.onclick = finish;
    const ease = (x) => 1 - Math.pow(1 - x, 3), clamp = (x) => Math.max(0, Math.min(1, x));
    // нож: длинный клинок тёмной стали, золотая гарда, рукоять
    const knife = (x, y, a, L) => {
      const k = L / 100;
      // точка вращения — центр ножа (клинок 0…-62, рукоять до -102)
      g.save(); g.translate(x, y); g.rotate(a); g.scale(k, k); g.translate(51, 0);
      g.fillStyle = '#1f2a3a'; g.beginPath(); g.moveTo(0, -10); g.lineTo(-62, -5.5); g.lineTo(-62, 5.5); g.lineTo(0, 10); g.closePath(); g.fill();
      g.strokeStyle = '#a9c2d8'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(0, -8.5); g.lineTo(-60, -4); g.stroke();
      g.fillStyle = '#e0ad45'; g.fillRect(-64, -13, 6, 26);
      g.fillStyle = '#2a1b10'; g.fillRect(-100, -6, 36, 12);
      g.fillStyle = '#e0ad45'; g.beginPath(); g.arc(-102, 0, 6, 0, 7); g.fill();
      g.restore();
    };
    const sparks = (x, y, p) => {
      g.save(); g.translate(x, y); g.strokeStyle = '#ffe9a8'; g.lineWidth = 3; g.lineCap = 'round';
      for (let i = 0; i < 10; i++) {
        const an = i / 10 * Math.PI * 2 + 0.2, r1 = 26 + p * 70, r2 = r1 + 26 * (1 - p);
        g.globalAlpha = 1 - p;
        g.beginPath(); g.moveTo(Math.cos(an) * r1, Math.sin(an) * r1); g.lineTo(Math.cos(an) * r2, Math.sin(an) * r2); g.stroke();
      }
      g.restore();
    };
    const loop = (now) => {
      if (done) return;
      const t = now - T0, w = innerWidth, h = innerHeight;
      // точка попадания — правый верх надписи
      // кончик лезвия втыкается в надпись; вращение — вокруг центра ножа, поэтому центр смещаем назад от кончика
      const L = w * 0.15, kk = L / 100, off = 51 * kk, STUCK = 0.85;
      const TIP = [w * 0.6, h * 0.43];
      const hx = TIP[0] - off * Math.cos(STUCK), hy = TIP[1] - off * Math.sin(STUCK);
      const sx = -w * 0.06, sy = h * 0.68, cx = w * 0.35, cy = h * 0.02;
      const p = clamp(t / FLY), e = p;   // равномерный полёт, без торможения к концу
      const bez = (q) => { const k = 1 - q; return [k * k * sx + 2 * k * q * cx + q * q * hx, k * k * sy + 2 * k * q * cy + q * q * hy]; };
      const [kx, ky] = bez(e);
      const ang = STUCK;
      g.save();
      if (shake > 0) { g.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= 0.82; }
      const grd = g.createRadialGradient(w / 2, h * 0.45, 20, w / 2, h * 0.45, Math.max(w, h) * 0.7);
      grd.addColorStop(0, '#5a3819'); grd.addColorStop(0.55, '#2e1c0f'); grd.addColorStop(1, '#120b06');
      g.fillStyle = grd; g.fillRect(-30, -30, w + 60, h + 60);
      // пунктирный след полёта
      if (t < FLY) {
        g.setLineDash([3, 9]); g.strokeStyle = 'rgba(255,230,170,.45)'; g.lineWidth = 2; g.beginPath(); g.moveTo(sx, sy);
        for (let q = 0; q <= e; q += 0.02) { const [px, py] = bez(q); g.lineTo(px, py); }
        g.stroke(); g.setLineDash([]);
        for (let i = 4; i >= 1; i--) { const q = Math.max(0, p - i * 0.03), [px, py] = bez(q); g.globalAlpha = 0.14 * (5 - i) / 4; knife(px, py, ang - (1 - q) * Math.PI * 3.5, w * 0.15); }
        g.globalAlpha = 1;
        knife(kx, ky, ang - (1 - e) * Math.PI * 3.5, w * 0.15);
      }
      if (t >= FLY) {
        if (!hit) { hit = true; sparkT = t; shake = 12; try { sfx('thunk'); } catch (er) {} }
        const fl = clamp(1 - (t - sparkT) / 260);
        if (fl > 0) { const fg = g.createRadialGradient(TIP[0], TIP[1], 0, TIP[0], TIP[1], w * 0.45); fg.addColorStop(0, 'rgba(255,236,180,' + (0.55 * fl) + ')'); fg.addColorStop(1, 'rgba(255,236,180,0)'); g.fillStyle = fg; g.fillRect(-30, -30, w + 60, h + 60); }
        if (t - sparkT < 380) sparks(TIP[0], TIP[1], (t - sparkT) / 380);
        // название: появляется и поднимается
        const tt = clamp((t - FLY) / 260), up = ease(clamp((t - FLY - 90) / 300));
        const ty = h * (0.5 - 0.07 * up);
        const sc = 0.7 + 0.3 * tt + 0.14 * Math.sin(tt * Math.PI) * (1 - tt);
        g.save(); g.globalAlpha = Math.min(1, tt * 1.4); g.translate(w / 2, ty); g.scale(sc, sc);
        let fs = Math.min(w * 0.15, 160);
        g.font = '900 ' + fs + 'px DejaVu Sans, Russo One, Rubik, sans-serif';
        const mw = g.measureText(title).width; if (mw > w * 0.84) { fs = fs * (w * 0.84) / mw; g.font = '900 ' + fs + 'px DejaVu Sans, Russo One, Rubik, sans-serif'; }
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.shadowColor = 'rgba(255,170,60,.45)'; g.shadowBlur = 34; g.shadowOffsetY = 0;
        g.lineJoin = 'round'; g.lineWidth = fs * 0.09; g.strokeStyle = '#3a1f0a'; g.strokeText(title, 0, 0);
        const gr = g.createLinearGradient(0, -fs / 2, 0, fs / 2); gr.addColorStop(0, '#fff0b0'); gr.addColorStop(0.5, '#f4c15a'); gr.addColorStop(1, '#c98a2a');
        g.fillStyle = gr; g.fillText(title, 0, 0);
        g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 14; g.shadowOffsetY = 8; g.fillText(title, 0, 0);
        g.restore();
        // подпись
        const sa = clamp((t - 1250) / 350);
        g.save(); g.globalAlpha = sa; g.fillStyle = '#f3e7d2'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = Math.min(26, w * 0.05) + 'px Rubik, DejaVu Sans, sans-serif';
        g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 8;
        g.fillText(sub, w / 2, h * 0.6); g.restore();
        knife(hx, hy, ang, w * 0.15);   // нож поверх надписи
      }
      g.restore();
      if (t > END) return finish();
      raf = requestAnimationFrame(loop);
    };
    try { sfx('whoosh'); } catch (er) {}
    raf = requestAnimationFrame(loop);
  }

  applyDevice();
  buildProfileUI();
  buildExtraUI();
  addLangToggles();
  applyStatic();
  renderServers();
  initRoom();
  requestAnimationFrame(frame);
  playSplash();
})();
