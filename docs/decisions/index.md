# Architecture decision records

* [ADR-001: No backward compatibility with v1](adr-001-no-backward-compatibility.md) - Accepted. v2 is a clean break in protocol, storage, and identity.
* [ADR-002: Built-in Electron crypto only, no libsignal](adr-002-builtin-crypto-only.md) - Accepted. No third-party runtime crypto. HexHoot owns its protocol, which requires an external review.
* [ADR-003: Hybrid post-quantum algorithm choice](adr-003-hybrid-pq-algorithm-choice.md) - Proposed. X25519 + ML-KEM-1024 handshake and per-turn ratchet step, with Ed25519 + ML-DSA-65 identity signatures.
* [ADR-004: Account model](adr-004-account-model.md) - Proposed. Replace the username and password brain wallet with a random identity and a recovery phrase.
