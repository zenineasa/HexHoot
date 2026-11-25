---
type: Design
title: Target crypto architecture
description: One-page overview of HexHoot 2.0's algorithms, layers, and the process split that keeps keys out of the renderer.
tags: [design, cryptography, post-quantum, ratchet, keyring]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T12:00:00Z }
---

# Goals

1. **Hybrid post-quantum confidentiality.** Traffic stays secret if *either* the classical primitive (X25519) *or* the post-quantum primitive (ML-KEM) holds.
2. **Forward secrecy and post-compromise security** through ratcheting, against both classical and quantum attackers.
3. **Keys never sit in plaintext on disk or in the renderer.** They are sealed by the OS keyring.
4. **No compatibility with v1** ([ADR-001](/decisions/adr-001-no-backward-compatibility.md)). All v2 components only need to work with each other.
5. **Don't build our own protocol.** Use audited implementations ([ADR-002](/decisions/adr-002-libsignal-for-session-crypto.md)).

# Algorithm suite ("HexHoot v2 suite")

| Purpose | Algorithm | Library |
|---|---|---|
| Identity signature (classical) | Curve25519 / XEdDSA | `@signalapp/libsignal-client` |
| Identity signature (post-quantum) | **ML-DSA-65** (FIPS 204) | `@noble/post-quantum` |
| Initial key agreement | **PQXDH**: X25519 (3–4 DH) + **ML-KEM-1024** encapsulation | libsignal |
| Ongoing ratchet | **Triple Ratchet**: Double Ratchet (X25519) + **SPQR** sparse post-quantum ratchet (ML-KEM-768 braid) | libsignal |
| Message encryption inside the ratchet | AES-256-CBC + HMAC-SHA-256 (encrypt-then-MAC, Signal message format) | libsignal |
| Local record encryption | **XChaCha20-Poly1305** with random 192-bit nonces | `@noble/ciphers` |
| Key derivation | HKDF-SHA-256 with HexHoot domain-separation labels | `@noble/hashes` |
| Passphrase KDF | **Argon2id** (RFC 9106: t=3, p=4, m=64 MiB) | `@noble/hashes` or `hash-wasm` |
| Root secret at rest | OS keyring through Electron `safeStorage` (Keychain, DPAPI, libsecret or kwallet) | Electron |
| Address / fingerprint | SHA-256 over the canonical identity bundle | `@noble/hashes` |

The user asked for X25519MLKEM768 "or something better". This suite gives a stronger hybrid: X25519 with ML-KEM-1024 for the handshake, plus a post-quantum *ratchet*, which a one-off hybrid KEM cannot provide. The reasoning is in [ADR-003](/decisions/adr-003-hybrid-pq-algorithm-choice.md).

# Layers

```
┌───────────────────────── Renderer (UI only, contextIsolation: true) ─────────────────────────┐
│ Chat / Login / AddFriend …   ──  window.hexhoot.*  (contextBridge, narrow typed API)        │
└───────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                                │ IPC (plaintext UI data only, no keys)
┌──────────────────────── Main or utilityProcess: "Core" ───────────────────────────────────────┐
│ Keyring (safeStorage → vault key) ── Signal stores (identity/prekey/kyber/session)           │
│ Session engine (libsignal: PQXDH + Triple Ratchet) ── Contact/trust manager                 │
│ Transports: Hyperswarm (internet) + LAN  ── Wire protocol v2 framing                         │
│ Encrypted store (IndexedDB is replaced by a file/SQLite store in Core; see open questions)    │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

Moving crypto and networking out of the renderer is what makes the keyring possible, because `safeStorage` is main-process only. It also removes the S1 class of bugs (see [findings](/assessment/crypto-findings.md)).

# Related

- [Identity and addresses](/design/identity-and-addresses.md)
- [Sessions and ratcheting](/design/session-and-ratchet.md)
- [Keyring](/design/keyring.md)
- [Wire protocol v2](/design/wire-protocol-v2.md)
