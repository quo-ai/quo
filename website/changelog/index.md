# What’s new in Quo

Last updated 13 November 2026. Also on [GitHub](https://github.com/quo-ai/quo/blob/master/CHANGELOG.md).

Notable changes to Quo. Quo Web and the desktop app ship together under the desktop version (`desktop-v*` tags); the phone app has its own numbers. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## Quo Desktop 1.7.2

2026-11-13

### Added

- **Claude Agent** — use Claude in Quo with your own Claude Code sign-in, on your own Claude plan (or API key). Install Claude Code, run `claude auth login`, then open Models & storage → Your keys → Claude Agent. Your messages go from your computer to Anthropic, not through Quo, and Quo never sees your sign-in. It works in chat and in Code mode, where every change still needs your OK in Quo. The chat bar shows how much of your plan's limits is used.

### Improved

- **llama.cpp 1.0** — Quo runs the engine's first 1.0 release. Replies came faster in our tests on the graphics card, its server has security fixes, and Quo can run 3 more kinds of model from Hugging Face.
- **More offline models in Quo Web** — SmolLM3 3B, Ministral 3B and Phi-4 Mini join Qwen3.5, Llama 3.2 and Gemma 4 in the browser, with a newer browser engine.
- **A link can open Quo Web on one model** — each model's page on the website has "Try it in your browser".
- **Images made on your computer** use the newest stable-diffusion.cpp.

### Fixed

- **The first picture on a computer** — it sometimes said "Stopped." although the picture had been made. It shows now.
- **Security** — the app is built on Electron 44.11, with Chromium's latest fixes.

## Quo Desktop 1.7.1

2026-11-08

### Improved

- **A newer engine** — llama.cpp's first numbered stable release (v0.9.0). Replies came faster in our tests on the graphics card, Gemma 4 E2B reads long messages faster, and Quo can run 8 more kinds of model from Hugging Face, among them Mistral Large 4, LFM3 and DeepSeek 4.1.
- **A picture to make** — a new chat always suggests one picture among its ideas. Click it to make the picture: in an offline chat it's made on this computer once an image model is downloaded.
- **Images made on your computer** use the newest stable-diffusion.cpp.

### Fixed

- **Stable Diffusion 2 files** — adding one as your own image model now says plainly that Quo can't run it, instead of treating it as Stable Diffusion 1.5.
- **Security** — the app is built on Electron 44.10, with Chromium's latest fixes.

## Quo Desktop 1.7.0

2026-11-03

### Added

- **Images made on your computer** — download an image model in Models & storage (Z-Image Turbo, or FLUX.2 klein, which can also change a picture) and offline chats make pictures on this computer: nothing is sent, not even the description. Ask for a change right after a picture ("remove the apple") and Quo makes it. You can also add an image model file of your own: SDXL, Stable Diffusion 1.5, or a Z-Image or FLUX.2 klein fine-tune.
- **Images** — every picture you've made, across chats, in the sidebar. Click one to see it full size, zoom in and move around.
- **Tool servers (MCP)** — give models more tools, such as your calendar, GitHub or a database. Add servers to Quo's tool servers file (the same form other apps use) in Models & storage → Code; turning one on shows exactly what it runs, and Quo asks before each of its tools is used.
- **Documents in a folder** — Quo reads PDF, Word, PowerPoint, Excel and OpenDocument files in a folder you open, so you can ask about a folder of documents. They are read in a sealed-off part of the app.
- **A local server for other apps** — let editors, scripts and tools on this computer use Quo's offline model through the OpenAI-style API. Off until you turn it on in Models & storage.
- **Fewer questions in Code mode, if you choose** — for one session, let Quo ask only about risky steps, or about nothing but pushes.

### Improved

- **Code mode finds things out** — it checks the project and the computer with its tools instead of saying it can't, and with the free model it takes up to 20 steps a reply instead of 8.
- **Pictures in offline chats** — they're made on this computer once an image model is downloaded; otherwise Quo asks before making one in the cloud. Each picture offers the other place to make it.

### Fixed

- **The next message after a picture** — the offline model loads again and answers. The same goes after the faster NVIDIA engine is installed, or after an unused model was let go.
- **Quo's approval window** — released builds showed the system's plain dialog for every approval instead of Quo's own window. It's back.
- **The Plan button** no longer runs over the note beside it.
- **Linux one-line install** — the menu entry matches the app, and quo:// links open in it.

## Quo Desktop 1.6.0

2026-11-03

### Added

- **A new look** — Quo Web and the desktop app have a calmer design with solid surfaces and Atkinson Hyperlegible type, made to be easy to read. Choose Light, Dark or Black, and Quo follows your system's high-contrast setting and e-ink screens. Every reply shows where it ran: on your device or in the cloud.
- **Edit a message, or go back** — change one of your earlier messages and the chat goes on from there, or go back to an earlier reply (with a few seconds to undo). Quo Sync keeps the change on your other devices.
- **Make images** — ask a cloud model for a picture, or type `/image` with any model. A few are free every day; after that they use credits, and each image shows what it cost. Images stay on your device.
- **Files and photos for every model** — documents and photos now go with your message to cloud models and to models you use with your own key too. With an offline model they still never leave your device.
- **Quo Pro, credit packs and Quo Sync** — on sale in Quo Web and the desktop app, under Plan & credits. New accounts get 25 free credits to try.
- **Invite friends** — a friend who signs up with your link gets 25 extra credits, and you get 50 when they first buy.
- **Open a model from Hugging Face in Quo** — links that start with `quo://models/huggingface/` open that model in Models & storage, ready to download.

### Changed

- **Quo's new address** — Quo Web is at app.quo.computer and the website at quo.computer. The desktop app now uses them; the old address keeps working for a while.
- **Updates on a Mac** — the Mac app can't install updates by itself yet (it isn't signed by Apple), so instead of downloading them it now tells you once when a new version is out, with a button to download it.

