---
type: Design
title: Keyring and encrypted storage
description: A vault key sealed by the OS keyring through Electron safeStorage, with a scrypt (N=2^20) passphrase fallback, encrypting every local record and every backup with AES-256-GCM under HKDF-SHA-512-derived keys, all with built-in Electron crypto at maximum strength.
tags: [design, keyring, keychain, safeStorage, storage]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-26T15:00:00Z }
sources:
  - { id: safestorage, resource: "https://www.electronjs.org/docs/latest/api/safe-storage", title: Electron safeStorage API }
  - { id: probe, resource: /assessment/electron-crypto-capabilities.md, title: Electron 45 crypto capability probe }
---

# Concept

This follows the keyring and key-vault pattern: one **vault key** (VK, 256 bits, from `randomBytes`) protects everything. The VK is never stored in plaintext. It is *wrapped* by one or more **unlockers**:

| Unlocker | Backed by | Default |
|---|---|---|
| `os-keyring` | `safeStorage.encryptString` → macOS Keychain, Windows DPAPI, or Linux libsecret/kwallet | Yes, when available |
| `passphrase` | scrypt(passphrase, 32-byte salt, N=2²⁰, r=8, p=1, 1 GiB) → KEK → AES-256-GCM wrap | Required when the OS backend is weak (see below). Optional otherwise, as an extra lock. |
| `recovery` | Name and password ([identity](/design/identity-and-addresses.md), [ADR-004](/decisions/adr-004-account-model.md)). They re-derive the identity on a new machine, and a new vault is made there. | Used only for setting up a new machine |

On Linux, `safeStorage.getSelectedStorageBackend()` can return `basic_text`, meaning no secret service is running. In that case HexHoot **must** require the passphrase unlocker and must not silently store the key with obfuscation only.

**Why scrypt at N=2²⁰:** Electron's BoringSSL build has no Argon2 (`ERR_CRYPTO_ARGON2_NOT_SUPPORTED`). scrypt (RFC 7914) at N=2²⁰ is the parameter set its author recommends for file encryption, and it is the **highest cost Electron can run**: N=2²¹ crashes the process. One derivation takes about 8 s and 1 GiB of RAM on Apple Silicon, so it always runs asynchronously in Core with a progress indicator. The capability guard test reports when Argon2id becomes available, and the stored unlocker records its KDF and parameters so the KDF can be upgraded on the next unlock.

# Key hierarchy and record encryption

```
VK ──HKDF-SHA-512 "hexhoot/v2/db"──────▶ K_db       (contacts, messages, preferences)
   ──HKDF-SHA-512 "hexhoot/v2/secrets"─▶ K_secrets  (identity seed, ratchet sessions)

per record:  salt = randomBytes(32)
             K_rec = HKDF(K_x, salt, "hexhoot/v2/rec" ‖ table ‖ recordId, 32)
             nonce = randomBytes(12)
             blob  = salt ‖ nonce ‖ AES-256-GCM(K_rec, nonce, data, ad = table ‖ recordId)
```

AES-GCM is the only AEAD built into Electron. Deriving a fresh key for each record with a random salt avoids the 2³² limit on random 96-bit nonces under one key. Using the table and record ID as associated data stops an attacker with disk access from moving or swapping records between slots.

# What is stored where

| Item | Store | Protection |
|---|---|---|
| Wrapped VK + unlocker metadata (KDF, parameters) | `userData/keyring.json` | Sealed by the OS keyring and/or the passphrase |
| Identity seed, ratchet sessions | Core store | AES-256-GCM under keys derived from `K_secrets` |
| Contacts, messages, preferences | Core store | AES-256-GCM under keys derived from `K_db` |
| Renderer | — | Holds no keys. It only receives decrypted UI data over IPC. |

# Lifecycle

- **First run:** derive the identity from name and password → create the VK → wrap it with `os-keyring` (and `passphrase` if needed or chosen).
- **Launch:** unwrap the VK, keep it only in Core memory, and zero the buffers on lock or quit.
- **Lock:** a manual lock and an optional idle timeout drop the VK from memory.
- **Backup export:** the user picks a backup passphrase → scrypt (N=2²⁰) → AES-256-GCM over `{identity seed, contacts, messages, preferences}`. **No ratchet state** goes in the backup. The file extension is `.hexhoot2`, and it replaces the plaintext `.hexhootjson`.
- **Reset:** delete `keyring.json`, delete the store, and remove the entry from the OS keyring.

# Implementation (2026-11-26)

The keyring is built and tested as a library in `modules/Crypto`. Core does not use it yet: it is wired in with the new login screen in Phase 4, which replaces v1's password-derived key ([ADR-004](/decisions/adr-004-account-model.md)).

| File | What it does |
|---|---|
| `modules/Crypto/primitives.js` | `encodeParts`, HKDF-SHA-512, AES-256-GCM `seal`/`open`, and `scrypt` with its limits |
| `modules/Crypto/RecordCipher.js` | Per-record encryption |
| `modules/Crypto/Keyring.js` | The vault key, its unlockers, `keyring.json` |
| `modules/Main/sealer.js` | The OS keyring, through `safeStorage` (main process only) |

## Exact formats

`parts(a, b, …)` is each part as a 4-byte big-endian length followed by its bytes (UTF-8 for strings). Every HKDF `info` and AEAD associated data uses it, so `("ab", "c")` and `("a", "bc")` can never be confused. The `‖` in the sketch above is this encoding.

