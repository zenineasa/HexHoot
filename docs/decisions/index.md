# Architecture decision records

* [ADR-001: No backward compatibility with v1](adr-001-no-backward-compatibility.md) - Accepted. v2 is a clean break in protocol, storage, and identity.
* [ADR-002: Use libsignal for session crypto](adr-002-libsignal-for-session-crypto.md) - Proposed. Use the audited PQXDH and Triple Ratchet instead of writing our own.
* [ADR-003: Hybrid post-quantum algorithm choice](adr-003-hybrid-pq-algorithm-choice.md) - Proposed. X25519 + ML-KEM-1024 handshake, SPQR ratchet, and ML-DSA-65 identity signatures.
* [ADR-004: Account model](adr-004-account-model.md) - Proposed. Replace the username and password brain wallet with a random identity and a recovery phrase.