## Quo Desktop 1.5.0

2026-10-21

### Added

- **Any model from Hugging Face** — the desktop app can search Hugging Face and run almost any GGUF model (about 160 kinds: Llama, Qwen, Gemma, Mistral, DeepSeek, GLM, Phi, Granite and more). It says before downloading if a model won't work, and suggests a size that fits your computer.
- **A faster engine for NVIDIA graphics cards** — Models & storage offers llama.cpp's CUDA engine where it helps: long messages are read about 40% faster and replies written about 10% faster. It's downloaded only if you ask, from llama.cpp's own releases, and checked before use; if it ever fails to start, Quo goes back to the engine it came with.
- **Linux on ARM** — Quo now has ARM builds for Linux.
- **Qwen3.8 27B** replaces Qwen3.5 27B in the desktop app: the newer model, with the same speed-up for writing several words at once. If you have the old one, Models & storage offers to remove it.
- **Gemma 4 models** — Gemma 4 E2B in the browser (Chrome, Edge and Firefox; best with a graphics card), and Gemma 4 12B and 26B A4B in the desktop app. Google's models write well in 140+ languages, read images in the desktop app, and can think when you turn it on.
- **Dark mode and themes** — follows your system, or choose Light or Dark in Settings → Appearance. Dark is true black by default (clean on OLED screens), or Midnight, the indigo night with frosted glass. The accent is Indigo or Mono (greys, no glow). In the desktop app the window and the approval window follow the same choice.

### Fixed

- **No engine from a CDN** — in Safari and older browsers, the offline model's engine came from a public CDN (jsDelivr). Quo now ships that version itself and loads it only where it's needed.

### Improved

