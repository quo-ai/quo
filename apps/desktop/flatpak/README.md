# Quo as a Flatpak

The desktop app as a Flatpak, app ID `computer.quo.Quo` (the reverse of quo.computer), built the way Flathub
requires: entirely from source, with no network during the build.

## How it's built

Flathub builds open-source apps entirely from source, with no network during the build. The manifest
(`computer.quo.Quo.yml`) builds, in order:

1. **llama.cpp** at the release `engine.lock.json` pins, the way its own Linux Vulkan release is built, into
   `/app/quo/resources/engine/<target>/`. The server's own web page is left out: Quo doesn't use it, and the build
   would otherwise download it.
2. **stable-diffusion.cpp** at the release `engine.lock.json` pins, likewise, into `…/engine/<target>/images/`, with
   only the parts `sd-cli` uses (its ggml and libwebp).
3. **Quo Web and the desktop app** from npm's offline cache (`generated-sources.json`, written by `sources.sh` from both
   lockfiles), then electron-builder's unpacked Linux build into `/app/quo`, started by `zypak-wrapper`.

When `engine.lock.json` changes, change the archive URLs, checksums and build number here too
(`test/packaging.test.js` checks they match).

## What differs inside Flatpak

- **Commands, git and tool servers run on the computer**, outside the sandbox, through `flatpak-spawn --host`
  (`src/flatpak.js`, permission `--talk-name=org.freedesktop.Flatpak`): a project's own compilers and tools aren't in
  the sandbox. Everything else is unchanged: the same approvals, the computer's environment scrubbed the same way, the
  same folder and limits. A small shell wrapper turns Flatpak's stop signals into SIGKILL for the whole process group,
  so Stop and time limits work as they do elsewhere. `test/flatpak.test.js` tries to abuse each part.
- **No self-updates and no CUDA download.** Flathub updates the app, and doesn't allow downloaded programs. The menu's
  update setting is hidden and the faster NVIDIA engine isn't offered; Vulkan runs on NVIDIA cards too.
- **Its own data folder** (`~/.var/app/computer.quo.Quo/`), as for every Flatpak: chats and models from another Quo
  install aren't shared.
- **Home folder access** (`--filesystem=home`) for Code mode's projects and for models already downloaded with LM
  Studio or Ollama.
- **x86_64 only** so far: the ARM build hasn't been tried on an ARM computer.

## Checking it

`.github/workflows/flatpak.yml` builds it in Flathub's container, runs Flathub's linter, installs it and runs
`--smoke`, which inside Flatpak also runs a command on the computer and checks that one ignoring signals is stopped. It
runs when these files change, for every `desktop-v*` tag, and by hand (Actions → Flatpak → Run workflow). The
workflow's artifact is an installable bundle: `flatpak install --user quo.flatpak`.

Tools like `flatpak-node-generator` and `flatpak-builder` aren't installed on the development computer; run them in a
container or let CI run them.

**Try the smoke test before pushing a change to it**, in the same image CI uses, on a bundle from a workflow run
(`gh run download <run> -n quo-x86_64.flatpak`). The first three commands let Flatpak update the image's own runtimes,
as the workflow does:

```bash
podman run --rm --privileged -v ./quo.flatpak:/quo.flatpak:ro -v ./apps/desktop/flatpak/smoke.sh:/smoke.sh:ro \
  --entrypoint bash ghcr.io/flathub-infra/flatpak-github-actions:freedesktop-26.08 -c \
  'cp -a /var/lib/flatpak /var/lib/flatpak.copy && rm -rf /var/lib/flatpak && mv /var/lib/flatpak.copy /var/lib/flatpak && bash /smoke.sh /quo.flatpak'
```

`--privileged` lets the container see this computer's graphics card: the smoke test only lists it (no model loads).

## Not for submitting to Flathub

This manifest was written with an AI assistant, so it can't go to Flathub. Flathub's
[Generative AI policy](https://docs.flathub.org/docs/for-app-authors/requirements#generative-ai-policy) says manifests
must not contain AI-generated or AI-assisted content (disclosing it doesn't help), AI tools must not open or automate
submission pull requests or write their text, comments or replies, and AI-generated code in the app must be disclosed
(reviewers may reject on its extent). It is Quo's own build, checked in CI. A Flathub submission would need a manifest
the maintainer writes themselves, by hand, and a pull request they make and answer themselves.
