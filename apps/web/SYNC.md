# Quo Sync

End-to-end encrypted sync of chats and memories between a person's devices: Quo Web, the desktop app and the Android app. This is the design, written so it can be reviewed, and so another client can implement the same format.

**The promise:** Quo's servers hold your synced chats only as ciphertext. The key never leaves your devices, so Quo can't read them, search them, hand them over in readable form, or recover them for you.

## What syncs

| Syncs | Doesn't |
|---|---|
| Chats: title, messages, thinking, timestamps; new messages and deletions | Photos and documents attached to messages (their names are kept, contents stay on the device they were added on) |
| Memories (what a person has asked Quo to remember; every app keeps the same list) | Models, settings, a long chat's rolling summary |

Syncing is a convenience on top of local storage. Every chat is always saved on the device first and works offline; sync only ever copies.

## Keys

- **Recovery key**: 160 random bits, shown once as 8 groups of 4 characters plus 2 check characters (`XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX`), Crockford base32 (no `I L O U`). The first check character is a Luhn mod-32 digit, which catches every single wrong character; the second is part of a CRC-16, which catches most other slips. Entry is forgiving: any case, with or without dashes or spaces, `O`→`0`, `I`/`L`→`1`. (`src/sync/recovery.ts`)
- **Record key**: `HKDF-SHA-256(recovery key, salt = "quo-sync/v1", info = "record-key")` → 32 bytes, used as an AES-256-GCM key. The recovery key is random rather than a password, so no slow key stretching is needed.
- A device stores **only the record key**, never the recovery key. On the web and desktop it is a non-extractable `CryptoKey` in IndexedDB, so a script running in the page can use it but not read it out. On the phone it is kept in the Android Keystore through `expo-secure-store`. The recovery key is shown once, when sync is turned on. To add a device you type it in; if it's lost, the cloud copy can be deleted and started again from a device that still has the chats.

## A record

```
plaintext  = gzip( JSON( item ) )
blob       = base64( 0x01 | iv (12 bytes) | AES-GCM( key, iv, plaintext, aad ) )
aad        = "quo-sync/v1|" + kind + "|" + recordId
```

A fresh random IV per record. The kind and id are authenticated, so the server can't present one record's ciphertext as another's (or as a different kind). The version byte lets the format change.

**Record ids.** A chat's record id is the chat's own id. Every other kind is prefixed with its name (`memory:<id>`), so ids can never collide across kinds. Ids are letters, digits and `_ . : -`, 8 to 100 characters.

**Verifier.** When sync is turned on, the device encrypts a fixed phrase the same way (`aad = "quo-sync/v1|verifier|account"`) and stores it with the account. A new device checks a recovery key against it before downloading anything. It's ciphertext, so it reveals nothing without the key.

## The data inside (wire format)

Each app converts its own chats to a shared shape (`src/sync/wire.ts`) to upload, and back when it receives them, so the apps need not store chats the same way.

