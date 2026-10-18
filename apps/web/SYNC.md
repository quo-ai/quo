# Quo Sync

End-to-end encrypted sync of chats between a person's devices. This is the design, written so it can be reviewed, and so another client (the phone apps) can implement the same format.

**The promise:** Quo's servers hold your synced chats only as ciphertext. The key never leaves your devices, so Quo can't read them, search them, hand them over in readable form, or recover them for you.

## What syncs

| Syncs | Doesn't |
|---|---|
| Chats: title, messages, reasoning, timestamps; new messages and deletions | Photos and documents attached to messages (names are kept, contents stay on the device they were added on) |
| | Models, settings, memories (a later version) |

Syncing is a convenience on top of local storage. Every chat is always saved on the device first and works offline; sync only ever copies.

## Keys

- **Recovery key**: 160 random bits, shown once as 8 groups of 4 characters plus 2 check characters (`XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX`), Crockford base32 (no `I L O U`). The first check character is a Luhn mod-32 digit, which catches every single wrong character; the second is part of a CRC-16, which catches most other slips. Entry is forgiving: any case, with or without dashes or spaces, `O`→`0`, `I`/`L`→`1`.
- **Record key**: `HKDF-SHA-256(recovery key, salt = "quo-sync/v1", info = "record-key")` → AES-256-GCM, created non-extractable. The recovery key is random rather than a password, so no slow key stretching is needed.
- A device stores **only the record key** (a non-extractable `CryptoKey` in IndexedDB), never the recovery key, so a script running in the page can use the key but can't read it out. The recovery key is shown once, when sync is turned on. To add a device you type it in; if it's lost, the cloud copy can be deleted and started again from a device that still has the chats.

## A record

`kind = "chat"`, `id` = the chat's id (a UUID).

```
plaintext  = gzip( JSON( chat ) )          // attachments reduced to { id, kind, name, width, height, omitted: true }
blob       = base64( 0x01 | iv (12 bytes) | AES-GCM( key, iv, plaintext, aad ) )
aad        = "quo-sync/v1|" + kind + "|" + id
```

A fresh random IV per record. The kind and id are authenticated, so the server can't present one record's ciphertext as another's (or as a different kind). The version byte lets the format change.

**Verifier.** When sync is turned on, the device encrypts a fixed phrase the same way (`aad = "quo-sync/v1|verifier|account"`) and stores it with the account. A new device checks a recovery key against it before downloading anything. It's ciphertext, so it reveals nothing without the key.

## Protocol

All under `/api/sync/`, for a signed-in user. `server/sync.ts` is the implementation; `src/sync/engine.ts` the client.

| Call | Does |
|---|---|
| `GET status` | `{ entitled, enabled, verifier, seq, usedBytes, limitBytes, records }` |
| `POST setup { verifier }` | Starts sync for the account (`402` without a plan, `409` if already on) |
| `GET pull?since=N` | Records with `seq > N`, oldest first, in pages, plus `more` and the new `seq` |
| `POST push { records: [{ id, kind, blob \| null, deleted, baseSeq }] }` | Up to 25 per call → `{ seq, accepted: [{ id, seq }], conflicts: [id] }` |
| `POST reset` | Deletes everything held for the account |

Every write gets the account's next change number, `seq`. A device pulls "everything after the `seq` I have", and pushes each record with the `baseSeq` it last saw for it. If the stored record has moved on, that record is a **conflict** and isn't written; the device pulls, merges and pushes again. So a write can never silently replace a newer one. Pushes lock the account row, so change numbers are gap-free and ordered.

Deleting keeps a marker (`deleted: true`, no blob) so other devices learn about it.

## Merging

Chats mostly grow at the end. When both sides changed a chat:

- one side's messages are the start of the other's → the longer one wins, no copy;
- same messages → the later edit wins;
- they really diverged → the later edit keeps the chat, and the other version is kept as a **copy** titled "… (other device)". Nothing is discarded.

Deleted on one device but edited on another → the edit is kept and uploaded again. A chat is never changed while a reply is being written into it (sync waits).

## Limits and plans

- 1 MB of ciphertext per chat (larger chats stay on the device and the app says so), 20,000 chats, 250 MB per account (`SYNC_LIMIT_MB`). Over the limit, writes fail with `quota_exceeded`; deleting always works.
- Included with Quo Pro, or the Sync-only plan (`sync_yearly`). If a plan ends, pulling still works so people can always get their data out; pushing needs a plan. `reset` always works.
- Until sign-in or purchases are set up, every call answers `503 setup_required`.

## What the server can and can't learn

Can: that an account uses sync, how many chats it has, their approximate sizes, and when they changed (and the account's email, as for any account). Can't: titles, messages, who talked about what, or anything else inside a chat.

A malicious server could withhold changes, or replay an older version of a record (it can't forge or alter one: AES-GCM would fail). Replays are a known limit of this design; they'd show up as an older chat, not as invented content.

## Not done yet

- Phone apps (the format above is intended for them).
- Pruning old deletion markers and data after a plan lapses (needs a scheduled job).
- Syncing attachments (would use object storage rather than the database).
- Rate limits beyond the size limits.
