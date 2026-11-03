<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="website/assets/brand/quo-mark-white.svg">
  <img src="website/assets/brand/quo-mark-indigo.svg" width="96" alt="Quo">
</picture>

# Quo

**Private AI that works offline.**

A free, open-source AI assistant that runs on your own device: in your browser, on your desktop, and on your phone.<br>
No account, no internet needed, and nothing you type leaves your device.<br>
**11,000+ installs on Android.**

[**Try Quo in your browser →**](https://app.quo.computer/)

[Website](https://quo.computer) · [Download for desktop](https://github.com/quo-ai/quo/releases/latest) · [Google Play](https://play.google.com/store/apps/details?id=com.quo.app) · iPhone coming soon

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-3b2eff)](LICENSE)
[![CI](https://github.com/quo-ai/quo/actions/workflows/ci.yml/badge.svg)](https://github.com/quo-ai/quo/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/quo-ai/quo?color=3b2eff&label=desktop)](https://github.com/quo-ai/quo/releases/latest)

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="website/assets/shots/hero-dark.webp">
  <img src="website/assets/shots/hero-light.webp" width="860" alt="Quo running with Wi-Fi off, answering on the computer itself">
</picture>

</div>

## Why Quo

Most AI assistants run on someone else's servers. You need an account and a connection, and your conversations are stored there.

Quo runs the model on your device instead:

- **Works offline.** On a plane, abroad, anywhere without signal.
- **Private by design.** Chats, files, photos and voice are processed on your device. No account, no server copy.
- **Open source.** “Private” is something you can check, not just a promise.
- **Free.** Offline models are free and unlimited.
- **The cloud only when you choose it.** Cloud models are clearly marked and used only when you pick one. Each reply shows where it ran.

## Get Quo

| | How it runs | Get it |
|---|---|---|
| **Web** | [wllama](https://github.com/ngxson/wllama) (llama.cpp in WebAssembly), on the graphics card in Chrome and Edge | [app.quo.computer](https://app.quo.computer/) |
| **Desktop** | llama.cpp on the graphics card (an optional CUDA engine for NVIDIA cards), in an app for macOS, Windows and Linux (x64 and ARM) | [macOS](https://github.com/quo-ai/quo/releases/latest/download/Quo-mac-universal.dmg) · [Windows](https://github.com/quo-ai/quo/releases/latest/download/Quo-windows-x64-setup.exe) · [Linux](https://github.com/quo-ai/quo/releases/latest/download/Quo-linux-x86_64.AppImage) · [all downloads](https://github.com/quo-ai/quo/releases/latest) |
| **Android** | [llama.rn](https://github.com/mybigday/llama.rn), with a model built in | [Google Play](https://play.google.com/store/apps/details?id=com.quo.app) |
| **iPhone and iPad** | llama.rn on Metal | Coming soon |

**Desktop app in one line.** It picks the right download for your computer, checks it against the release, and installs it for you only (no admin rights):

```bash
curl -fsSL https://quo.computer/install.sh | sh     # macOS and Linux
```

```powershell
irm https://quo.computer/install.ps1 | iex          # Windows, in PowerShell
```

Run it again to update the Mac app (Windows and Linux update themselves).

In a browser, use Chrome or Edge on a computer: Firefox and Safari run on the processor, which is slower, and phone browsers don't have the memory (use the app).

<table>
  <tr>
    <td colspan="4">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="website/assets/shots/code-dark.webp">
        <img src="website/assets/shots/code-light.webp" alt="Code mode in the desktop app: the steps it took, a test run, and the changed files beside the chat">
      </picture>
    </td>
  </tr>
  <tr>
    <td width="25%"><picture><source media="(prefers-color-scheme: dark)" srcset="website/assets/shots/phone-offline-dark.webp"><img src="website/assets/shots/phone-offline-light.webp" alt="Quo answering on a phone with no internet connection"></picture></td>
    <td width="25%"><picture><source media="(prefers-color-scheme: dark)" srcset="website/assets/shots/phone-document-dark.webp"><img src="website/assets/shots/phone-document-light.webp" alt="Quo summarising a hotel booking PDF"></picture></td>
    <td width="25%"><picture><source media="(prefers-color-scheme: dark)" srcset="website/assets/shots/phone-vision-dark.webp"><img src="website/assets/shots/phone-vision-light.webp" alt="Quo saying a photo shows an apple on a tree"></picture></td>
    <td width="25%"><picture><source media="(prefers-color-scheme: dark)" srcset="website/assets/shots/phone-thinking-dark.webp"><img src="website/assets/shots/phone-thinking-light.webp" alt="Quo working out an arrival time step by step"></picture></td>
  </tr>
</table>

## Features

| | Web | Desktop | Phone |
|---|:-:|:-:|:-:|
| Offline models, working with no internet | ✓ | ✓ | ✓ |
| Thinking you can read | ✓ | ✓ | ✓ † |
| Ask about documents | ✓ | ✓ | ✓ |
| Understand photos | ✓ ‡ | ✓ | ✓ |
| Voice input and read aloud | ✓ | ✓ | ✓ † |
| Memories, kept on your device | ✓ | ✓ | ✓ |
| A free cloud model, and your own API keys (OpenRouter, Anthropic, OpenAI, Ollama…) | ✓ | ✓ | |
| Web search with sources, when the model needs it | ✓ | ✓ | |
| Make images (in the cloud; a few free a day) | ✓ | ✓ | |
| Quo Sync: your chats and memories on every device, end-to-end encrypted | ✓ § | ✓ § | ✓ § |
| Any model from Hugging Face | | ✓ | |
| Code mode: a coding agent that asks before every change, commit and push | | ✓ | |

† Part of the optional one-time Premium upgrade on the phone.<br>
‡ With cloud models or your own API key; the offline models in the browser read text.<br>
§ With Quo Pro or a Quo Sync plan.

## Models

Open models, downloaded once and kept on your device. Quo checks your hardware and suggests one that runs well.

| Model | Download | Runs well on | Where | Licence |
|---|---|---|---|---|
| Qwen3.5 0.8B | 0.5 GB | almost any phone or computer | phone, browser | Apache 2.0 |
| Qwen3.5 2B | 1.3 GB | 6 GB phones, 8 GB computers | phone, browser | Apache 2.0 |
| Llama 3.2 3B | 2.0 GB | 8 GB phones and computers | everywhere | Llama 3.2 Community |
| Ministral 3B (vision) | 2.1 GB | 8 GB phones | phone | Apache 2.0 |
| Qwen3.5 4B (vision, thinking) | 2.7 GB | 8 GB phones and computers | phone, desktop | Apache 2.0 |
| Gemma 4 E2B (vision, thinking) | 2.6–3.1 GB | 8 GB phones and computers | everywhere | Gemma terms |
| Phi-4 Mini | 2.5 GB | 8 GB phones and computers | phone, desktop | MIT |
| Qwen3.5 9B (vision, thinking) | 5.9 GB | 16 GB computers, or an 8 GB graphics card | desktop | Apache 2.0 |
| Gemma 4 12B (vision, thinking) | 6.9 GB | 16 GB computers, or an 8 GB graphics card | desktop | Gemma terms |
| Gemma 4 26B A4B (vision, thinking) | 15.4 GB | 24 GB computers | desktop | Gemma terms |
| Qwen3.8 27B (vision, thinking) | 17.4 GB | 32 GB computers | desktop | Apache 2.0 |

The desktop app can also search Hugging Face and run almost any GGUF model. Full lists: [`apps/mobile/constants/models.ts`](apps/mobile/constants/models.ts) (phone) and [`apps/web/src/catalog.ts`](apps/web/src/catalog.ts) (web and desktop).

## Pricing

Everything on your device is free: every offline model, with no account and no limits. In the cloud, one model is free every day (GPT-6 Luna, 20 messages).

The most powerful cloud models use credits, from **Quo Pro** ($12 a month or $99 a year, with 1,000 credits a month and Quo Sync) or a **credit pack** (from $12). **Quo Sync** on its own is $24 a year. Buy them in Quo Web or the desktop app (Plan & credits); prices include tax.

On the phone, a one-time **Premium** upgrade (from $9.99) unlocks every model, thinking, voice, and unlimited chats and memories. Full details: [quo.computer/pricing](https://quo.computer/pricing/).

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
cd ../desktop && npm install
npm run fetch:engine   # the pinned llama.cpp build for this computer
npm run dev
```

**Phone apps** (Expo SDK 57 / React Native, New Architecture)

```bash
cd apps/mobile
npm install
npm run android    # or: npm run ios (macOS)
```

Each app has its own checks (`npm run typecheck`, `npm test`, and `npm run lint` for the phone app). [`CLAUDE.md`](CLAUDE.md) covers the architecture and the rules that keep it safe; [`apps/web/README.md`](apps/web/README.md) (including hosting your own server) and [`apps/desktop/README.md`](apps/desktop/README.md) go deeper.

## Repository

```
apps/mobile/    Phone app: Expo / React Native, llama.rn
apps/web/       Quo Web (Vite + React, wllama) and its API (server/)
apps/desktop/   Desktop app: Electron and llama.cpp, serving a Quo Web build
website/        quo.computer (static)
scripts/        Checks that run in CI: secrets, file size, shared sync code
```

## Contributing

Issues and pull requests are welcome: see [CONTRIBUTING.md](.github/CONTRIBUTING.md) and the [Code of Conduct](.github/CODE_OF_CONDUCT.md). Report security issues privately ([SECURITY.md](.github/SECURITY.md)).

## License

[Apache 2.0](LICENSE). The licence doesn't cover the Quo name, logo or icons, so forks need their own ([TRADEMARKS.md](TRADEMARKS.md)). Brand assets: [quo.computer/brand](https://quo.computer/brand/).
