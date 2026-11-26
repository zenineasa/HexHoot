---
type: Plan
title: External cryptographic review package
description: What an external reviewer of HexHoot 2.0 needs - scope, the frozen specifications, the code that implements each, the threat model, what is already known and accepted, the questions we most want answered, and how to run the tests.
tags: [plan, security, review, cryptography]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-27T12:00:00Z }
---

HexHoot owns its protocol: it is built only from Electron's built-in cryptography ([ADR-002](/decisions/adr-002-builtin-crypto-only.md)), with no third-party protocol library. So the 2.0.0 release waits on an independent review ([roadmap](/plan/roadmap.md), Phase 5). This page is the starting point for the reviewer.

# Scope

In scope, in order of priority:

1. **The session protocol:** the hybrid KEM, the SIGMA-I handshake, and the Double Ratchet with an ML-KEM-1024 encapsulation in every turn.
2. **Identity:** deterministic derivation of the P-521 and ML-DSA-87 identity keys from a name and password through scrypt, the signed bundle, the address and the safety number.
3. **The keyring and storage:** the vault key, its OS-keyring and passphrase unlockers, per-record encryption, and the `.hexhoot2` backup.
4. **The wire protocol and session layer:** envelopes, padding, receipts, resends, RESET, the handling of simultaneous handshakes, and what an observer of the network learns.

Out of scope: Hyperswarm and HyperDHT themselves, Electron and BoringSSL, and the UI (except where UI code handles peer-supplied data).

# What to read

The specifications are proposed as frozen. The maintainer tags the commit sent for review as `spec-freeze-1`; changes after that are listed in the [log](/log.md).

| Topic | Specification | Code | Tests |
|---|---|---|---|
| Overview | [Target crypto architecture](/design/target-crypto-architecture.md), [ADR-003](/decisions/adr-003-hybrid-pq-algorithm-choice.md) (algorithm choice) | | |
| Primitives | [Session spec, notation](/design/session-and-ratchet.md) | `modules/Crypto/primitives.js` (HKDF, AES-256-GCM, scrypt, length-prefixed encoding) | `test/capability` (the algorithms Electron must provide) |
| Hybrid KEM | [Session spec, HK](/design/session-and-ratchet.md) | `modules/Crypto/hybridKem.js` | `test/crypto/handshake.test.js` |
| Handshake | [Session spec, handshake](/design/session-and-ratchet.md) | `modules/Crypto/handshake.js` | `test/crypto/handshake.test.js` |
| Ratchet | [Session spec, ratchet](/design/session-and-ratchet.md) | `modules/Crypto/Ratchet.js` | `test/crypto/ratchet.test.js` (including a 400-step random conversation) |
| Identity, address, safety number | [Identity and addresses](/design/identity-and-addresses.md), [ADR-004](/decisions/adr-004-account-model.md) (account model) | `modules/Crypto/Identity.js`, `credentials.js`, `address.js` | `test/crypto/identity.test.js` (with a known-answer test at the real scrypt cost) |
| Keyring and storage | [Keyring](/design/keyring.md) | `modules/Crypto/Keyring.js`, `RecordCipher.js`, `modules/Core/EncryptedStore.js`, `modules/Main/sealer.js` | `test/crypto/keyring.test.js`, `record.test.js`, `test/e2e/keyring.e2e.mjs` (real `safeStorage`) |
| Backup | [Keyring, backup file](/design/keyring.md) | `modules/Crypto/backup.js` | `test/crypto/backup.test.js` |
| Wire and session layer | [Wire protocol v2](/design/wire-protocol-v2.md) | `modules/Protocol/wire.js`, `Messenger.js`, `DhtCarrier.js`, `LanCarrier.js` | `test/protocol/*`, `test/core/*`, `test/e2e/*` |

The crypto and protocol code is about 4,300 lines of JavaScript. `modules/Core/index.js` (accounts, contacts and chat on top of the Messenger) is a further 740.

# Threat model

The attacker may:

- watch, drop, delay, replay, reorder and inject anything on the network, on the DHT and on the local network;
- know the victim's address, and therefore their rendezvous topic;
- run any number of HexHoot instances, complete handshakes with the victim, and send any message a peer can send;
- record traffic today and attack it later with a quantum computer;
- briefly compromise a device (read its state), then lose access.

We want message confidentiality and integrity, mutual authentication, forward secrecy and post-compromise security against classical *and* quantum attackers; no identities on the wire; and nothing readable at rest without the OS keyring or the passphrase.