- **Faster writing in the desktop app** — Qwen and Gemma models draft several words at a time and check each one, so replies are the same, only quicker: rewriting a file with a small change went from about 100 to 570 words a second in our test. Gemma 4 models come with a small drafter file for this.
- **Longer memory on smaller computers** — when memory is short, the desktop app stores the model's working memory in 8 bits, which fits about twice as much conversation for about 3% of speed.
- **Much faster follow-ups with offline models** — the model now reuses what it already read of the chat instead of reading it all again: the prompt no longer changes every minute (it has the date, not the time), and long chats and Code sessions drop old parts in steps. In a test in the browser, a follow-up in a 2,300-token chat took 2 seconds instead of 114.
- **Clearer replies** — every model is asked to write plainly: the answer first, short sentences, no filler, and the same style in the code and text it writes.
- **Code colours** — code in replies and in the desktop file panel is coloured by language (about 50, with the grammars VS Code uses), in calm colours that follow your theme and accent. Code blocks are light in Light mode, like GitHub.
- **Maths** — formulas are drawn properly, inline and on their own line, however the model writes them; prices like $5 stay as text.
- **Easier tables and text** — numbers line up and right-align, headings and paragraphs wrap without a lone last word.
- **Small details** — the background glow fades out through a fine dither (Light and Midnight), changing the look dissolves the new one in, terminal output matches the dark style, and text selection, the text cursor and scrollbars take the accent.
- **Easier to read** — small grey text and green labels pass contrast checks in both themes; sheets stay readable where the browser can't blur.

## Quo Desktop 1.4.0

2026-10-20

### Added

- **Push and pull requests** — Code mode can push the branch you're on and give you a link to open a pull request on GitHub. You approve every push; it never force-pushes. Turn it off in Models & storage → Code.
- **Searches and sources** — each search shows as a step while it runs, and the pages a reply used appear as sources under it.
- **The model decides when to search** — no Web switch. Quo's cloud models, the free one included, search through OpenRouter when a question needs it (3 searches a day on the free model). Settings → Web says whether models may search at all.
- **Code mode starts itself** — the model asks for a project folder when a request needs one (you approve it), and can run a dev server in the background, hand a broad question to a read-only helper, keep a checklist, and summarise long sessions.
- **Thinking levels** — Off, Quick, Auto or Deep, showing only the levels each model has. Auto leaves it to the model.
- **Approvals in Quo's own window**, a file panel with clickable file links in replies, and opening what Quo built in your browser.
- **Memory meter and summaries** — see how full the model's memory is and summarise earlier messages to keep going. Type `/` for commands and `@` to point at a project file.
- **Connection awareness** — an Offline pill, and a choice to move to your offline model when a cloud model can't be reached.

### Improved

- **Faster offline Qwen3.5** in the desktop app (editions with a prediction head: about twice as fast on code edits). Models that don't fit memory start with a smaller window instead of failing, and an idle model unloads after 30 minutes.
- **Model settings follow each maker's advice** (sampling, window, reply length). Qwen3.5 0.8B and 2B left the desktop app as too small; their files can be deleted in Models & storage.
- **Commits** match the project's message style, a failing git hook comes back for the model to fix, signed commits work, and commands that throw work away carry a warning.
- **Quo's co-author line** names the `quo-code` account, so GitHub shows "quo-code" with Quo's picture instead of "quo-ai[bot]".

### Fixed

- macOS: Code mode refuses system folders reached through links (`/etc` is `/private/etc`).
- Linux: the taskbar shows Quo's icon instead of a generic one.

## Quo Desktop 1.3.0

2026-10-18

The first releases of Quo Web and the desktop app.

### Added

- **Quo Web** — offline models in the browser (WebGPU in Chrome and Edge), saved chats, thinking, resumable downloads, installable as an app.
- **Quo for desktop** — macOS, Windows and Linux. Models run in llama.cpp on the graphics card: hundreds of words a second, bigger models (up to Qwen3.5 27B), photos, and models you already have in LM Studio or Ollama.
- **Code mode** — a coding agent for a project folder: it reads, edits, runs tests and commits, and you approve every change, command and commit. Works with cloud models, your own key or an offline model.
- **Your own API keys** — OpenRouter, Anthropic, OpenAI, Google, xAI, DeepSeek, Mistral, Groq, or your own server (Ollama, LM Studio). Messages go straight to the provider.
- **Web search** in Code mode and with your own keys or offline models: Brave, Tavily, Exa, SearXNG or DuckDuckGo.
- **Cloud models** — a free model, and frontier models (Claude, GPT, Gemini and more) that unlock with credits.
- **Photos, documents, voice and read aloud**, all processed on your computer.
- **Memories** — things Quo should know about you, read by offline models only.
- **Quo Sync** — end-to-end encrypted sync of chats and memories across web, desktop and Android, with sign out of all devices and account deletion.
- **Open source** — Apache 2.0, with a contributing guide, code of conduct and security policy.

