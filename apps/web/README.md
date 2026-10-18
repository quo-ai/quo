# Quo Web

Quo in the browser. **Local by default, cloud when you choose.**

- **Free, no account:** local models run in the browser (wllama: llama.cpp → WebAssembly, WebGPU or multi-threaded CPU). Unlimited, offline, nothing leaves the device.
- **Quo Pro (subscription):** monthly credits for cloud models (frontier + open), plus Pro features.
- **Credit packs:** one-off top-ups.

Separate from the mobile app's Premium (no shared entitlement).

## Develop

```bash
npm install
npm run dev         # app + API on http://localhost:5173 (embedded database, simulated services)
npm run typecheck   # app and server
npm test
npm run build       # dist/, also used by the desktop app
```

## Hosting

The app is static (`dist/`) and must be served with cross-origin isolation headers; the API in `server/` is plain Web `Request → Response` handlers (`server/routes.ts`), so the same code runs everywhere:

| Where | Entry point |
|---|---|
| Dev server | `vite.config.ts` (via `server/node.ts`) |
| Vercel (now) | `api/index.ts`, with `vercel.json` rewriting `/api/*` to it |
| Your own server (later) | `npm run build && npm start` (`server/serve.ts`: app + API on `PORT`, default 3000) |

**Environment** (`server/env.ts`):

| Variable | Needed | What it does |
|---|---|---|
| `QUO_ENV=production` | production | Real services only; nothing simulated |
| `DATABASE_URL` | production | Postgres (Neon on Vercel today) |
| `SESSION_SECRET` | production | Signs session cookies; long random string |
| `APP_URL` | production | Public URL, e.g. `https://quoai-app.vercel.app` |
| `OPENROUTER_API_KEY` | for cloud models | Without it, cloud models are hidden |
| `RESEND_API_KEY`, `EMAIL_FROM` | for sign-in | Emails sign-in codes; needs a verified sending domain. Without it, sign-in, paid models and purchases are hidden |
| `PADDLE_*` | for purchases | Paddle merchant of record; without it, purchases are hidden |
| `DEFAULT_CLOUD_MODEL`, `FREE_DAILY_MESSAGES`, `FREE_DAILY_MESSAGES_PER_IP` | optional | Free tier (defaults: GPT-6 Luna, 20 per device, 60 per IP, per day) |

The server reports what's switched on in `/api/me` (`features`), and the app only shows what works. The database schema is created automatically on first use.

**Vercel (temporary):** project `quoai-app` in London (`lhr1`), with the Neon integration providing `DATABASE_URL`. Deploy with `bash scripts/deploy.sh` (it uploads a copy from outside git; Vercel builds it).

**Moving to your own host and domain:**
1. Run `npm run build && npm start` behind a reverse proxy with TLS (it must forward `X-Forwarded-For`).
2. Keep Neon (it's plain Postgres and works from anywhere), or move the data with `pg_dump` / `pg_restore`.
3. Set the variables above, with `APP_URL` on the new domain.
4. Point the clients at the new address: `WEB_APP_URL` in `src/platform.ts`, `API_ORIGIN` in `apps/desktop/src/protocol.js`, and `LINKS.webapp` in `website/assets/site.js`.

## Local models

| Concern | Approach |
|---|---|
| Engine | wllama v3: same GGUF files as mobile, WebGPU on Chrome/Edge (needs JSPI), CPU elsewhere. Firefox is CPU-only unless JSPI is enabled. |
| Download | Own resumable downloader (`src/storage/download.worker.ts`): HTTP Range resume from bytes on disk, infinite capped-backoff retry while offline, exact-size + GGUF-magic verification, one tab per model via Web Locks, auto-resume on next visit. |
| Storage | OPFS (`models/<id>/`): not cleared by "clear cached images and files". `navigator.storage.persist()` requested on first download so the browser won't evict it. |
| Survives "clear site data" | Chromium: optional "keep models in a folder on this computer" (File System Access API) — not built yet. Other browsers: re-download or import from file. |
| Safari | Install to Dock/Home Screen (PWA) to escape the 7-day storage cap. |
| Size limit | Files must be < 2 GiB; larger models (Qwen3.5 4B, Gemma 4 E2B) need splitting with `llama-gguf-split` and hosting as parts (Cloudflare R2, zero egress). |
| Offline | Service worker caches the app shell (not built yet); models already local. |
| Phones | Too memory-limited in mobile browsers; point to the native apps. |

## Cloud models and credits

Optional, and never chosen for the user (see below).

- **Credits** are Quo's own unit, so a provider's price change never changes what users bought. Each cloud model has a rate in credits per 1M input and output tokens (reasoning tokens bill as output); the app shows "≈ N messages left" from the user's own recent average, never raw tokens.
- **Free tier:** a daily allowance of messages on the default cloud model, counted per account or device and per IP address (`server/freeTier.ts`).
- **Guardrails:** credits are reserved before each request (at the maximum output) and settled after, so balances never go negative; rates can change without a release; history sent to cloud models is compacted to cap input cost per message.
- **Providers:** routed through Quo's API (`server/`), which counts tokens and stores no message content; zero-data-retention providers only.
- **Payments:** Paddle as merchant of record (handles VAT and sales tax).

## Getting Quo onto the computer

Quo Web is the fastest way in; the install prompt and desktop app keep people coming back.

- **Install prompt** (`src/install.ts`, `ui/InstallNudge.tsx`): Chromium's `beforeinstallprompt` is captured at startup. Once Quo has answered on this computer, a one-time card offers **Install Quo** (Chrome / Edge) or the **desktop app** for this OS (other browsers, or no graphics card). "Not now" rests it for 14 days; after two, it never returns. The manifest has screenshots and a description, so Chrome shows its richer install dialog.
- **Get the app** (`ui/GetAppSheet.tsx`, sidebar): install from this browser, desktop app (direct download from the latest GitHub release), phone apps.
- **Desktop app** (`apps/desktop/`): Electron serves this build with its own Chromium, so WebGPU, JSPI and cross-origin isolation are always available. It sets `window.quoDesktop`; Quo Web then hides install/desktop prompts, says "on your computer" instead of "in your browser", and opens checkout in the system browser.
- **Offline first**: Quo Web never picks a cloud model by itself. During the first download it offers "Chat in the cloud while you wait" as an explicit choice and switches to the offline model when it's ready (`quo.cloudUntilOffline`).

## Privacy

- Local chats never leave the device. Cloud chats go through Quo's server to the provider, which counts tokens and stores no content; zero-data-retention providers only; first use of a cloud model shows that the message leaves the device.
- Privacy policy, terms (credits, expiry, refunds) and data-processing agreements updated before Pro launches.

## Build order

1. **Local core** (in progress): catalog, resumable downloads, OPFS storage, engine, chat. ✔ first version.
2. **Local polish:** chats saved in IndexedDB, markdown rendering, offline app shell (PWA, install prompt), device check and model recommendation, "keep models in a folder" (Chromium), split hosting for > 2 GiB models, export/import.
3. **Deploy** ✔ Live at https://quoai-app.vercel.app with the API and a Neon database (temporary; moves to its own host and domain later, see Hosting).
4. **Accounts and billing:** passwordless sign-in, Paddle subscription + packs, credit ledger.
5. **Cloud models:** gateway proxy (OpenRouter + direct providers where cheaper), metering, model picker with "Cloud" labelling, trial credits.
6. **Later:** end-to-end encrypted sync, local documents and images.
