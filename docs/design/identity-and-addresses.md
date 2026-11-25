---
type: Design
title: Identity and addresses
description: Hybrid Curve25519 + ML-DSA-65 identity derived from a high-entropy recovery phrase, published as a 32-byte fingerprint address.
tags: [design, identity, ml-dsa, address]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T12:00:00Z }
---

# Identity keys

Each account has one **identity bundle**:

| Field | Size | Purpose |
|---|---|---|
| `ik_c` | 32 B | Curve25519 identity key (libsignal `IdentityKeyPair`). Used by PQXDH and XEdDSA signatures. |
| `ik_pq` | 1952 B | ML-DSA-65 public key. A post-quantum signature over every published prekey bundle. |
| `created_at` | 8 B | Creation time of the account. |

`bundle_sig = XEdDSA(ik_c, B) || ML-DSA-65(ik_pq, B)`, where `B` is the canonical encoding of the fields above. A verifier needs **both** signatures to be valid (a hybrid AND).

# Account model

The proposal is in [ADR-004](/decisions/adr-004-account-model.md), which is still *proposed*:

- At sign-up, generate 256 bits of entropy with a CSPRNG and show it as a **24-word recovery phrase**.
- `seed = HKDF-SHA-256(entropy, info="hexhoot/v2/identity-seed")`
- `ik_c = Curve25519 key from HKDF(seed, "hexhoot/v2/ik-c")`
- `ik_pq = ML-DSA-65.keygen(HKDF(seed, "hexhoot/v2/ik-pq"))` (deterministic keygen from a seed is part of FIPS 204)
- Entering the phrase on a new machine gives back the same identity. This keeps the current "log in anywhere" property without the offline password-guessing problem of the v1 brain wallet (F2).
- The username and password login goes away. A local passphrase (optional) only unlocks the vault on that machine (see [keyring](/design/keyring.md)).

# Address (friend code)

```
fingerprint = SHA-256("hexhoot/v2/fp" || canonical(ik_c, ik_pq))      // 32 bytes
address     = "hh2:" + base32(fingerprint) + checksum(2 chars)        // ~58 chars, copy/paste/QR
```

- ML-DSA public keys are too large to paste, so the address commits to them. The full bundle is fetched when two peers first connect, and checked against the fingerprint.
- **Safety number:** `SHA-256(sorted(fp_A, fp_B))` shown as 60 digits, the same idea as Signal's. Users compare it out of band to move a contact from *TOFU* to *verified*.

# Rendezvous topic

`topic = BLAKE2b-256("hexhoot/v2/topic" || fingerprint)`

This is domain-separated from the address, so the DHT topic is not the public key (T1). Anyone who knows the address can still compute the topic, so this does not hide *that* a user is online from people who have their address. Rotating topics are listed in [open questions](/plan/open-questions.md).
