# Architecture decision records

* [ADR-001: No backward compatibility with v1](adr-001-no-backward-compatibility.md) - Accepted. v2 is a clean break in protocol, storage, and identity.
* [ADR-002: Built-in Electron crypto only, no libsignal](adr-002-builtin-crypto-only.md) - Accepted. No third-party runtime crypto. HexHoot owns its protocol, which requires an external review.
* [ADR-003: Maximum-strength hybrid algorithm suite](adr-003-hybrid-pq-algorithm-choice.md) - Accepted. The strongest built-in option for every role: ML-KEM-1024 + P-521, ML-DSA-87 + ECDSA P-521, AES-256-GCM, SHA-512, and scrypt at 2²⁰.
* [ADR-004: Account model](adr-004-account-model.md) - Proposed. Replace the username and password brain wallet with a random identity and a recovery phrase.