## Quo Phone 1.5.0

2026-10-04

### Added

- **Gemma 4** — new model with image understanding
- **Memories** — Quo remembers facts you ask it to, like your name
- **Light and dark mode** — refreshed look

### Improved

- **Answers** — smarter, more accurate and more on topic
- **Speed** — faster replies; thinking mode no longer takes so long
- **Smaller download** — the starter model installs in the background (Play Asset Delivery fast-follow)

### Fixed

- A crash when using thinking mode, plus many stability fixes

## Quo Phone 1.4.0

2026-07-07

### Added

- **Bundled starter model (instant start)** — Qwen3.5 0.8B ships with the app via Play Asset Delivery and is materialized on first launch, eliminating the first-run download wall. Builds without the pack fall back to the download flow automatically
- **Rolling context compression** — Older messages fold into an on-device LLM-written summary once history approaches the context limit, so long conversations keep their early content instead of silently forgetting it
- **Enhanced Recall (premium)** — Optional 84MB embedding model indexes conversations on-device; when a question relates to summarized-away messages, the most relevant originals are retrieved verbatim into the prompt
- **Read Aloud / offline voice output (premium)** — Optional ~535MB OuteTTS + WavTokenizer voice reads any answer aloud, fully offline, from the message long-press menu
- **Voice input trial** — Free users get 3 metered voice transcriptions before the paywall instead of a hard feature wall
- **New models** — Gemma 3 4B (vision), Gemma 3 1B, Phi-4 Mini (3.8B reasoning), Llama 3.2 3B
- **Speed Boost (experimental)** — Draft-model speculative decoding: the 0.8B starter drafts for Qwen 2B/4B when enabled in Settings → Intelligence
- **Storage management** — Download/delete controls for the optional voice and recall models in Settings
- **Suggested questions** — Empty state now shows 4 random questions from a 1,100+ knowledge bank instead of workflow template buttons

### Fixed

- **Responses cutting off mid-sentence** — Generation now auto-continues (up to 3 extra passes) when the token cap is hit, so detailed multi-step answers run to completion
- **Free vision contradiction** — Users on non-vision models are pointed to the free Ministral vision model instead of being shown a paywall for a capability the free tier includes
- **Conversation storage scalability** — Conversations now store one-per-key with an index (plus one-time migration), avoiding Android CursorWindow limits that could make large histories unreadable
- **Partial answers no longer discarded** — If generation errors after streaming began, the already-streamed content is kept instead of thrown away

### Improved

- **Smooth streaming with live formatting** — Replies render through the full markdown + LaTeX pipeline while streaming, with typewriter pacing and automatic repair of in-progress markdown (bold/code/fences/math no longer flash as raw markers)
- **Background memory usage** — Optional TTS and recall AI contexts are released when the app goes to background and reload lazily
- **Dependencies** — llama.rn 0.12.5, whisper.rn 0.5.5, lucide 1.x, expo-audio replaces deprecated expo-av, IAP 14.7.20; removed 15 unused dependencies
- **Engineering** — Jest test suite introduced (95+ unit tests), all model download URLs verified, deduplicated generation pipeline shared between send and resend

## Quo Phone 1.3.2

2026-07-06

### Added

- New and refined model options, including premium models
- Voice input auto-detects the language with multilingual models

### Improved

- Vision model downloads and model management

### Fixed

- Layout issues, bugs and performance problems

## Quo Phone 1.3.0

2026-03-30

### Fixed

