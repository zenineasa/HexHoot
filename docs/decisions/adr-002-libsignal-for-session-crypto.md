---
type: Architecture Decision Record
title: "ADR-002: Use libsignal for session crypto"
description: Use @signalapp/libsignal-client's PQXDH and Triple Ratchet (with SPQR) instead of building a ratchet on top of noble primitives.
tags: [adr, libsignal, ratchet]
status: draft
decision_status: Proposed
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T12:00:00Z }
sources:
  - { id: npm, resource: "https://www.npmjs.com/package/@signalapp/libsignal-client", title: "@signalapp/libsignal-client 0.108.7, AGPL-3.0-only" }
---

# Options

| | A. libsignal-client (recommended) | B. Our own protocol on `@noble/*` |
|---|---|---|
| Handshake | PQXDH, specified and formally analysed | Our own X-Wing + signatures design |
| Ratchet | Double Ratchet + SPQR (post-quantum), in production at Signal | We would write the Double Ratchet *and* a post-quantum ratchet ourselves |
| Audit status | Heavily reviewed, Rust core | noble primitives are audited, but our composition would not be |
| Licence | AGPL-3.0-only, **the same as HexHoot** | MIT |
| Packaging | Native (Rust) module, needs a prebuilt binary per platform and architecture | Pure JS, runs anywhere |
| API churn | Pre-1.0 (0.108). The API changes often. | Stable |

# Decision (proposed)

**Option A.** Ratchet protocols have subtle state-machine bugs (skipped keys, simultaneous starts, SPQR epoch handling), and those bugs are where the security sits. HexHoot should not reimplement them. The `@noble/*` libraries are still used for the pieces libsignal does not cover: ML-DSA-65, XChaCha20-Poly1305 for storage, HKDF, and Argon2id.

# Risks and mitigations

- **Native module:** pin an exact version and test-load it on all four platform builds in CI (Phase 2 spike).
- **API churn:** wrap it behind a small `SessionEngine` interface so upgrades only touch one file.
- **Classical-only identity signatures in libsignal:** covered by the extra ML-DSA-65 signatures ([sessions](/design/session-and-ratchet.md)).
- **Fallback:** if the spike fails, choose option B with X-Wing (`@noble/post-quantum` `ml_kem768_x25519`) and a KEM-based ratchet, plus an external review before release.
