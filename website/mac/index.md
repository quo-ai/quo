# Private AI for Mac that works offline

Quo is a free, open-source AI assistant that runs on your own Mac. It runs open models such as Qwen, Gemma and Llama on Apple silicon’s graphics. After a model downloads, it works with no internet, and what you type stays on your Mac.

[Download for Mac](https://github.com/quo-ai/quo/releases/latest/download/Quo-mac-universal.dmg)[Try it in your browser first](https://app.quo.computer/)

- Apple silicon and Intel Macs
- One app for both
- No account

Quo running with Wi-Fi off: a chat planning a budget trip to Lisbon, answered by a model on the device itself

## Install it

1. Download [Quo-mac-universal.dmg](https://github.com/quo-ai/quo/releases/latest/download/Quo-mac-universal.dmg) and open it.
2. Drag **Quo** into your Applications folder.
3. Open Quo. If macOS says it can’t check the app, go to System Settings › Privacy & Security and choose **Open Anyway**. You do this once.
4. Quo suggests a model that fits your Mac. Download it once; after that it works offline.

Or install it in one line in Terminal. It checks the download against the release’s checksum and puts Quo in Applications. Run it again to update Quo.

In Terminal `curl -fsSL https://quo.computer/install.sh | sh`

## What it does

- **Works offline.** Models run on your computer. After a model downloads, Quo needs no internet, and your chats, documents and photos stay on the computer.
- **Runs on Apple silicon’s graphics.** On Macs with Apple silicon, Quo runs models with llama.cpp on the graphics (Metal), using the Mac’s shared memory. Intel Macs run them on the processor.
- **Reads documents and photos, and listens.** Ask about a PDF or a photo, or talk instead of typing. Your voice is turned into text on the computer.
- **[Any GGUF model from Hugging Face](https://quo.computer/models/hugging-face/).** Search Hugging Face in Models & storage, or use models you already downloaded with LM Studio or Ollama.
- **[Code mode](https://quo.computer/code-mode/).** A model works in a project folder: it reads the code, makes changes, runs tests, commits and pushes. You approve every step.
- **Makes pictures on Macs with Apple silicon** with an image model you download.
- **Cloud models only when you choose them:** Quo’s own, your own API key, or [Claude Agent](https://quo.computer/claude-agent/) with your own Claude Code sign-in. Each is clearly marked.

## Models that run on it

In the desktop app, Quo checks your device and suggests a model that runs well. Bigger models give better answers but need more memory. Each model has its own page with what it needs and its licence.

| Model | Good at | Download | Memory it needs |
| --- | --- | --- | --- |
| [Qwen3.5 4B](https://quo.computer/models/qwen3.5-4b/) | Strong all-rounder with careful reasoning. Reads images. Best on a computer with a graphics card. | 3.5 GB | 8 GB |
| [Qwen3.5 9B](https://quo.computer/models/qwen3.5-9b/) | A big step up in quality and reasoning. Reads images. Wants a graphics card with 8 GB or more, or 16 GB of memory. | 6.8 GB | 12 GB |
| [Qwen3.8 27B](https://quo.computer/models/qwen3.8-27b/) | The most capable model here. Reads images. For computers with 32 GB or more of memory, or a high-end graphics card. | 17.4 GB | 32 GB |
| [Gemma 4 E2B](https://quo.computer/models/gemma-4-e2b/) | Google’s small multilingual model. Reads images and speaks 140+ languages. | 3.6 GB | 8 GB |
| [Gemma 4 12B](https://quo.computer/models/gemma-4-12b/) | Google’s mid-size model: clear writing in 140+ languages. Reads images. Wants a graphics card with 8 GB or more, or 16 GB of memory. | 6.9 GB | 12 GB |
| [Gemma 4 26B A4B](https://quo.computer/models/gemma-4-26b-a4b/) | Google’s larger model, quick for its size: it uses only part of itself for each word. Reads images. For computers with 24 GB or more of memory. | 15.4 GB | 24 GB |
| [Llama 3.2 3B](https://quo.computer/models/llama-3.2-3b/) | Dependable all-rounder for writing and summarising. | 2 GB | 8 GB |
| [Phi-4 Mini](https://quo.computer/models/phi-4-mini/) | Microsoft’s compact reasoning model. Strong at maths, logic and structured answers. | 2.5 GB | 8 GB |

See [every model and what it needs](https://quo.computer/models/).

## Questions

### Why does macOS ask before it opens Quo?

Quo isn’t notarised by Apple yet, so macOS asks once. Choose Open Anyway in System Settings › Privacy & Security. Quo is open source, and the app is built from the code on GitHub by an automated release process.

### Does Quo run on Intel Macs?

Yes: the app is universal. Intel Macs run models on the processor, which is slower, so choose a smaller model. Macs with Apple silicon run them on the graphics. The smallest models need about 8 GB of memory.

### How do I update Quo on a Mac?

Quo tells you when a new version is out. Download it again, or run the one-line install again. Your chats and models are kept.

### Does Quo work without the internet?

Yes. Quo needs the internet to download the app and a model. After that, chats run on your computer with Wi-Fi off. Quo checks for updates when it starts; you can turn that off in the Help menu.

## Quo on your other devices

- [Windows](https://quo.computer/windows/)
- [Linux](https://quo.computer/linux/)
- [Android](https://quo.computer/android/)
- [In your browser](https://quo.computer/browser/)

---
Quo runs AI models on your Mac, on Apple silicon’s graphics, with no internet and no account. Free and open source. How to install it and which models fit.
This page: https://quo.computer/mac/
