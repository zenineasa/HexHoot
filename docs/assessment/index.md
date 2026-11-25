# Assessment (state as of 2026-11-25, commit 67ca2c0)

* [Current architecture](current-architecture.md) - How HexHoot is structured today: Electron renderer, DBMessenger, Hyperswarm and LAN transports, IndexedDB.
* [Cryptography and security findings](crypto-findings.md) - Weaknesses in the current crypto and a peer-triggerable remote code execution path, ranked by severity.
* [Built-in crypto in Electron 45](electron-crypto-capabilities.md) - Measured support for ML-KEM, ML-DSA, X25519, Ed25519, AES-GCM, HKDF, scrypt, and safeStorage, and what is missing.
* [Dependency audit](dependency-audit.md) - `npm audit` results (36 vulnerabilities) and the staleness of each direct dependency.
