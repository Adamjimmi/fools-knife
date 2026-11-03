// «Нож дурака»: звук и музыка, профиль игрока (опыт, уровни, достижения, гардероб),
// персонажи в одежде, арены, частицы и следы ножей.
(() => {
  'use strict';
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };

  // =====================================================================
  // ЗВУК И МУЗЫКА (Web Audio, всё синтезируется на лету)
  // =====================================================================
  const Audio = (() => {
    let ac = null, master, sfxBus, musBus, noiseBuf, musicTimer = null, nextNote = 0, step = 0;
    const st = Object.assign({ sound: true, music: true, vMaster: 80, vMusic: 55, vSfx: 60, track: 'auto' }, LS.get('nd-audio', {}));
    let context = 'lobby', arena = 'sunset', current = null, voice = null;
    const save = () => LS.set('nd-audio', st);
    const musGain = () => (st.music ? st.vMusic / 100 * 0.42 : 0);
    const sfxGain = () => (st.sound ? st.vSfx / 100 * 0.7 : 0);
    function ctx() {
      if (ac) return ac;
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
      master = ac.createGain(); master.gain.value = st.vMaster / 100; master.connect(ac.destination);
      sfxBus = ac.createGain(); sfxBus.gain.value = sfxGain(); sfxBus.connect(master);
      musBus = ac.createGain(); musBus.gain.value = musGain(); musBus.connect(master);
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 1.5, ac.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return ac;
    }
    function unlock() { const a = ctx(); if (a && a.state === 'suspended') a.resume(); if (st.music) startMusic(); }
    ['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, unlock, { passive: true }));
    function noise(t, dur, type, f0, f1, gain, bus, q = 1) {
      const s = ac.createBufferSource(); s.buffer = noiseBuf;
      const f = ac.createBiquadFilter(); f.type = type; f.Q.value = q;
      f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur / 4)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(bus || sfxBus); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
    }
    function tone(t, dur, type, f0, f1, gain, bus, attack = 0.005) {
      const o = ac.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, t); if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(bus || sfxBus); o.start(t); o.stop(t + dur + 0.05);
    }
    const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
    function sfx(kind, arg) {
      const a = ctx(); if (!a || !st.sound) return;
      const t = a.currentTime + 0.005;
      switch (kind) {
        case 'whoosh': noise(t, 0.3, 'bandpass', 400, 2400, 0.32, null, 2.5); noise(t + 0.05, 0.22, 'highpass', 2000, 5000, 0.07); break;
        case 'thunk': tone(t, 0.15, 'sine', 170, 55, 0.6); noise(t, 0.06, 'lowpass', 2400, 400, 0.4); tone(t, 0.08, 'triangle', 420, 260, 0.1); break;
        case 'clank': [1180, 1730, 2610, 3320].forEach((f, i) => tone(t, 0.3 - i * 0.05, 'sine', f, f * 0.98, 0.09 / (i + 1))); noise(t, 0.05, 'highpass', 3000, 6000, 0.14); break;
        case 'clang': [880, 1397, 2093, 2794, 4186].forEach((f, i) => tone(t, 1 - i * 0.12, 'sine', f, f * 0.995, 0.13 / (i + 1))); noise(t, 0.07, 'highpass', 2500, 7000, 0.22); break;
        case 'dirt': noise(t, 0.12, 'lowpass', 900, 200, 0.3); break;
        case 'take': noise(t, 0.05, 'highpass', 2500, 6000, 0.16); tone(t + 0.02, 0.1, 'sine', 600, 1200, 0.07); break;
        case 'deal': noise(t, 0.04, 'bandpass', 3000, 2000, 0.14, null, 4); break;
        case 'click': tone(t, 0.04, 'square', 900, 700, 0.03); break;
        case 'tick': tone(t, 0.035, 'square', 1500, 1500, 0.035); break;
        case 'streak': { const n = Math.min(6, arg || 2); for (let i = 0; i < n; i++) tone(t + i * 0.07, 0.2, 'triangle', NOTE(72 + [0, 4, 7, 12, 16, 19][i]), 0, 0.08); break; }
        case 'win': [60, 64, 67, 72, 76, 79, 84].forEach((n, i) => tone(t + i * 0.09, 0.45, 'triangle', NOTE(n), 0, 0.1)); [48, 55, 60].forEach(n => tone(t + 0.6, 1.1, 'sawtooth', NOTE(n), 0, 0.03, null, 0.05)); break;
        case 'lose': [67, 63, 60, 55].forEach((n, i) => tone(t + i * 0.18, 0.4, 'triangle', NOTE(n), NOTE(n) * 0.97, 0.09)); break;
        case 'levelup': [72, 76, 79, 84, 88].forEach((n, i) => tone(t + i * 0.06, 0.32, 'sine', NOTE(n), 0, 0.08)); noise(t, 0.5, 'highpass', 6000, 9000, 0.03); break;
        case 'achieve': [79, 84, 91].forEach((n, i) => tone(t + i * 0.1, 0.45, 'triangle', NOTE(n), 0, 0.08)); break;
      }
    }
    // ---------- музыка: несколько треков ----------
    // ch — аккорды (MIDI), bass — бас по тактам, mel — мелодия на 32 шестнадцатых (-1 пауза), style — ударные и тембры
    const TRACKS = {
      tavern: { name: ['Таверна', 'Tavern'], bpm: 104, ch: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], bass: [45, 41, 36, 43],
        mel: [76, -1, 74, 72, 69, -1, 72, -1, 74, -1, 76, 79, 76, -1, 74, -1, 72, -1, 69, 72, 74, -1, 72, -1, 69, -1, 67, -1, 69, -1, -1, -1], style: 'folk' },
      duel: { name: ['Дуэль', 'Duel'], bpm: 124, ch: [[52, 55, 59], [48, 52, 55], [55, 59, 62], [50, 54, 57]], bass: [40, 36, 43, 38],
        mel: [71, -1, 71, 74, 76, -1, 74, 71, 69, -1, 67, -1, 69, 71, -1, -1, 71, -1, 74, -1, 79, 78, 76, -1, 74, -1, 71, 69, 71, -1, -1, -1], style: 'drive' },
      night: { name: ['Ночь', 'Night'], bpm: 78, ch: [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]], bass: [38, 34, 41, 36],
        mel: [74, -1, -1, 77, -1, -1, 76, -1, 74, -1, -1, -1, 69, -1, -1, -1, 72, -1, -1, 74, -1, -1, 72, -1, 70, -1, 69, -1, -1, -1, -1, -1], style: 'calm' },
      winter: { name: ['Зима', 'Winter'], bpm: 96, ch: [[48, 52, 55], [55, 59, 62], [57, 60, 64], [53, 57, 60]], bass: [36, 43, 45, 41],
        mel: [79, -1, 76, -1, 72, -1, 74, 76, 77, -1, 76, -1, 74, -1, -1, -1, 76, -1, 72, -1, 69, -1, 71, 72, 74, -1, 72, -1, 72, -1, -1, -1], style: 'bells' },
      desert: { name: ['Пустыня', 'Desert'], bpm: 92, ch: [[52, 56, 59], [53, 57, 60], [52, 56, 59], [50, 53, 57]], bass: [40, 41, 40, 38],
        mel: [76, 77, 80, -1, 81, -1, 80, 77, 76, -1, -1, -1, 77, 76, 74, -1, 76, -1, 80, 81, 83, -1, 81, 80, 77, -1, 76, -1, -1, -1, -1, -1], style: 'darbuka' },
    };
    const AUTO = { lobby: 'tavern', sunset: 'duel', night: 'night', winter: 'winter', desert: 'desert' };
    // авто-режим: трек меняется сам каждую минуту по кругу
    const KEYS = Object.keys(TRACKS); let rot = Math.floor(Math.random() * KEYS.length);
    function wanted() { if (st.track !== 'auto' && TRACKS[st.track]) return st.track; return KEYS[rot]; }
    function schedule() {
      const tr = TRACKS[current]; const S16 = 60 / tr.bpm / 4;
      while (nextNote < ac.currentTime + 0.15) {
        const s = step % 64, bar = Math.floor(s / 16) % 4, b16 = s % 16, t = nextNote;
        const B = voice;
        switch (tr.style) {
          case 'drive':
            if (b16 % 4 === 0) tone(t, 0.2, 'sine', 125, 45, 0.6, B);
            if (b16 === 4 || b16 === 12) noise(t, 0.16, 'bandpass', 1900, 1300, 0.32, B, 0.8);
            noise(t, 0.03, 'highpass', 7500, 9000, b16 % 2 ? 0.06 : 0.035, B);
            if (b16 % 2 === 0) tone(t, S16 * 1.6, 'sawtooth', NOTE(tr.bass[bar] + (b16 % 8 === 6 ? 12 : 0)), 0, 0.13, B);
            break;
          case 'calm':
            if (b16 === 0) tone(t, 0.5, 'sine', 70, 40, 0.35, B);
            if (b16 === 0) tr.ch[bar].forEach(n => tone(t, S16 * 15, 'sine', NOTE(n), 0, 0.05, B, 0.4));
            if (b16 === 0 || b16 === 8) tone(t, S16 * 7, 'triangle', NOTE(tr.bass[bar]), 0, 0.22, B, 0.05);
            if (b16 % 4 === 2) noise(t, 0.05, 'highpass', 8000, 9500, 0.025, B);
            break;
          case 'bells':
            if (b16 % 4 === 0) tone(t, 0.2, 'sine', 110, 45, 0.45, B);
            if (b16 === 8) noise(t, 0.12, 'bandpass', 2000, 1500, 0.2, B, 0.8);
            if (b16 % 2 === 1) noise(t, 0.06, 'highpass', 6000, 9000, 0.08, B);      // бубенцы
            if (b16 === 0 || b16 === 8) tr.ch[bar].forEach(n => tone(t, S16 * 7, 'triangle', NOTE(n + 12), 0, 0.03, B, 0.02));
            if (b16 === 0 || b16 === 10) tone(t, S16 * 5, 'triangle', NOTE(tr.bass[bar]), 0, 0.28, B);
            break;
          case 'darbuka':
            if (b16 === 0 || b16 === 6 || b16 === 10) tone(t, 0.18, 'sine', 95, 50, 0.55, B);
            if (b16 === 3 || b16 === 8 || b16 === 12 || b16 === 14) tone(t, 0.07, 'triangle', 520, 380, 0.12, B);
            if (b16 % 2 === 1) noise(t, 0.04, 'highpass', 5000, 8000, 0.04, B);
            if (b16 === 0) tr.ch[bar].forEach(n => tone(t, S16 * 15, 'sawtooth', NOTE(n), 0, 0.018, B, 0.3));
            if (b16 === 0 || b16 === 8) tone(t, S16 * 6, 'triangle', NOTE(tr.bass[bar]), 0, 0.26, B);
            break;
          default: // folk
            if (b16 % 4 === 0) tone(t, 0.22, 'sine', 120, 45, 0.55, B);
            if (b16 === 4 || b16 === 12) noise(t, 0.14, 'bandpass', 1800, 1200, 0.28, B, 0.8);
            if (b16 % 2 === 1) noise(t, 0.04, 'highpass', 7000, 9000, 0.07, B);
            if (b16 === 0 || b16 === 6 || b16 === 10) tone(t, S16 * 3.5, 'triangle', NOTE(tr.bass[bar]), 0, 0.32, B);
            if (b16 === 0 || b16 === 8) tr.ch[bar].forEach(n => tone(t, S16 * 7, 'sawtooth', NOTE(n), 0, 0.025, B, 0.04));
        }
        const m = tr.mel[step % 32];
        if (m > 0 && Math.floor(step / 32) % 2 === 1) {
          const wave = tr.style === 'calm' || tr.style === 'bells' ? 'sine' : 'triangle';
          tone(t, S16 * (tr.style === 'calm' ? 3.5 : 1.8), wave, NOTE(m), 0, tr.style === 'calm' ? 0.07 : 0.09, B, tr.style === 'calm' ? 0.03 : 0.005);
          if (tr.style === 'bells') tone(t, S16 * 2.5, 'sine', NOTE(m + 12), 0, 0.03, B);
        }
        nextNote += S16; step++;
      }
    }
    // у каждого трека свой «голос» (gain): старый плавно затухает, новый сразу начинается и плавно нарастает
    const FADE_OUT = 1.2, FADE_IN = 0.9;
    function newVoice(fadeIn) {
      const g = ac.createGain(), t = ac.currentTime;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(1, t + fadeIn); g.connect(musBus); return g;
    }
    function fadeVoice(g, dur) {
      if (!g) return; const t = ac.currentTime;
      g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0.0001, t + dur);
      setTimeout(() => { try { g.disconnect(); } catch (e) {} }, (dur + 3) * 1000);   // +3 c — чтобы дозвучали уже запланированные длинные ноты
    }
    function startTrack(id, fadeIn) { fadeVoice(voice, FADE_OUT); current = id; voice = newVoice(fadeIn); step = 0; nextNote = ac.currentTime + 0.05; }
    function startMusic() { const a = ctx(); if (!a || musicTimer) return; startTrack(wanted(), FADE_IN); musicTimer = setInterval(schedule, 40); }
    function stopMusic() { if (musicTimer) clearInterval(musicTimer); musicTimer = null; if (ac) fadeVoice(voice, 0.6); voice = null; current = null; }
    function retarget() { const w = wanted(); if (!musicTimer || w === current) return; startTrack(w, FADE_IN); }
    setInterval(() => { if (st.track !== 'auto' || !musicTimer || document.hidden) return; rot = (rot + 1) % KEYS.length; retarget(); }, 60000);
    function apply() {
      if (!ac) return; const t = ac.currentTime;
      master.gain.setTargetAtTime(st.vMaster / 100, t, 0.05); sfxBus.gain.setTargetAtTime(sfxGain(), t, 0.05); musBus.gain.setTargetAtTime(musGain(), t, 0.15);
    }
    // фон: звук стоит, пока приложение не на экране (сворачивание, блокировка, другая вкладка)
    function pauseAudio() { if (ac && ac.state === 'running') ac.suspend(); }
    function resumeAudio() { if (ac && ac.state === 'suspended' && (st.music || st.sound)) ac.resume(); }
    document.addEventListener('visibilitychange', () => (document.hidden ? pauseAudio() : resumeAudio()));
    window.addEventListener('pagehide', pauseAudio);
    window.addEventListener('pageshow', resumeAudio);
    const CapApp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (CapApp && CapApp.addListener) CapApp.addListener('appStateChange', (st2) => (st2.isActive ? resumeAudio() : pauseAudio()));
    return {
      sfx,
      // подготовка звука и проверка, разблокирован ли он (без очереди — иначе звук придёт с задержкой)
      warm() { const a = ctx(); if (a && a.state === 'suspended') a.resume().catch(() => {}); },
      ready() { return !!ac && ac.state === 'running'; },
      TRACKS,
      setSound(on) { st.sound = on; save(); apply(); },
      setMusic(on) { st.music = on; save(); apply(); if (ctx()) { if (on) startMusic(); else stopMusic(); } },
      setVolume(kind, v) { st[kind] = Math.max(0, Math.min(100, Math.round(v))); save(); apply(); },
      setTrack(id) { st.track = TRACKS[id] ? id : 'auto'; save(); retarget(); },
      setContext(c, a) { context = c; if (a) arena = a; retarget(); },
      get sound() { return st.sound; }, get music() { return st.music; }, get state() { return Object.assign({}, st); },
      get nowPlaying() { return current; },
    };
  })();

  // =====================================================================
  // ГАРДЕРОБ, ДОСТИЖЕНИЯ, ПРОФИЛЬ
  // =====================================================================
  // unlock: число — уровень; строка — id достижения
  const ITEMS = {
    hat: [
      ['none', 1, 'Без шапки', 'No hat'], ['cap', 2, 'Кепка', 'Cap'], ['bandana', 4, 'Бандана', 'Bandana'],
      ['cowboy', 6, 'Ковбойская шляпа', 'Cowboy hat'], ['ushanka', 9, 'Ушанка', 'Ushanka'], ['viking', 12, 'Шлем викинга', 'Viking helmet'],
      ['tophat', 18, 'Цилиндр', 'Top hat'], ['crown', 'streak5', 'Корона', 'Crown'],
    ],
    shirt: [
      ['basic', 1, 'Футболка', 'T-shirt'], ['stripes', 3, 'Тельняшка', 'Sailor stripes'], ['leather', 7, 'Кожаная куртка', 'Leather jacket'],
      ['kimono', 10, 'Кимоно', 'Kimono'], ['camo', 'beat_hard', 'Камуфляж', 'Camo'], ['armor', 25, 'Золотой доспех', 'Golden armor'],
    ],
    face: [
      ['none', 1, 'Ничего', 'Nothing'], ['mustache', 5, 'Усы', 'Mustache'], ['eyepatch', 8, 'Повязка пирата', 'Eyepatch'],
      ['shades', 11, 'Тёмные очки', 'Shades'], ['beard', 14, 'Борода', 'Beard'], ['ninja', 'knock5', 'Маска ниндзя', 'Ninja mask'],
    ],
    back: [['none', 1, 'Ничего', 'Nothing'], ['scarf', 15, 'Шарф', 'Scarf'], ['cape', 20, 'Плащ', 'Cape']],
    trail: [
      ['plain', 1, 'Обычный след', 'Plain trail'], ['fire', 13, 'Огненный след', 'Fire trail'], ['sparks', 16, 'Искры', 'Sparks'],
      ['rainbow', 22, 'Радуга', 'Rainbow'], ['gold', 'win10', 'Золотой след', 'Gold trail'],
    ],
    arena: [['sunset', 1, 'Закат', 'Sunset'], ['night', 6, 'Ночь', 'Night'], ['winter', 9, 'Зима', 'Winter'], ['desert', 17, 'Пустыня', 'Desert']],
  };
  const SLOTS = ['hat', 'shirt', 'face', 'back', 'trail', 'arena'];
  const SLOT_NAMES = { hat: ['Шапки', 'Hats'], shirt: ['Одежда', 'Outfits'], face: ['Лицо', 'Face'], back: ['Спина', 'Back'], trail: ['След ножа', 'Knife trail'], arena: ['Арена', 'Arena'] };
  const DEFAULT_LOOK = { hat: 'none', shirt: 'basic', face: 'none', back: 'none', trail: 'plain', arena: 'sunset' };
  const ACH = [
    ['first_hit', 'Первая кровь', 'First blood', 'Попади в пень', 'Hit the stump'],
    ['bull10', 'Снайпер', 'Sniper', '10 раз попади в яблочко', 'Hit 10 bullseyes'],
    ['streak3', 'Серийный метатель', 'Combo thrower', 'Сделай серию ×3', 'Get a ×3 streak'],
    ['streak5', 'Король серий', 'Streak king', 'Сделай серию ×5 → корона', 'Get a ×5 streak → crown'],
    ['knock1', 'Перехватчик', 'Interceptor', 'Сбей нож в воздухе', 'Knock a knife out of the air'],
    ['knock5', 'Ниндзя', 'Ninja', 'Сбей 5 ножей → маска ниндзя', 'Knock down 5 knives → ninja mask'],
    ['win1', 'Не дурак', 'Not a fool', 'Выиграй первый матч', 'Win your first match'],
    ['win10', 'Ветеран', 'Veteran', 'Выиграй 10 матчей → золотой след', 'Win 10 matches → gold trail'],
    ['beat_hard', 'Сильнее машины', 'Beat the machine', 'Победи сложного бота → камуфляж', 'Beat the hard bot → camo'],
    ['online_win', 'Дуэлянт', 'Duelist', 'Победи живого игрока', 'Beat a human player'],
    ['full50', 'Марафонец', 'Marathoner', 'Сыграй матч на 50 ножей', 'Finish a 50-knife match'],
  ];
  const MAX_LEVEL = 30;
  const BOT_XP_CAP = 5;   // против ботов опыт идёт только до этого уровня
  const xpFor = (L) => Math.round(60 * Math.pow(Math.max(0, L - 1), 1.6));   // всего опыта для уровня L
  const levelOf = (xp) => { let L = 1; while (L < MAX_LEVEL && xp >= xpFor(L + 1)) L++; return L; };
  const valid = (slot, id) => ITEMS[slot].some(x => x[0] === id);
  function cleanLook(l) { const o = {}; for (const s of SLOTS) o[s] = l && valid(s, l[s]) ? l[s] : DEFAULT_LOOK[s]; return o; }

  const Profile = (() => {
    const blank = () => ({ xp: 0, stats: { matches: 0, wins: 0, losses: 0, draws: 0, throws: 0, hits: 0, bulls: 0, knocks: 0, bestStreak: 0, points: 0 }, ach: {}, look: Object.assign({}, DEFAULT_LOOK) });
    let p = Object.assign(blank(), LS.get('nd-profile', {}));
    p.stats = Object.assign(blank().stats, p.stats || {}); p.look = cleanLook(p.look); p.ach = p.ach || {};
    if (!p.pid) { p.pid = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 8); LS.set('nd-profile', p); }
    const listeners = [];
    const save = () => LS.set('nd-profile', p);
    const emit = (ev) => listeners.forEach(f => f(ev));
    const isUnlocked = (slot, id) => { const it = ITEMS[slot].find(x => x[0] === id); if (!it) return false; return typeof it[1] === 'number' ? levelOf(p.xp) >= it[1] : !!p.ach[it[1]]; };
    function unlockedSet() { const s = new Set(); for (const sl of SLOTS) for (const it of ITEMS[sl]) if (isUnlocked(sl, it[0])) s.add(sl + ':' + it[0]); return s; }
    // против бота опыт обрезается так, чтобы не перешагнуть BOT_XP_CAP
    const botRoom = () => Math.max(0, xpFor(BOT_XP_CAP) - p.xp);
    function addXp(n, vsBot) {
      if (vsBot) n = Math.min(n, botRoom());
      if (n <= 0) return 0;
      const before = levelOf(p.xp), had = unlockedSet();
      p.xp += Math.round(n); const after = levelOf(p.xp);
      save(); emit({ type: 'xp' });
      if (after > before) emit({ type: 'level', level: after, items: [...unlockedSet()].filter(x => !had.has(x)) });
      return Math.round(n);
    }
    function achieve(id) {
      if (p.ach[id]) return;
      const had = unlockedSet();
      p.ach[id] = Date.now(); save();
      emit({ type: 'ach', id, items: [...unlockedSet()].filter(x => !had.has(x)) });
    }
    function onThrow(res, streak, vsBot) {
      const s = p.stats;
      if (!res || res.code === 'timeout') return 0;
      s.throws++;
      let xp = 1;
      if (res.hit) { s.hits++; xp += 5; achieve('first_hit'); if (res.zone === 'bull') { s.bulls++; xp += 5; if (s.bulls >= 10) achieve('bull10'); } }
      if (res.knock) { s.knocks++; xp += 15; achieve('knock1'); if (s.knocks >= 5) achieve('knock5'); }
      if ((res.hit || res.knock) && streak > 1) { xp += 5 * (streak - 1); if (streak >= 3) achieve('streak3'); if (streak >= 5) achieve('streak5'); }
      if (streak > s.bestStreak) s.bestStreak = streak;
      s.points += res.points || 0;
      save();
      return addXp(xp, vsBot);
    }
    // result: 'win' | 'loss' | 'draw'; opp: 'easy'|'medium'|'hard'|'human'
    function onMatch(result, opp, size, myScore) {
      const s = p.stats; s.matches++;
      if (result === 'win') s.wins++; else if (result === 'loss') s.losses++; else s.draws++;
      const mult = { easy: 0.6, medium: 1, hard: 1.5, human: 1.5 }[opp] || 1;
      const base = result === 'win' ? 80 : result === 'draw' ? 50 : 30;
      const xp = Math.round(base * mult * (size / 20));
      if (result === 'win') { achieve('win1'); if (s.wins >= 10) achieve('win10'); if (opp === 'hard') achieve('beat_hard'); if (opp === 'human') achieve('online_win'); }
      if (size === 50) achieve('full50');
      save();
      return addXp(xp, opp !== 'human');
    }
    function equip(slot, id) { if (!isUnlocked(slot, id)) return false; p.look[slot] = id; save(); emit({ type: 'look' }); return true; }
    return {
      get data() { return p; }, get level() { return levelOf(p.xp); }, get botCapped() { return botRoom() <= 0; }, BOT_XP_CAP,
      progress() { const L = levelOf(p.xp); if (L >= MAX_LEVEL) return { L, cur: 1, need: 1, pct: 1 }; const a = xpFor(L), b = xpFor(L + 1); return { L, cur: p.xp - a, need: b - a, pct: (p.xp - a) / (b - a) }; },
      look: () => Object.assign({}, p.look), isUnlocked, equip, onThrow, onMatch, on: (f) => listeners.push(f),
    };
  })();

  // =====================================================================
  // ПЕРСОНАЖ
  // =====================================================================
  // opts: { x, facing, color, look, arm (угол прицела|null), swing (0..1, бросок), holdCard, now }
  function drawCharacter(g, o) {
    const L = cleanLook(o.look), f = o.facing, now = o.now || 0;
    const bob = Math.sin(now / 420 + (f > 0 ? 0 : 2)) * 1.5;
    g.save(); g.translate(o.x, o.ground);
    // плащ / шарф — позади тела
    if (L.back === 'cape') {
      const wave = Math.sin(now / 300) * 6;
      g.fillStyle = '#8f1d24'; g.beginPath(); g.moveTo(-6 * f, -148 + bob); g.quadraticCurveTo(-30 * f + wave * f * -1, -100, -26 * f - wave * f, -40); g.lineTo(-4 * f, -60); g.closePath(); g.fill();
      g.fillStyle = '#b8323b'; g.beginPath(); g.moveTo(-4 * f, -148 + bob); g.quadraticCurveTo(-20 * f, -110, -18 * f - wave * f, -50); g.lineTo(-2 * f, -70); g.closePath(); g.fill();
    }
    // ноги
    g.strokeStyle = '#2a1d13'; g.lineWidth = 7; g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, -80); g.lineTo(-12 * f, 0); g.moveTo(0, -80); g.lineTo(12 * f, 0); g.stroke();
    g.fillStyle = '#1a120b'; g.fillRect(-12 * f - 6, -4, 12, 5); g.fillRect(12 * f - 6, -4, 12, 5);
    // тело
    g.save(); g.translate(0, bob);
    const bx = -9, bw = 18, by = -152, bh = 72;
    const body = new Path2D(); body.roundRect ? body.roundRect(bx, by, bw, bh, 7) : body.rect(bx, by, bw, bh);
    switch (L.shirt) {
      case 'stripes': g.fillStyle = '#f2f2f2'; g.fill(body); g.save(); g.clip(body); g.fillStyle = '#1d3d8f'; for (let y = by + 4; y < by + bh; y += 10) g.fillRect(bx, y, bw, 4); g.restore(); break;
      case 'leather': g.fillStyle = '#3b2416'; g.fill(body); g.strokeStyle = '#7a4d2e'; g.lineWidth = 2; g.beginPath(); g.moveTo(-5, by + 2); g.lineTo(0, by + 18); g.lineTo(5, by + 2); g.stroke(); g.fillStyle = '#c9a26a'; g.fillRect(-1, by + 24, 2, 40); break;
      case 'kimono': g.fillStyle = '#f4efe6'; g.fill(body); g.strokeStyle = '#1a1a1a'; g.lineWidth = 3; g.beginPath(); g.moveTo(-8, by + 2); g.lineTo(4 * f, by + 30); g.stroke(); g.fillStyle = '#1a1a1a'; g.fillRect(bx, by + 38, bw, 8); break;
      case 'camo': g.fillStyle = '#5d6b3c'; g.fill(body); g.save(); g.clip(body); [['#3d4a28', -4, by + 10, 7], ['#8a8f5a', 4, by + 28, 6], ['#2f3a1f', -2, by + 50, 8], ['#7d6a45', 5, by + 60, 5]].forEach(([c, x, y, r]) => { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, r, r * 0.7, 0.5, 0, 7); g.fill(); }); g.restore(); break;
      case 'armor': { const gr = g.createLinearGradient(bx, 0, bx + bw, 0); gr.addColorStop(0, '#a87a1e'); gr.addColorStop(0.5, '#ffe08a'); gr.addColorStop(1, '#8a6214'); g.fillStyle = gr; g.fill(body); g.fillStyle = '#d9a93a'; g.beginPath(); g.ellipse(0, by + 4, 16, 7, 0, 0, 7); g.fill(); g.strokeStyle = 'rgba(90,60,10,.6)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(bx, by + 36); g.lineTo(bx + bw, by + 36); g.stroke(); break; }
      default: g.fillStyle = o.color; g.fill(body);
    }
    // шарф
    if (L.back === 'scarf') {
      const wave = Math.sin(now / 250) * 5;
      g.fillStyle = '#c8302a'; g.fillRect(-10, by - 2, 20, 8);
      g.beginPath(); g.moveTo(-6 * f, by + 2); g.quadraticCurveTo(-22 * f, by + 6 + wave, -34 * f, by + wave); g.lineTo(-32 * f, by + 9 + wave); g.quadraticCurveTo(-20 * f, by + 14, -6 * f, by + 8); g.fill();
    }
    // голова
    const hy = -170;
    g.fillStyle = '#f0c9a0'; g.beginPath(); g.arc(0, hy, 15, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2a1d13'; g.beginPath(); g.arc(6 * f, hy - 3, 1.8, 0, 7); g.fill();          // глаз
    // лицо
    switch (L.face) {
      case 'mustache': g.fillStyle = '#3b2416'; g.beginPath(); g.ellipse(7 * f, hy + 6, 6, 2.6, 0, 0, 7); g.fill(); break;
      case 'eyepatch': g.strokeStyle = '#111'; g.lineWidth = 2; g.beginPath(); g.moveTo(-14 * f, hy - 9); g.lineTo(14 * f, hy - 1); g.stroke(); g.fillStyle = '#111'; g.beginPath(); g.ellipse(6 * f, hy - 3, 4.5, 4, 0, 0, 7); g.fill(); break;
      case 'shades': g.fillStyle = '#111'; g.fillRect(f > 0 ? 1 : -13, hy - 6, 12, 6); g.fillRect(-15 * f - (f > 0 ? 0 : 0), hy - 5, 2, 2); break;
      case 'beard': g.fillStyle = '#5a3a20'; g.beginPath(); g.moveTo(-8 * f, hy + 2); g.quadraticCurveTo(2 * f, hy + 22, 13 * f, hy + 4); g.lineTo(13 * f, hy + 2); g.closePath(); g.fill(); break;
      case 'ninja': g.fillStyle = '#16161c'; g.beginPath(); g.arc(0, hy, 15.5, 0.15 * Math.PI, 0.85 * Math.PI); g.fill(); g.fillRect(-15, hy - 1, 30, 9); g.fillStyle = '#16161c'; g.fillRect(-15, hy - 15, 30, 7); break;
    }
    // шапка / волосы
    switch (L.hat) {
      case 'cap': g.fillStyle = o.color; g.beginPath(); g.arc(0, hy - 3, 15, Math.PI, 0); g.fill(); g.fillRect(f > 0 ? 0 : -24, hy - 5, 24, 4); break;
      case 'bandana': g.fillStyle = '#c8302a'; g.beginPath(); g.arc(0, hy - 2, 15.5, Math.PI, 0); g.fill(); g.fillRect(-15, hy - 5, 30, 5); g.beginPath(); g.moveTo(-14 * f, hy - 4); g.lineTo(-26 * f, hy + 2); g.lineTo(-22 * f, hy - 8); g.fill(); break;
      case 'cowboy': g.fillStyle = '#7a4d2e'; g.beginPath(); g.ellipse(0, hy - 10, 26, 5, 0, 0, 7); g.fill(); g.beginPath(); g.roundRect ? g.roundRect(-12, hy - 28, 24, 18, 6) : g.rect(-12, hy - 28, 24, 18); g.fill(); g.fillStyle = '#3b2416'; g.fillRect(-12, hy - 15, 24, 3); break;
      case 'ushanka': g.fillStyle = '#6b5a4a'; g.beginPath(); g.arc(0, hy - 4, 17, Math.PI, 0); g.fill(); g.fillStyle = '#9a8770'; g.fillRect(-18, hy - 8, 36, 7); g.fillStyle = '#6b5a4a'; g.fillRect(-17, hy - 4, 6, 14); g.fillRect(11, hy - 4, 6, 14); break;
      case 'viking': g.fillStyle = '#9aa3ad'; g.beginPath(); g.arc(0, hy - 3, 16, Math.PI, 0); g.fill(); g.fillStyle = '#6b737c'; g.fillRect(-16, hy - 5, 32, 4); g.fillStyle = '#efe4c8';
        g.beginPath(); g.moveTo(-14, hy - 9); g.quadraticCurveTo(-28, hy - 14, -26, hy - 30); g.quadraticCurveTo(-20, hy - 18, -10, hy - 15); g.fill();
        g.beginPath(); g.moveTo(14, hy - 9); g.quadraticCurveTo(28, hy - 14, 26, hy - 30); g.quadraticCurveTo(20, hy - 18, 10, hy - 15); g.fill(); break;
      case 'tophat': g.fillStyle = '#16161c'; g.beginPath(); g.ellipse(0, hy - 12, 20, 4, 0, 0, 7); g.fill(); g.fillRect(-11, hy - 40, 22, 28); g.fillStyle = '#8f1d24'; g.fillRect(-11, hy - 18, 22, 4); break;
      case 'crown': { g.fillStyle = '#f2c24a'; g.beginPath(); g.moveTo(-14, hy - 10); g.lineTo(-14, hy - 26); g.lineTo(-7, hy - 18); g.lineTo(0, hy - 30); g.lineTo(7, hy - 18); g.lineTo(14, hy - 26); g.lineTo(14, hy - 10); g.closePath(); g.fill();
        g.strokeStyle = '#a87a1e'; g.lineWidth = 1.5; g.stroke(); g.fillStyle = '#c8302a'; g.beginPath(); g.arc(0, hy - 15, 2.5, 0, 7); g.fill(); g.fillStyle = '#3b82f6'; g.beginPath(); g.arc(-8, hy - 14, 2, 0, 7); g.arc(8, hy - 14, 2, 0, 7); g.fill();
        g.fillStyle = o.color; g.beginPath(); g.arc(0, hy - 6, 15, Math.PI, 0); g.fill(); break; }
      default: if (L.face !== 'ninja') { g.fillStyle = o.color; g.beginPath(); g.arc(0, hy - 6, 15, Math.PI, 0); g.fill(); }
    }
    // руки
    const sx = 0, sy = -145;
    let ex = 30 * f, ey = -195;
    let ang = -0.9;
    if (o.arm != null) { ang = o.arm; ex = sx - Math.cos(o.arm) * 34 * f; ey = sy - Math.sin(o.arm) * 34 - 10; }
    else if (o.swing != null && o.swing < 1) {        // замах и бросок: рука идёт сзади вперёд
      const s = o.swing; const a0 = -2.4, a1 = 0.5; ang = a0 + (a1 - a0) * (1 - Math.pow(1 - s, 3));
      ex = Math.cos(ang) * 36 * f; ey = sy + Math.sin(ang) * 36;
    }
    g.strokeStyle = '#2a1d13'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.stroke();
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(18 * f, -105); g.stroke();
    if (L.shirt === 'armor') { g.fillStyle = '#d9a93a'; g.beginPath(); g.arc(sx + 2 * f, sy + 2, 6, 0, 7); g.fill(); }
    if (o.holdCard) {
      g.save(); g.translate(ex, ey);
      const ha = o.arm != null ? o.arm : -0.9;
      g.rotate(f === 1 ? ha : Math.PI - ha); g.translate(18, 0);
      KG.drawKnife(g, o.holdCard, { trump: o.holdCard.stats && o.holdCard.stats.trump });
      g.restore();
    }
    g.restore();
    g.restore();
  }

  // =====================================================================
  // АРЕНЫ: статичный фон + живая погода
  // =====================================================================
  function drawArena(g, id, W, H, GROUND) {
    const P = {
      sunset: { sky: ['#f2a65a', '#e7c38a', '#c9b48e'], sun: 'rgba(255,240,200,.85)', mtn: '#9a7c63', tree: '#5d6b46', grass: '#4c5a39', g1: '#5f7d3a', g2: '#4b3826', g3: '#2c1f14', blade: '#7da04a' },
      night:  { sky: ['#0b1028', '#1d2550', '#3a3460'], sun: 'rgba(235,240,255,.95)', mtn: '#2a2748', tree: '#162a26', grass: '#14241f', g1: '#1f3a2c', g2: '#1c1a22', g3: '#0c0b10', blade: '#2f5a44' },
      winter: { sky: ['#9fc4e8', '#cfe3f3', '#eef4f8'], sun: 'rgba(255,255,240,.8)', mtn: '#c8d6e3', tree: '#3d5a54', grass: '#dfe9f0', g1: '#f4f8fb', g2: '#cfdbe4', g3: '#9fb1bf', blade: '#ffffff' },
      desert: { sky: ['#f7b267', '#f8d49a', '#f3e2bd'], sun: 'rgba(255,248,215,.95)', mtn: '#d18e52', tree: '#6d8b4a', grass: '#e2b878', g1: '#e9c48a', g2: '#d3a568', g3: '#a87a46', blade: '#c79a5c' },
    }[id] || null;
    const p = P || { sky: ['#f2a65a', '#e7c38a', '#c9b48e'], sun: 'rgba(255,240,200,.85)', mtn: '#9a7c63', tree: '#5d6b46', grass: '#4c5a39', g1: '#5f7d3a', g2: '#4b3826', g3: '#2c1f14', blade: '#7da04a' };
    const sky = g.createLinearGradient(0, 0, 0, GROUND);
    sky.addColorStop(0, p.sky[0]); sky.addColorStop(0.55, p.sky[1]); sky.addColorStop(1, p.sky[2]);
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    if (id === 'night') { for (let i = 0; i < 90; i++) { const x = (i * 211) % W, y = (i * 97) % 300; g.fillStyle = `rgba(255,255,255,${0.3 + (i % 5) * 0.12})`; g.fillRect(x, y, 1.6, 1.6); } }
    g.fillStyle = p.sun; g.beginPath(); g.arc(id === 'night' ? 760 : 500, id === 'desert' ? 150 : 180, id === 'desert' ? 75 : id === 'night' ? 42 : 60, 0, Math.PI * 2); g.fill();
    if (id === 'night') { g.fillStyle = p.sky[0]; g.beginPath(); g.arc(776, 170, 38, 0, 7); g.fill(); }
    g.fillStyle = p.mtn; g.beginPath(); g.moveTo(0, 360);
    for (let x = 0; x <= W; x += 50) g.lineTo(x, (id === 'desert' ? 360 : 330) - Math.sin(x * 0.011) * (id === 'desert' ? 25 : 50) - Math.sin(x * 0.03) * 14);
    g.lineTo(W, GROUND); g.lineTo(0, GROUND); g.fill();
    if (id === 'winter') { g.fillStyle = '#ffffff'; g.beginPath(); for (let x = 0; x <= W; x += 50) { const y = 330 - Math.sin(x * 0.011) * 50 - Math.sin(x * 0.03) * 14; g.moveTo(x - 18, y + 14); g.lineTo(x, y); g.lineTo(x + 18, y + 14); } g.fill(); }
    if (id === 'desert') {
      // кактусы
      g.fillStyle = p.tree;
      [[120, 1], [330, 0.8], [640, 1.1], [900, 0.9]].forEach(([x, s]) => { const h = 70 * s; g.fillRect(x, 430 - h, 10 * s, h); g.fillRect(x - 12 * s, 430 - h * 0.7, 8 * s, h * 0.35); g.fillRect(x - 12 * s, 430 - h * 0.7, 14 * s, 6 * s); g.fillRect(x + 12 * s, 430 - h * 0.85, 8 * s, h * 0.4); g.fillRect(x + 8 * s, 430 - h * 0.5, 12 * s, 6 * s); });
    } else {
      g.fillStyle = p.tree;
      for (let x = -20; x < W + 40; x += 26) { const h = 60 + ((x * 37) % 45); g.beginPath(); g.moveTo(x, 430); g.lineTo(x + 14, 430 - h); g.lineTo(x + 28, 430); g.fill();
        if (id === 'winter') { g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(x + 7, 430 - h * 0.5); g.lineTo(x + 14, 430 - h); g.lineTo(x + 21, 430 - h * 0.5); g.fill(); g.fillStyle = p.tree; } }
    }
    g.fillStyle = p.grass; g.fillRect(0, 425, W, GROUND - 425);
    const gr = g.createLinearGradient(0, GROUND, 0, H);
    gr.addColorStop(0, p.g1); gr.addColorStop(0.12, p.g2); gr.addColorStop(1, p.g3);
    g.fillStyle = gr; g.fillRect(0, GROUND, W, H - GROUND);
    g.strokeStyle = p.blade; g.lineWidth = 2;
    if (id !== 'desert') for (let x = 0; x < W; x += 7) { g.beginPath(); g.moveTo(x, GROUND + 2); g.lineTo(x + 2, GROUND - 4 - (x * 13) % 6); g.stroke(); }
  }
  // живая погода поверх фона
  const weather = [];
  function drawWeather(g, id, now, W, H, GROUND) {
    const want = { winter: 90, night: 14, desert: 20, sunset: 10 }[id] || 0;
    while (weather.length < want) weather.push({ x: Math.random() * W, y: Math.random() * H, s: Math.random(), p: Math.random() * 6 });
    weather.length = Math.min(weather.length, want);
    g.save();
    for (const w of weather) {
      if (id === 'winter') { w.y += 0.6 + w.s * 1.2; w.x += Math.sin(now / 900 + w.p) * 0.5; if (w.y > GROUND + 40) { w.y = -5; w.x = Math.random() * W; } g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(w.x, w.y, 1.2 + w.s * 2, 0, 7); g.fill(); }
      else if (id === 'night') { w.x += Math.sin(now / 1300 + w.p) * 0.4; w.y += Math.cos(now / 1100 + w.p) * 0.3; if (w.y < 250) w.y = 250 + Math.random() * 200; const a = 0.4 + 0.6 * Math.abs(Math.sin(now / 500 + w.p)); g.fillStyle = `rgba(220,255,140,${a})`; g.shadowColor = '#d8ff8a'; g.shadowBlur = 8; g.beginPath(); g.arc(w.x, Math.min(GROUND - 10, w.y), 2, 0, 7); g.fill(); }
      else if (id === 'desert') { w.x += 1.2 + w.s * 1.5; w.y += Math.sin(now / 400 + w.p) * 0.2; if (w.x > W + 10) { w.x = -10; w.y = 300 + Math.random() * 220; } g.fillStyle = 'rgba(210,160,90,.35)'; g.beginPath(); g.arc(w.x, w.y, 1 + w.s * 1.5, 0, 7); g.fill(); }
      else { w.x += 0.3 + w.s * 0.4; w.y += 0.25 + Math.sin(now / 700 + w.p) * 0.3; if (w.x > W + 10 || w.y > GROUND) { w.x = -10; w.y = 80 + Math.random() * 300; } g.fillStyle = 'rgba(255,230,170,.55)'; g.beginPath(); g.ellipse(w.x, w.y, 2.5, 1.2, now / 600 + w.p, 0, 7); g.fill(); }
    }
    g.restore();
  }

  // =====================================================================
  // ЧАСТИЦЫ, СЛЕДЫ НОЖЕЙ, ТРЯСКА
  // =====================================================================
  let parts = [];
  function burst(type, x, y, n, dir = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 4;
      if (type === 'chips') parts.push({ type, x, y, vx: -dir * (1 + Math.random() * 4), vy: -2 - Math.random() * 4, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, life: 1, c: ['#c9a272', '#8a5a32', '#e2c08f'][i % 3], w: 3 + Math.random() * 4 });
      else if (type === 'sparks') parts.push({ type, x, y, vx: Math.cos(a) * sp * 1.6, vy: Math.sin(a) * sp * 1.6 - 1, life: 1, c: ['#fff4b0', '#ffd77a', '#ffffff'][i % 3] });
      else if (type === 'dirt') parts.push({ type, x, y, vx: (Math.random() - 0.5) * 4, vy: -1 - Math.random() * 3, life: 1, c: ['#6b4a2e', '#4b3826', '#8a6a48'][i % 3], w: 2 + Math.random() * 3 });
      else if (type === 'confetti') parts.push({ type, x: Math.random() * 1000, y: -10 - Math.random() * 200, vx: (Math.random() - 0.5) * 2, vy: 1.5 + Math.random() * 2, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, life: 3, c: ['#ffd77a', '#e8b64a', '#ff7a59', '#5fb8ff', '#9ff0a6'][i % 5], w: 5 + Math.random() * 4 });
    }
  }
  function drawParts(g) {
    parts = parts.filter(p => p.life > 0);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.vy += p.type === 'confetti' ? 0.02 : 0.25;
      if (p.type === 'confetti') { p.vx *= 0.99; p.r += p.vr; p.life -= 0.008; } else p.life -= p.type === 'sparks' ? 0.04 : 0.022;
      g.save(); g.globalAlpha = Math.max(0, Math.min(1, p.life));
      if (p.type === 'sparks') { g.strokeStyle = p.c; g.lineWidth = 2; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 2, p.y - p.vy * 2); g.stroke(); }
      else { g.translate(p.x, p.y); g.rotate(p.r || 0); g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.w / 4, p.w, p.w / 2); }
      g.restore();
    }
  }
  function drawTrail(g, skin, pts, now) {
    // pts: последние точки полёта, от новой к старой
    pts.forEach((p, k) => {
      const a = 1 - k / pts.length;
      let col, r = 4.5 - k * 0.4;
      switch (skin) {
        case 'fire': col = `hsla(${20 + k * 6},100%,${55 + k * 3}%,${0.75 * a})`; r += 2; break;
        case 'sparks': col = `rgba(255,${200 + (k * 20) % 55},120,${0.8 * a})`; p = { x: p.x + (Math.random() - 0.5) * 8, y: p.y + (Math.random() - 0.5) * 8 }; r = 2; break;
        case 'rainbow': col = `hsla(${(now / 3 + k * 40) % 360},90%,60%,${0.75 * a})`; r += 1; break;
        case 'gold': col = `rgba(255,${200 + k * 4},90,${0.8 * a})`; r += 0.5; break;
        default: col = `rgba(255,255,255,${0.25 - k * 0.035})`;
      }
      if (r <= 0) return;
      g.fillStyle = col; g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
    });
  }
  let shakeT = 0, shakeA = 0;
  function shake(amount) { shakeA = Math.max(shakeA, amount); shakeT = performance.now(); }
  function shakeOffset(now) { const k = 1 - (now - shakeT) / 350; if (k <= 0) return [0, 0]; const a = shakeA * k * k; return [(Math.random() - 0.5) * a * 2, (Math.random() - 0.5) * a * 2]; }

  window.NDX = { Audio, Profile, ITEMS, SLOTS, SLOT_NAMES, ACH, DEFAULT_LOOK, cleanLook, levelOf, xpFor, drawCharacter, drawArena, drawWeather, burst, drawParts, drawTrail, shake, shakeOffset };
})();
