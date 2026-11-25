---
type: Architecture Decision Record
title: "ADR-003: Maximum-strength hybrid algorithm suite"
description: For every primitive, use the strongest option Electron's built-in crypto offers. That means ML-KEM-1024 + ECDH P-521, ML-DSA-87 + ECDSA P-521, AES-256-GCM, SHA-512 / HKDF-SHA-512, and scrypt at N=2^20.
tags: [adr, post-quantum, ml-kem, ml-dsa, p-521, algorithm-suite]
status: stable
decision_status: Accepted
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T14:00:00Z }
verified: { by: "human:zenineasa", at: 2026-11-25T14:00:00Z }
sources:
  - { id: probe, resource: /assessment/electron-crypto-capabilities.md, title: Electron 45 crypto capability probe }
  - { id: cnsa2, resource: "https://media.defense.gov/2022/Sep/07/2003071836/-1/-1/0/CSI_CNSA_2.0_FAQ_.PDF", title: NSA CNSA 2.0 (ML-KEM-1024, ML-DSA-87, AES-256, SHA-384/512) }
---

# Context

The maintainer asked for hybrid post-quantum crypto and ratcheting. On 2026-11-25 they said: *"Let's go for the best choices for every method being chosen. Highest encryption, highest security."* [ADR-002](/decisions/adr-002-builtin-crypto-only.md) limits the choice to Electron's built-in crypto.

# Decision: the HexHoot v2 suite

Each row is the **strongest option Electron 45 provides**, as measured by the [capability probe](/assessment/electron-crypto-capabilities.md).

| Role | Choice | Strength | Strongest alternative not available or rejected |
|---|---|---|---|
| Post-quantum KEM | **ML-KEM-1024** | NIST category 5, the highest ML-KEM level | — |
| Classical key agreement (hybrid half) | **ECDH P-521** | ~256-bit classical | X448 (~224-bit) is not in BoringSSL |
| Post-quantum signature | **ML-DSA-87** | NIST category 5, the highest ML-DSA level | SLH-DSA and Falcon are not in BoringSSL |
| Classical signature (hybrid half) | **ECDSA P-521 with SHA-512** | ~256-bit classical | Ed448 is not in BoringSSL |
| AEAD | **AES-256-GCM** | 256-bit key, Grover-resistant at 128-bit | ChaCha20-Poly1305 and AES-GCM-SIV are not in BoringSSL |
| Hash | **SHA-512** | 256-bit collision resistance | SHA-3 is not in BoringSSL |
| KDF and ratchet chains | **HKDF-SHA-512 and HMAC-SHA-512** | — | — |
| Passphrase KDF | **scrypt N=2²⁰, r=8, p=1** (1 GiB, about 8 s) | The highest cost that runs: N=2²¹ crashes Electron (SIGTRAP) | Argon2id is not in BoringSSL |
| Recovery entropy | **256 bits** (24 words) | Matches category 5 | — |
| Hybrid combining | KEM *and* ECDH secrets plus the full transcript go into HKDF-SHA-512 | Secure if either half holds | — |
| Signature combining | **Both** must verify (AND) | Unforgeable if either half holds | — |
| Ratchet post-quantum healing | ML-KEM-1024 in **every** turn | Fastest healing possible | — |

This matches or exceeds NSA CNSA 2.0, which calls for ML-KEM-1024, ML-DSA-87, AES-256, and SHA-384 or SHA-512.

# Notes and trade-offs

- **P-521 instead of X25519.** P-521 has twice the classical security. The classical half only matters if ML-KEM or ML-DSA falls, and then it is the only defence, so the larger margin is the "highest security" answer. The costs:
  - P-521 is about 30× slower than X25519 (about 1 ms per ECDH), which is negligible here.
  - Its public keys are larger: 133 B uncompressed.
  - It needs point validation. The probe confirmed BoringSSL rejects invalid points on import, and the L1 tests keep it that way.
  - Some cryptographers prefer Curve25519's "rigid" parameters over NIST curves. HexHoot accepts P-521 because the hybrid AND means a weakness in P-521 alone breaks nothing.
- **The address stays 32 bytes** (SHA-512 truncated to 256 bits). The property that protects an address is second-preimage resistance: 2²⁵⁶ classical and 2¹²⁸ with Grover, which is already category 5. Collision resistance does not apply, because an attacker who builds two colliding bundles only collides with themselves. A longer address would add length without adding security.
- **scrypt at 1 GiB and about 8 s** (Apple Silicon, Electron 45; Electron's scrypt is about 2.5× slower than stock Node's). It only runs when the OS keyring cannot be used, when the optional extra lock is on, and during backup export or import. It runs asynchronously in Core so the UI never freezes. Machines with less than about 2 GiB of free RAM will struggle (see Q14 in [open questions](/plan/open-questions.md)).
- **Bandwidth:** the first message of each ratchet turn carries 133 B (P-521) + 1568 B (ML-KEM pk) + 1568 B (ML-KEM ct), about 3.3 KB. Handshake signatures are 132 B + 4627 B.
