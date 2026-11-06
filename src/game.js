// Общая логика «Нож дурака»: колода, характеристики ножей, баллистика, отрисовка ножей.
// Используется и сервером (Node), и браузером (window.KG).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KG = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- Мир ----------
  const W = 1000, H = 560, GROUND = 480;
  const STUMP_TOP = 300, STUMP_W = 70, FACE_X = 840; // пень соперника (в системе координат бросающего)
  const BULL_Y = 390;                                // «яблочко» на боку пня
  const HAND = { x: 75, y: 285 };                    // точка выброса
  const GRAV = 900, SPIN = Math.PI * 2, WIND_ACC = 80, KNIFE_HALF = 30;
  const TURN_MS = 35000;

  const SUITS = {
    clubs:    { sym: '♣', name: 'Крести', red: false, handle: '#2f6b3a' },
    diamonds: { sym: '♦', name: 'Бубны',  red: true,  handle: '#c7701d' },
    spades:   { sym: '♠', name: 'Пики',   red: false, handle: '#2a2a35' },
    hearts:   { sym: '♥', name: 'Черви',  red: true,  handle: '#a3192a' },
  };
  const SUIT_ORDER = ['clubs', 'diamonds', 'spades', 'hearts'];

  const TIERS = {
    ace:  { name: 'Туз',              rank: 'Т' },
    good: { name: 'Хороший нож',      rank: 'Х' },
    bad:  { name: 'Плохой нож',       rank: 'П' },
  };

  // Особые способности (тузы и козыри)
  const ABILITIES = {
    homing: { name: 'Самонаведение',    desc: 'в конце полёта доворачивает к пню' },
    calm:   { name: 'Штиль',            desc: 'ветер не действует' },
    double: { name: 'Двойной удар',     desc: 'очки за попадание ×2' },
    sticky: { name: 'Всегда втыкается', desc: 'втыкается под любым углом' },
    eagle:  { name: 'Орлиный глаз',     desc: 'видна вся траектория' },
    magnet: { name: 'Магнит',           desc: 'пень-мишень крупнее' },
    thief:  { name: 'Вор',              desc: 'при попадании крадёт 5 очков' },
    bounce: { name: 'Рикошет',          desc: 'один раз отскакивает от земли' },
    volley: { name: 'Залп',             desc: '12 кортиков веером, у каждого видна траектория; попадание — 3 очка' },
    bloodsword: { name: 'Меч Кровавого Короля', desc: 'летит в 2 раза медленнее, полная траектория, втыкается любой стороной клинка, очки ×2, его нельзя сбить — лишь чуть сбить с курса, при попадании крадёт лучшую карту соперника' },
    slowmo: { name: 'Слоумо',           desc: 'летит в 4 раза медленнее и втыкается любым концом; только первым броском в раунде' },
  };
  // Хорошие качества
  const QUALITIES = {
    balance: { name: 'Баланс',   desc: 'разброс −50%' },
    power:   { name: 'Сила',     desc: 'скорость броска +12%' },
    sharp:   { name: 'Острота',  desc: 'окно втыкания +20°' },
    light:   { name: 'Лёгкость', desc: 'гравитация −15%' },
    value:   { name: 'Ценность', desc: '+5 очков за попадание' },
    scope:   { name: 'Прицел',   desc: 'траектория видна дальше' },
  };
  // Недостатки плохих ножей
  const FLAWS = {
    crooked: { name: 'Кривой',  desc: 'разброс +50%' },
    dull:    { name: 'Тупой',   desc: 'окно втыкания −8°' },
    heavy:   { name: 'Тяжёлый', desc: 'гравитация +10%' },
    wobbly:  { name: 'Шаткий',  desc: 'вращается быстрее' },
  };

  // ---------- Колоды: 20 / 30 / 50 ножей ----------
  const SUIT_SHORT = { clubs: 'c', diamonds: 'd', spades: 's', hearts: 'h' };
  // Тузы: по одному на масть
  const ACES = {
    clubs:    ['Дубовый Король', 'royal',    ['magnet'], 'calm',   'value'],
    diamonds: ['Алмазный Шип',   'stiletto', ['double'], 'eagle',  'balance'],
    spades:   ['Чёрный Клык',    'dagger',   ['homing'], 'sticky', 'power'],
    hearts:   ['Алое Сердце',    'fang',     ['thief'],  'homing', 'sharp'],
  };
  // Особые тузы: заменяют последний хороший нож своей масти в каждой колоде
  const SPECIAL = [
    ['diamonds', 'A2-d', ['Дюжина кортиков', 'dirk',  ['volley'],                   'calm', 'balance']],
    ['spades',   'A2-s', ['Слоумо-нож',      'twin',  ['slowmo', 'double', 'eagle'], 'calm', 'value']],
  ];
  const VOLLEY_N = 12, VOLLEY_PTS = 3, SLOWMO = 4;
  // Редкий туз: попадает в колоду не в каждом матче (заменяет последний хороший нож червей)
  const RARE = ['hearts', 'A3-h', ['Меч Кровавого Короля', 'sword', ['bloodsword'], 'calm', 'power']];
  const RARE_CHANCE = 0.25;
  // Модели хороших ножей: [имя, форма, качества, козырная способность, козырное качество]
  const GOOD = [
    ['Боуи',       'bowie',     ['power', 'value'],   'bounce', 'balance'],
    ['Финка',      'finka',     ['balance', 'scope'], 'calm',   'sharp'],
    ['Танто',      'tanto',     ['sharp', 'power'],   'eagle',  'light'],
    ['Балисонг',   'butterfly', ['light', 'balance'], 'magnet', 'value'],
    ['Кукри',      'kukri',     ['value', 'sharp'],   'homing', 'power'],
    ['Кортик',     'dirk',      ['scope', 'light'],   'double', 'balance'],
    ['Скиннер',    'skinner',   ['balance', 'value'], 'sticky', 'scope'],
    ['Кунай',      'kunai',     ['light', 'sharp'],   'thief',  'power'],
    ['Керамбит',   'karambit',  ['sharp', 'scope'],   'bounce', 'value'],
    ['Сантоку',    'kitchen',   ['value', 'light'],   'calm',   'balance'],
    ['Охотничий',  'royal',     ['power', 'balance'], 'eagle',  'sharp'],
    ['Метательный','stiletto',  ['light', 'scope'],   'magnet', 'power'],
  ];
  // Модели плохих ножей: [имя, форма, недостатки, козырная способность, козырное качество]
  const BAD = [
    ['Ржавый тесак',     'cleaver',  ['heavy'],   'magnet', 'light'],
    ['Заточка',          'shiv',     ['crooked'], 'bounce', 'balance'],
    ['Нож для масла',    'butter',   ['dull'],    'sticky', 'value'],
    ['Перочинный',       'penknife', ['wobbly'],  'calm',   'sharp'],
    ['Сломанный клинок', 'broken',   ['crooked'], 'homing', 'sharp'],
    ['Хлеборез',         'bread',    ['heavy'],   'eagle',  'balance'],
    ['Кухонный',         'kitchen',  ['dull'],    'double', 'power'],
    ['Столовый',         'table',    ['wobbly'],  'bounce', 'light'],
    ['Пилка',            'bread',    ['dull'],    'thief',  'balance'],
    ['Тупой мачете',     'cleaver',  ['wobbly'],  'calm',   'value'],
    ['Пластиковый',      'table',    ['heavy'],   'homing', 'power'],
    ['Брелок',           'penknife', ['crooked'], 'magnet', 'sharp'],
  ];
  // Сколько хороших/плохих ножей каждой масти в колоде (порядок мастей: ♣ ♦ ♠ ♥)
  const LAYOUT = {
    20: { good: [2, 2, 2, 2], bad: [2, 2, 2, 2], hand: 2 },
    30: { good: [4, 3, 3, 3], bad: [3, 3, 3, 4], hand: 3 },
    50: { good: [6, 6, 6, 5], bad: [5, 6, 6, 6], hand: 5 },
  };
  const DECK_SIZES = [20, 30, 50];
  const HAND_SIZE = { 20: 2, 30: 3, 50: 5 };

  function mkCard(id, suit, tier, d, isBad) {
    return {
      id, suit, tier, name: d[0], shape: d[1],
      abilities: tier === 'ace' ? d[2] : [], qualities: tier === 'good' ? d[2] : [], flaws: isBad ? d[2] : [],
      trumpAbility: d[3], trumpQuality: d[4],
    };
  }
  function deckFor(size, opt) {
    const L = LAYOUT[size] || LAYOUT[20];
    const out = [];
    SUIT_ORDER.forEach((suit, si) => {
      const a = ACES[suit];
      out.push(mkCard('A-' + SUIT_SHORT[suit], suit, 'ace', a, false));
      for (let k = 0; k < L.good[si]; k++) out.push(mkCard(`G-${SUIT_SHORT[suit]}${k + 1}`, suit, 'good', GOOD[(si * 2 + k) % GOOD.length], false));
      for (let k = 0; k < L.bad[si]; k++) out.push(mkCard(`B-${SUIT_SHORT[suit]}${k + 1}`, suit, 'bad', BAD[(si * 2 + k) % BAD.length], true));
    });
    for (const [suit, id, d] of SPECIAL) {
      let i = -1; out.forEach((c, k) => { if (c.suit === suit && c.tier === 'good') i = k; });
      if (i >= 0) out[i] = mkCard(id, suit, 'ace', d, false);
    }
    if (opt && opt.rare) { let i = -1; out.forEach((c, k) => { if (c.suit === RARE[0] && c.tier === 'good') i = k; }); if (i >= 0) out[i] = mkCard(RARE[1], RARE[0], 'ace', RARE[2], false); }
    return out;
  }
  const CARDS = deckFor(20);
  const CARD_BY_ID = Object.fromEntries(deckFor(50).concat(deckFor(50, { rare: true })).map(c => [c.id, c]));

  const BASE = {
    ace:  { maxSpeed: 1100, gravityMul: 0.9,  spread: 0.5, stick: 100, spinMul: 1,   points: 30, preview: 0.7,  windMul: 0.5 },
    good: { maxSpeed: 1030, gravityMul: 1.0,  spread: 1.5, stick: 70,  spinMul: 1,   points: 15, preview: 0.4,  windMul: 0.9 },
    bad:  { maxSpeed: 960,  gravityMul: 1.08, spread: 3.0, stick: 44,  spinMul: 1.1, points: 7,  preview: 0.2,  windMul: 1.15 },
  };

  // Итоговые характеристики ножа с учётом козыря
  function knifeStats(card, trumpSuit) {
    const s = Object.assign({ magnet: 1 }, BASE[card.tier]);
    const trump = card.suit === trumpSuit;
    const abilities = card.abilities.slice();
    const qualities = card.qualities.slice();
    const flaws = card.flaws.slice();
    if (trump) {
      // Козырь: +1 особенность, +1 хорошее качество, летит лучше
      abilities.push(card.trumpAbility);
      qualities.push(card.trumpQuality);
      s.windMul *= 0.5;
      s.spread *= 0.6;
    }
    for (const q of qualities) {
      if (q === 'balance') s.spread *= 0.5;
      if (q === 'power') s.maxSpeed *= 1.12;
      if (q === 'sharp') s.stick += 20;
      if (q === 'light') s.gravityMul *= 0.85;
      if (q === 'value') s.points += 5;
      if (q === 'scope') s.preview += 0.25;
    }
    for (const f of flaws) {
      if (f === 'crooked') s.spread *= 1.5;
      if (f === 'dull') s.stick -= 8;
      if (f === 'heavy') s.gravityMul *= 1.1;
      if (f === 'wobbly') s.spinMul *= 1.25;
    }
    for (const a of abilities) {
      if (a === 'calm') s.windMul = 0;
      if (a === 'eagle') s.preview = 1;
      if (a === 'sticky') s.stick = 360;
      if (a === 'magnet') s.magnet = 1.4;
      if (a === 'slowmo') s.stick = 360;
      if (a === 'bloodsword') { s.stick = 360; s.preview = 1; }
      if (a === 'volley') s.points = VOLLEY_PTS;
    }
    // длина ножа в физике = длина по рисунку (длинный клинок достаёт до пня раньше)
    const shp = SH[card.shape];
    s.reach = shp ? (shp.sword ? 54 : shp.twin ? 36 : Math.max(26, Math.min(38, (shp.len + shp.handle) / 2))) : KNIFE_HALF;
    s.twin = !!(shp && shp.twin);
    // хлеборез, кухонный и тесак: широкий тяжёлый клинок легче вгрызается в дерево
    if (card.tier === 'bad' && ['bread', 'kitchen', 'cleaver'].includes(card.shape)) { s.stick += 22; s.spinMul *= 0.9; }
    s.preview = Math.min(1, s.preview);
    s.spread = Math.round(s.spread * 100) / 100;
    return Object.assign(s, {
      abilities, qualities, flaws, trump,
      extraAbility: trump ? card.trumpAbility : null,
      extraQuality: trump ? card.trumpQuality : null,
      has: (a) => abilities.includes(a),
    });
  }

  function cardWithStats(card, trumpSuit) {
    const st = knifeStats(card, trumpSuit);
    const { has, ...stats } = st;
    return Object.assign({}, card, { stats });
  }

  // ---------- Случайность ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.max(-2.5, Math.min(2.5, Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)));
  }
  function shuffle(arr, rnd = Math.random) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function norm(a) {
    a = a % (Math.PI * 2);
    if (a > Math.PI) a -= Math.PI * 2;
    if (a <= -Math.PI) a += Math.PI * 2;
    return a;
  }

  // ---------- Баллистика ----------
  // stats — объект из knifeStats (abilities — массив). angle в радианах (вправо = 0, вверх < 0), power 0..1
  function simulate({ angle, power, stats, wind = 0, seed = 1, noNoise = false, start = null }) {
    const has = (a) => stats.abilities.includes(a);
    const rng = mulberry32(seed);
    let a = angle, sp = Math.max(0, Math.min(1, power)) * stats.maxSpeed;
    if (!noNoise) {
      a += gauss(rng) * stats.spread * Math.PI / 180;
      sp *= 1 + gauss(rng) * stats.spread * 0.004;
    }
    let x = HAND.x, y = HAND.y, vx = Math.cos(a) * sp, vy = Math.sin(a) * sp, r = a;
    let omega = SPIN * stats.spinMul;
    if (start) ({ x, y, vx, vy, r, omega } = start);
    const EVERY = slowOf(stats) > 1 ? 1 : 2;   // медленные ножи: кадр на каждый шаг физики (×2 без подрисовки)   // продолжение полёта (меч после отклонения)
    const g = GRAV * stats.gravityMul;
    const ax = wind * WIND_ACC * stats.windMul;
    const big = stats.magnet > 1;
    const top = STUMP_TOP - (big ? 40 : 0);
    const face = FACE_X - (big ? 20 : 0);
    const right = FACE_X + STUMP_W + (big ? 20 : 0);
    const win = stats.stick * Math.PI / 360; // половина окна
    const reach = stats.reach || KNIFE_HALF, TIP = reach * 0.92;
    // настоящий пень (магнит только ловит, отскоки — от настоящего)
    const T0 = STUMP_TOP, F0 = FACE_X, R0 = FACE_X + STUMP_W;
    const lim = Math.min(win, 1.0);   // «всегда втыкается» тоже входит остриём, а не рукоятью
    const twin = !!stats.twin;        // клинки с обеих сторон: втыкается любым концом
    const flip = (rn) => (twin && Math.abs(rn) > Math.PI / 2 ? norm(rn + Math.PI) : rn);
    const topAngle = (r) => { const rn = flip(norm(r - Math.PI / 2)); return Math.PI / 2 + Math.max(-lim, Math.min(lim, rn)); };
    const inStump = (X, Y) => X >= F0 && X <= R0 && Y >= T0 && Y <= GROUND;
    // три точки ножа: остриё, центр, рукоять — [x, y, прошлый x, прошлый y, остриё?]
    const probes3 = (x, y, px, py, r, rp) => { const c = Math.cos(r), sn = Math.sin(r), cp = Math.cos(rp), sp = Math.sin(rp);
      return [[x + c * TIP, y + sn * TIP, px + cp * TIP, py + sp * TIP, true], [x, y, px, py, false], [x - c * TIP, y - sn * TIP, px - cp * TIP, py - sp * TIP, twin]]; };
    // выталкиваем нож целиком: вверх над торцом или в сторону от ближнего бока
    const pushOut = (ins, fromTop) => {
      if (fromTop) { y -= Math.max(...ins.map(q => q[1] - T0)) + 1; return; }
      const mid = (F0 + R0) / 2;
      if (x <= mid) x -= Math.max(...ins.map(q => q[0] - F0)) + 1; else x += Math.max(...ins.map(q => R0 - q[0])) + 1;
    };
    const dt = 1 / 120;
    const frames = [];
    const res = { hit: false, reason: 'Мимо', code: 'miss', mult: 0, points: 0, zone: null, stuck: null };
    let state = 'fly', bounced = false;
    const push = () => frames.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, r: Math.round(r * 1000) / 1000 });

    for (let i = 0; i < 720; i++) {
      const px = x, py = y;
      if (state === 'fly') {
        if (has('homing') && x > face - 330 && vx > 0) {
          const cur = Math.atan2(vy, vx);
          const des = Math.atan2(BULL_Y - y, face - x);
          const d = Math.max(-2.2 * dt, Math.min(2.2 * dt, norm(des - cur)));
          const spd = Math.hypot(vx, vy);
          vx = Math.cos(cur + d) * spd; vy = Math.sin(cur + d) * spd;
        }
        vx += ax * dt; vy += g * dt;
        x += vx * dt; y += vy * dt; r += omega * dt;

        const tipNow = x + TIP, tipPrev = px + TIP;
        const stickFace = stats.stick >= 360 || Math.abs(norm(r)) <= win;
        const stickTop = stats.stick >= 360 || Math.abs(norm(r - Math.PI / 2)) <= win;
        let done = false;
        // 1) остриё входит в бок (магнит ловит раньше, но нож втыкается в настоящий бок пня)
        if (tipPrev < face && tipNow >= face && y >= top && y <= GROUND) {
          if (stickFace) {
            const rn = flip(norm(r)), rr = Math.max(-lim, Math.min(lim, rn));
            r = rr; x = F0 + 10 - Math.cos(rr) * reach; y = Math.max(T0 + 6 - Math.sin(r) * TIP, Math.min(GROUND - 6 - Math.sin(r) * TIP, y));
            const dy = Math.abs(y - BULL_Y);
            if (dy <= 16) { res.mult = 2; res.zone = 'bull'; res.reason = 'Яблочко!'; res.code = 'bull'; }
            else if (dy <= 50) { res.mult = 1.5; res.zone = 'inner'; res.reason = 'Отличное попадание!'; res.code = 'inner'; }
            else { res.mult = 1; res.zone = 'outer'; res.reason = 'Попадание'; res.code = 'outer'; }
            res.hit = true; res.stuck = { x, y, r }; push(); break;
          }
        }
        // 2) магнит сверху: остриё пересекло расширенную зону — нож притягивается к торцу
        if (big) {
          const c = Math.cos(r), sn = Math.sin(r), rp = r - omega * dt;
          const X = x + c * TIP, Y = y + sn * TIP, PY = py + Math.sin(rp) * TIP;
          if (stickTop && PY < top && Y >= top && X >= face && X <= right && Y < T0 + 8) {
            const tx = Math.max(F0 + 6, Math.min(R0 - 6, X)), k = TIP - 8;
            r = topAngle(r); const c2 = Math.cos(r), s2 = Math.sin(r);
            res.hit = true; res.mult = 1; res.zone = 'top'; res.reason = 'В торец!'; res.code = 'top';
            x = tx - c2 * k; y = T0 + 8 - s2 * k; res.stuck = { x, y, r }; push(); break;
          }
        }
        // 3) настоящий пень: остриё, центр и рукоять
        const ins = probes3(x, y, px, py, r, r - omega * dt).filter(q => inStump(q[0], q[1]));
        if (ins.length) {
          const fromTop = ins.some(q => q[3] < T0);
          const tip = ins.find(q => q[4]);
          if (fromTop && tip && stickTop) {
            res.hit = true; res.mult = 1; res.zone = 'top'; res.reason = 'В торец!'; res.code = 'top';
            r = topAngle(r); const k = TIP - 8, c = Math.cos(r), sn = Math.sin(r);   // остриё входит в дерево на 8 px
            x = Math.max(F0 + 6, Math.min(R0 - 6, tip[0])) - c * k; y = T0 + 8 - sn * k;
            res.stuck = { x, y, r }; push(); break;
          }
          if (!fromTop && tip && stickFace && tip[2] < F0) {   // остриё зашло в бок между кадрами
            r = Math.max(-lim, Math.min(lim, flip(norm(r)))); x = F0 + 10 - Math.cos(r) * reach; y = Math.max(T0 + 6 - Math.sin(r) * TIP, Math.min(GROUND - 6 - Math.sin(r) * TIP, y));
            const dy = Math.abs(y - BULL_Y);
            if (dy <= 16) { res.mult = 2; res.zone = 'bull'; res.reason = 'Яблочко!'; res.code = 'bull'; }
            else if (dy <= 50) { res.mult = 1.5; res.zone = 'inner'; res.reason = 'Отличное попадание!'; res.code = 'inner'; }
            else { res.mult = 1; res.zone = 'outer'; res.reason = 'Попадание'; res.code = 'outer'; }
            res.hit = true; res.stuck = { x, y, r }; push(); break;
          }
          pushOut(ins, fromTop);
          if (fromTop) { vy = -Math.abs(vy) * 0.3; vx *= 0.4; omega *= -1.3; res.reason = 'Отскочил от торца'; res.code = 'bounce_top'; }
          else { vx = -Math.abs(vx) * 0.25; vy = Math.min(vy, -140); omega *= -1.4; res.reason = 'Отскочил от пня'; res.code = 'bounce_face'; }
          state = 'fall';
        }
      } else {
        vy += g * dt; x += vx * dt; y += vy * dt; r += omega * 0.6 * dt;
        const ins = probes3(x, y, px, py, r, r - omega * 0.6 * dt).filter(q => inStump(q[0], q[1]));
        if (ins.length) {
          const fromTop = ins.some(q => q[3] < T0);
          pushOut(ins, fromTop);
          if (fromTop) {
            if (x >= F0 + 4 && x <= R0 - 4 && Math.abs(vy) < 260) { r = Math.cos(r) > 0 ? 0.03 : Math.PI - 0.03; y = T0 - 4; push(); break; }   // лёг на торец
            if (x < F0 + 4 || x > R0 - 4) { vx = (x < (F0 + R0) / 2 ? -1 : 1) * Math.max(90, Math.abs(vx)); vy = Math.max(0, -Math.abs(vy) * 0.2); omega = (vx > 0 ? 1 : -1) * 5; }   // центр за краем — соскальзывает
            else { vy = -Math.abs(vy) * 0.3; vx *= 0.6; omega *= -0.8; }
          } else vx = -vx * 0.3;
        }
      }

      if (y >= GROUND) {
        if (state === 'fly' && has('bounce') && !bounced) {
          bounced = true; y = GROUND - 1; vy = -Math.abs(vy) * 0.5; vx *= 0.75;
        } else {
          y = GROUND - 2;
          if (Math.sin(r) > 0.5) { y = GROUND + 6; } else { r = Math.cos(r) > 0 ? 0.04 : Math.PI - 0.04; }
          if (state === 'fly') { res.reason = 'В землю'; res.code = 'ground'; }
          const ins3 = probes3(x, y, x, y - 20, r, r).filter(q => inStump(q[0], q[1]) && q[1] < GROUND - 2);
          if (ins3.length) pushOut(ins3, false);
          push();
          break;
        }
      }
      if (x > W + 80 || x < -80 || y < -600) { if (state === 'fly') { res.reason = 'Улетел'; res.code = 'out'; } push(); break; }
      if (i % EVERY === 0) push();
    }
    if (res.hit) {
      res.points = Math.round(stats.points * res.mult * (has('double') || has('bloodsword') ? 2 : 1));
    }
    // слоумо (×4) и меч (×2): та же траектория, но время растянуто
    const SL = slowOf(stats) / (3 - EVERY);   // остаток растяжения подрисовываем (слоумо ×4 = ×2 шагов · ×2)
    if (SL > 1 && frames.length > 1) {
      const sl = [];
      for (let k = 0; k < frames.length - 1; k++) { const a = frames[k], b = frames[k + 1];
        for (let j = 0; j < SL; j++) { const t = j / SL; sl.push({ x: Math.round((a.x + (b.x - a.x) * t) * 10) / 10, y: Math.round((a.y + (b.y - a.y) * t) * 10) / 10, r: Math.round((a.r + (b.r - a.r) * t) * 1000) / 1000 }); } }
      sl.push(frames[frames.length - 1]);
      return { frames: sl, result: res };
    }
    return { frames, result: res };
  }
  const slowOf = (stats) => (stats.abilities.includes('slowmo') ? SLOWMO : stats.abilities.includes('bloodsword') ? 2 : 1);
  // меч не сбивается: от удара его траектория отклоняется на kick радиан, скорость падает на 12%
  function deflect(frames, at, stats, wind, kick) {
    const SL = slowOf(stats);
    at = Math.max(1, Math.min(frames.length - 2, at | 0));
    const a = frames[at - 1], b = frames[at], k = 60 * SL;   // соседние кадры отстоят на 1/(60·SL) с полёта
    let vx = (b.x - a.x) * k, vy = (b.y - a.y) * k;
    const sp = Math.hypot(vx, vy) * 0.88, an = Math.atan2(vy, vx) + kick;
    vx = Math.cos(an) * sp; vy = Math.sin(an) * sp;
    const sim = simulate({ angle: 0, power: 0, stats, wind, noNoise: true, start: { x: b.x, y: b.y, vx, vy, r: b.r, omega: (b.r - a.r) * k + kick * 6 } });
    return { frames: frames.slice(0, at + 1).concat(sim.frames.slice(1)), result: sim.result };
  }
  // залп: 12 кортиков веером. Первый летит точно в прицел, остальные — с небольшим разбросом угла и силы
  function volleyShots(angle, power) {
    const out = [];
    for (let i = 0; i < VOLLEY_N; i++) {
      const k = i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2);
      out.push({ angle: angle + k * 0.034, power: Math.max(0, Math.min(1, power * (1 + ((i % 3) - 1) * 0.025))) });
    }
    return out;
  }
  // бросок с учётом особых тузов: возвращает основной нож и (для залпа) остальные
  function throwSim(o) {
    if (!o.stats.abilities.includes('volley')) return simulate(o);
    const shots = volleyShots(o.angle, o.power).map((v, i) => simulate(Object.assign({}, o, v, { seed: ((o.seed || 1) + i * 7919) | 0 })));
    const hits = shots.filter(x => x.result.hit).length;
    const main = shots[0];
    const res = Object.assign({}, main.result, { hit: hits > 0, points: hits * VOLLEY_PTS, volley: hits,
      code: hits ? 'volley' : main.result.code, reason: hits ? `Залп: ${hits} из ${VOLLEY_N}` : main.result.reason,
      stucks: shots.filter(x => x.result.hit).map(x => x.result.stuck) });
    res.stuck = null;
    return { frames: main.frames, result: res, extra: shots.slice(1).map(x => x.frames), dur: Math.max(...shots.map(x => x.frames.length)) };
  }

  // ---------- Английские названия ----------
  const EN = {
    suits: { clubs: 'Clubs', diamonds: 'Diamonds', spades: 'Spades', hearts: 'Hearts' },
    tiers: { ace: ['Ace', 'A'], good: ['Good knife', 'G'], bad: ['Bad knife', 'B'] },
    abilities: {
      homing: ['Homing', 'curves toward the stump late in flight'], calm: ['Calm', 'wind has no effect'],
      double: ['Double Strike', 'hit points ×2'], sticky: ['Always Sticks', 'sticks at any angle'],
      eagle: ['Eagle Eye', 'full trajectory shown'], magnet: ['Magnet', 'bigger target stump'],
      thief: ['Thief', 'steals 5 points on a hit'], bounce: ['Ricochet', 'bounces off the ground once'],
      volley: ['Volley', '12 dirks in a fan, every trajectory shown; 3 points per hit'],
      bloodsword: ['Blood King\'s Sword', 'flies 2× slower, full trajectory, sticks with any side of the blade, points ×2, can\'t be knocked down (only nudged off course), steals your opponent\'s best card on a hit'],
      slowmo: ['Slowmo', 'flies 4× slower and sticks with either end; only as your first throw of a round'],
    },
    qualities: {
      balance: ['Balance', 'spread −50%'], power: ['Power', 'throw speed +12%'], sharp: ['Sharpness', 'stick window +20°'],
      light: ['Lightness', 'gravity −15%'], value: ['Value', '+5 points per hit'], scope: ['Sight', 'longer trajectory preview'],
    },
    flaws: { crooked: ['Crooked', 'spread +50%'], dull: ['Dull', 'stick window −8°'], heavy: ['Heavy', 'gravity +10%'], wobbly: ['Wobbly', 'spins faster'] },
    names: {
      'Дубовый Король': 'Oak King', 'Алмазный Шип': 'Diamond Thorn', 'Чёрный Клык': 'Black Fang', 'Алое Сердце': 'Scarlet Heart',
      'Боуи': 'Bowie', 'Финка': 'Finka', 'Танто': 'Tanto', 'Балисонг': 'Balisong', 'Кукри': 'Kukri', 'Кортик': 'Dirk',
      'Скиннер': 'Skinner', 'Кунай': 'Kunai', 'Керамбит': 'Karambit', 'Сантоку': 'Santoku', 'Охотничий': 'Hunter', 'Метательный': 'Thrower',
      'Ржавый тесак': 'Rusty Cleaver', 'Заточка': 'Shiv', 'Нож для масла': 'Butter Knife', 'Перочинный': 'Penknife',
      'Сломанный клинок': 'Broken Blade', 'Хлеборез': 'Bread Knife', 'Кухонный': 'Kitchen Knife', 'Столовый': 'Table Knife',
      'Пилка': 'Nail File', 'Тупой мачете': 'Dull Machete', 'Пластиковый': 'Plastic Knife', 'Брелок': 'Keychain Knife',
      'Дюжина кортиков': 'Dozen Dirks', 'Слоумо-нож': 'Slowmo Blade', 'Меч Кровавого Короля': 'Blood King\'s Sword',
    },
    reasons: {
      miss: 'Miss', bull: 'Bullseye!', inner: 'Great hit!', outer: 'Hit', top: 'Into the top!', bounce_face: 'Bounced off the stump',
      bounce_top: 'Bounced off the top', ground: 'Into the ground', out: 'Flew away', timeout: 'Time is up',
      knock: 'Knocked the enemy knife!', knocked: 'Knocked out of the air!', volley: 'Volley hit!',
    },
  };
  const RU_REASONS = {
    miss: 'Мимо', bull: 'Яблочко!', inner: 'Отличное попадание!', outer: 'Попадание', top: 'В торец!', bounce_face: 'Отскочил от пня',
    bounce_top: 'Отскочил от торца', ground: 'В землю', out: 'Улетел', timeout: 'Время вышло',
    knock: 'Сбил нож соперника!', knocked: 'Сбит в воздухе!', volley: 'Залп попал!',
  };

  // ---------- Столкновение ножей в воздухе ----------
  const KNOCK_DIST = 38;
  // Обрезать траекторию на кадре idx и дописать падение сбитого ножа (детерминированно)
  function knockFrames(frames, idx) {
    idx = Math.max(0, Math.min(frames.length - 1, idx | 0));
    const out = frames.slice(0, idx + 1);
    const f = frames[idx], pf = frames[Math.max(0, idx - 1)];
    let vx = (f.x - pf.x) * 60, vy = (f.y - pf.y) * 60;
    vx = -vx * 0.25; vy = Math.min(vy, 0) * 0.2 - 160;
    let x = f.x, y = f.y, r = f.r;
    const dt = 1 / 60;
    for (let k = 0; k < 400; k++) {
      vy += GRAV * dt; x += vx * dt; y += vy * dt; r += 14 * dt;
      if (y >= GROUND - 2) { out.push({ x: Math.round(x * 10) / 10, y: GROUND - 2, r: Math.cos(r) > 0 ? 0.04 : Math.PI - 0.04 }); break; }
      out.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, r: Math.round(r * 1000) / 1000 });
    }
    return out;
  }
  // Ищет столкновение нового ножа (кадры newF) с чужим ножом oldF, который летит уже offset кадров.
  // Чужой нож в зеркальной системе координат. Возвращает {i, j} или null.
  function findCollision(newF, oldF, offset) {
    for (let i = 0; i < newF.length; i++) {
      const j = offset + i;
      if (j >= oldF.length - 1) return null;          // чужой нож уже долетел
      if (j < 0) continue;
      const A = newF[i], B = oldF[j];
      if (A.y >= GROUND - 4 || B.y >= GROUND - 4) continue;
      const dx = A.x - (W - B.x), dy = A.y - B.y;
      if (dx * dx + dy * dy < KNOCK_DIST * KNOCK_DIST) return { i, j };
    }
    return null;
  }

  // ---------- Отрисовка ножа (только браузер) ----------
  const SH = {
    royal:     { len: 54, w: 10, handle: 26, guard: 18, pts: [[0,-.6],[.6,-.6],[.78,-.35],[1,.1],[.85,.6],[0,.6]], pommel: true },
    stiletto:  { len: 56, w: 6,  handle: 24, guard: 16, pts: [[0,-.5],[1,0],[0,.5]], pommel: true },
    dagger:    { len: 52, w: 10, handle: 24, guard: 18, pts: [[0,-.7],[.7,-.45],[1,0],[.7,.45],[0,.7]], pommel: true },
    sword:     { len: 84, w: 8, handle: 22, guard: 0, pts: [[0,0]], sword: true },
    twin:      { len: 30, w: 8, handle: 16, guard: 0, pts: [[0,0]], twin: true },
    karambit:  { len: 36, w: 9, handle: 24, guard: 0, pts: [[0,0]], karambit: true },
    fang:      { len: 50, w: 10, handle: 24, guard: 14, pts: [[0,-.5],[.5,-.75],[.85,-.4],[1,.4],[.78,.05],[.4,.5],[0,.6]], pommel: true },
    bowie:     { len: 46, w: 9,  handle: 24, guard: 14, pts: [[0,-.6],[.62,-.6],[.78,-.35],[1,.15],[.85,.6],[0,.6]] },
    finka:     { len: 40, w: 8,  handle: 26, guard: 10, pts: [[0,-.5],[.75,-.5],[1,.1],[.7,.55],[0,.55]] },
    tanto:     { len: 42, w: 9,  handle: 24, guard: 12, pts: [[0,-.55],[.8,-.55],[1,-.2],[.88,.55],[0,.55]] },
    butterfly: { len: 40, w: 7,  handle: 28, guard: 0,  pts: [[0,-.45],[.8,-.45],[1,0],[.85,.45],[0,.45]], split: true },
    kukri:     { len: 44, w: 10, handle: 24, guard: 8,  pts: [[0,-.4],[.45,-.9],[.8,-.5],[1,.2],[.6,.9],[.3,.4],[0,.5]] },
    dirk:      { len: 48, w: 8,  handle: 24, guard: 16, pts: [[0,-.5],[1,0],[0,.5]] },
    skinner:   { len: 38, w: 10, handle: 26, guard: 6,  pts: [[0,-.5],[.5,-.6],[.9,-.2],[1,.3],[.6,.7],[0,.6]] },
    kunai:     { len: 36, w: 10, handle: 22, guard: 0,  pts: [[0,-.2],[.25,-.9],[1,0],[.25,.9],[0,.2]], ring: true },
    cleaver:   { len: 40, w: 12, handle: 24, guard: 0,  pts: [[0,-.9],[.95,-.9],[1,.9],[0,.9]] },
    shiv:      { len: 34, w: 6,  handle: 22, guard: 0,  pts: [[0,-.4],[.3,-.6],[.5,-.3],[.7,-.5],[1,0],[.6,.4],[.3,.25],[0,.5]], rag: true },
    butter:    { len: 36, w: 7,  handle: 26, guard: 0,  pts: [[0,-.4],[.85,-.4],[.97,-.2],[1,0],[.97,.2],[.85,.4],[0,.4]] },
    penknife:  { len: 26, w: 6,  handle: 30, guard: 0,  pts: [[0,-.4],[.7,-.4],[1,.1],[.8,.4],[0,.4]], fat: true },
    broken:    { len: 40, w: 9,  handle: 24, guard: 10, pts: [[0,-.6],[.55,-.6],[.62,-.1],[.5,.2],[.58,.6],[0,.6]] },
    bread:     { len: 50, w: 8,  handle: 24, guard: 0,  pts: null },
    kitchen:   { len: 46, w: 10, handle: 24, guard: 0,  pts: [[0,-.4],[.6,-.4],[1,.1],[.7,.8],[0,.8]] },
    table:     { len: 36, w: 6,  handle: 26, guard: 0,  pts: [[0,-.3],[.9,-.3],[1,.1],[.9,.35],[0,.35]] },
  };
  (function () {
    const p = [[0,-.5],[.92,-.5],[1,.2]];
    for (let i = 0; i <= 12; i++) { const x = 1 - i / 12 * 0.95; p.push([x, i % 2 ? .5 : .32]); }
    p.push([0, .5]);
    SH.bread.pts = p;
  })();

  const ACE_BLADE = {
    clubs: ['#fff3b0', '#d4a52c'], diamonds: ['#e8fbff', '#62c7e6'],
    spades: ['#6a6380', '#15131c'], hearts: ['#ffd7d7', '#c8263b'],
  };

  // меч Кровавого Короля: длинный клинок с долом, кровь у острия, крестовина с рубином, тёмно-красное свечение
  function drawSword(ctx, card, sh, opt) {
    const L = sh.len, w = sh.w, hl = sh.handle, t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    const glow = 0.5 + 0.5 * Math.sin(t * 2);
    ctx.translate(-(L - hl) / 2, 0);
    // рукоять, навершие
    ctx.fillStyle = '#2a0a0e'; ctx.fillRect(-hl, -3.4, hl, 6.8);
    ctx.strokeStyle = '#9a1622'; ctx.lineWidth = 1.6; for (let i = 0; i < 5; i++) { const x = -hl + 2 + i * 4; ctx.beginPath(); ctx.moveTo(x, -3.4); ctx.lineTo(x + 3, 3.4); ctx.stroke(); }
    ctx.fillStyle = '#d4a23a'; ctx.beginPath(); ctx.arc(-hl - 3, 0, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#b3121f'; ctx.beginPath(); ctx.arc(-hl - 3, 0, 2, 0, Math.PI * 2); ctx.fill();
    // клинок
    ctx.shadowColor = `rgba(200,20,40,${0.45 + glow * 0.5})`; ctx.shadowBlur = 5 + glow * 10;
    ctx.beginPath(); ctx.moveTo(0, -w * 0.62); ctx.lineTo(L * 0.86, -w * 0.5); ctx.lineTo(L, 0); ctx.lineTo(L * 0.86, w * 0.5); ctx.lineTo(0, w * 0.62); ctx.closePath();
    const gr = ctx.createLinearGradient(0, -w, 0, w); gr.addColorStop(0, '#f2f4f7'); gr.addColorStop(0.5, '#a9b2bd'); gr.addColorStop(1, '#5d6672');
    ctx.fillStyle = gr; ctx.fill(); ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(30,10,10,.7)'; ctx.lineWidth = 0.9; ctx.stroke();
    // дол с кровью
    ctx.strokeStyle = '#7a0d16'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(L * 0.72, 0); ctx.stroke();
    ctx.fillStyle = 'rgba(150,10,22,.9)'; ctx.beginPath(); ctx.moveTo(L * 0.7, -w * 0.5); ctx.lineTo(L * 0.86, -w * 0.5); ctx.lineTo(L, 0); ctx.lineTo(L * 0.86, w * 0.5); ctx.lineTo(L * 0.76, w * 0.52);
    ctx.quadraticCurveTo(L * 0.74, w * 0.1, L * 0.7, w * 0.4); ctx.quadraticCurveTo(L * 0.66, 0, L * 0.7, -w * 0.5); ctx.fill();
    ctx.beginPath(); ctx.arc(L * 0.62, w * 0.25, 1.4, 0, Math.PI * 2); ctx.arc(L * 0.55, -w * 0.2, 1, 0, Math.PI * 2); ctx.fill();
    // крестовина
    ctx.fillStyle = '#3a3036'; ctx.beginPath(); ctx.moveTo(-3, -12); ctx.lineTo(3, -10); ctx.lineTo(3, 10); ctx.lineTo(-3, 12); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#d4a23a'; ctx.fillRect(-3.5, -13, 7, 3); ctx.fillRect(-3.5, 10, 7, 3);
    ctx.save(); ctx.shadowColor = '#ff2a3a'; ctx.shadowBlur = 4 + glow * 8; ctx.fillStyle = '#e0162a'; ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }

  // слоумо-нож: рукоять в центре, клинки с обеих сторон, пульсирующее синее свечение
  function drawTwin(ctx, card, sh, suit, opt) {
    const L = sh.len, w = sh.w, h = sh.handle / 2, t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    const glow = 0.55 + 0.45 * Math.sin(t * 2.6);
    ctx.shadowColor = `rgba(80,170,255,${0.55 + glow * 0.45})`; ctx.shadowBlur = 6 + glow * 14;
    for (const d of [1, -1]) {
      ctx.beginPath(); ctx.moveTo(d * h, -w * 0.55); ctx.lineTo(d * (h + L * 0.8), -w * 0.55); ctx.lineTo(d * (h + L), 0); ctx.lineTo(d * (h + L * 0.8), w * 0.55); ctx.lineTo(d * h, w * 0.55); ctx.closePath();
      const gr = ctx.createLinearGradient(0, -w, 0, w); gr.addColorStop(0, '#eaf6ff'); gr.addColorStop(0.5, '#9fd0ff'); gr.addColorStop(1, '#4f86c6');
      ctx.fillStyle = gr; ctx.fill();
    }
    ctx.shadowBlur = 0;
    for (const d of [1, -1]) {
      ctx.beginPath(); ctx.moveTo(d * h, -w * 0.55); ctx.lineTo(d * (h + L * 0.8), -w * 0.55); ctx.lineTo(d * (h + L), 0); ctx.lineTo(d * (h + L * 0.8), w * 0.55); ctx.lineTo(d * h, w * 0.55); ctx.closePath();
      ctx.strokeStyle = 'rgba(20,50,90,.7)'; ctx.lineWidth = 0.9; ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${0.5 + glow * 0.4})`; ctx.beginPath(); ctx.moveTo(d * (h + 2), -w * 0.15); ctx.lineTo(d * (h + L * 0.78), -w * 0.15); ctx.stroke();
    }
    ctx.fillStyle = '#e3b341'; ctx.fillRect(-h - 2, -w * 0.95, 4, w * 1.9); ctx.fillRect(h - 2, -w * 0.95, 4, w * 1.9);
    ctx.fillStyle = suit.handle; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1;
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(-h + 2, -4.5, h * 2 - 4, 9, 3); else ctx.rect(-h + 2, -4.5, h * 2 - 4, 9); ctx.fill(); ctx.stroke();
    ctx.save(); ctx.shadowColor = '#7fc4ff'; ctx.shadowBlur = 6 + glow * 8; ctx.fillStyle = `rgba(150,215,255,${0.6 + glow * 0.4})`;
    ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }

  // керамбит: изогнутая рукоять с кольцом для пальца и клинок-коготь, загнутый вниз
  function drawKarambit(ctx, card, sh, suit, opt) {
    const L = sh.len, w = sh.w, hl = sh.handle;
    // кольцо на конце рукояти
    ctx.lineWidth = 4.2; ctx.strokeStyle = '#2b2b31'; ctx.beginPath(); ctx.arc(-hl - 5, 4, 6.5, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 2.6; ctx.strokeStyle = '#a7afb8'; ctx.stroke();
    ctx.shadowBlur = 0;
    // рукоять: изгиб вниз к кольцу
    ctx.fillStyle = suit.handle; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(2, -4.5); ctx.quadraticCurveTo(-hl * 0.5, -6.5, -hl + 1, -1.5);
    ctx.lineTo(-hl + 2, 6.5); ctx.quadraticCurveTo(-hl * 0.5, 4, 2, 4.5); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.2)';
    for (let i = 1; i < 4; i++) { const x = -hl + (hl / 4) * i; ctx.beginPath(); ctx.moveTo(x, -4.5); ctx.lineTo(x - 2, 4); ctx.stroke(); }
    ctx.fillStyle = '#c9ced4'; [[-hl * 0.3, 0], [-hl * 0.75, 1.5]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 1.3, 0, Math.PI * 2); ctx.fill(); });
    // клинок-коготь
    if (opt.trump) ctx.shadowBlur = 14;
    const tx = L * 0.9, ty = w * 1.75;
    ctx.beginPath(); ctx.moveTo(0, -4.5);
    ctx.bezierCurveTo(L * 0.42, -w * 1.55, L * 1.08, -w * 1.05, tx, ty);          // обух: дугой вверх и вниз к острию
    ctx.bezierCurveTo(L * 0.82, w * 0.35, L * 0.4, -w * 0.05, 0, 4.5);             // вогнутая режущая кромка
    ctx.closePath();
    const gr = ctx.createLinearGradient(0, -w * 1.3, 0, w * 1.4);
    if (card.tier === 'ace') { const c = ACE_BLADE[card.suit]; gr.addColorStop(0, c[0]); gr.addColorStop(1, c[1]); }
    else if (card.tier === 'good') { gr.addColorStop(0, '#f4f7fa'); gr.addColorStop(1, '#7f8c9a'); }
    else { gr.addColorStop(0, '#b3a68e'); gr.addColorStop(1, '#5e5444'); }
    ctx.fillStyle = gr; ctx.fill(); ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 0.9; ctx.stroke();
    // заточка вдоль внутренней кромки и блик на обухе
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(3, 2.2); ctx.bezierCurveTo(L * 0.4, -w * 0.25, L * 0.78, w * 0.2, tx - 1, ty - 3); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.45)';
    ctx.beginPath(); ctx.moveTo(4, -5); ctx.bezierCurveTo(L * 0.4, -w * 1.25, L * 0.85, -w * 1.0, L * 0.95, -w * 0.1); ctx.stroke();
  }

  function drawKnife(ctx, card, opt) {
    opt = opt || {};
    const sh = SH[card.shape] || SH.bowie;
    const suit = SUITS[card.suit];
    const L = sh.len, w = sh.w, hl = sh.handle, hw = sh.fat ? 6 : 4.5;
    ctx.save();
    if (sh.twin) { drawTwin(ctx, card, sh, suit, opt); ctx.restore(); return; }
    if (sh.sword) { drawSword(ctx, card, sh, opt); ctx.restore(); return; }
    ctx.translate(-(L - hl) / 2, 0);
    if (opt.trump) { ctx.shadowColor = 'rgba(255,214,90,.95)'; ctx.shadowBlur = 14; }
    if (sh.karambit) { drawKarambit(ctx, card, sh, suit, opt); ctx.restore(); return; }
    // рукоять
    ctx.fillStyle = suit.handle;
    ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1;
    if (sh.split) {
      ctx.fillRect(-hl, -hw, hl, 3); ctx.fillRect(-hl, hw - 3, hl, 3);
      ctx.fillStyle = '#888'; ctx.fillRect(-hl - 3, -hw, 3, hw * 2);
    } else {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-hl, -hw, hl, hw * 2, 3); else ctx.rect(-hl, -hw, hl, hw * 2);
      ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,.18)';
      for (let i = 1; i < 5; i++) { const x = -hl + (hl / 5) * i; ctx.beginPath(); ctx.moveTo(x, -hw + 1); ctx.lineTo(x - 2, hw - 1); ctx.stroke(); }
      if (sh.rag) { ctx.fillStyle = '#c9b48a'; ctx.fillRect(-hl * 0.7, -hw - 1, hl * 0.5, hw * 2 + 2); }
    }
    if (sh.ring) { ctx.strokeStyle = '#999'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(-hl - 5, 0, 5, 0, Math.PI * 2); ctx.stroke(); }
    if (sh.pommel) { ctx.fillStyle = card.tier === 'ace' ? '#e3b341' : '#999'; ctx.beginPath(); ctx.arc(-hl - 2, 0, 4.5, 0, Math.PI * 2); ctx.fill(); }
    // гарда
    if (sh.guard) {
      ctx.fillStyle = card.tier === 'ace' ? '#e3b341' : card.tier === 'good' ? '#8d949c' : '#6b6152';
      ctx.fillRect(-3, -sh.guard / 2, 5, sh.guard);
    }
    // клинок
    if (opt.trump) ctx.shadowBlur = 14;
    ctx.beginPath();
    sh.pts.forEach((p, i) => { const X = p[0] * L, Y = p[1] * w; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
    ctx.closePath();
    const gr = ctx.createLinearGradient(0, -w, 0, w);
    let c1, c2;
    if (card.tier === 'ace') [c1, c2] = ACE_BLADE[card.suit];
    else if (card.tier === 'good') { c1 = '#f4f7fa'; c2 = '#8c99a7'; }
    else { c1 = '#b3a68e'; c2 = '#5e5444'; }
    gr.addColorStop(0, c1); gr.addColorStop(1, c2);
    ctx.fillStyle = gr; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = card.tier === 'ace' ? 'rgba(80,50,0,.8)' : 'rgba(0,0,0,.55)';
    ctx.lineWidth = 0.9; ctx.stroke();
    // дол / блик
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(3, -w * 0.15); ctx.lineTo(L * 0.6, -w * 0.15); ctx.stroke();
    if (card.tier === 'bad') {
      ctx.fillStyle = 'rgba(140,60,20,.6)';
      [[.2, .1], [.45, -.2], [.65, .25], [.35, .3]].forEach(([a, b]) => { ctx.beginPath(); ctx.arc(a * L, b * w, 2.2, 0, Math.PI * 2); ctx.fill(); });
    }
    ctx.restore();
  }

  return {
    W, H, GROUND, STUMP_TOP, STUMP_W, FACE_X, BULL_Y, HAND, KNIFE_HALF, TURN_MS,
    EN, RU_REASONS, SUITS, SUIT_ORDER, TIERS, ABILITIES, QUALITIES, FLAWS, CARDS, CARD_BY_ID, deckFor, DECK_SIZES, HAND_SIZE,
    knifeStats, cardWithStats, simulate, throwSim, deflect, RARE_CHANCE, volleyShots, VOLLEY_N, knockFrames, findCollision, shuffle, mulberry32, gauss, norm, drawKnife,
  };
});