```
record blob = 0x01 ‖ salt (32) ‖ nonce (12) ‖ ciphertext ‖ tag (16)
K_rec       = HKDF-SHA-512(K_x, salt, parts("hexhoot/v2/rec", table, id))
ad          = parts("hexhoot/v2/rec", 0x01, table, id)
K_db        = HKDF-SHA-512(VK, "", "hexhoot/v2/db")        (32 bytes)
K_secrets   = HKDF-SHA-512(VK, "", "hexhoot/v2/secrets")
check       = HKDF-SHA-512(VK, "", "hexhoot/v2/keyring/check")
KEK         = scrypt(NFKC(passphrase), salt (32), N, r, p, 32 bytes)
wrapped     = nonce (12) ‖ AES-256-GCM(KEK, VK, ad = parts("hexhoot/v2/keyring/passphrase", "scrypt", N, r, p)) ‖ tag
```

`keyring.json` (mode 0600, written atomically):

```json
{"format": "hexhoot-keyring", "version": 1, "check": "<base64>",
 "unlockers": [
   {"type": "os-keyring", "backend": "keychain", "sealed": "<base64 safeStorage output>"},
   {"type": "passphrase", "kdf": "scrypt", "N": 1048576, "r": 8, "p": 1,
    "salt": "<base64>", "wrapped": "<base64>"}]}
```

## Decisions made while building it

- **`check` value.** `safeStorage` does not authenticate what it decrypts (on macOS it is AES-CBC with no MAC). The check detects a wrong vault key from the OS keyring before anything is decrypted with it. It reveals nothing about VK.
- **KDF parameters are associated data.** Editing `N`, `r` or `p` in the file makes unlocking fail instead of quietly weakening anything. N is capped at 2²⁰ *before* scrypt runs, because 2²¹ kills Electron with an uncatchable SIGTRAP.
- **Low-memory check.** scrypt refuses to start unless 1.5× its memory need is available ([Q14](/plan/open-questions.md)). It uses `process.availableMemory()`, which counts reclaimable memory (macOS inactive pages, Linux `MemAvailable`). `os.freemem()` reported 0.08 GiB on an 8 GiB Mac that had 1.7 GiB available, so it would have refused every time.
- **KDF upgrade.** A passphrase unlocker with a lower N than the current default is re-made on the next successful unlock. Test keyrings use N=2¹⁴, and the default-cost test (create and unlock at 2²⁰) took 8.4 s on the 8 GiB Mac.
- **Weak OS keyring.** `basic_text` and `unknown` backends on Linux, and `isEncryptionAvailable() === false` anywhere, count as weak. A passphrase is then required, and the weak backend is never used.
- **Reset** deletes `keyring.json`. `safeStorage` has one key for the whole app and no per-entry delete, so there is no OS keyring entry to remove; the sealed vault key lived only in the file.
- **Zeroing** is best effort. The vault key, KEKs, record keys and passphrase bytes are `fill(0)`-ed after use or on `lock()`, but JavaScript strings (the passphrase as typed, and the base64 text passed to `safeStorage`) cannot be wiped.

## Tests

- `npm run test:crypto` (L1, under Electron's BoringSSL):
  - Round trips, tampering with every byte, moving a record to another table or id, and a format vector that WebCrypto's separate HKDF and AES-GCM path decrypts.
  - Both unlockers, a weak backend, a wrong key from the OS keyring, tampered parameters or wrapped key, a corrupt file, locking, changing and removing the passphrase, and the KDF upgrade.
  - The scrypt cap, the low-memory check and NFKC normalization.
  - The default-cost run (CI, or `HEXHOOT_SLOW_TESTS=1`).
- `test/e2e/keyring.e2e.mjs` runs the keyring with the real `safeStorage` in an Electron main process: strong with `--use-mock-keychain` on macOS, and a passphrase fallback where Linux CI has no secret service.

# Backup file (.hexhoot2), as implemented (2026-11-26)

`modules/Crypto/backup.js`, tested in `test/crypto/backup.test.js`.

```
file    = "HEXHOOT2" ‖ 0x01 ‖ u32be header length ‖ header ‖ sealed
header  = JSON {kdf: "scrypt", N, r, p, salt (32 B, base64)}          public, at most 4 KiB
key     = HKDF-SHA-512(scrypt(NFKC(passphrase), salt, N, r, p), "", "hexhoot/v2/backup", 32)
sealed  = nonce (12) ‖ AES-256-GCM(key, deflate-raw(JSON payload), ad) ‖ tag (16)
ad      = parts("hexhoot/v2/backup", "HEXHOOT2", 0x01, header)
payload = {format: "hexhoot-backup", version: 1, createdAt, identity: Identity#secret(), tables: {name: rows}}
```

- **The passphrase** needs 16 characters or more, the same rule as account passwords. The account password itself is fine to use.
- **No session state.** A table named `Sessions` (the ratchet store), in any letter case, is refused at export. After a restore, each contact gets a new handshake. The test checks that the old session cannot read the new one.
- **The KDF parameters are bound to the ciphertext.** Editing them makes the file unreadable rather than weaker, and N is capped at 2²⁰ before scrypt runs.
- **Compressed before encryption.** It is a file at rest, not an interactive channel, so compression-based leaks (CRIME-style) do not apply.
- **Cost:** export and import together took 9.6 s at N=2²⁰ on the 8 GiB Mac.
- **Errors:** `NOT_A_BACKUP`, `UNSUPPORTED_VERSION`, `CORRUPT`, `BAD_PARAMS`, `BAD_PASSPHRASE` (wrong passphrase *or* a changed file: AES-GCM cannot tell them apart) and `LOW_MEMORY`.
- **The v1 `.hexhootjson` export** (plaintext, including the private key, finding F7) stays in Core until Phase 4 switches the UI to this format.
