# Support

We’re happy to help.

Email [hello@quo.computer](mailto:hello@quo.computer) and we’ll get back to you. Please mention your device (phone model, or computer and browser) and the version of Quo you have.

## Common questions

Does Quo need an internet connection?

Only to download an AI model. After that, Quo works fully offline.

Where are my chats stored?

On your device. If you turn on Quo Sync (optional, and it needs a Quo account), encrypted copies are also kept so your other devices can have them, and we can’t read them. Without Quo Sync there is no server copy, so if you uninstall the app or clear your chats, they are gone for good.

What is Code mode?

A coding agent in the desktop app. Ask for something in a project and Quo works in that folder: it reads the code, makes changes, runs your tests, commits and, if you ask, pushes and gives you a link to open a pull request. You approve every change, command, commit and push in a window the page can’t click (read-only checks like `git status` run on their own), and it never reads files like .env or private keys. Plan mode makes it read-only, and Undo puts changed files back. It reads PDF, Word, PowerPoint, Excel and OpenDocument files too, so you can also ask about a folder of documents. With a cloud model the files it reads go to the model’s provider; with an offline model they stay on your computer. Settings are in **Models & storage → Code**.

Can I use my own API key?

Yes, with no Quo account. In **Models & storage → Your keys**, pick a provider (OpenRouter, Anthropic, OpenAI, Google, xAI, DeepSeek, Mistral or Groq), paste your key and choose the models you want. You can also add a server of your own, such as Ollama or LM Studio. Messages go straight from your computer to the provider, not through Quo, and you pay the provider directly. In the desktop app the key is kept in your system’s secure storage and the page can’t read it back. Code mode works with these models too.

Can Quo search the web?

Yes. There is no switch to press: the model searches when it decides a message needs it, like Claude and ChatGPT do. Quo’s cloud models, the free one included, search through OpenRouter (a few searches a day on the free model). In the desktop app, models with your own key and offline models can also search and read pages, with the service you pick in **Models & storage → Web**: Brave Search, Tavily or Exa with your own key, your own SearXNG, or DuckDuckGo with nothing to set up. Searching is allowed by default for online models and off for offline ones, and can be changed there. The search words leave your computer; nothing else does. Offline, it switches itself off.

What is Quo Sync?

It keeps your chats and memories in step between your devices (the Android app, Quo Web and the desktop app), end-to-end encrypted: they’re scrambled on your device with a key only you hold, so we can’t read them. Turn it on in **Settings → Sync** in the Android app, or from the sidebar in Quo Web and the desktop app. It’s included with Quo Pro, or can be bought on its own. Photos, files and models aren’t synced.

I lost my Quo Sync recovery key.

Nobody can recover it, not even us, because that’s what keeps your chats private. Your chats on your devices are still there. Open Quo Sync, choose to delete the cloud copy, and turn Quo Sync on again from a device that has your chats: it uploads them afresh with a new key.

How do I delete my Quo account?

In the Android app: **Settings → Sync → Delete my Quo account**. In Quo Web or the desktop app: **Plan & credits → Delete my account**. It deletes your synced chats and memories, credits and plan records, and leaves the chats on your devices. If you have a running plan, cancel it first. If you can’t sign in, email us from the address on the account and we’ll do it for you. Full steps: [how to delete your account](https://quo.computer/delete-account/).

Why are replies slow on my phone?

The AI runs on your phone’s processor. Lighter models reply faster; larger models are more capable but slower, especially on older phones. You can switch models in Settings.

How do I restore my Premium purchase?

Open Settings and tap **Restore Purchases**, signed in with the same Google Play or Apple account you bought it with.

How do I turn off analytics?

Settings → Data → Share Usage Analytics. Quo never sends your chats, prompts or files either way.

How do I delete my data?

Your chats and memories are on your device: delete them in Settings, or uninstall Quo to remove everything. If you use Quo Sync, delete your account to remove the cloud copy too (see below). For the limited usage data described in our [Privacy Policy](https://quo.computer/privacy/), email us.

Where can I use Quo?

In your browser at [Quo Web](https://app.quo.computer/) (Chrome or Edge work best), as a [desktop app](https://quo.computer/#desktop) for Mac, Windows and Linux, and on Android. The iPhone app is coming soon. Each keeps its chats on that device only.

Why are replies slow in my browser?

Chrome and Edge can use your graphics card, which makes replies much faster. Firefox and Safari run Quo on your processor. If you’d rather not switch browsers, use the desktop app.

My computer warns about the desktop app. Is it safe?

The app is built from the open-source code on GitHub by an automated release process. Until our signing certificates are in place, macOS may ask you to confirm it in System Settings › Privacy & Security (Open Anyway), and Windows may show “More info › Run anyway”.

Can I report a bug or suggest a feature?

Yes, please. Open an issue on [GitHub](https://github.com/quo-ai/quo/issues/new/choose), or email us.

---
Answers to common questions about Quo, the private AI assistant that works offline, and how to reach us.
This page: https://quo.computer/support/
