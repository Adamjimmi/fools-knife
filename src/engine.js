// Игровой движок хоста: работает в браузере того, кто создал сервер (или в игре с ботом).
// Правила раунда: оба добирают руку до лимита и бросают ОДНОВРЕМЕННО. Попал — бросаешь ещё (пока есть карты).
// Промах или пустая рука — твой раунд окончен. Раунд заканчивается, когда оба закончили.
window.NDEngine = (() => {
  'use strict';
  const G = KG;

  // out: { state(), throwEv(msg), log(text), aim(msg) }
  function create(opts, out) {
    const size = G.DECK_SIZES.includes(+opts.size) ? +opts.size : 20;
    const g = {
      id: opts.id, name: opts.name, password: opts.password || '', hostId: opts.hostId,
      size, handMax: G.HAND_SIZE[size], arena: opts.arena || 'sunset', botLevel: ['easy', 'medium', 'hard', 'elite', 'king'].includes(opts.botLevel) ? opts.botLevel : 'medium',
      players: [], state: 'lobby', phase: 'idle', deck: [], trumpSuit: null, trumpCard: null,
      round: 0, wind: 0, stuck: [], flights: [], timers: [], token: 0, winnerId: null, endReason: '', throwSeq: 0,
    };
    const later = (ms, fn) => { const tok = g.token; g.timers.push(setTimeout(() => { if (g.token === tok && !g.dead) fn(); }, ms)); };
    const clearTimers = () => { g.timers.forEach(clearTimeout); g.timers = []; g.token++; };
    const P = (id) => g.players.find(p => p.id === id);
    const log = (t) => out.log(t);
    const push = () => out.state();

    function pub() {
      const now = Date.now();
      return {
        id: g.id, name: g.name, hostId: g.hostId, state: g.state, phase: g.phase, round: g.round,
        size: g.size, handMax: g.handMax, arena: g.arena,
        trumpSuit: g.trumpSuit, trumpCard: g.trumpCard ? g.trumpCard.id : null, deckCount: g.deck.length,
        wind: g.wind, winnerId: g.winnerId, endReason: g.endReason, locked: !!g.password,
        players: g.players.map(p => ({
          id: p.id, name: p.name, isBot: p.isBot, lvl: p.lvl, cn: p.cn, hm: p.handMax || g.handMax, look: p.look, score: p.score, hits: p.hits,
          hand: p.hand.map(c => c.id), active: p.active ? p.active.id : null,
          status: p.status, streak: p.streak, rt: p.rt || 0, left: p.status === 'aim' && p.deadline ? Math.max(0, p.deadline - now) : 0,
        })),
        // компактно: [индекс игрока, карта, козырь, x, y, r, id броска]
        stuck: g.stuck.map(s => [g.players.findIndex(p => p.id === s.o), s.c, s.t ? 1 : 0, s.x, s.y, s.r, s.id]),
        ep: g.epoch || '',
        // ножи в полёте — на случай, если сообщение о броске потерялось
        fl: g.flights.filter(f => !f.landed && f.msg).map(f => Object.assign({}, f.msg, { el: now - f.t0 })),
      };
    }
    function summary() {
      return { id: g.id, name: g.name, players: g.players.length, state: g.state, round: g.round, locked: !!g.password, hasBot: g.players.some(p => p.isBot), size: g.size };
    }
    const newPlayer = (id, name, isBot, look, lvl) => ({ id, name, isBot: !!isBot, look: look || null, lvl: lvl || null, score: 0, hits: 0, hand: [], active: null, status: 'idle', streak: 0, deadline: 0, turnNo: 0 });
    const reset = (p) => Object.assign(p, { score: 0, hits: 0, hand: [], active: null, status: 'idle', streak: 0, deadline: 0 });

    function addPlayer(id, name, look) {
      if (P(id)) return { ok: true };
      if (g.players.length >= 2) return { ok: false, code: 'full', msg: 'Сервер заполнен' };
      if (g.state === 'playing') return { ok: false, code: 'playing', msg: 'Игра уже идёт' };
      g.players.push(newPlayer(id, name, false, look));
      log({ k: 'join', n: name });
      push();
      return { ok: true };
    }
    const BOT_LOOK = {
      easy:   { hat: 'cap', shirt: 'basic', face: 'none', back: 'none', trail: 'plain' },
      medium: { hat: 'bandana', shirt: 'leather', face: 'mustache', back: 'none', trail: 'plain' },
      hard:   { hat: 'viking', shirt: 'armor', face: 'beard', back: 'cape', trail: 'fire' },
      elite:  { hat: 'tophat', shirt: 'armor', face: 'shades', back: 'cape', trail: 'sparks' },
      king:   { hat: 'bloodcrown', shirt: 'armor', face: 'beard', back: 'cape', trail: 'fire' },
    };
    // лимит руки конкретного игрока (в кампании у игрока и противника он может быть разным)
    const HM = (p) => p.handMax || g.handMax;
    // слоумо-нож можно бросить только первым в раунде
    const canUse = (p, c) => !(c.abilities.includes('slowmo') && (p.rt || 0) > 0);
    const usable = (p) => p.hand.filter(c => canUse(p, c));
    function setHand(id, n) { const p = P(id); if (p && n > 0) p.handMax = n; }
    // extra (кампания): { cn — номер противника, look, hand — лимит руки бота }
    function addBot(level, extra) {
      if (g.players.length >= 2 || g.state === 'playing') return;
      extra = extra || {};
      const lvl = ['easy', 'medium', 'hard', 'elite', 'king'].includes(level) ? level : g.botLevel;
      const bp = newPlayer('bot-' + Math.random().toString(36).slice(2, 7), 'Бот Ножовщик', true, extra.look || BOT_LOOK[lvl], lvl);
      if (extra.cn != null) bp.cn = extra.cn;
      if (extra.hand) bp.handMax = extra.hand;
      g.players.push(bp);
      log({ k: 'bot', cn: extra.cn }); push();
    }
    function kickBot() { if (g.state === 'playing') return; g.players = g.players.filter(p => !p.isBot); push(); }

    function removePlayer(id) {
      const p = P(id); if (!p) return;
      g.players = g.players.filter(x => x.id !== id);
      g.stuck = g.stuck.filter(s => s.o !== id);
      log({ k: 'leave', n: p.name, b: p.isBot });
      if (g.state === 'playing') {
        clearTimers();
        const other = g.players[0];
        g.state = 'over'; g.phase = 'idle';
        if (other) { other.status = 'idle'; other.active = null; }
        g.winnerId = other ? other.id : null; g.endReason = 'forfeit';
      }
      push();
    }

    function start() {
      if (g.players.length !== 2 || g.state === 'playing') return;
      clearTimers();
      g.rare = Math.random() < G.RARE_CHANCE;   // редкий меч — не в каждом матче
      g.deck = G.shuffle(G.deckFor(g.size, { rare: g.rare }));
      g.trumpCard = g.deck[g.deck.length - 1];
      g.trumpSuit = g.trumpCard.suit;
      g.state = 'playing'; g.round = 0; g.stuck = []; g.flights = []; g.epoch = Math.random().toString(36).slice(2, 8); g.winnerId = null; g.endReason = '';
      g.players.forEach(reset);
      log({ k: 'start', size: g.size, suit: g.trumpSuit, hand: g.handMax, hm: g.players.map(HM) });
      if (g.rare) log({ k: 'rare' });
      nextRound();
    }

    function nextRound() {
      // добор по очереди, пока у обоих не будет лимит или колода не кончится
      let drew = true;
      const order = g.round % 2 === 0 ? g.players : [...g.players].reverse();
      while (drew && g.deck.length) {
        drew = false;
        for (const p of order) if (p.hand.length < HM(p) && g.deck.length) { p.hand.push(g.deck.shift()); drew = true; }
      }
      if (g.players.every(p => p.hand.length === 0)) return endGame();
      g.round++;
      g.wind = Math.round((Math.random() * 2 - 1) * 100) / 100;
      g.phase = 'draw';
      g.players.forEach(p => { p.active = null; p.streak = 0; p.rt = 0; p.status = p.hand.length ? 'wait' : 'done'; p.deadline = 0; });
      push();
      later(1200, () => {
        g.phase = 'play';
        g.players.forEach(p => { if (p.status === 'wait') beginAim(p); });
        push();
      });
    }

    function beginAim(p) {
      p.status = 'aim';
      p.deadline = Date.now() + G.TURN_MS;
      const turnNo = ++p.turnNo;
      later(G.TURN_MS + 300, () => {
        if (p.status !== 'aim' || p.turnNo !== turnNo || g.state !== 'playing') return;
        // время вышло: нож сгорает, раунд для игрока окончен
        const c = p.active || usable(p)[0] || p.hand[0];
        p.hand = p.hand.filter(x => x !== c);
        p.active = null; p.status = 'done'; p.streak = 0;
        log({ k: 'timeout', n: p.name, b: p.isBot, c: c ? c.id : null });
        out.throwEv({ ep: g.epoch, o: p.id, a: null, c: c ? c.id : null, ts: g.trumpSuit, res: { hit: false, reason: 'Время вышло', code: 'timeout', points: 0 }, id: ++g.throwSeq });
        checkRoundEnd();
        push();
      });
      if (p.isBot) botAim(p, turnNo);
    }

    function take(id, cardId) {
      const p = P(id);
      if (!p || g.state !== 'playing' || p.status !== 'aim' || p.active) return;
      const c = p.hand.find(x => x.id === cardId) || (cardId == null ? usable(p)[0] : null);
      if (!c || !canUse(p, c)) return;
      p.active = c; push();
    }

    function doThrow(id, angle, power) {
      const p = P(id);
      if (!p || g.state !== 'playing' || g.phase !== 'play' || p.status !== 'aim' || !p.active) return;
      angle = Math.max(-1.45, Math.min(0.6, Number(angle) || 0));
      power = Math.max(0, Math.min(1, Number(power) || 0));
      const card = p.active;
      if (!canUse(p, card)) return;
      p.rt = (p.rt || 0) + 1;
      const st = G.knifeStats(card, g.trumpSuit);
      const seed = (Math.random() * 2 ** 31) | 0;
      const sim = G.throwSim({ angle, power, stats: st, wind: g.wind, seed });
      const volley = st.has('volley');
      let frames = sim.frames;
      const result = Object.assign({}, sim.result);
      p.hand = p.hand.filter(x => x !== card);
      p.active = null; p.status = 'flying'; p.deadline = 0;
      const throwId = ++g.throwSeq;
      const now = Date.now();
      const flight = { id: throwId, o: id, card, st, frames, result, t0: now, ver: 0, landed: false, dur: sim.dur || 0, volley };
      const msg = { ep: g.epoch, o: id, a: angle, p: power, s: seed, w: g.wind, c: card.id, ts: g.trumpSuit, id: throwId };
      flight.msg = msg;

      // Столкновение с чужим ножом, который ещё в воздухе
      for (const f of g.flights) {
        if (volley) break;   // залп летит веером и не сбивает ножи
        if (f.landed || f.o === id || f.result.knocked || f.result.knock || f.volley) continue;
        const offset = Math.round(((now - f.t0) / 1000) * 60);
        const col = G.findCollision(frames, f.frames, offset);
        if (!col) continue;
        // меч Кровавого Короля не сбить: чужой нож падает, а меч лишь чуть отклоняется
        const kickOf = (sw, other, i, j) => ((other[Math.min(j, other.length - 1)] || {}).y > (sw[Math.min(i, sw.length - 1)] || {}).y ? -0.16 : 0.16);
        if (st.has('bloodsword')) {
          const k = kickOf(frames, f.frames, col.i, col.j), d = G.deflect(frames, col.i, st, g.wind, k);
          frames = flight.frames = d.frames; Object.keys(result).forEach(x => delete result[x]); Object.assign(result, d.result);
          msg.defl = { at: col.i, k };
          f.frames = G.knockFrames(f.frames, col.j);
          f.result = { hit: false, knocked: true, reason: 'Сбит в воздухе!', code: 'knocked', points: 0, zone: null, stuck: null };
          msg.knock = { id: f.id, at: col.j, res: f.result }; msg.clash = col.i;
          if (f.msg) { f.msg.cut = col.j; f.msg.res = Object.assign({}, f.result); f.msg.streak = 0; }
          scheduleLanding(f); break;
        }
        if (f.st.has('bloodsword')) {
          const k = kickOf(f.frames, frames, col.j, col.i), d = G.deflect(f.frames, col.j, f.st, g.wind, k);
          f.frames = d.frames; f.result = d.result;
          frames = flight.frames = G.knockFrames(frames, col.i);
          Object.assign(result, { hit: false, knocked: true, reason: 'Сбит в воздухе!', code: 'knocked', points: 0, mult: 0, zone: null, stuck: null });
          msg.cut = col.i; msg.clash = col.i;
          const fr = { hit: d.result.hit, reason: d.result.reason, code: d.result.code, points: d.result.points, zone: d.result.zone, stuck: d.result.stuck };
          msg.defl2 = { id: f.id, at: col.j, k, res: fr };
          if (f.msg) { f.msg.defl = { at: col.j, k }; f.msg.res = Object.assign({}, fr); f.msg.streak = (fr.hit ? (P(f.o) || {}).streak + 1 : 0) || 0; }
          scheduleLanding(f);
          break;
        }
        frames = flight.frames = G.knockFrames(frames, col.i);
        f.frames = G.knockFrames(f.frames, col.j);
        const bonus = Math.max(5, Math.round(f.st.points / 2));
        Object.assign(result, { hit: false, knock: true, reason: 'Сбил нож соперника!', code: 'knock', points: bonus, mult: 0, zone: null, stuck: null });
        f.result = { hit: false, knocked: true, reason: 'Сбит в воздухе!', code: 'knocked', points: 0, zone: null, stuck: null };
        msg.cut = col.i;
        msg.knock = { id: f.id, at: col.j, res: f.result };
        if (f.msg) { f.msg.cut = col.j; f.msg.res = Object.assign({}, f.result); f.msg.streak = 0; }
        scheduleLanding(f);
        break;
      }
      const opp = g.players.find(x => x.id !== id);
      msg.res = { hit: result.hit, knock: !!result.knock, knocked: !!result.knocked, reason: result.reason, code: result.code, points: result.points, zone: result.zone, stuck: result.stuck, volley: result.volley };
      msg.streak = (result.hit || result.knock) ? p.streak + 1 : 0;
      if (result.hit && st.has('thief') && opp) msg.res.steal = Math.min(5, opp.score);
      g.flights.push(flight);
      out.throwEv(msg);
      push();
      scheduleLanding(flight);
    }

    // Очки и последствия броска применяются, когда нож долетел (его могли сбить по дороге)
    function scheduleLanding(f) {
      const ver = ++f.ver;
      const ms = f.t0 + (Math.max(f.frames.length, f.dur || 0) / 60) * 1000 - Date.now();
      later(Math.max(0, ms), () => { if (f.ver === ver && !f.landed) land(f); });
    }
    function land(f) {
      f.landed = true;
      g.flights = g.flights.filter(x => x !== f);
      const p = P(f.o);
      if (!p || g.state !== 'playing') return;
      const r = f.result;
      const opp = g.players.find(x => x.id !== f.o);
      if (r.hit && f.st.has('thief') && opp) { r.steal = Math.min(5, opp.score); opp.score -= r.steal; r.points += r.steal; }
      p.score += r.points || 0;
      if (r.hit && f.st.has('bloodsword') && opp) {   // меч крадёт лучшую карту соперника
        const pool = opp.hand.filter(c => c !== opp.active);
        if (pool.length) {
          const val = (c) => TIER_RANK[c.tier] + (c.suit === g.trumpSuit ? 0.5 : 0);
          const best = pool.reduce((a, b) => (val(b) > val(a) ? b : a));
          opp.hand = opp.hand.filter(c => c !== best); p.hand.push(best);
          r.stoleLog = { k: 'steal', n: p.name, b: p.isBot, cn: p.cn, c: best.id, from: opp.name, fb: opp.isBot, fcn: opp.cn };
          if (opp.status === 'aim' && !opp.active && !usable(opp).length) { opp.status = 'done'; opp.deadline = 0; }
        }
      }
      const good = r.hit || r.knock;
      if (r.hit) p.hits++;
      p.streak = good ? p.streak + 1 : 0;
      for (const sk of (r.stucks || (r.stuck ? [r.stuck] : []))) g.stuck.push({ o: f.o, c: f.card.id, t: f.st.trump, x: Math.round(sk.x), y: Math.round(sk.y), r: Math.round(sk.r * 100) / 100, id: f.id });
      log({ k: 'throw', n: p.name, b: p.isBot, c: f.card.id, code: r.code, pts: r.points || 0, steal: r.steal || 0, streak: good ? p.streak : 0 });
      if (r.stoleLog) log(r.stoleLog);
      push();
      later(700, () => {
        if (g.state !== 'playing' || p.status !== 'flying') return;
        if (good && usable(p).length) beginAim(p);      // попал или сбил — бросает ещё (если есть чем)
        else p.status = 'done';
        checkRoundEnd();
        push();
      });
    }

    function checkRoundEnd() {
      if (g.state !== 'playing' || g.phase !== 'play') return;
      if (g.players.every(p => p.status === 'done')) {
        g.phase = 'end';
        later(1100, nextRound);
      }
    }

    function endGame() {
      g.state = 'over'; g.phase = 'idle';
      g.players.forEach(p => { p.status = 'idle'; p.active = null; });
      const [a, b] = g.players;
      if (a.score === b.score) { g.winnerId = null; g.endReason = 'draw'; }
      else { const w = a.score > b.score ? a : b; g.winnerId = w.id; g.endReason = 'win'; }
      const w = g.players.find(p => p.id === g.winnerId);
      log({ k: 'end', w: w ? w.name : null, b: w ? w.isBot : false, cn: w ? w.cn : undefined, s1: a.score, s2: b.score });
      push();
    }

    // ---------- Бот ----------
    const TIER_RANK = { ace: 3, good: 2, bad: 1 };
    // параметры сложности: ошибка угла (°), ошибка силы, шанс целиться в яблочко, шанс взять лучший нож, задержка
    const DIFF = {
      easy:   { angErr: 8.5, powErr: 0.075, bull: 0.1,  best: 0.2,  think: 1.8 },
      medium: { angErr: 3.8, powErr: 0.035, bull: 0.4,  best: 0.6,  think: 1.3 },
      hard:   { angErr: 1.1, powErr: 0.01,  bull: 0.8,  best: 1,    think: 1.0 },
      elite:  { angErr: 0.8, powErr: 0.007, bull: 0.9,  best: 1,    think: 0.9 },
      king:   { angErr: 0.5, powErr: 0.004, bull: 1,    best: 1,    think: 0.8 },
    };
    function botAim(bot, turnNo) {
      const mine = () => g.state === 'playing' && bot.status === 'aim' && bot.turnNo === turnNo;
      const D = DIFF[bot.lvl] || DIFF.medium;
      later((900 + Math.random() * 900) * D.think, () => {
        if (!mine()) return;
        // лучший нож (козырь важнее) — с вероятностью по сложности, иначе случайный
        const sorted = usable(bot).sort((x, y) => (TIER_RANK[y.tier] + (y.suit === g.trumpSuit ? 0.5 : 0)) - (TIER_RANK[x.tier] + (x.suit === g.trumpSuit ? 0.5 : 0)));
        if (!sorted.length) return;
        const pick = Math.random() < D.best ? sorted[0] : sorted[Math.floor(Math.random() * sorted.length)];
        take(bot.id, pick.id);
        later((1100 + Math.random() * 900) * D.think, () => {
          if (!mine() || !bot.active) return;
          const st = G.knifeStats(bot.active, g.trumpSuit);
          const hits = [];
          for (let a = -62; a <= 4; a += 1.5) for (let pw = 0.45; pw <= 1.001; pw += 0.015) {
            const r = G.simulate({ angle: a * Math.PI / 180, power: pw, stats: st, wind: g.wind, noNoise: true }).result;
            if (r.hit) hits.push({ a, pw, w: r.mult });
          }
          let a = -35, pw = 0.8;
          if (hits.length) {
            const best = hits.filter(h => h.w >= 1.5);
            const pool = best.length && Math.random() < D.bull ? best : hits;
            const h = pool[Math.floor(Math.random() * pool.length)];
            a = h.a + G.gauss(Math.random) * D.angErr; pw = h.pw + G.gauss(Math.random) * D.powErr;
          }
          out.aim({ o: bot.id, a: a * Math.PI / 180, p: pw });
          later(500, () => { if (mine()) doThrow(bot.id, a * Math.PI / 180, pw); });
        });
      });
    }

    function destroy() { clearTimers(); g.dead = true; }

    return { g, pub, summary, addPlayer, addBot, setHand, kickBot, removePlayer, start, take, doThrow, destroy, checkPassword: (pw) => !g.password || g.password === pw };
  }
  return { create };
})();
