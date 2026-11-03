# Android app (Google Play build)

The Android app is the same game (`../play/index.html`) packaged with [Capacitor](https://capacitorjs.com/). It is built in the cloud by GitHub Actions, so nothing needs to be installed locally.

## One-time setup: signing key

Google Play needs a signed Android App Bundle. Create an upload key once and keep it safe:

```bash
keytool -genkeypair -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 upload.jks > ANDROID_KEYSTORE_B64.txt   # macOS: base64 -i upload.jks
```

Then add four repository secrets (Settings → Secrets and variables → Actions → New repository secret):

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_B64` | the full content of `ANDROID_KEYSTORE_B64.txt` |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `upload` |
| `ANDROID_KEY_PASSWORD` | the key password (the same one if you used a single password) |

Never commit the `.jks` file. Turn on **Play App Signing** in Play Console when you upload the first bundle, so Google holds the real app signing key and this one is only an upload key.

## Build

1. Open **Actions → Build Android app → Run workflow** and pick a version name.
2. When it finishes, download the `fools-knife-android` artifact. It contains:
   - `fools-knife.aab`, the file you upload to Play Console;
   - `fools-knife.apk`, which you can install on a phone to test before uploading.

`versionCode` is the workflow run number, so every build is higher than the last one, as Play requires.

## What the build does

`build.sh` copies `play/index.html` into a fresh Capacitor project, generates the icons and splash screens from `resources/`, patches the Android project with `patch_android.py` (target SDK 36, portrait lock, English and Russian app name, release signing), then runs Gradle to produce the `.aab` and `.apk`.

The application id is set in `capacitor.config.json` (`com.morstudio.foolsknife`). It cannot be changed after the first upload to Google Play.

`play-store-icon-512.png` is the 512×512 icon for the Play Console store listing.
