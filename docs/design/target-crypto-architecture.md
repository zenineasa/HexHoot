---
type: Design
title: Target crypto architecture
description: One-page overview of HexHoot 2.0's algorithms, layers, and the process split that keeps keys out of the renderer.
tags: [design, cryptography, post-quantum, ratchet, keyring]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T12:00:00Z }
---

# Goals

1. **Hybrid post-quantum confidentiality.** Traffic stays secret if *either* the classical primitive (ECDH P-521) *or* the post-quantum primitive (ML-KEM-1024) holds.
2. **Forward secrecy and post-compromise security** through ratcheting, against both classical and quantum attackers.
3. **Keys never sit in plaintext on disk or in the renderer.** They are sealed by the OS keyring.
4. **No compatibility with v1** ([ADR-001](/decisions/adr-001-no-backward-compatibility.md)). All v2 components only need to work with each other.
5. **Only Electron's built-in crypto** ([ADR-002](/decisions/adr-002-builtin-crypto-only.md)). There is no third-party crypto library at runtime. The protocol follows published designs (SIGMA-I, the Signal Double Ratchet spec, PQ3-style KEM rekeying), and its spec is written before the code.

# Algorithm suite ("HexHoot v2 suite")

Every row below is `require('crypto')` or `safeStorage` in Electron 45, as verified in the [capability probe](/assessment/electron-crypto-capabilities.md).

| Purpose | Algorithm |
|---|---|
Each choice is the **strongest option Electron offers** ([ADR-003](/decisions/adr-003-hybrid-pq-algorithm-choice.md)).

| Purpose | Algorithm |
|---|---|
| Identity signatures | **ECDSA P-521/SHA-512 + ML-DSA-87** (FIPS 204, category 5), and both must verify |
| Hybrid KEM | **ECDH P-521 + ML-KEM-1024** (FIPS 203, category 5), combined with HKDF-SHA-512 over secrets, ciphertexts, and public keys |
| Handshake | SIGMA-I over the hybrid KEM, with encrypted identities and a separate key per direction |
| Ongoing ratchet | Double Ratchet (P-521) **with an ML-KEM-1024 encapsulation in every turn** |
| Message AEAD | AES-256-GCM with a fresh key per message, and the header and handshake hash as associated data |
| Local record encryption | AES-256-GCM under per-record HKDF-SHA-512-derived keys |
| Hash, KDF, MAC | SHA-512, HKDF-SHA-512, and HMAC-SHA-512, with `hexhoot/v2/…` labels |
| Passphrase KDF | scrypt N=2²⁰, r=8, p=1 (1 GiB). This is Electron's ceiling, since 2²¹ crashes. Argon2id is not available. |
| Identity entropy | Name and password through scrypt N=2²⁰ ([ADR-004](/decisions/adr-004-account-model.md)) |
| Root secret at rest | OS keyring through `safeStorage` (Keychain, DPAPI, libsecret or kwallet) |
| Address, fingerprint, topic | SHA-512 with labels, truncated to 256 bits |

This meets or exceeds NSA CNSA 2.0. The user asked for X25519MLKEM768 "or something better". This suite has a stronger KEM, a stronger classical half, post-quantum signatures, and a post-quantum *ratchet*.

# Layers

```
┌───────────────────────── Renderer (UI only, contextIsolation: true) ─────────────────────────┐
│ Chat / Login / AddFriend …   ──  window.hexhoot.*  (contextBridge, narrow typed API)        │
└───────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                                │ IPC (plaintext UI data only, no keys)
┌──────────────────────── Main or utilityProcess: "Core" ───────────────────────────────────────┐
│ Keyring (safeStorage → vault key) ── Identity (P-521 + ML-DSA-87) ── Encrypted store         │
│ Session engine (SIGMA-I + hybrid KEM, Double Ratchet + ML-KEM-1024) ── Contact/trust manager│
│ Transports: Hyperswarm (internet) + LAN  ── Wire protocol v2 framing                         │
│ Encrypted store (node:sqlite in Core, every record AES-256-GCM)                               │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

Moving crypto and networking out of the renderer is what makes the keyring possible, because `safeStorage` is main-process only. It also removes the S1 class of bugs (see [findings](/assessment/crypto-findings.md)).

# Related

- [Identity and addresses](/design/identity-and-addresses.md)
- [Sessions and ratcheting](/design/session-and-ratchet.md)
- [Keyring](/design/keyring.md)
- [Wire protocol v2](/design/wire-protocol-v2.md)