- **Chat**: `{ id, title, createdAt, updatedAt, messages: [...], x? }`. A message: `{ id, role, content, reasoning?, timestamp?, modelId?, modelName?, stats?, stopped?, cloud?, charged?, attachments?, x? }`.
- **Thinking** is a separate `reasoning` field. (The phone stores it inline as `<think>…</think>` and converts at the edges, with the same parsing rules as its message bubble.)
- **Attachments** shrink to `{ id, kind, name, width?, height?, omitted: true }`.
- **Memory**: `{ id, content, createdAt, updatedAt }`.
- **`x`** carries fields only one platform understands (the phone's full generation stats and tool actions travel in `x.mobile`). They come back unchanged, so a chat that goes phone → web → phone loses nothing.

## Protocol

All under `/api/sync/`, for a signed-in user. `server/sync.ts` is the implementation; `src/sync/engine.ts` the client.

| Call | Does |
|---|---|
| `GET status` | `{ entitled, enabled, verifier, seq, usedBytes, limitBytes, records }` |
| `POST setup { verifier }` | Starts sync for the account (`402` without a plan, `409` if already on) |
| `GET pull?since=N&kinds=chat,memory` | Records with `seq > N` of those kinds, oldest first, in pages, plus `more` and the new `seq`. Without `kinds`, chats only, as the first versions behaved |
| `POST push { records: [{ id, kind, blob \| null, deleted, baseSeq }] }` | Up to 25 per call → `{ seq, accepted: [{ id, seq }], conflicts: [id] }` |
| `POST reset` | Deletes everything held for the account |

Every write gets the account's next change number, `seq`. A device pulls "everything after the `seq` I have", and pushes each record with the `baseSeq` it last saw for it. If the stored record has moved on, that record is a **conflict** and isn't written; the device pulls, merges and pushes again. So a write can never silently replace a newer one. Pushes lock the account row, so change numbers are gap-free and ordered. Deleting keeps a marker (`deleted: true`, no blob) so other devices learn about it.

**Signing in.** Quo Web and the desktop app use a signed `HttpOnly` cookie. The phone has no cookie jar to rely on, so it asks for the same signed value as a bearer token (`POST auth/verify` with `"client": "app"` returns `token`, and no cookie is set) and sends `Authorization: Bearer …`, keeping it in secure storage. Tokens last 180 days and, like the cookie, are stateless. Signing out removes the token from the device; deleting the account makes every old token useless.

## Merging

Chats mostly grow at the end. When both sides changed a chat (`src/sync/merge.ts`):

- one side's messages are the start of the other's → the longer one wins, no copy;
- same messages → the later edit wins;
- they really diverged → the later edit keeps the chat, and the other version is kept as a **copy** titled "… (other device)". Nothing is discarded.

A memory edited on two devices: the later edit wins. Deleted on one device but edited on another → the edit is kept and uploaded again. A chat is never changed while a reply is being written into it (sync waits), and a write that finds the chat changed since it was read is abandoned and retried, so an edit made at the same moment is never overwritten.

## One engine, two apps

`engine.ts`, `merge.ts`, `kinds.ts`, `wire.ts` and `recovery.ts` are the same files in `apps/web/src/sync/` and `apps/mobile/services/sync/` (the phone app can't import from outside its folder). `scripts/check-shared-sync.js` fails CI if they differ and `--fix` copies the web's over the phone's. What differs is only what has to: the encryption (WebCrypto on the web; `@noble/ciphers`, `@noble/hashes` and `fflate` on the phone, which has no WebCrypto), where chats live, and the conversion to the wire format.

`src/sync/__tests__/vectors.json` holds a recovery key, records and verifiers written by **both** implementations; each must read every one. And `apps/web/interop/` (`npm run test:interop`) runs the phone's own code and the web's against the real server and database: chats, replies, divergent edits, deletes, memories and token sign-in, in both directions.

## Limits, plans and retention

- 1 MB of ciphertext per chat (larger chats stay on the device and the app says so), 20,000 chats, 250 MB per account (`SYNC_LIMIT_MB`). Over the limit, writes fail with `quota_exceeded`; deleting always works.
- Included with Quo Pro, or the Sync-only plan (`sync_yearly`). If a plan ends, pulling still works so people can always get their data out; pushing needs a plan. `reset` and account deletion always work.
- **Retention** (`server/syncRetention.ts`, run daily by the host's scheduler on `GET /api/cron/sync-cleanup` with `Authorization: Bearer $CRON_SECRET`, or by a timer in the standalone server): 180 days after the plan ends the encrypted copy is deleted; the account's email gets one warning 30 days before; deletion markers are pruned after 90 days; subscribing again resets the clock.
- **Account deletion** (`POST /api/account/delete`, `{ "confirm": true }`) removes the account, its synced data, credits and plan records. It is refused while a plan is running (`409 plan_active`).
- Until sign-in or purchases are set up, every call answers `503 setup_required`.

## What the server can and can't learn

Can: that an account uses sync, how many chats and memories it has, their approximate sizes, and when they changed (and the account's email, as for any account). Can't: titles, messages, memories, who talked about what, or anything else inside a record.

A malicious server could withhold changes, or replay an older version of a record (it can't forge or alter one: AES-GCM would fail). Replays are a known limit of this design; they'd show up as an older chat, not as invented content.

## Not done yet

- Syncing attachments (would use object storage rather than the database).
- Revoking a phone's sign-in token before it expires (sessions are stateless).
- iOS: the phone code is shared React Native and nothing in it is Android-specific, but it has only been tested on Android's side of the build.
- Live updates (devices poll: after a change, when the app returns to the front, and every few minutes).
- Rate limits beyond the size limits.
