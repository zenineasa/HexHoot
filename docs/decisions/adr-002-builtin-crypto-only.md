---
type: Architecture Decision Record
title: "ADR-002: Built-in Electron crypto only, no libsignal"
description: Build HexHoot's handshake and ratchet on Electron's built-in crypto (BoringSSL), with no runtime dependency on @signalapp/libsignal-client or other crypto libraries.
tags: [adr, cryptography, electron, ratchet]
status: stable
decision_status: Accepted
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T13:00:00Z }
verified: { by: "human:zenineasa", at: 2026-11-25T13:00:00Z }
sources:
  - { id: probe, resource: /assessment/electron-crypto-capabilities.md, title: Electron 45 crypto capability probe }
---

# Context

The first draft proposed `@signalapp/libsignal-client`. On 2026-11-25 the maintainer said: *"I don't want to be dependent on signalapp. Can we use whatever electron/chrome already provides (crypto library) and perhaps a few other things?"*

The [capability probe](/assessment/electron-crypto-capabilities.md) shows that Electron 45 already has every primitive a hybrid post-quantum messenger needs: ML-KEM-1024, ML-DSA-65, X25519, Ed25519, AES-256-GCM, HKDF, and scrypt.

# Decision

- **No third-party runtime crypto.** Everything goes through `require('crypto')` in Core (the main process or `utilityProcess`) and `safeStorage`.
- HexHoot implements its own **protocol layer**, following published designs rather than inventing new ones:
  - The handshake is the SIGMA-I pattern with a hybrid KEM ([sessions](/design/session-and-ratchet.md)).
  - The ratchet is Signal's public **Double Ratchet specification**, with an ML-KEM step added to every ratchet turn, in the style of Apple's PQ3.
- `@noble/post-quantum` may be used as a **dev-only test oracle**, to cross-check ML-KEM and ML-DSA results. It is never shipped.

# Consequences

- **Benefits:** no native add-on to rebuild per platform, no pre-1.0 API churn, and no outside party in the trust chain beyond Electron itself. The dependency tree is smaller.
- **Cost and risk:** HexHoot now owns a ratchet state machine, which is where real-world bugs live. The mitigations are required, not optional:
  1. A written spec first: [sessions and ratcheting](/design/session-and-ratchet.md) is the source of truth.
  2. Test vectors, property tests, and adversarial tests (L1, L2, and L4 in [testing infrastructure](/design/testing-infrastructure.md)).
  3. An **external cryptographic review** of the spec and code before 2.0.0 ships.
- **Bound to BoringSSL's feature set:** the capability guard test catches regressions when Electron is upgraded.
