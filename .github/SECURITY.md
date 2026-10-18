# Security

Quo's promise is that your conversations stay on your device, so we take security reports seriously.

## Reporting a vulnerability

Please **don't open a public issue**. Instead, either:

- use GitHub's [private vulnerability reporting](https://github.com/quo-ai/quo/security/advisories/new), or
- email **astralabsltd@gmail.com** with "Security" in the subject.

Include what you found, how to reproduce it, and what an attacker could do with it. We'll reply within 3 working days, keep you updated while we fix it, and credit you in the release notes if you'd like.

## What's in scope

- Anything that sends chats, files, voice or other personal data off the device without the user choosing a cloud model.
- The Quo apps (Android, iOS), Quo Web, the desktop app, and Quo's API (accounts, credits, cloud chat).
- Quo Sync: its encryption and key handling (anything that lets someone, including us, read synced chats or memories without the recovery key), and sign-in and sessions (the design is in [apps/web/SYNC.md](../apps/web/SYNC.md)).
- Release and update integrity (desktop builds, auto-update, model downloads and their validation).

Third-party models are out of scope unless Quo's handling of them causes the problem.

## Supported versions

Security fixes go into the latest release of each app. Quo Web and the desktop app update themselves; please keep phone apps up to date from the store.
