#!/usr/bin/env bash
# Builds the signed Android App Bundle (.aab) and APK from ../play/index.html.
# Needs: Node 22, JDK 21, Android SDK. Signing is read from env:
# KEYSTORE_PATH, KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD
set -euo pipefail
cd "$(dirname "$0")"

rm -rf www android
mkdir www
cp ../play/index.html www/index.html

npm install --no-audit --no-fund
npx cap --version
npx cap add android
npx capacitor-assets generate --android --assetPath resources
python3 patch_android.py
npx cap sync android

cd android
chmod +x gradlew
./gradlew --no-daemon bundleRelease assembleRelease

mkdir -p ../out
cp app/build/outputs/bundle/release/app-release.aab ../out/fools-knife.aab
cp app/build/outputs/apk/release/app-release.apk ../out/fools-knife.apk
ls -la ../out
