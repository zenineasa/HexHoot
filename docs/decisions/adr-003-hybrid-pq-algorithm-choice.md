---
type: Architecture Decision Record
title: "ADR-003: Hybrid post-quantum algorithm choice"
description: X25519 + ML-KEM-1024 for the handshake and every ratchet turn, and Ed25519 + ML-DSA-65 for identity, all from Electron's built-in crypto.
tags: [adr, post-quantum, ml-kem, ml-dsa]
status: draft
decision_status: Proposed
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T13:00:00Z }
sources:
  - { id: probe, resource: /assessment/electron-crypto-capabilities.md, title: Electron 45 crypto capability probe }
---

# Context

The maintainer asked for "hybrid methods such as X25519MLKEM768 or something better" and for ratcheting. [ADR-002](/decisions/adr-002-builtin-crypto-only.md) limits us to what Electron provides.

X25519MLKEM768 is the TLS 1.3 named group. The application-layer equivalent is a hybrid KEM. On its own, though, that still gives one static secret per conversation.

# Decision (proposed)

| Concern | Choice | Why this is better than a single X25519MLKEM768 exchange |
|---|---|---|
| Hybrid KEM | **X25519 + ML-KEM-1024**, combined with HKDF-SHA-256 over both shared secrets, both ciphertexts, and both public keys (a "KitchenSink"-style combiner) | NIST category 5 rather than 3. The combiner stays secure if either component holds. |
| Ongoing secrecy | Double Ratchet with an **ML-KEM-1024 encapsulation in every ratchet turn** | Forward secrecy and post-compromise healing against a quantum attacker |
| Authentication | **Ed25519 + ML-DSA-65**, and both must verify | Post-quantum authentication |
| AEAD | AES-256-GCM | The only built-in AEAD |
| KDF | HKDF-SHA-256, with HMAC-SHA-256 chains | |

**Why not exact X-Wing:** X-Wing's combiner uses SHA3-256, which BoringSSL in Electron does not expose. The HKDF-SHA-256 combiner that hashes in the full transcript is the generic construction in `draft-irtf-cfrg-hybrid-kems`. It is also what Signal's PQXDH does: HKDF over the DH outputs together with the KEM secret.

**Bandwidth:** an ML-KEM-1024 public key plus ciphertext adds about 3.1 KB per ratchet turn. A turn happens only when the direction of the conversation changes, which is acceptable for desktop P2P. See Q13 in [open questions](/plan/open-questions.md) if this becomes a problem.

# Not chosen

- **ML-KEM alone.** Not hybrid.
- **SLH-DSA, Falcon, X448.** Not available in Electron, or too large.
- **ML-KEM-768.** Available and smaller. It is kept as a fallback if bandwidth becomes an issue.
