---
type: Design
title: Sessions and ratcheting
description: The protocol spec, a SIGMA-I handshake over the hybrid ECDH P-521 + ML-KEM-1024 KEM, then a Double Ratchet with an ML-KEM-1024 step in every turn, using only Electron's built-in crypto at maximum strength.
tags: [design, handshake, double-ratchet, ml-kem, p-521, protocol-spec]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T14:00:00Z }
sources:
  - { id: dr, resource: "https://signal.org/docs/specifications/doubleratchet/", title: Signal Double Ratchet specification }
  - { id: pq3, resource: "https://security.apple.com/blog/imessage-pq3/", title: Apple iMessage PQ3 (post-quantum rekeying in a ratchet) }
  - { id: sigma, resource: "https://webee.technion.ac.il/~hugo/sigma-pdf.pdf", title: "Krawczyk, SIGMA: the 'SIGn-and-MAc' approach" }
  - { id: hkems, resource: "https://datatracker.ietf.org/doc/draft-irtf-cfrg-hybrid-kems/", title: Hybrid KEM combiners (IETF CFRG draft) }
---

This document is the **spec**. The code has to match it, and the external review is done against it. The algorithms come from [ADR-003](/decisions/adr-003-hybrid-pq-algorithm-choice.md), and the primitives are listed in [Electron crypto capabilities](/assessment/electron-crypto-capabilities.md).

# Notation

| Symbol | Meaning | Node API |
|---|---|---|
| `H` | SHA-512 | `createHash('sha512')` |
| `HKDF(ikm, salt, info, L)` | HKDF-SHA-512 | `hkdfSync('sha512', …)` |
| `HMAC(k, m)` | HMAC-SHA-512 | `createHmac('sha512', k)` |
| `AEAD` | AES-256-GCM, 96-bit nonce, 128-bit tag | `createCipheriv('aes-256-gcm', …)` |
| `DH` | ECDH on P-521. Public keys are 133 B uncompressed and validated on import. | `diffieHellman` |
| `Sig` | `ECDSA-P521-SHA512 (P1363, 132 B) ‖ ML-DSA-87 (4627 B)`. **Both** must verify. | `sign` / `verify` |
| `info` | Every label starts with `hexhoot/v2/` | |

Received public keys go through `createPublicKey`, and anything that fails import is rejected, including invalid or identity points. P-521 shared secrets are 66 B and are never used directly, only as HKDF input.

# Hybrid KEM (`HK`)

```
HK.KeyGen()        → (P-521 keypair, ML-KEM-1024 keypair)
HK.Encaps(pk)      → e = fresh P-521;  ss_e = DH(e, pk.ec);  (ct_m, ss_m) = ML-KEM-1024.Encaps(pk.m)
                     ct = (e.pub, ct_m)
                     ss = HKDF(ss_m ‖ ss_e, salt = 0⁶⁴, info = "hexhoot/v2/hk" ‖ ct_m ‖ e.pub ‖ pk.m ‖ pk.ec, 64)
HK.Decaps(sk, ct)  → same with DH(sk.ec, e.pub) and ML-KEM-1024.Decaps(sk.m, ct_m)
```

# Handshake: SIGMA-I with HK (run once per contact, and again after a reset)

Both peers have to be online, because Hyperswarm has no store-and-forward. Messages written while offline are queued and sent after the handshake.

```
A → B   M1: { v:2, sid_A (32B random), hk_pk_A (ephemeral) }
B → A   M2: { sid_B (32B), ct = HK.Encaps(hk_pk_A), hk_pk_B (ephemeral, seeds the first ratchet turn),
              AEAD_{k_hs_B}( id_bundle_B, Sig_B(T2), HMAC(k_mac, "B" ‖ fp_B) ) }
A → B   M3: { AEAD_{k_hs_A}( id_bundle_A, Sig_A(T3), HMAC(k_mac, "A" ‖ fp_A) ) }

ss                            = HK shared secret (64 B)
k_hs_A, k_hs_B, k_mac, RK0    = HKDF(ss, salt = sid_A ‖ sid_B, info = "hexhoot/v2/hs", 128), four 32-byte keys
T2 = H(M1 ‖ M2-without-the-encrypted-part),  T3 = H(T2 ‖ M2-encrypted-part)
```

