# Quo desktop

Quo for macOS, Windows and Linux. It's [Quo Web](../web) (the same React app that runs GGUF models in the browser through wllama) packaged with Electron, so it installs like a normal app and runs models on the GPU.

## Why Electron

Local inference needs **WebGPU + JSPI** (`WebAssembly.Suspending`) for the GPU path and **SharedArrayBuffer** (cross-origin isolation) for multithreaded CPU inference. Tauri uses the system webview (WKWebView, WebKitGTK, WebView2), and the first two don't ship WebGPU with JSPI, so models would run CPU-only there. Electron ships its own Chromium (Electron 44 = Chromium 152), which has both on every platform.

## How it works

- `src/protocol.js` serves the built web app from `app://quo/` (a privileged standard, secure scheme). Every response carries `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Resource-Policy: same-origin`, so `crossOriginIsolated` is true. Unknown paths without a file extension fall back to `index.html` (client-side routes).
- No service worker: `/registerSW.js` is served empty and `/sw.js` is a 404. The assets ship with the app.
- **API proxy.** `/api/*` (any method, body and headers) is forwarded to the hosted backend, `https://quoai-app.vercel.app` by default. Set `QUO_API_ORIGIN` to change it (for example `QUO_API_ORIGIN=http://localhost:5173 npm run dev` against the Quo Web dev server). The proxy uses Electron's `net.fetch` with `credentials: 'include'`, so the session cookie lives in the app's persistent cookie jar and is never exposed to the page. It also drops the renderer's `Origin`/`Referer`/`Sec-Fetch-*` headers: forwarding `Origin: app://quo` would make Chromium treat the call as cross-site, which means no cookies and a 403 from the API's CSRF check. Responses stream through as they arrive (server-sent events aren't buffered), and stopping a stream in the page aborts the upstream request. If the backend can't be reached (offline, DNS failure, or no response headers within 30 s), the proxy returns `503 {"error":"offline","message":"You're offline. Offline models still work."}`. That's the same shape as the API's own errors, so the web app shows its offline state.
- **Links.** Navigation away from `app://quo` and `window.open` open in the system browser (http, https and mailto only). `/checkout.html` also opens in the browser, on the API origin, because Paddle's checkout can't run in a cross-origin isolated page.
- Packaged builds flip [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses) so the signed binary can't be reused as a Node runtime (`ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect` are ignored), and app code loads only from `app.asar`. Cookie encryption is off on purpose. With it on, unsigned macOS builds trigger Keychain prompts after every update, and turning it on later signs everyone out once.
- Models are stored in OPFS under the `app://quo` origin in the app's profile (`~/Library/Application Support/Quo`, `%APPDATA%\Quo`, `~/.config/Quo`). **Never change the scheme or host**, or existing users lose their downloaded models. `npm run dev` uses a separate `Quo Dev` profile, so it can run next to an installed Quo.

### Contract with the web app

- The preload script exposes `window.quoDesktop = { platform, version }`: `process.platform` (`darwin`, `win32`, `linux`) and the app version. `apps/web/src/platform.ts` relies on exactly this shape.
- The user agent ends with ` QuoDesktop/<version>`, and API requests send the same user agent.
- Relative `/api/...` URLs keep working. Service workers aren't available (`navigator.serviceWorker` calls fail on `app://`).

## Development

```sh
cd apps/web && npm ci && npm run build   # or, from desktop/: npm run build:web
cd ../desktop && npm install
npm run dev     # run the app against ../web/dist (set QUO_WEB_DIR to use another build)
npm run smoke   # headless self-check (see below)
npm run dist    # package for the current OS into dist/
```

The first `npm run dev` downloads the Electron binary. In development, DevTools are in the View menu. Packaged builds hide them.

`npm run smoke` (or `QUO_SMOKE=1`) loads the app in a hidden window with a throwaway profile, prints a JSON report and exits 0 if the essentials hold: `crossOriginIsolated`, `SharedArrayBuffer`, JSPI, the app rendered, OPFS works, `window.quoDesktop` is correct, the wasm is served as `application/wasm`, and `/api` answers (any status, including the offline 503). It also reports `webgpu` and `adapter` (whether `navigator.gpu.requestAdapter()` returned a GPU), but doesn't fail without a GPU. The packaged app supports it too: `Quo --smoke`.

### WebGPU

No Chromium switches are needed. WebGPU is on by default on macOS (Metal), Windows (D3D12) and Linux (Vulkan), and so is JSPI. The usual Linux flags don't help: `--enable-unsafe-webgpu` only adds a SwiftShader CPU adapter, which the web app treats as no GPU. It also turns off Chrome's GPU blocklist, so it's not worth the risk.

On Linux, Chromium's GPU sandbox only lets the Vulkan loader read driver manifests with the standard file names (`nvidia_icd.json`, `intel_icd.x86_64.json`, `radeon_icd.x86_64.json`, …). Some distro packages use other names, for example Fedora/RPM Fusion's `nvidia_icd.x86_64.json`. There, `requestAdapter()` returns null and Quo falls back to CPU. Running `Quo --disable-gpu-sandbox` confirms the cause (tested: the NVIDIA adapter appears and replies run on the GPU), but that turns off a security boundary, so it isn't the default. A gentler fix that hasn't been tested: `sudo ln -s /usr/share/vulkan/icd.d/nvidia_icd.x86_64.json /etc/vulkan/icd.d/nvidia_icd.json`.

## Releasing

1. Bump the version: `cd desktop && npm version 1.2.3 --no-git-tag-version` (updates `package.json` and the lockfile).
2. Commit, then tag and push: `git tag desktop-v1.2.3 && git push origin desktop-v1.2.3`. The tag must match the version or the workflow stops.
3. `.github/workflows/desktop-release.yml` creates a draft release `desktop-v1.2.3` and builds macOS, Windows and Linux in parallel, uploading to the draft.
4. Check the draft on GitHub, edit the notes and **publish** it. Until it's published, neither the website links nor auto-update see it.

The website links to `https://github.com/quo-ai/quo/releases/latest/download/<name>`, so **asset names must never change**:

| Platform | Asset |
| --- | --- |
| macOS (universal) | `Quo-mac-universal.dmg` (+ `Quo-mac-universal.zip` for auto-update) |
| Windows x64 | `Quo-windows-x64-setup.exe` |
| Linux x86_64 | `Quo-linux-x86_64.AppImage`, `Quo-linux-amd64.deb` |

Also uploaded: `latest.yml`, `latest-mac.yml`, `latest-linux.yml` and `*.blockmap`, which electron-updater reads. `releases/latest` points at the newest *published, non-prerelease* release in the repository. If other releases are published (for example, the mobile app), mark them as prereleases or untick "Set as the latest release", or these links break.

The GitHub repository must be public for the download links and auto-update to work without a token.

You can also run the workflow manually (Actions → Desktop release → Run workflow). By default it only attaches the builds to the run, which is handy for testing. Tick "publish" to upload to a draft release instead.

### Auto-update

`electron-updater` checks GitHub Releases once at startup in packaged builds (`QUO_DISABLE_UPDATES=1` turns that off). It downloads in the background, then asks "A new version of Quo is ready. Restart to update?" (Restart / Later). With Later, the update installs the next time Quo quits. Errors, including being offline, are only logged. Supported: the Windows installer, the AppImage, the .deb (asks for the admin password to install), and **signed** macOS builds.

### Signing and notarization (optional)

Builds succeed unsigned when these repository secrets are missing:

| Secret | Used for |
| --- | --- |
| `CSC_LINK` | macOS Developer ID Application certificate (`.p12`, base64 or URL) |
| `CSC_KEY_PASSWORD` | Its password |
| `APPLE_API_KEY` | Contents of the App Store Connect API key (`.p8`), for notarization |
| `APPLE_API_KEY_ID` | API key ID |
| `APPLE_API_ISSUER` | API key issuer ID |
| `WIN_CSC_LINK` | Windows code-signing certificate (`.pfx`, base64 or URL) |
| `WIN_CSC_KEY_PASSWORD` | Its password |

Without `CSC_LINK`, the macOS app is ad-hoc signed (so it launches on Apple silicon) and not notarized. Notarization runs only when `CSC_LINK` and all three `APPLE_API_*` secrets are set.

## Known limitations

- **Unsigned builds trigger OS warnings.** On macOS, Gatekeeper blocks the first launch: right-click → Open, or System Settings → Privacy & Security → Open Anyway. On Windows, SmartScreen shows "Windows protected your PC": More info → Run anyway.
- **macOS auto-update requires a signed build.** Squirrel.Mac refuses unsigned updates. Unsigned macOS users must download new versions by hand.
- The AppImage needs FUSE 2 (`libfuse2`/`libfuse2t64` on Ubuntu 22.04+). The .deb doesn't. On systems without unprivileged user namespaces, the AppImage starts with Chromium's sandbox off. The .deb installs an AppArmor profile instead.
- Linux GPU inference may fall back to CPU on some driver packages (see [WebGPU](#webgpu)).
