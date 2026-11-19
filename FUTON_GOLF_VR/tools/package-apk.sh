#!/usr/bin/env bash
# Build FUTON_GOLF_VR.apk on your own PC (Linux/macOS, or Git-Bash/WSL on Windows).
# Requirements: Node 18+, JDK 17, internet access. Bubblewrap downloads the Android SDK on first run.
#   ./tools/package-apk.sh https://your-domain.example/
# The game must be hosted at that HTTPS address (domain ROOT recommended, see README).
set -euo pipefail
SITE_URL="${1:?Usage: tools/package-apk.sh https://your-domain/}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
node tools/build.js
command -v bubblewrap >/dev/null || npm install --global @meta-quest/bubblewrap-cli
KS="$ROOT/android/android.keystore"
: "${BUBBLEWRAP_KEYSTORE_PASSWORD:=futongolf}"; : "${BUBBLEWRAP_KEY_PASSWORD:=$BUBBLEWRAP_KEYSTORE_PASSWORD}"
export BUBBLEWRAP_KEYSTORE_PASSWORD BUBBLEWRAP_KEY_PASSWORD
if [ ! -f "$KS" ]; then
  echo ">> creating signing key android/android.keystore (keep it safe — updates must use the same key)"
  keytool -genkeypair -v -keystore "$KS" -alias futon -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$BUBBLEWRAP_KEYSTORE_PASSWORD" -keypass "$BUBBLEWRAP_KEY_PASSWORD" \
    -dname "CN=FUTON GROUP, OU=Games, O=FUTON GROUP, L=-, ST=-, C=US"
fi
FP=$(keytool -list -v -keystore "$KS" -alias futon -storepass "$BUBBLEWRAP_KEYSTORE_PASSWORD" | grep -m1 "SHA256:" | awk '{print $2}')
node tools/make-assetlinks.js "$FP"
node tools/make-twa-manifest.js "$SITE_URL" "${VERSION_CODE:-1}"
cd android
bubblewrap update --skipVersionUpgrade
bubblewrap build --skipPwaValidation
cp app-release-signed.apk "$ROOT/FUTON_GOLF_VR.apk"
echo
echo "✔ FUTON_GOLF_VR.apk created."
echo "  Upload the contents of dist/ (including dist/.well-known/assetlinks.json) to $SITE_URL"
echo "  Then install: adb install -r FUTON_GOLF_VR.apk   (or drag the APK onto SideQuest)"
