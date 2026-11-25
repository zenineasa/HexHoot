# Log

## 2026-11-25

* **Update**: The maintainer rejected the libsignal dependency. Electron 45.5's built-in crypto was probed and supports ML-KEM-768/1024, ML-DSA-44/65/87, X25519, Ed25519, AES-256-GCM, HKDF, and scrypt in main and `utilityProcess` ([probe](/assessment/electron-crypto-capabilities.md)). [ADR-002](/decisions/adr-002-builtin-crypto-only.md) was rewritten and accepted. [ADR-003](/decisions/adr-003-hybrid-pq-algorithm-choice.md), the [session spec](/design/session-and-ratchet.md), [identity](/design/identity-and-addresses.md), [keyring](/design/keyring.md), the wire protocol, the roadmap, and the dependency matrix were revised to use only built-in primitives.

* **Initialization**: Created the knowledge bundle with the current-state [assessment](/assessment/index.md), the target [design](/design/index.md), [decisions](/decisions/index.md), and the [roadmap](/plan/roadmap.md) for HexHoot 2.0.
* **Creation**: Added the [testing infrastructure](/design/testing-infrastructure.md) design, a multi-instance harness modelled on Konjugate's interaction runner.
