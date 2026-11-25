---
type: Design
title: Identity and addresses
description: Hybrid ECDSA P-521 + ML-DSA-87 identity derived deterministically from a 256-bit recovery phrase with Electron's built-in crypto, published as a 32-byte fingerprint address.
tags: [design, identity, ml-dsa, p-521, address]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T14:00:00Z }
sources:
  - { id: probe, resource: /assessment/electron-crypto-capabilities.md, title: Electron 45 crypto capability probe }
---

# Identity keys

Each account has one **identity bundle**. Both keys are *signature* keys. Key agreement uses only ephemeral keys ([sessions](/design/session-and-ratchet.md)).

| Field | Size | Purpose |
|---|---|---|
| `ik_ec` | 133 B | ECDSA P-521 public key, uncompressed |
| `ik_pq` | 2592 B | ML-DSA-87 public key |
| `created_at` | 8 B | Creation time of the account |

`Sig(m) = ECDSA-P521-SHA512(ik_ec, m) ‖ ML-DSA-87(ik_pq, m)`. A verifier needs **both** signatures to pass (a hybrid AND). The bundle carries a self-signature over its canonical encoding.

# Account model and deterministic derivation

The proposal is in [ADR-004](/decisions/adr-004-account-model.md), which is still *proposed*.

```
entropy = randomBytes(32)                          → shown as a 24-word recovery phrase (256 bits; bundled word list)
seed    = HKDF(entropy, salt = 0⁶⁴, info = "hexhoot/v2/identity-seed", 64)

ik_pq   = createPrivateKey({ key: HKDF(seed, …, "hexhoot/v2/ik-pq", 32), format: 'raw-seed', asymmetricKeyType: 'ml-dsa-87' })

ik_ec   : for ctr = 0, 1, 2, …
            d = HKDF(seed, …, "hexhoot/v2/ik-ec" ‖ u32(ctr), 66);  d[0] &= 0x01          // 521 bits
            if 1 ≤ d < n_P521: break                                                  // rejection sampling, no modulo bias
          public = createECDH('secp521r1').setPrivateKey(d).getPublicKey()
          key    = createPrivateKey({ key: { kty:'EC', crv:'P-521', d, x, y }, format:'jwk' })
```

Here `HKDF` is HKDF-SHA-512. Every step uses Electron's built-in crypto, and the probe confirmed both derivations are deterministic. The only extra asset is the 2048-word list, which is a static data file and not a library.

- Entering the phrase on a new machine gives back the same identity. This keeps v1's "log in anywhere" property without the offline password-guessing problem of the v1 brain wallet (F2).
- A local passphrase (optional) only unlocks the vault on that machine (see [keyring](/design/keyring.md)).

# Address (friend code)

```
fingerprint = SHA-512("hexhoot/v2/fp" ‖ canonical(ik_ec, ik_pq))[0..32]       // 256 bits
address     = "hh2:" + base32(fingerprint) + checksum(2 chars)                 // ~58 chars, copy/paste/QR
```

- 256 bits gives second-preimage resistance of 2²⁵⁶ classically and 2¹²⁸ against Grover, which is category 5. [ADR-003](/decisions/adr-003-hybrid-pq-algorithm-choice.md) explains why a longer address would not add security.
- The full bundle arrives during the handshake and is checked against the fingerprint.
- **Safety number:** `SHA-512("hexhoot/v2/safety" ‖ sorted(fp_A, fp_B))`, shown as 80 digits. Users compare it out of band to move a contact from *TOFU* to *verified*.

# Rendezvous topic

`topic = SHA-512("hexhoot/v2/topic" ‖ fingerprint)[0..32]`. Hyperswarm topics are fixed at 32 bytes.

This is domain-separated from the address, so the DHT topic is not the public key (T1). Anyone who knows the address can still compute the topic. Rotating topics are listed in [open questions](/plan/open-questions.md).
