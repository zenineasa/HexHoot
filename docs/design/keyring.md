---
type: Design
title: Keyring and encrypted storage
description: A vault key sealed by the OS keyring through Electron safeStorage, with a scrypt (N=2^20) passphrase fallback, encrypting every local record and every backup with AES-256-GCM under HKDF-SHA-512-derived keys, all with built-in Electron crypto at maximum strength.
tags: [design, keyring, keychain, safeStorage, storage]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T13:00:00Z }
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
| `recovery` | The recovery phrase ([identity](/design/identity-and-addresses.md)) | Used only for restoring onto a new machine |

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

- **First run:** generate the identity → show the recovery phrase → create the VK → wrap it with `os-keyring` (and `passphrase` if needed or chosen).
- **Launch:** unwrap the VK, keep it only in Core memory, and zero the buffers on lock or quit.
- **Lock:** a manual lock and an optional idle timeout drop the VK from memory.
- **Backup export:** the user picks a backup passphrase → scrypt (N=2²⁰) → AES-256-GCM over `{identity seed, contacts, messages, preferences}`. **No ratchet state** goes in the backup. The file extension is `.hexhoot2`, and it replaces the plaintext `.hexhootjson`.
- **Reset:** delete `keyring.json`, delete the store, and remove the entry from the OS keyring.
