#!/usr/bin/env python3
"""Patches the generated Capacitor Android project: SDK levels, version, portrait lock,
app names (RU/EN) and release signing. Run from android-app/ after `npx cap add android`."""
import os, re, sys, pathlib

root = pathlib.Path('android')
ver_code = os.environ.get('VERSION_CODE', '1')
ver_name = os.environ.get('VERSION_NAME', '1.0.0')

# 1) уровни SDK (Google Play требует targetSdk 36 с 31.08.2026)
vg = root / 'variables.gradle'
s = vg.read_text()
for key, val in (('compileSdkVersion', 36), ('targetSdkVersion', 36)):
    s, n = re.subn(rf'({key}\s*=\s*)\d+', rf'\g<1>{val}', s)
    if not n:
        sys.exit(f'variables.gradle: {key} not found')
s = re.sub(r'(minSdkVersion\s*=\s*)(\d+)', lambda m: m.group(1) + str(max(24, int(m.group(2)))), s)
vg.write_text(s)

# 2) версия и подпись релиза
bg = root / 'app' / 'build.gradle'
s = bg.read_text()
s, n1 = re.subn(r'versionCode\s+\d+', f'versionCode {ver_code}', s)
s, n2 = re.subn(r'versionName\s+"[^"]*"', f'versionName "{ver_name}"', s)
if not (n1 and n2):
    sys.exit('app/build.gradle: versionCode/versionName not found')
if 'KEYSTORE_PATH' not in s:
    s += '''

// ---- release signing (values come from environment / GitHub secrets) ----
android {
    signingConfigs {
        release {
            storeFile file(System.getenv("KEYSTORE_PATH"))
            storePassword System.getenv("KEYSTORE_PASSWORD")
            keyAlias System.getenv("KEY_ALIAS")
            keyPassword System.getenv("KEY_PASSWORD")
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}
'''
bg.write_text(s)

# 3) вертикальная ориентация
mf = root / 'app' / 'src' / 'main' / 'AndroidManifest.xml'
s = mf.read_text()
if 'screenOrientation' not in s:
    s, n = re.subn(r'(<activity\b)', r'\1\n            android:screenOrientation="portrait"', s, count=1)
    if not n:
        sys.exit('AndroidManifest: <activity> not found')
mf.write_text(s)

# 4) названия приложения (по умолчанию EN, для русского языка RU)
res = root / 'app' / 'src' / 'main' / 'res'
def strings(app, activity):
    return ('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
            f'    <string name="app_name">{app}</string>\n'
            f'    <string name="title_activity_main">{activity}</string>\n'
            '    <string name="package_name">com.morstudio.foolsknife</string>\n'
            '    <string name="custom_url_scheme">com.morstudio.foolsknife</string>\n'
            '</resources>\n')
(res / 'values' / 'strings.xml').write_text(strings("Fool\\'s Knife", "Fool\\'s Knife"))
(res / 'values-ru').mkdir(exist_ok=True)
(res / 'values-ru' / 'strings.xml').write_text(strings('Нож дурака', 'Нож дурака'))
print('patched OK: versionCode', ver_code, 'versionName', ver_name)
