# Changelog

All notable changes to Quo will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Quo Web** — Quo in the browser: offline models run on the computer (WebGPU in Chrome and Edge), saved chats, thinking mode, resumable model downloads, installable as an app. Optional, clearly marked cloud models.
- **Quo for desktop** — macOS, Windows and Linux app (Electron). Built and published by GitHub Actions.
- **Get the app / Install Quo** — one-time install prompt after the first answer, a "Get the app" sheet, and browser / phone banners that point to the faster option.
- **Native AI engine in the desktop app** — models now run in llama.cpp on the graphics card (Metal, Vulkan) or processor, instead of in the browser: far faster replies (hundreds of tokens a second on a graphics card instead of about a dozen), documents read in seconds instead of over a minute, and no 2 GB model limit. Bigger models (Qwen3.5 up to 27B), models that read photos, and models you already have from LM Studio or Ollama are used in place with no second download. Falls back to the in-browser engine where it isn't available.
- **Code mode: a coding agent in the desktop app** — turn on Code in the chat bar and pick a project folder. A model can read and search the code, make changes, run tests and read public GitHub repositories. A Plan switch makes it read-only, each reply that changed files has an Undo button, and it follows the project's `AGENTS.md`. You approve every change and command (read-only ones like `git status` run on their own), and secrets files (.env, keys) are never read. Works with Quo's cloud models, your own API key, or an offline model on your computer (Qwen3.5 9B and up recommended; smaller ones ask first). Settings are in Models & storage → Code.
- **Web search with Quo’s cloud models, the model’s call** — there is no Web switch: the model is offered OpenRouter’s web search tool and searches only when a message needs it (a fixed engine, Exa, so the price is known: $0.007 a search plus the results as tokens), in the browser and the desktop app. The free model gets one search a reply from 3 a day per device (10 per IP; `FREE_DAILY_SEARCHES`, `FREE_DAILY_SEARCHES_PER_IP`); a reply that didn't search gives it back, and once they're used up Quo says so once. Replies on credits may search up to 3 times and pay only for the searches made. Your own OpenRouter key gets the same tool. Settings → Web says whether models may search at all.
- **A new look for things that move, and slash commands** — what appears dissolves in through an ordered dither, "working" is a dither bar sweeping (under a running step, along the chat box, while a reply is on its way) with a block cursor at the end of streaming text, terminal output has scanlines and a faint glow, a finished step flashes once, and everything stops for people who ask for reduced motion. Code in replies has its language and a copy button, long runs of steps fold the older ones away with a one-line summary, edits show +/− as badges, and a Latest button appears when you scroll up. Type `/` for commands (`/new`, `/plan`, `/code`, `/summarise`, `/undo`, `/retry`, `/copy`, `/model`, `/keys`, `/think`, `/folder`, `/stop`; only the ones that apply right now are listed), `Shift+Tab` switches plan mode, and an arrow up in an empty box brings back your last message.
- **Memory meter, summaries and a better folder picker** — a ring in the chat bar shows how full the model's memory is (counted by the provider when it says, estimated otherwise); open it to see what fills it, summarise the earlier messages so the conversation goes on from notes (or let Quo do it by itself when it is nearly full), or start a new chat. In Code mode the folder chip switches between recent projects (with where they are) and shows the git branch and how many files changed, each chat remembers its folder, and typing `@` lists the project's files to point the model at one.
- **Use your own API key** — in Models & storage → Your keys, connect OpenRouter, Anthropic, OpenAI, Google, xAI, DeepSeek, Mistral or Groq, or add a server of your own (Ollama, LM Studio…), for chat and Code mode, with no Quo account. Messages go straight from your computer to the provider, not through Quo. In the desktop app the key is encrypted by your system's secure storage and the app's pages can't read it back; in a browser it stays in that browser.
- **Web search** — models can search the web and read pages: in Code mode, and in chats with your own API key or an offline model, when the model decides to. Choose the search service in Models & storage → Web: Brave Search, Tavily or Exa with your key, your own SearXNG, or DuckDuckGo with nothing to set up. In a browser, OpenRouter and Anthropic search for themselves. On by default with your own keys, off with offline models until you turn it on. A model can only open addresses you wrote, a search found, or a page it read links to; never this computer or your network.
- **Connection awareness** — Quo notices when you're offline (an Offline pill, web search switches off) and, as you choose, moves to your offline model when a cloud model can't be used (no internet, out of messages or credits, a refused key), asks first, or does nothing. It only ever moves toward the offline model.
- **Quo Pro and cloud models** — a Quo Pro popup and a Cloud tab under Models & storage list the free model and the frontier models (Claude, GPT, Gemini, Grok, Qwen, GLM, Mistral, DeepSeek and more), which stay locked until you sign in and have credits. Choosing a locked model shows what it costs and how to unlock it.
- **Memories in Quo Web and the desktop app** — a list of things you want Quo to know about you (Memories in the sidebar). Offline models read it before every reply; it is never sent to a cloud model. With Quo Sync on, it is the same list as in the Android app.
- **Photos and documents** — attach PDFs and text files (and photos, with models that read images) to a message; they're read on your computer and only go to offline models.
- **Voice input and read aloud** — speak instead of typing (Whisper runs on your computer after a one-time ~80 MB download) and have replies read out with your system's voices.
- **Quo Sync** — end-to-end encrypted sync of chats and memories between Quo Web, the desktop app and the Android app, with a recovery key only you hold; Quo can't read them. Part of Quo Pro, or on its own. Needs sign-in and purchases to be switched on.
- **Sign out of all devices** — ends every other sign-in of your account (a lost phone, a shared computer); available in Plan & credits in Quo Web and the desktop app, and in Settings → Sync in the Android app.
- **Delete your account** — from Settings → Sync in the Android app, or Plan & credits in Quo Web and the desktop app; it removes your synced data, credits and plan records.
- **Sync clean-up** — synced data stays for 180 days after a plan ends (with one warning email 30 days before it is deleted).
- **Open source** — Apache 2.0 licence, contributing guide, code of conduct, security policy, issue templates; website and brand assets refreshed for launch.

## [1.5.0] - 2026-10-04

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

## [1.4.0] - 2026-07-07

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

## [1.3.2] - 2026-07-06

### Added
- New and refined model options, including premium models
- Voice input auto-detects the language with multilingual models

### Improved
- Vision model downloads and model management

### Fixed
- Layout issues, bugs and performance problems

## [1.3.0] - 2026-03-30

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

## [1.2.9] - 2026-03-04

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

## [1.2.8] - Previous Release
- Initial release with core AI chat functionality
- On-device model inference
- Vision/image analysis capabilities
- Memory system for user preferences
- Multi-language support
