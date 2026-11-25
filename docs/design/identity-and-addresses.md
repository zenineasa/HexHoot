---
type: Design
title: Identity and addresses
description: Hybrid Ed25519 + ML-DSA-65 identity derived from a high-entropy recovery phrase with Electron's built-in crypto, published as a 32-byte fingerprint address.
tags: [design, identity, ml-dsa, ed25519, address]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T13:00:00Z }
sources:
  - { id: probe, resource: /assessment/electron-crypto-capabilities.md, title: Electron 45 crypto capability probe }
---

# Identity keys

Each account has one **identity bundle**. Both keys are *signature* keys. Key agreement uses only ephemeral keys ([sessions](/design/session-and-ratchet.md)), so the identity has no X25519 key.

| Field | Size | Purpose |
|---|---|---|
| `ik_ed` | 32 B | Ed25519 public key |
| `ik_pq` | 1952 B | ML-DSA-65 public key |
| `created_at` | 8 B | Creation time of the account |

`Sig(m) = Ed25519(ik_ed, m) ‖ ML-DSA-65(ik_pq, m)`. A verifier needs **both** signatures to pass (a hybrid AND). The bundle carries a self-signature over its canonical encoding.

# Account model and deterministic derivation

The proposal is in [ADR-004](/decisions/adr-004-account-model.md), which is still *proposed*.

```
entropy = randomBytes(32)                         → shown as a 24-word recovery phrase (BIP-39-style word list, bundled)
seed    = HKDF(entropy, salt=0, info="hexhoot/v2/identity-seed", 32)
ik_ed   = createPrivateKey({ key: HKDF(seed, …,"hexhoot/v2/ik-ed", 32), format: 'raw-private', asymmetricKeyType: 'ed25519' })
ik_pq   = createPrivateKey({ key: HKDF(seed, …,"hexhoot/v2/ik-pq", 32), format: 'raw-seed',    asymmetricKeyType: 'ml-dsa-65' })
```

Every step uses built-in Electron crypto. The probe confirmed that `raw-seed` import works for ML-DSA. The only extra asset is the 2048-word list, which is a static data file and not a library.

- Entering the phrase on a new machine gives back the same identity. This keeps v1's "log in anywhere" property without the offline password-guessing problem of the v1 brain wallet (F2).
- A local passphrase (optional) only unlocks the vault on that machine (see [keyring](/design/keyring.md)).

# Address (friend code)

```
fingerprint = SHA-256("hexhoot/v2/fp" ‖ canonical(ik_ed, ik_pq))        // 32 bytes
address     = "hh2:" + base32(fingerprint) + checksum(2 chars)          // ~58 chars, copy/paste/QR
```

- ML-DSA public keys are too large to paste, so the address commits to them. The full bundle arrives during the handshake and is checked against the fingerprint.
- **Safety number:** `SHA-256("hexhoot/v2/safety" ‖ sorted(fp_A, fp_B))` shown as 60 digits. Users compare it out of band to move a contact from *TOFU* to *verified*.

# Rendezvous topic

`topic = SHA-256("hexhoot/v2/topic" ‖ fingerprint)`, a 32-byte Hyperswarm topic.

This is domain-separated from the address, so the DHT topic is not the public key (T1). Anyone who knows the address can still compute the topic. Rotating topics are listed in [open questions](/plan/open-questions.md).
