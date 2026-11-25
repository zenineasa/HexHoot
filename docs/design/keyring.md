---
type: Design
title: Keyring and encrypted storage
description: A vault key sealed by the OS keyring through Electron safeStorage, with an Argon2id passphrase fallback, encrypting every local record and every backup.
tags: [design, keyring, keychain, safeStorage, storage]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T12:00:00Z }
sources:
  - { id: safestorage, resource: "https://www.electronjs.org/docs/latest/api/safe-storage", title: Electron safeStorage API }
---

# Concept

This follows the keyring and key-vault pattern: one **vault key** (VK, 256 bits, random) protects everything. The VK itself is never stored in plaintext. It is *wrapped* by one or more **unlockers**:

| Unlocker | Backed by | Default |
|---|---|---|
| `os-keyring` | `safeStorage.encryptString` → macOS Keychain, Windows DPAPI, or Linux libsecret/kwallet | Yes, when available |
| `passphrase` | Argon2id(passphrase, salt) → KEK → XChaCha20-Poly1305 wrap | Required when the OS backend is weak (see below). Optional otherwise, as an extra lock. |
| `recovery` | The recovery phrase ([identity](/design/identity-and-addresses.md)) | Used only for restoring onto a new machine |

On Linux, `safeStorage.getSelectedStorageBackend()` can return `basic_text`, meaning no secret service is running. In that case HexHoot **must** require the passphrase unlocker and must not silently store the key with obfuscation only.

# Key hierarchy

```
VK ──HKDF "hexhoot/v2/db"────────▶ record-encryption key
   ──HKDF "hexhoot/v2/signal"────▶ Signal-store encryption key (identity, prekeys, sessions)
   ──HKDF "hexhoot/v2/backup"────▶ not used. Backups use their own passphrase-derived key.
```

# What is stored where

| Item | Store | Protection |
|---|---|---|
| Wrapped VK + unlocker metadata | `userData/keyring.json` | Sealed by the OS keyring and/or the passphrase |
| Identity seed, prekeys, sessions | Core store | XChaCha20-Poly1305 under the Signal-store key, with the record ID as associated data |
| Contacts, messages, preferences | Core store | XChaCha20-Poly1305 under the record key |
| Renderer | — | Holds no keys. It only receives decrypted UI data over IPC. |

Using the record ID as associated data stops an attacker with disk access from moving or swapping records between slots.

# Lifecycle

- **First run:** generate the identity → show the recovery phrase → create the VK → wrap it with `os-keyring` (and `passphrase` if needed or chosen).
- **Launch:** unwrap the VK, keep it only in Core memory, and zero the buffers on lock or quit.
- **Lock:** a manual lock and an optional idle timeout drop the VK from memory.
- **Backup export:** the user picks a backup passphrase → Argon2id → XChaCha20-Poly1305 over `{identity seed, contacts, messages, preferences}`. **No ratchet state** goes in the backup. The file extension is `.hexhoot2`, and it replaces the plaintext `.hexhootjson`.
- **Reset:** delete `keyring.json`, delete the store, and remove the entry from the OS keyring.
