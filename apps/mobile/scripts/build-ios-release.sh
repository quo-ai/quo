#!/usr/bin/env bash
# Build (and optionally upload) the App Store release of Quo.
#
# Must run on macOS with Xcode + CocoaPods installed. Usage:
#   APPLE_TEAM_ID=XXXXXXXXXX npm run ios:release            # archive + export .ipa
#   APPLE_TEAM_ID=XXXXXXXXXX npm run ios:release:upload     # archive + upload to App Store Connect
#
# Optional (for fully non-interactive signing/upload) — an App Store Connect API key:
#   APP_STORE_CONNECT_API_KEY_PATH=/path/AuthKey_ABC123.p8
#   APP_STORE_CONNECT_KEY_ID=ABC123
#   APP_STORE_CONNECT_ISSUER_ID=xxxxxxxx-xxxx-...
# Without a key, Xcode uses the Apple ID signed into Xcode (interactive on first run).
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ "$(uname)" != "Darwin" ]]; then
  echo "error: iOS builds require macOS/Xcode. Run this on a Mac (or use: eas build -p ios --profile production)." >&2
  exit 1
fi

DESTINATION="export"
if [[ "${1:-}" == "--upload" ]]; then
  DESTINATION="upload"
fi

: "${APPLE_TEAM_ID:?error: set APPLE_TEAM_ID to your Apple Developer Team ID (developer.apple.com > Membership)}"

# Firebase config: the real GoogleService-Info.plist (gitignored) must exist.
if [[ ! -f GoogleService-Info.plist ]] || grep -q REPLACE_ME GoogleService-Info.plist; then
  echo "error: ./GoogleService-Info.plist is missing or still the placeholder." >&2
  echo "Download it from Firebase Console (iOS app, bundle com.quo.app) into the repo root." >&2
  exit 1
fi

# ios/ isn't committed: generate it from app.json and the config plugins.
echo "==> expo prebuild (ios)"
npx expo prebuild -p ios --no-install
cp GoogleService-Info.plist ios/Quo/GoogleService-Info.plist

AUTH_ARGS=()
if [[ -n "${APP_STORE_CONNECT_API_KEY_PATH:-}" ]]; then
  AUTH_ARGS=(
    -authenticationKeyPath "$APP_STORE_CONNECT_API_KEY_PATH"
    -authenticationKeyID "${APP_STORE_CONNECT_KEY_ID:?}"
    -authenticationKeyIssuerID "${APP_STORE_CONNECT_ISSUER_ID:?}"
  )
fi

echo "==> starter model (bundled into the app; skipped if already present)"
npm run fetch:starter-model

echo "==> pod install"
(cd ios && pod install)

ARCHIVE_PATH="ios/build/Quo.xcarchive"
EXPORT_DIR="ios/build/export"

echo "==> xcodebuild archive"
xcodebuild archive \
  -workspace ios/Quo.xcworkspace \
  -scheme Quo \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE_PATH" \
  -allowProvisioningUpdates \
  "${AUTH_ARGS[@]}" \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
  CODE_SIGN_STYLE=Automatic

echo "==> export ($DESTINATION)"
EXPORT_OPTIONS="ios/build/ExportOptions.plist"
mkdir -p ios/build
cat > "$EXPORT_OPTIONS" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>destination</key>
  <string>${DESTINATION}</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>teamID</key>
  <string>${APPLE_TEAM_ID}</string>
  <key>uploadSymbols</key>
  <true/>
</dict>
</plist>
PLIST

xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS" \
  -exportPath "$EXPORT_DIR" \
  -allowProvisioningUpdates \
  "${AUTH_ARGS[@]}"

if [[ "$DESTINATION" == "export" ]]; then
  echo "==> done: $(ls "$EXPORT_DIR"/*.ipa 2>/dev/null || echo "$EXPORT_DIR")"
  echo "Upload with the Transporter app, or re-run with --upload."
else
  echo "==> done: uploaded to App Store Connect (processing takes a few minutes; check TestFlight)."
fi
