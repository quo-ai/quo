# Private AI for Linux that works offline

Quo is a free, open-source AI assistant that runs on your own computer. It runs open models such as Qwen, Gemma and Llama with llama.cpp on your graphics card. After a model downloads, it works with no internet, and what you type stays on your computer.

[Download the AppImage](https://github.com/quo-ai/quo/releases/latest/download/Quo-linux-x86_64.AppImage)[All downloads (.deb, ARM)](https://github.com/quo-ai/quo/releases/latest)

- x64 and ARM64
- AppImage and .deb
- Updates itself
- No account

Quo running with Wi-Fi off: a chat planning a budget trip to Lisbon, answered by a model on the device itself

## Install it

The quickest way is one line in a terminal. It picks the build for your computer, checks it against the release’s checksum, and installs the AppImage in `~/.local/bin` with a menu entry. It needs no root.

In Terminal `curl -fsSL https://quo.computer/install.sh | sh`

### AppImage

1. Download [Quo-linux-x86_64.AppImage](https://github.com/quo-ai/quo/releases/latest/download/Quo-linux-x86_64.AppImage), or [the ARM64 build](https://github.com/quo-ai/quo/releases/latest/download/Quo-linux-arm64.AppImage).
2. Make it executable: `chmod +x Quo-linux-x86_64.AppImage`
3. Open it. The AppImage needs FUSE 2: `sudo apt install libfuse2t64` on Ubuntu 24.04 and later, `libfuse2` on older releases.

### .deb, for Debian and Ubuntu

1. Download [Quo-linux-amd64.deb](https://github.com/quo-ai/quo/releases/latest/download/Quo-linux-amd64.deb), or [the ARM64 build](https://github.com/quo-ai/quo/releases/latest/download/Quo-linux-arm64.deb).
2. Install it: `sudo apt install ./Quo-linux-amd64.deb`

## What it does

- **Works offline.** Models run on your computer. After a model downloads, Quo needs no internet, and your chats, documents and photos stay on the computer.
- **Runs on your graphics card.** On x64, Quo uses llama.cpp with Vulkan, so most NVIDIA, AMD and Intel graphics work. On an NVIDIA card you can add llama.cpp’s CUDA engine in Models & storage. ARM64 computers run models on the processor; NVIDIA ARM machines can add the CUDA engine.
- **Reads documents and photos, and listens.** Ask about a PDF or a photo, or talk instead of typing. Your voice is turned into text on the computer.
- **[Any GGUF model from Hugging Face](https://quo.computer/models/hugging-face/).** Search Hugging Face in Models & storage, or use models you already downloaded with LM Studio or Ollama.
- **[Code mode](https://quo.computer/code-mode/).** A model works in a project folder: it reads the code, makes changes, runs tests, commits and pushes. You approve every step.
- **Makes pictures on x64 computers** with an image model you download.
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

### AppImage or .deb?

They are the same app, and both update themselves. The AppImage needs no root and runs on most distributions, but needs FUSE 2. The .deb is for Debian and Ubuntu, doesn’t need FUSE, and asks for your password to install updates.

### Which graphics cards work?

On x64, Quo runs models with Vulkan, so most NVIDIA, AMD and Intel graphics work with their usual drivers. On an NVIDIA card you can also add llama.cpp’s CUDA engine. Without a usable graphics card, models run on the processor.

### Does Quo work without the internet?

Yes. Quo needs the internet to download the app and a model. After that, chats run on your computer with Wi-Fi off. Quo checks for updates when it starts; you can turn that off in the Help menu.

### Is Quo open source?

Yes, under Apache 2.0. The app is built from the code on [GitHub](https://github.com/quo-ai/quo) by an automated release process, and its engine is llama.cpp’s official release build.

## Quo on your other devices

- [Windows](https://quo.computer/windows/)
- [Mac](https://quo.computer/mac/)
- [Android](https://quo.computer/android/)
- [In your browser](https://quo.computer/browser/)

---
Quo runs AI models on your Linux computer with llama.cpp and Vulkan, with no internet and no account. AppImage and .deb for x64 and ARM. Free and open source.
This page: https://quo.computer/linux/
