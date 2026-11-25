---
type: Capability Probe
title: Built-in crypto in Electron 45
description: Which algorithms Electron 45.5's built-in Node crypto (BoringSSL) supports, measured on 2026-11-25, as the basis for using no third-party crypto libraries.
tags: [assessment, electron, cryptography, boringssl, post-quantum]
status: stable
stale_after: 2027-05-25T00:00:00Z
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T13:00:00Z }
verified: { by: process:electron-probe, at: 2026-11-25T13:00:00Z }
sources:
  - { id: probe, resource: "electron@45.5.0 on darwin arm64 (Node 24.22.3, Chrome 156, BoringSSL)", title: "Probe scripts run with ELECTRON_RUN_AS_NODE, in the main process, and in utilityProcess" }
---

Electron builds Node's `crypto` on **BoringSSL**, not OpenSSL (`process.versions.openssl` is `0.0.0`). Support therefore differs from stock Node 24. All results below hold in the main process and in `utilityProcess`.

# Available (used by the HexHoot v2 design)

| Primitive | API | Notes |
|---|---|---|
| **ML-KEM-768 / ML-KEM-1024** | `generateKeyPairSync('ml-kem-1024')`, `crypto.encapsulate`, `crypto.decapsulate` | `raw-public` import/export (1184 / 1568 B). Private keys import from a 64-byte `raw-seed`. ML-KEM-512 is not supported. |
| **ML-DSA-44 / 65 / 87** | `generateKeyPairSync('ml-dsa-65')`, `sign(null, …)` / `verify` | ML-DSA-65 signatures are 3309 B. Private keys import from a 32-byte `raw-seed`, so identity can be derived from a recovery phrase. |
| **X25519** | `diffieHellman` | `raw-private` / `raw-public` import |
| **Ed25519** | `sign(null, …)` | `raw-private` import (32 B) |
| **AES-256-GCM** | `createCipheriv` | AES-CBC and AES-CTR are also present |
| **HKDF** | `hkdfSync('sha256' \| 'sha512', …)` | |
| **HMAC / SHA-256 / SHA-512** | `createHmac`, `createHash` | |
| **scrypt** | `scryptSync` | N=2¹⁷, r=8 runs fine with `maxmem` raised |
| CSPRNG | `randomBytes` | |
| OS keyring | `safeStorage` | Main process only. Round trip confirmed with `--use-mock-keychain`. |

# Not available

| Primitive | Result | What v2 does instead |
|---|---|---|
| ChaCha20-Poly1305, AES-GCM-SIV | `ERR_CRYPTO_UNKNOWN_CIPHER` | AES-256-GCM with a key derived per record |
| SHA-3, SHAKE, BLAKE2b | `Digest method not supported` | SHA-256 / HKDF-SHA-256 with labels. This is also why exact X-Wing (which uses SHA3-256) is not used. |
| Argon2id | `argon2Sync` exists but throws `ERR_CRYPTO_ARGON2_NOT_SUPPORTED` | scrypt. Re-check after each Electron upgrade. |
| X448, Ed448, SLH-DSA, ML-KEM-512 | Unsupported | Not needed |

# Keeping this true

An L1 **capability guard test** ([testing infrastructure](/design/testing-infrastructure.md)) re-runs these checks under the bundled Electron. An Electron upgrade that drops a primitive then fails CI instead of failing at runtime.