- Each direction has its own handshake key, so the two sides never reuse a key and nonce pair.
- A checks that `fingerprint(id_bundle_B)` equals the address it dialled ([identity](/design/identity-and-addresses.md)). B checks A against its contacts or pending requests.
- Identities are encrypted, so a passive observer does not learn who is talking (SIGMA-I's identity protection).
- **Trade-off:** signing the transcript makes the handshake *non-deniable*. See Q12 in [open questions](/plan/open-questions.md).

# Ratchet: Double Ratchet with a KEM step in every turn

This follows the Signal Double Ratchet spec, using its symbol names, with two changes:

1. The DH ratchet uses **P-521**.
2. **Every turn also carries an ML-KEM-1024 encapsulation.**

State per session:

- `RK`, the root key (64 B)
- `CKs` and `CKr`, the sending and receiving chain keys (64 B)
- `DHs`, our P-521 ratchet keypair, and `DHr`, theirs
- `KEMs`, our ML-KEM-1024 ratchet keypair, and `KEMr`, theirs
- `Ns`, `Nr`, `PN`, and `MKSKIPPED` (capped at 2000)

On a **sending turn**, when we send after receiving:

```
DHs  = new P-521;   KEMs_new = new ML-KEM-1024
(ct_k, ss_k) = ML-KEM-1024.Encaps(KEMr)
RK, CKs = HKDF(ikm = DH(DHs, DHr) ‖ ss_k, salt = RK, info = "hexhoot/v2/rk", 128), two 64-byte halves
header  = { dh: DHs.pub (133 B), kem_pub: KEMs_new.pub (1568 B), kem_ct: ct_k (1568 B), pn: PN, n: Ns }
KEMs = KEMs_new
```

The **receiver** mirrors this with `ML-KEM-1024.Decaps(KEMs, kem_ct)`, then stores `KEMr = header.kem_pub`.

Per message:

- `CK, MK = HMAC(CK, 0x02), HMAC(CK, 0x01)`
- `key, nonce = HKDF(MK, salt = 0⁶⁴, info = "hexhoot/v2/msg", 44)`, a 32-byte key and a 12-byte nonce. Every message has its own key, so nonce reuse is impossible.
- `ciphertext = AEAD(key, nonce, plaintext, ad = session_ad ‖ encode(header))`, where `session_ad = H(T3)` binds every message to the handshake.

## Properties to prove in tests (L1/L2) and in the review

| Property | How it comes about |
|---|---|
| Forward secrecy | Message and chain keys are deleted after use. Old `DHs`/`KEMs` secrets are deleted after the next turn. |
| Classical post-compromise security | Fresh P-521 in every turn |
| **Quantum** post-compromise security | Fresh ML-KEM-1024 encapsulation in every turn, mixed into `RK` |
| Hybrid | `RK` depends on the P-521 output *and* the ML-KEM secret, so breaking one is not enough |
| Out-of-order / loss | `MKSKIPPED`, capped at 2000 per chain, with skipped keys dropped after 7 days |
| Replay | A message key is consumed once. Duplicate `(dh, n)` pairs are rejected. |
| Invalid keys | Malformed or invalid P-521 points and ML-KEM keys of the wrong length are rejected before use |

# Session rules

- There is one session per contact. If both peers start a handshake at once, the one with the lower `sid` wins and the other is dropped. Add a test for this.
- Restoring a backup **never** restores ratchet state ([keyring](/design/keyring.md)). The session is re-established with a handshake.
- Multiple devices per identity are out of scope for 2.0.