# Already known and accepted

These are documented, so the reviewer need not report them again, but we welcome views on whether accepting them is right.

| Item | Where |
|---|---|
| The identity can be attacked offline by guessing the password, at about 1 GiB and several seconds of scrypt per guess. Passwords need 16 characters or more. | F2 in [findings](/assessment/crypto-findings.md), [ADR-004](/decisions/adr-004-account-model.md) |
| scrypt is capped at N=2²⁰, because 2²¹ crashes Electron. Argon2id is not available. | [ADR-003](/decisions/adr-003-hybrid-pq-algorithm-choice.md) |
| Hyperswarm's own Noise layer is classical only; it carries only post-quantum ciphertext. | T6 |
| RESET cannot be authenticated. A forged one costs one handshake. | T8, [wire protocol](/design/wire-protocol-v2.md) |
| The signed handshake is not deniable. | [Q12](/plan/open-questions.md) |
| A user's rendezvous topic is stable, so someone who knows the address can see when the user is online. | [Q9](/plan/open-questions.md) |
| Every message carries the full 3.3 KB ratchet header. | [Q13](/plan/open-questions.md) |
| No multi-device, no store-and-forward. | [Q7, Q8](/plan/open-questions.md) |

# Questions we most want answered

1. **The KEM combiner.** HK puts both shared secrets, both ciphertexts and both public keys into the HKDF-SHA-512 *key material*, because Node limits HKDF `info` to 1024 bytes. Is the combiner sound, and does it bind everything it should (compare X-Wing and the IETF hybrid drafts)?
2. **The handshake.** Does SIGMA-I over HK give mutual authentication, identity hiding (the responder's against passive attackers, the initiator's against active ones too, as the spec claims), and resistance to key-compromise impersonation and unknown-key-share? Is the rule for simultaneous starts (keep the session with the lower `sid_A` within a 60 s window) safe?
3. **The ratchet.** With a fresh ML-KEM-1024 encapsulation in every turn, a responder that can send only after the initiator's first message, and a full header in every message: does it give post-quantum post-compromise security, and is the skipped-key handling (2000 per chain, 5000 in all, 7 days) safe against memory exhaustion and key reuse? Decryption works on a copy of the state and commits only on success; is any state left behind on failure?
4. **Deterministic identity keys.** The P-521 key comes from the scrypt output by rejection sampling, and the ML-DSA-87 key from a seed derived with HKDF. Are the derivations sound and free of bias? Are the per-name salt and the name normalization (NFKC, lower case, collapsed whitespace) safe, for example against two different names that normalize to the same salt?
5. **Keyring and storage.** Records are encrypted with per-record HKDF keys and associated data `table ‖ id`, and record ids are HMACs. Is that enough to stop records being moved, swapped or rolled back undetected, and does it matter that it is not enough for some of them?
6. **The session layer.** What does an observer learn from envelope kinds, sizes (Padmé, at least 1 KiB), timing, the stable per-session tag, and HS1 being sent to the recipient's topic? Are the resend, receipt and parking rules (a message for an unknown session is held for 2 s) open to amplification or state exhaustion?
7. **The implementation.** Constant-time comparisons where secrets are compared, key material wiped where JavaScript allows it, invalid P-521 points and wrong-length ML-KEM inputs rejected before use, and nothing secret logged or sent to the renderer.

# How to run it

```
npm ci
npm run test:capability   # the algorithms the bundled Electron provides
npm run test:crypto       # L1: keyring, identity, handshake, ratchet, backup
npm run test:protocol     # L1/L2: wire, Messenger, carriers, fault injection
npm run test:core         # L2: Core on the v2 stack, with real carriers
npm run test:e2e          # L3/L4: several app instances and an adversarial peer
```

The crypto, protocol and Core tests run under Electron's own Node (`scripts/electron-node.js`), because Electron uses BoringSSL and a system Node uses OpenSSL, and their algorithms differ. The adversarial peer (`test/peers/evilPeer.js`) can send arbitrary message types and bodies over a real session, replay or tamper with any envelope, and post raw frames. It is a quick way to try an attack against the running app ([testing infrastructure](/design/testing-infrastructure.md)).

# What we hope to receive

A written report that rates each issue by severity and says whether it is in the specification or the implementation, plus a short statement of which properties the reviewer believes hold. Fixes are tracked as findings in the [assessment](/assessment/crypto-findings.md), each with a regression test, and the report is linked from there.
