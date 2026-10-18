# Contributing to Quo

Thanks for helping. Quo is a private, offline-first AI assistant, so every change should keep three promises:

1. **Local first.** Local models work fully offline. Nothing leaves the device unless the user explicitly chooses a cloud model.
2. **No tracking by default.** No new analytics, third-party requests or SDKs without discussion.
3. **Plain language.** UI text explains what happens, without jargon.

## Getting started

- **Quo Web:** `cd apps/web && npm install && npm run dev`
- **Desktop:** build Quo Web (`cd apps/web && npm run build`), then `cd apps/desktop && npm install && npm run dev`
- **Phone apps:** `cd apps/mobile && npm install && npm run android` (or `npm run ios` on macOS)

Read [`CLAUDE.md`](../CLAUDE.md) first. It lists architecture and the native gotchas that break builds. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md), and report security issues privately ([SECURITY.md](SECURITY.md)).

## Before opening a pull request

- The checks pass in every app you touched: `npm run typecheck && npm test` (plus `npm run lint` in `apps/mobile`).
- Keep changes focused, with one topic per pull request.
- For UI changes, include a screenshot or short clip.
- For bigger changes (new model, new feature, dependency bumps to llama.rn or wllama), open an issue first.

## Writing style

Quo is for everyone, not just developers, so text in the apps and on the website:

- Uses plain words: "runs on your device", not "on-device inference"; "graphics card", not "GPU" (developer docs can be technical).
- Is short and calm. No hype words like "revolutionary" or "supercharge".
- Is honest about limits: smaller than cloud models, slower without a graphics card.
- Uses sentence case, with full stops on headlines.

## Reporting bugs

Include your device or computer, OS, browser (for Quo Web), the model you used, and steps to reproduce.

## License

By contributing, you agree that your contributions are licensed under [Apache 2.0](../LICENSE).
