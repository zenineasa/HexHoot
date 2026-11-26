# Log

## 2026-11-26

* **Update**: Renderer lockdown done. The window is sandboxed with context isolation and no Node.js. The page is ES modules over `app://`, with escaping templates instead of `eval`, and the CSP has no `'unsafe-eval'`. Karma is replaced by `node --test` and a CDP-driven E2E suite ([roadmap](/plan/roadmap.md) Phase 2, [testing](/design/testing-infrastructure.md), [Q5](/plan/open-questions.md)).
* **Finding**: S4. Saving the Edit Profile form gave every user the same private key. Fixed in Core, with regression tests ([findings](/assessment/crypto-findings.md)).
* **Update**: Core split done. Storage (`node:sqlite`), the v1 protocol, and the DHT and LAN transports run in a `utilityProcess`, and the renderer talks to Core over a `MessagePort`. Two instances now befriend and chat through the UI, which closes T7. T4 and T5 are fixed. L2 tests run with `npm run test:core` ([roadmap](/plan/roadmap.md) Phase 2, [findings](/assessment/crypto-findings.md), [testing](/design/testing-infrastructure.md)).
* **Creation**: Added the capability guard (`npm run test:capability`). [Q6](/plan/open-questions.md) is resolved as `node:sqlite`. scrypt at 2²⁰ took 59–153 s on an 8 GiB Mac under memory pressure ([probe](/assessment/electron-crypto-capabilities.md), [Q14](/plan/open-questions.md)).
* **Update**: The maintainer confirmed that v1 has no users to protect, so no 1.0.6 patch release ships. The Phase 0 hardening and the Phase 1 toolchain upgrade are done on the same branch ([roadmap](/plan/roadmap.md), [Q3](/plan/open-questions.md)).
* **Finding**: With no committed lockfile, a fresh install resolves `hyperdht` 6.37.0, which calls `.unref()` on a browser timer and crashes the receiving renderer on every incoming Hyperswarm connection. Running Hyperswarm in the renderer is unsupported, and the real fix is the Core split ([roadmap](/plan/roadmap.md) Phase 2). Recorded as T7 in [findings](/assessment/crypto-findings.md).

## 2026-11-25

* **Update**: The maintainer asked for the strongest option for every method. [ADR-003](/decisions/adr-003-hybrid-pq-algorithm-choice.md) is now the maximum-strength suite (ML-KEM-1024 + ECDH P-521, ML-DSA-87 + ECDSA P-521, AES-256-GCM, SHA-512 / HKDF-SHA-512 / HMAC-SHA-512, scrypt N=2²⁰, Padmé padding), and it is accepted. The probe found that scrypt N=2²¹ crashes Electron, so 2²⁰ is the hard cap ([probe](/assessment/electron-crypto-capabilities.md)).

* **Update**: The maintainer rejected the libsignal dependency. Electron 45.5's built-in crypto was probed and supports ML-KEM-768/1024, ML-DSA-44/65/87, X25519, Ed25519, AES-256-GCM, HKDF, and scrypt in main and `utilityProcess` ([probe](/assessment/electron-crypto-capabilities.md)). [ADR-002](/decisions/adr-002-builtin-crypto-only.md) was rewritten and accepted. [ADR-003](/decisions/adr-003-hybrid-pq-algorithm-choice.md), the [session spec](/design/session-and-ratchet.md), [identity](/design/identity-and-addresses.md), [keyring](/design/keyring.md), the wire protocol, the roadmap, and the dependency matrix were revised to use only built-in primitives.

* **Initialization**: Created the knowledge bundle with the current-state [assessment](/assessment/index.md), the target [design](/design/index.md), [decisions](/decisions/index.md), and the [roadmap](/plan/roadmap.md) for HexHoot 2.0.
* **Creation**: Added the [testing infrastructure](/design/testing-infrastructure.md) design, a multi-instance harness modelled on Konjugate's interaction runner.
