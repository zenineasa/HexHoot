---
type: Architecture Decision Record
title: "ADR-003: Hybrid post-quantum algorithm choice"
description: Why HexHoot 2.0 uses X25519 + ML-KEM-1024 (PQXDH), an SPQR ratchet, and ML-DSA-65 signatures instead of a single X25519MLKEM768 exchange.
tags: [adr, post-quantum, ml-kem, ml-dsa]
status: draft
decision_status: Proposed
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T12:00:00Z }
---

# Context

The maintainer asked for "hybrid methods such as X25519MLKEM768 or something better" and for ratcheting.

X25519MLKEM768 is the **TLS 1.3 named group** (codepoint `0x11EC`). It is the right choice for TLS. For a messenger at the application layer, the equivalent building block is a hybrid KEM such as **X-Wing** (X25519 + ML-KEM-768 with a proper combiner). On its own, that still gives one static secret per conversation.

# Decision (proposed)

| Concern | Choice | Why this is "better" than a single X25519MLKEM768 exchange |
|---|---|---|
| Handshake KEM | X25519 + **ML-KEM-1024** (PQXDH) | NIST category 5 rather than 3, plus multiple DH legs for authentication and deniability |
| Ongoing secrecy | **SPQR** post-quantum ratchet together with the X25519 Double Ratchet | Forward secrecy and healing against a quantum attacker, which no one-off KEM can give |
| Authentication | Hybrid **XEdDSA + ML-DSA-65** on identity and prekeys | Post-quantum authentication of prekeys, which Signal does not have today |
| Fallback KEM | X-Wing (`ml_kem768_x25519` in `@noble/post-quantum`) | Used only if libsignal is rejected ([ADR-002](/decisions/adr-002-libsignal-for-session-crypto.md)) |

# Not chosen

- **ML-KEM alone.** Not hybrid. It is only as safe as a scheme that is still young.
- **SLH-DSA.** Signatures are 7–50 KB, too large to send at every reconnect. Reconsider it as a backup if ML-DSA weakens.
- **Falcon / FN-DSA.** FIPS 206 is not final, and correct floating-point implementations are hard.
- **Native Node `crypto` ML-KEM / ML-DSA.** Node 24 with OpenSSL 3.5 supports them, but Electron is built on BoringSSL, so support inside Electron is not guaranteed. Re-check this in the Phase 2 spike. It would allow dropping `@noble/post-quantum`.
