<div align="center">

<img src="website/assets/brand/quo-mark-indigo.svg" width="96" alt="Quo">

# Quo

**Private AI that works offline.**

A free, open-source AI assistant that runs on your own device: in your browser, on your desktop, and on your phone.<br>
No account, no internet needed, and nothing you type leaves your device.<br>
**11,000+ installs on Android.**

[**Try Quo in your browser →**](https://quoai-app.vercel.app/)

[Website](https://quoai.vercel.app) · [Download for desktop](https://github.com/quo-ai/quo/releases/latest) · [Google Play](https://play.google.com/store/apps/details?id=com.quo.app) · iPhone coming soon

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-3b2eff)](LICENSE)
[![CI](https://github.com/quo-ai/quo/actions/workflows/ci.yml/badge.svg)](https://github.com/quo-ai/quo/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/quo-ai/quo?color=3b2eff&label=desktop)](https://github.com/quo-ai/quo/releases/latest)

<br>

<img src="website/assets/shots/web-chat.webp" width="860" alt="Quo running in the browser, answering on the computer itself">

</div>

## Why Quo

Most AI assistants run on someone else's servers. You need an account and a connection, and your conversations are stored there.

Quo runs the model on your device instead:

- **Works offline.** On a plane, abroad, anywhere without signal.
- **Private by design.** Chats, files, photos and voice are processed on your device. No account, no server copy.
- **Open source.** “Private” is something you can check, not just a promise.
- **Free.** Offline models are free and unlimited, everywhere.

## Get Quo

| | How it runs | Get it |
|---|---|---|
| 🌐 **Web** | [wllama](https://github.com/ngxson/wllama) (llama.cpp → WebAssembly). WebGPU in Chrome and Edge, CPU elsewhere | [quoai-app.vercel.app](https://quoai-app.vercel.app/) |
| 💻 **Desktop** | Its own app for macOS, Windows and Linux (Electron), running models on your graphics card | [macOS](https://github.com/quo-ai/quo/releases/latest/download/Quo-mac-universal.dmg) · [Windows](https://github.com/quo-ai/quo/releases/latest/download/Quo-windows-x64-setup.exe) · [Linux](https://github.com/quo-ai/quo/releases/latest/download/Quo-linux-x86_64.AppImage) |
| 🤖 **Android** | [llama.rn](https://github.com/mybigday/llama.rn), ships with a starter model | [Google Play](https://play.google.com/store/apps/details?id=com.quo.app) |
| 📱 **iPhone / iPad** | llama.rn on Metal | Coming soon |

> **Best browser:** Chrome or Edge on a laptop or desktop. They let Quo use your graphics card (WebGPU), which makes replies much faster. Firefox and Safari work but run on the processor. Phone browsers don't have enough memory, so use the phone apps.

## Features

| | Web and desktop | iPhone and Android |
|---|:-:|:-:|
| Chat with offline models (Qwen, Gemma, Llama, …) | ✓ | ✓ |
| Thinking mode (reasoning you can read) | ✓ | ✓ † |
| Saved chats, markdown, search | ✓ | ✓ |
| Works fully offline after one download | ✓ | ✓ |
| Suggests the right model for your hardware | ✓ | ✓ |
| Ask about PDFs and documents | | ✓ |
| Understand photos | | ✓ |
| Voice input and read aloud | | ✓ † |
| Optional cloud models, clearly marked | ✓ | |
| Use your own API key (OpenRouter, Anthropic, OpenAI, …), or a server like Ollama | ✓ | |
| Code mode: a coding agent for your project folder (desktop app) | ✓ | |

Phone features marked † are part of the optional one-time Premium upgrade.

## Models

Open models in GGUF format, downloaded once and kept on your device. Quo checks your hardware and suggests one that runs well.

| Model | Download | Runs well on | Where | Licence |
|---|---|---|---|---|
| Qwen3.5 0.8B | 0.5 GB | almost any phone or computer | everywhere | Apache 2.0 |
| Qwen3.5 2B | 1.3 GB | 6 GB phones, 8 GB computers | everywhere | Apache 2.0 |
| Llama 3.2 3B | 2.0 GB | 8 GB phones and computers | everywhere | Llama 3.2 Community |
| Ministral 3B (vision) | 2.1 GB | 8 GB phones | phone | Apache 2.0 |
| Qwen3.5 4B (vision, thinking) | 2.7 GB | 8 GB phones and computers | phone, desktop | Apache 2.0 |
| Gemma 4 E2B (vision) | 3.1 GB | 8 GB phones and computers | phone, desktop | Gemma terms |
| Phi-4 Mini | 2.5 GB | 8 GB phones and computers | phone, desktop | MIT |
| Qwen3.5 9B (vision, thinking) | 5.7 GB | 16 GB computers, or an 8 GB graphics card | desktop | Apache 2.0 |
| Qwen3.5 27B (vision, thinking) | 16.7 GB | 32 GB computers | desktop | Apache 2.0 |

The full catalogues are [`apps/mobile/constants/models.ts`](apps/mobile/constants/models.ts) (phones) and [`apps/web/src/catalog.ts`](apps/web/src/catalog.ts) (web and desktop).

## Pricing

Quo Web and the desktop app are free. The phone apps are free with three models (one with vision), and an optional one-time **Premium** upgrade (from $9.99, no subscription) unlocks every model, thinking mode, voice input and read-aloud, enhanced recall, and unlimited chats and memories.

## Build from source

**Quo Web**

```bash
cd apps/web
npm install
npm run dev        # http://localhost:5173
```

**Desktop app** (see [`apps/desktop/README.md`](apps/desktop/README.md))

```bash
cd apps/web && npm install && npm run build
cd ../desktop && npm install && npm run dev
```

**Phone apps** (Expo SDK 57 / React Native, New Architecture)

```bash
cd apps/mobile
npm install
npm run android    # or: npm run ios (macOS)
```

Each app runs its own checks (`npm run typecheck`, `npm test`, plus `npm run lint` for the phone app). Read [`CLAUDE.md`](CLAUDE.md) for the architecture and native gotchas, and [`apps/web/README.md`](apps/web/README.md) for how Quo Web works.

## Repository

```
apps/mobile/    Phone apps: Expo / React Native, llama.rn (Android, iOS)
apps/web/       Quo Web: Vite + React, wllama, and its API (server/)
apps/desktop/   Desktop app: Electron, serving a Quo Web build
website/        quoai.vercel.app (static, no build step)
```

`apps/mobile/ios/` isn't committed: it's generated from `app.json` by `npx expo prebuild -p ios`.

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](.github/CONTRIBUTING.md), and please follow the [Code of Conduct](.github/CODE_OF_CONDUCT.md). Security issues: see [SECURITY.md](.github/SECURITY.md).

## License

Code is licensed under [Apache 2.0](LICENSE). The licence doesn't cover the Quo AI name, logo or app icons; forks need their own name and icon (see [TRADEMARKS.md](TRADEMARKS.md)). Brand assets for press are at [quoai.vercel.app/brand](https://quoai.vercel.app/brand/).