- **Native Crash (SIGSEGV): endCompletion() race condition** — Added `isCompleting` mutex to prevent `stopCompletion()` from being called when no completion is active, fixing use-after-free crashes in `librnllama` on dotprod and v8 devices
- **Native Crash (SIGSEGV): JSI binding lambda** — `unloadModel()` now waits for any in-flight completion to finish before releasing the native context, preventing the JSI lambda from accessing freed memory
- **ANR: Model loading blocks UI thread** — Deferred `initLlama()` to `InteractionManager.runAfterInteractions` with a 100ms yield so the heavy native memory-mapping no longer competes with input dispatching during app startup
- **ANR: Download completion blocks main thread** — Moved `moveAsync()` file I/O in the download `.done()` callback off the native main thread via `setTimeout(0)`, fixing "RNBackgroundDownloaderModuleImpl.onSuccessfulDownload — Input dispatching timed out"
- **ANR: Streaming bridge contention** — Increased token streaming throttle from 50ms to 100ms to halve the number of React Native bridge crossings and reduce setState pressure on the UI thread
- **ANR: Mali GPU shader compilation** — The `InteractionManager` deferral also prevents `glLinkProgram` from contending with input dispatching on Mali GPU devices during model init
- **Math/LaTeX rendering overhaul** — Completely rewrote math rendering to convert LaTeX to Unicode inline within text, fixing broken paragraph flow. Supports Greek letters, super/subscripts (Unicode), fractions, roots, operators, relations, set theory, calculus, logic, arrows, accents, delimiters, trig functions, and environments. Display math renders as code blocks; inline math as code spans

### Added

- **File attachments** — Attach text files, PDFs, code, CSV, JSON, XML, and more to messages. The app extracts text content and sends it to the model so you can ask questions about documents, analyse finances, review code, etc. Supported via the new 📎 button in the input bar

### Improved

- **Chat scroll during streaming** — Scrolling up to read earlier content no longer fights auto-scroll. A floating ↓ button appears to jump back to the latest output. Auto-scroll resumes when you scroll back to the bottom or when generation finishes
- **Model tags updated** — Qwen3.5 models now carry the "Recommended" badge; legacy Qwen3 models are marked "Outdated" with descriptions pointing to their newer replacements

---

## Quo Phone 1.2.9

2026-03-04

### Added

- **Background Generation**: Model responses now continue generating when the app goes to background, with a persistent notification so Android keeps the process alive
- **Generation Notifications**: Get notified when your AI response finishes while the app is in background, with a preview of the response
- **Expanded Question Database**: Added 585+ diverse, timeless knowledge questions across 30 categories (science, history, philosophy, technology, cultures, etc.) for better conversation starters
- **Copy Responses**: Users can now copy model responses to clipboard (already implemented)

### Improved

- **Model Knowledge Confidence**: Updated system prompts to answer factual questions confidently instead of hedging or deflecting on common knowledge
- **Android Compatibility**: Fixed deprecated API warnings for Android 15+ by removing explicit statusBarColor setting
- **Large Screen Support**: Enabled all orientations and removed portrait lock to better support tablets and foldable devices
- **Model Management**: Improved custom model deletion to properly unload and remove files without affecting other models
- **Prompt Quality**: Removed weak/trivial questions and upgraded all prompts to be more specific and engaging

### Fixed

- **Background Generation Bug**: Previously, tapping home button during generation would stop the response and discard progress. Now generation continues in background
- **Model Deletion Bug**: Fixed issue where deleting a model could unload unrelated active models
- **System Prompt Issues**: Fixed model tendency to deflect on basic science questions by clarifying when to use "I don't know"
- **Notification Cleanup**: Fixed edge cases where ongoing generation notifications could persist after completion

### Technical

- Added persistent notification channel "Generation In Progress" for Android
- Added proper notification dismissal across all generation lifecycle events (stop, error, completion, return to app)
- Enhanced AppState handling to track background/foreground transitions correctly
- Improved error handling for model context invalidation scenarios

---

## Quo Phone 1.2.8

- Initial release with core AI chat functionality
- On-device model inference
- Vision/image analysis capabilities
- Memory system for user preferences
- Multi-language support

---
Every release of Quo for desktop, web and phone, with what changed.
This page: https://quo.computer/changelog/
