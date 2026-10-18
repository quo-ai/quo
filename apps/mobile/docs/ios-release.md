# iOS release guide (Quo, `com.quo.app`)

The `ios/` project isn't committed: it's generated from `app.json` and the config plugins by `npx expo prebuild -p ios` (the release script and `npm run ios` do this for you). Unlike `android/`, it carries no hand-maintained customizations. All iOS config lives in `app.json` (usage strings, entitlements, Firebase file, static frameworks).

Building requires **macOS with Xcode 16+** and CocoaPods (`brew install cocoapods`). On Linux you can prepare everything but not compile; the cloud alternative is `eas build -p ios --profile production`.

## Blockers — must be resolved before any build you intend to submit or test on-device

1. **`GoogleService-Info.plist`** — the file at the repo root is currently a placeholder (`REPLACE_ME` values). `FirebaseApp.configure()` runs on every launch and **will crash the app immediately** with the placeholder. Get the real one from Firebase Console (see setup step 4) before building.
2. **Privacy policy URL** — `constants/legal.ts` points to https://quoai.vercel.app/privacy/ (the website in `website/`), which App Store review and Play Console's data-safety declaration both need. Keep it live before submitting for review.
3. **`APP_STORE_ID`** in `components/settings/AboutSection.tsx` — still `'0000000000'`. Harmless placeholder (the write-review deep link just won't resolve) until you've created the App Store Connect listing in step 2 below.

## One-time setup

1. **Apple Developer Program** membership; note your Team ID (developer.apple.com → Membership).
2. **App Store Connect**: create the app record for bundle id `com.quo.app`.
   - Create the in-app purchase: non-consumable, product id **`quopremium`** — the code fetches exactly this SKU (`services/iap.ts` `IAP_SKUS`). Attach it to the first app version for review, with screenshot + review notes.
   - After creation, put the numeric App Store id into `APP_STORE_ID` in `components/settings/AboutSection.tsx` (used for the write-review link).
3. **Capabilities**: if automatic signing complains, enable *Increased Memory Limit* and *Extended Virtual Addressing* for the App ID in the developer portal — the entitlements are declared in `app.json` (`ios.entitlements`) and are required so larger GGUF models aren't jetsammed.
4. **Firebase**: in the Firebase console add an iOS app (bundle `com.quo.app`) and download `GoogleService-Info.plist` into the **repo root** (gitignored; `GoogleService-Info.plist.example` shows the shape). Without it the app crashes at launch (see Blockers above).

## Build + upload (macOS)

```sh
# archive and export an .ipa to ios/build/export/
APPLE_TEAM_ID=XXXXXXXXXX npm run ios:release

# archive and upload straight to App Store Connect / TestFlight
APPLE_TEAM_ID=XXXXXXXXXX npm run ios:release:upload
```

Non-interactive signing/upload (CI or no-Xcode-login): create an App Store Connect API key (Users and Access → Integrations) and set `APP_STORE_CONNECT_API_KEY_PATH` / `APP_STORE_CONNECT_KEY_ID` / `APP_STORE_CONNECT_ISSUER_ID`.

Version/build bumps: edit `version` + `ios.buildNumber` in `app.json`; the next prebuild picks them up. Note: prebuild always writes `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION` as `1.0`/`1` in the Xcode build settings — this is normal Expo output, not stale state; the real version/build live as literal strings in `Info.plist` and that's what ships.

## Build without a Mac: EAS Build (cloud)

```sh
npx eas-cli login
npx eas-cli build -p ios --profile production
```

Builds on Apple hardware in Expo's cloud. First run walks you through Apple credentials (sign in, or supply an App Store Connect API key) and provisions signing automatically. `npx eas-cli submit -p ios` uploads the result to App Store Connect / TestFlight afterward. The `GoogleService-Info.plist` blocker still applies — EAS reads the same gitignored file from your local checkout at build-submit time (or upload it as an EAS secret file if building from a fresh clone/CI).

## Testing on a physical iPhone

Three ways, roughly in order of how "release-like" the result is:

**A. TestFlight (recommended — closest to what reviewers/users see)**
1. Run `npm run ios:release:upload` (Mac) or `eas build -p ios --profile production && eas submit -p ios` (cloud/EAS).
2. Wait for Apple's processing email (usually 5–30 min), then in App Store Connect → TestFlight, add yourself as an internal tester (your Apple ID) and enable the build.
3. Install the **TestFlight** app from the App Store on your iPhone, sign in with the same Apple ID, and install Quo from there.
4. New builds show up in TestFlight automatically after each upload — no reinstall dance needed.

**B. Direct device install via Xcode (fastest iteration, no upload wait)**
1. Connect your iPhone via USB (or same-WiFi wireless debugging once paired once via cable).
2. `npx expo prebuild -p ios`, then `open ios/Quo.xcworkspace` (run `pod install` in `ios/` first if you haven't).
3. In Xcode, select your iPhone as the run destination (top toolbar), select the `Quo` scheme, and hit Run. First time: on the iPhone, go to Settings → General → VPN & Device Management and trust your developer certificate.
4. This installs a debug build with a dev server connection — fine for functional testing, but not representative of Release-mode performance (inference speed, binary size). For that, in Xcode set the scheme's build configuration to **Release** (Product → Scheme → Edit Scheme → Run → Build Configuration) before running.

**C. Local dev loop (fastest, for active development)**
```sh
npm run ios        # expo run:ios — builds debug, installs, starts Metro
```
Requires the device connected and trusted as in method B. Good for iterating on JS/UI; not for validating release performance or IAP (sandbox purchases work in debug builds too, so this method is fine for testing the purchase flow).

For IAP testing specifically (any method): use a **Sandbox Tester** account (App Store Connect → Users and Access → Sandbox → Testers), sign into it on the device under Settings → App Store → Sandbox Account (iOS 17+) rather than your real Apple ID, then purchase `quopremium` in-app — it won't charge real money.

## Platform behavior differences (by design)

- **Bundled starter model** — the ~530MB starter GGUF ships inside the app bundle (added by plugins/withIosBundledModel; fetched into assets-native/bundled-models/ by `npm run fetch:starter-model`, which the release script and EAS run automatically). llama.rn loads it straight from the bundle — no copy, no first-run download. If the file is absent at build time the app still works and falls back to downloading.
- **Backgrounded generation pauses on iOS** — Android keeps generating behind an ongoing notification; iOS suspends the app and generation resumes on foreground. Model downloads DO continue in the background (background NSURLSession, wired in AppDelegate).
- **aps-environment** shows `development` in the committed entitlements; App Store export rewrites it to `production` automatically.

## Pre-submission checklist

Functional (test on-device via TestFlight or Release-mode Xcode build):
- [ ] IAP purchase + restore in sandbox (including a second device restore)
- [ ] Model download survives backgrounding and app kill/relaunch (reattach path)
- [ ] Load the largest catalog model on a 4GB-RAM device (iPhone 12/13 mini class) — confirm the device-RAM warning (`utils/deviceCapability.ts`) shows and the confirm-before-download Alert appears; verify actual behavior matches the verdict
- [ ] Voice input end-to-end — the whisper.rn 0.7 realtime migration changed the mic capture path (now via `@fugood/react-native-audio-pcm-stream`); this has not been device-tested yet
- [ ] Mic permission + voice input, camera/photos attach, share sheet
- [ ] Keyboard behavior on a notched iPhone and an SE (input bar offsets)

Store metadata (before submitting for review, not needed for internal TestFlight):
- [ ] Privacy policy hosted and `PRIVACY_POLICY_URL` set in `constants/legal.ts` (see Blockers)
- [ ] `APP_STORE_ID` set in `components/settings/AboutSection.tsx`
- [ ] App Store Connect privacy "nutrition label" filled in to match actual Firebase Analytics/Crashlytics collection (Device ID, Crash Data, Product Interaction — not linked to identity)
- [ ] `ITSAppUsesNonExemptEncryption=false` already set in `app.json` — no export-compliance prompt on upload
