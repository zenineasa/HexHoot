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
5. **Only Electron's built-in crypto** ([ADR-002](/decisions/adr-002-builtin-crypto-only.md)). There is no third-party crypto library at runtime. The protocol follows published designs (SIGMA-I, the Signal Double Ratchet spec, PQ3-style KEM rekeying), and its spec is written before the code.

# Algorithm suite ("HexHoot v2 suite")

Every row below is `require('crypto')` or `safeStorage` in Electron 45, as verified in the [capability probe](/assessment/electron-crypto-capabilities.md).

| Purpose | Algorithm |
|---|---|
| Identity signatures | **Ed25519 + ML-DSA-65** (FIPS 204), and both must verify |
| Hybrid KEM | **X25519 + ML-KEM-1024** (FIPS 203), combined with HKDF-SHA-256 over secrets, ciphertexts, and public keys |
| Handshake | SIGMA-I over the hybrid KEM, with encrypted identities |
| Ongoing ratchet | Double Ratchet (X25519) **with an ML-KEM-1024 encapsulation in every turn** |
| Message AEAD | AES-256-GCM, with the header and handshake hash as associated data |
| Local record encryption | AES-256-GCM under per-record HKDF-derived keys |
| Key derivation | HKDF-SHA-256 and HMAC-SHA-256, with `hexhoot/v2/…` labels |
| Passphrase KDF | scrypt (N=2¹⁷, r=8, p=1). Argon2id is not available in BoringSSL. |
| Root secret at rest | OS keyring through `safeStorage` (Keychain, DPAPI, libsecret or kwallet) |
| Address, fingerprint, topic | SHA-256 with labels |

The user asked for X25519MLKEM768 "or something better". This suite uses ML-KEM-1024 rather than 768 and adds a post-quantum *ratchet*, which a one-off hybrid KEM cannot provide. The reasoning is in [ADR-003](/decisions/adr-003-hybrid-pq-algorithm-choice.md).

# Layers

```
┌───────────────────────── Renderer (UI only, contextIsolation: true) ─────────────────────────┐
│ Chat / Login / AddFriend …   ──  window.hexhoot.*  (contextBridge, narrow typed API)        │
└───────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                                │ IPC (plaintext UI data only, no keys)
┌──────────────────────── Main or utilityProcess: "Core" ───────────────────────────────────────┐
│ Keyring (safeStorage → vault key) ── Identity (Ed25519 + ML-DSA-65) ── Encrypted store       │
│ Session engine (SIGMA-I + hybrid KEM, Double Ratchet + ML-KEM) ── Contact/trust manager     │
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
