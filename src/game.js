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
  function deckFor(size) {
    const L = LAYOUT[size] || LAYOUT[20];
    const out = [];
    SUIT_ORDER.forEach((suit, si) => {
      const a = ACES[suit];
      out.push(mkCard('A-' + SUIT_SHORT[suit], suit, 'ace', a, false));
      for (let k = 0; k < L.good[si]; k++) out.push(mkCard(`G-${SUIT_SHORT[suit]}${k + 1}`, suit, 'good', GOOD[(si * 2 + k) % GOOD.length], false));
      for (let k = 0; k < L.bad[si]; k++) out.push(mkCard(`B-${SUIT_SHORT[suit]}${k + 1}`, suit, 'bad', BAD[(si * 2 + k) % BAD.length], true));
    });
    return out;
  }
  const CARDS = deckFor(20);
  const CARD_BY_ID = Object.fromEntries(deckFor(50).map(c => [c.id, c]));

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
    }
    // длина ножа в физике = длина по рисунку (длинный клинок достаёт до пня раньше)
    const shp = SH[card.shape];
    s.reach = shp ? Math.max(26, Math.min(38, (shp.len + shp.handle) / 2)) : KNIFE_HALF;
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
  function simulate({ angle, power, stats, wind = 0, seed = 1, noNoise = false }) {
    const has = (a) => stats.abilities.includes(a);
    const rng = mulberry32(seed);
    let a = angle, sp = Math.max(0, Math.min(1, power)) * stats.maxSpeed;
    if (!noNoise) {
      a += gauss(rng) * stats.spread * Math.PI / 180;
      sp *= 1 + gauss(rng) * stats.spread * 0.004;
    }
    let x = HAND.x, y = HAND.y, vx = Math.cos(a) * sp, vy = Math.sin(a) * sp, r = a;
    let omega = SPIN * stats.spinMul;
    const g = GRAV * stats.gravityMul;
    const ax = wind * WIND_ACC * stats.windMul;
    const big = stats.magnet > 1;
    const top = STUMP_TOP - (big ? 40 : 0);
    const face = FACE_X - (big ? 20 : 0);
    const right = FACE_X + STUMP_W + (big ? 20 : 0);
    const win = stats.stick * Math.PI / 360; // половина окна
    const reach = stats.reach || KNIFE_HALF, TIP = reach * 0.92;
    const inStump = (X, Y) => X >= face && X <= right && Y >= top && Y <= GROUND;
    // три точки ножа: остриё, центр, рукоять — [x, y, прошлый x, прошлый y, остриё?]
    const probes3 = (x, y, px, py, r, rp) => { const c = Math.cos(r), sn = Math.sin(r), cp = Math.cos(rp), sp = Math.sin(rp);
      return [[x + c * TIP, y + sn * TIP, px + cp * TIP, py + sp * TIP, true], [x, y, px, py, false], [x - c * TIP, y - sn * TIP, px - cp * TIP, py - sp * TIP, false]]; };
    // выталкиваем нож целиком: вверх над торцом или в сторону от ближнего бока
    const pushOut = (ins, fromTop) => {
      if (fromTop) { y -= Math.max(...ins.map(q => q[1] - top)) + 1; return; }
      const mid = (face + right) / 2;
      if (x <= mid) x -= Math.max(...ins.map(q => q[0] - face)) + 1; else x += Math.max(...ins.map(q => right - q[0])) + 1;
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
        if (tipPrev < face && tipNow >= face && y >= top && y <= GROUND) {
          // удар в бок пня
          const rn = norm(r);
          if (stats.stick >= 360 || Math.abs(rn) <= win) {
            const rr = Math.abs(rn) <= win ? rn : Math.sign(rn || 1) * Math.min(Math.abs(rn), 0.6);
            r = rr;
            x = face + 10 - Math.cos(rr) * reach;
            const dy = Math.abs(y - BULL_Y);
            if (dy <= 16) { res.mult = 2; res.zone = 'bull'; res.reason = 'Яблочко!'; res.code = 'bull'; }
            else if (dy <= 50) { res.mult = 1.5; res.zone = 'inner'; res.reason = 'Отличное попадание!'; res.code = 'inner'; }
            else { res.mult = 1; res.zone = 'outer'; res.reason = 'Попадание'; res.code = 'outer'; }
            res.hit = true;
            res.stuck = { x, y, r };
            push();
            break;
          } else {
            vx = -Math.abs(vx) * 0.25; vy = -140; omega *= -1.4;
            res.reason = 'Отскочил от пня'; res.code = 'bounce_face';
            state = 'fall';
            const ins2 = probes3(x, y, px, py, r, r).filter(q => inStump(q[0], q[1]));
            if (ins2.length) pushOut(ins2, false);
          }
        } else {
          // верх и бока пня: проверяем остриё, центр и рукоять, а не только центр
          const pr = probes3(x, y, px, py, r, r - omega * dt);
          const ins = pr.filter(q => inStump(q[0], q[1]));
          if (ins.length) {
            const fromTop = ins.some(q => q[3] < top);
            const tip = ins.find(q => q[4]);
            if (fromTop && tip && (stats.stick >= 360 || Math.abs(norm(r - Math.PI / 2)) <= win)) {
              res.hit = true; res.mult = 1; res.zone = 'top'; res.reason = 'В торец!'; res.code = 'top';
              const k = TIP - 8, c = Math.cos(r), sn = Math.sin(r);   // остриё входит в дерево на 8 px
              x = tip[0] - c * k; y = top + 8 - sn * k;
              res.stuck = { x, y, r };
              push(); break;
            }
            pushOut(ins, fromTop);
            if (fromTop) { vy = -Math.abs(vy) * 0.3; vx *= 0.4; omega *= -1.3; res.reason = 'Отскочил от торца'; res.code = 'bounce_top'; }
            else { vx = -Math.abs(vx) * 0.25; vy = Math.min(vy, -140); omega *= -1.4; res.reason = 'Отскочил от пня'; res.code = 'bounce_face'; }
            state = 'fall';
          }
        }
      } else {
        vy += g * dt; x += vx * dt; y += vy * dt; r += omega * 0.6 * dt;
        const ins = probes3(x, y, px, py, r, r - omega * 0.6 * dt).filter(q => inStump(q[0], q[1]));
        if (ins.length) {
          const fromTop = ins.some(q => q[3] < top);
          pushOut(ins, fromTop);
          if (fromTop) {   // лёг на торец
            if (Math.abs(vy) < 260) { r = Math.cos(r) > 0 ? 0.03 : Math.PI - 0.03; y = top - 4; push(); break; }
            vy = -Math.abs(vy) * 0.3; vx *= 0.6; omega *= -0.8;
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
      if (i % 2 === 0) push();
    }
    if (res.hit) {
      res.points = Math.round(stats.points * res.mult * (has('double') ? 2 : 1));
    }
    return { frames, result: res };
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
    },
    reasons: {
      miss: 'Miss', bull: 'Bullseye!', inner: 'Great hit!', outer: 'Hit', top: 'Into the top!', bounce_face: 'Bounced off the stump',
      bounce_top: 'Bounced off the top', ground: 'Into the ground', out: 'Flew away', timeout: 'Time is up',
      knock: 'Knocked the enemy knife!', knocked: 'Knocked out of the air!',
    },
  };
  const RU_REASONS = {
    miss: 'Мимо', bull: 'Яблочко!', inner: 'Отличное попадание!', outer: 'Попадание', top: 'В торец!', bounce_face: 'Отскочил от пня',
    bounce_top: 'Отскочил от торца', ground: 'В землю', out: 'Улетел', timeout: 'Время вышло',
    knock: 'Сбил нож соперника!', knocked: 'Сбит в воздухе!',
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
    knifeStats, cardWithStats, simulate, knockFrames, findCollision, shuffle, mulberry32, gauss, norm, drawKnife,
  };
});
