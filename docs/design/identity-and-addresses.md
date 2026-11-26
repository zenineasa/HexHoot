---
type: Design
title: Identity and addresses
description: Hybrid ECDSA P-521 + ML-DSA-87 identity derived deterministically from a name and password (scrypt N=2^20) with Electron's built-in crypto, published as a 32-byte fingerprint address.
tags: [design, identity, ml-dsa, p-521, address]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-26T17:00:00Z }
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

Accepted in [ADR-004](/decisions/adr-004-account-model.md): the identity comes from the **name and password**.

```
salt    = SHA-512(parts("hexhoot/v2/identity-salt", normalize(name)))      // NFKC, lower case, spaces collapsed
entropy = scrypt(NFKC(password), salt, N = 2²⁰, r = 8, p = 1, 32)          // about 5–8 s, 1 GiB
seed    = HKDF(entropy, salt = 0⁶⁴, info = "hexhoot/v2/identity-seed", 64)

ik_pq   = createPrivateKey({ key: HKDF(seed, …, "hexhoot/v2/ik-pq", 32), format: 'raw-seed', asymmetricKeyType: 'ml-dsa-87' })

ik_ec   : for ctr = 0, 1, 2, …
            d = HKDF(seed, …, "hexhoot/v2/ik-ec" ‖ u32(ctr), 66);  d[0] &= 0x01          // 521 bits
            if 1 ≤ d < n_P521: break                                                  // rejection sampling, no modulo bias
          public = createECDH('secp521r1').setPrivateKey(d).getPublicKey()
          key    = createPrivateKey({ key: { kty:'EC', crv:'P-521', d, x, y }, format:'jwk' })
```

Here `HKDF` is HKDF-SHA-512. Every step uses Electron's built-in crypto, and the probe confirmed both derivations are deterministic.

- The same name and password give back the same identity on any machine, as in v1. Unlike v1, every guess costs scrypt at 2²⁰, and the salt is per name.
- Passwords need at least 16 characters, must not contain the name, and must use at least 5 different characters (`credentials.checkCredentials`).
- Day to day nobody types anything: `Identity#secret()` (entropy, name, creation time) is kept in the [keyring](/design/keyring.md) under the OS keyring. Now and then the user is offered a non-blocking password check (`Identity#checkPassword`, `credentials.nextPasswordCheck`; see ADR-004).

# Address (friend code)

```
fingerprint = SHA-512("hexhoot/v2/fp" ‖ canonical(ik_ec, ik_pq))[0..32]       // 256 bits
address     = Bech32m("hh2", fingerprint) = "hh21" + 52 data + 6 checksum chars   // 62 chars, copy/paste/QR
```

- 256 bits gives second-preimage resistance of 2²⁵⁶ classically and 2¹²⁸ against Grover, which is category 5. [ADR-003](/decisions/adr-003-hybrid-pq-algorithm-choice.md) explains why a longer address would not add security.
- The full bundle arrives during the handshake and is checked against the fingerprint.
- **Safety number:** `HKDF-SHA-512(sorted(fp_A, fp_B), "", "hexhoot/v2/safety", 80 bytes)`, shown as 80 digits (16 groups of 5). Users compare it out of band to move a contact from *TOFU* to *verified*.

# Rendezvous topic

`topic = SHA-512("hexhoot/v2/topic" ‖ fingerprint)[0..32]`. Hyperswarm topics are fixed at 32 bytes.

This is domain-separated from the address, so the DHT topic is not the public key (T1). Anyone who knows the address can still compute the topic. Rotating topics are listed in [open questions](/plan/open-questions.md).

# Implementation (2026-11-26)

Built and tested as a library in `modules/Crypto`: `Identity.js` (`Identity`, `PublicIdentity`), `credentials.js` and `address.js`. Core uses it since Phase 4: logging in runs `Identity.fromCredentials`, and the [keyring](/design/keyring.md) stores `Identity#secret()` under its `secrets` key. A UI login at the real cost took 4.6 s on the 8 GiB Mac and gave exactly the known-answer address.

## Exact formats

`parts(…)` is the length-prefixed encoding defined in the [keyring](/design/keyring.md). Every `‖` above is `parts`.

```
seed      = HKDF-SHA-512(entropy, 0^64, "hexhoot/v2/identity-seed", 64)
ik_pq     = ML-DSA-87 from raw seed HKDF(seed, "", "hexhoot/v2/ik-pq", 32)
ik_ec     = P-521, d = HKDF(seed, "", parts("hexhoot/v2/ik-ec", u32be ctr), 66), d[0] &= 1, first ctr with 1 ≤ d < n
signature = ECDSA-P521-SHA512(P1363, 132 B) ‖ ML-DSA-87 (4627 B)       over parts("hexhoot/v2/sig", context, message)
bundle    = 0x01 ‖ u64be created_at ‖ ik_ec (133) ‖ ik_pq (2592) ‖ signature("bundle", previous bytes)   = 7493 B
fp        = SHA-512(parts("hexhoot/v2/fp", ik_ec, ik_pq))[0..32]
topic     = SHA-512(parts("hexhoot/v2/topic", fp))[0..32]
```

## Decisions made while building it

- **Name and password instead of a recovery phrase** (ADR-004, 2026-11-26). A BIP-39 recovery phrase was built first and then removed when the maintainer chose name and password. The scrypt parameters, the salt label and the name normalization are fixed forever, because changing any of them would change every identity. A known-answer test at the real cost pins them (CI, or `HEXHOOT_SLOW_TESTS=1`).
- **The address is Bech32m (BIP-350), not base32 with a 2-character hash.** A 10-bit hash check lets about 1 in 1024 typos through. Of the ~1,700 single-character typos of an address, one or two would be accepted, and the request would go to an address nobody owns. Bech32m is guaranteed to catch up to 4 wrong characters, and its alphabet leaves out `1 b i o`. It costs 4 more characters (62 instead of ~58). The all-upper-case form is accepted, for compact QR codes. Phase 4's rendezvous and UI use this format.
- **Signature contexts.** Every signature covers its purpose (`bundle`, and `handshake` later), so a signature made for one purpose is never valid for another.
- **Restore keeps the address, not the bundle.** The fingerprint covers only the two public keys, so logging in again with the same name and password gives the same address and topic. The bundle is re-signed with the new `created_at`.
- **Safety number from HKDF.** The design said SHA-512, which gives only 64 bytes. Each of the 16 groups takes 5 bytes mod 10⁵, which needs 80 bytes, and the bias is negligible.
- **The P-521 order** in the code is confirmed by BoringSSL, which accepts `n − 1` and rejects `n` as a private key.

## Tests

`test/crypto/identity.test.js` (L1, under Electron's BoringSSL):

- The BIP-350 vectors.
- Name normalization, the password rules, a derivation matching `scryptSync` computed directly, `checkPassword`, the check schedule, and a known-answer identity for a name and password at the real cost.
- A known-answer identity for entropy `00…1f`, re-derived with WebCrypto's separate HKDF.
- The same name and password giving the same identity, and a different name or password giving another.
- One flipped bit in each part of the bundle, an off-curve point, and a wrong expected address.
- Each half of a hybrid signature swapped for another key's.
- Signature contexts.
- Every single-character typo of an address rejected.
- Matching safety numbers on both sides.
