#!/usr/bin/env python3
"""Собирает игру в один самодостаточный файл play/index.html.
Запуск из корня репозитория:  python3 tools/build.py"""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = lambda f: open(os.path.join(ROOT, 'src', f), encoding='utf-8').read()

html = src('template.html')
css = src('style.css') + '\n' + src('style-extra.css')
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + css + '\n</style>')
html = html.replace('<button id="btn-refresh" class="btn small">⟳ Обновить</button>', '<span style="color:var(--muted);font-size:12.5px">обновляется сам</span>')
html = html.replace('<input id="room-name"', '<select id="deck-size"><option value="20">Матч на 20 ножей · рука 2</option><option value="30">Матч на 30 ножей · рука 3</option><option value="50">Матч на 50 ножей · рука 5</option></select>\n      <input id="room-name"')
html = html.replace('<div class="hud-item"><span>Ход</span><b id="hud-turn">—</b></div>', '<div class="hud-item"><span>Твоя серия</span><b id="hud-turn">—</b></div>')
html = html.replace('<div class="slot-label">Твой нож</div>', '<div class="slot-label">Твоя рука</div>')
html = html.replace('<button id="btn-bot" class="btn">Быстрая игра против бота</button>',
    '<button id="btn-bot" class="btn">Быстрая игра против бота</button>\n      <p class="note"></p>\n      <div id="online" class="online"></div>')
html = html.replace('<div id="toast" class="toast"></div>', '''<div id="toast" class="toast"></div>
<div id="rotate"><div class="ic">📱</div><p>Поверни телефон вертикально</p></div>
<div id="modal" class="modal hidden"><div class="panel"><h2>Пароль сервера</h2><input id="modal-input" type="password" maxlength="32" placeholder="Пароль"><div class="btns"><button id="modal-cancel" class="btn">Отмена</button><button id="modal-ok" class="btn gold">Войти</button></div></div></div>''')
scripts = ''.join('<script>\n' + s + '\n</script>\n' for s in [src('game.js'), src('engine.js'), 'window.ND_ITCH = true;', src('mqttnet.js'), src('app.js')])
html = html.replace('<script src="/shared/game.js"></script>\n<script src="client.js"></script>', scripts)
assert '<script src' not in html, 'не все скрипты встроены'
os.makedirs(os.path.join(ROOT, 'play'), exist_ok=True)
open(os.path.join(ROOT, 'play', 'index.html'), 'w', encoding='utf-8').write(html)
print('play/index.html:', len(html), 'bytes')
