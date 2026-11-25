# Run any GGUF model from Hugging Face

Besides its own list, the Quo desktop app can search Hugging Face and run almost any GGUF model on your computer, offline, with llama.cpp. It checks which models its engine can load (169 kinds of model) before anything downloads, and suggests a file that fits.

[Get the desktop app](https://quo.computer/#desktop)[Quo’s own models](https://quo.computer/models/)

- Desktop app: Mac, Windows, Linux
- Runs offline
- Free

## How it works

1. In **Models & storage**, open **Any model from Hugging Face** and search.
2. Quo marks the models its engine can’t load, and the ones that only embed text or speak, before anything downloads.
3. It suggests a file that fits your computer: a 4-bit file where it fits, never under 3 bits.
4. Press **Add and download**. The download is checked like any other, and the model then runs offline like Quo’s own.

## Models you already have

- Models you downloaded with LM Studio or Ollama, or a GGUF file you pick, run where they are. Quo never copies them, and forgetting one in Quo never deletes the file.
- Split (multi-part) GGUF files and files under 3 bits aren’t offered.

## Questions

### Which models can Quo run from Hugging Face?

Any GGUF model whose kind the bundled llama.cpp loads (169 kinds at present). Quo checks before anything downloads and says when a model can’t run.

### Does it work without the internet?

Yes, after the download. The model runs on your computer, and your chats stay there.

### Where are the files kept?

In Quo’s own folder for models. Models you already have from LM Studio or Ollama are used where they are, never copied.

### Is it free?

Yes. Running models on your computer is free, with no account and no limits.

## More in the desktop app

- [Claude Agent](https://quo.computer/claude-agent/)
- [Code mode](https://quo.computer/code-mode/)
- [Windows](https://quo.computer/windows/)
- [Mac](https://quo.computer/mac/)
- [Linux](https://quo.computer/linux/)

---
Quo’s desktop app searches Hugging Face, checks which GGUF models its llama.cpp engine can load, picks a file that fits your computer and runs it offline. Free.
This page: https://quo.computer/models/hugging-face/
