# Target design (HexHoot 2.0)

* [Target crypto architecture](target-crypto-architecture.md) - One-page overview of the v2 algorithms, layers, and process split.
* [Identity and addresses](identity-and-addresses.md) - Hybrid ECDSA P-521 + ML-DSA-87 identity, recovery phrase, and the fingerprint-based address that replaces raw public keys.
* [Sessions and ratcheting](session-and-ratchet.md) - The protocol spec: SIGMA-I handshake over ECDH P-521 + ML-KEM-1024, then a Double Ratchet with an ML-KEM-1024 step in every turn.
* [Keyring](keyring.md) - Vault backed by the OS keychain through Electron safeStorage, with a scrypt (N=2²⁰) passphrase fallback, AES-256-GCM records, and encrypted backups.
* [Wire protocol v2](wire-protocol-v2.md) - Framing, envelope types, and the inner message schema for Hyperswarm and LAN.
* [Testing infrastructure](testing-infrastructure.md) - Five test layers, including a Konjugate-style harness that launches several HexHoot apps that message each other over a local DHT testnet.
