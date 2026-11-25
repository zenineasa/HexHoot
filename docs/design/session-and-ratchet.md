---
type: Design
title: Sessions and ratcheting
description: A SIGMA-I handshake with a hybrid X25519 + ML-KEM-1024 KEM, then a Double Ratchet with an ML-KEM step in every turn, built only on Electron's built-in crypto.
tags: [design, handshake, double-ratchet, ml-kem, protocol-spec]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T13:00:00Z }
sources:
  - { id: dr, resource: "https://signal.org/docs/specifications/doubleratchet/", title: Signal Double Ratchet specification }
  - { id: pq3, resource: "https://security.apple.com/blog/imessage-pq3/", title: Apple iMessage PQ3 (post-quantum rekeying in a ratchet) }
  - { id: sigma, resource: "https://webee.technion.ac.il/~hugo/sigma-pdf.pdf", title: "Krawczyk, SIGMA: the 'SIGn-and-MAc' approach" }
  - { id: hkems, resource: "https://datatracker.ietf.org/doc/draft-irtf-cfrg-hybrid-kems/", title: Hybrid KEM combiners (IETF CFRG draft) }
---

This document is the **spec**. The code has to match it, and the external review is done against it. All primitives are listed in [Electron crypto capabilities](/assessment/electron-crypto-capabilities.md).

# Notation

- `HKDF(ikm, salt, info, L)` is HKDF-SHA-256.
- `H` is SHA-256.
- `AEAD` is AES-256-GCM with a 96-bit nonce.
- `Sig` is `Ed25519 ‖ ML-DSA-65`, and verification needs **both** to pass.
- Every `info` string starts with `hexhoot/v2/`.

# Hybrid KEM (`HK`)

```
HK.KeyGen()        → (x25519 keypair, ml-kem-1024 keypair)
HK.Encaps(pk)      → e = fresh X25519;  ss_x = X25519(e, pk.x);  (ct_m, ss_m) = ML-KEM.Encaps(pk.m)
                     ct = (e.pub, ct_m)
                     ss = HKDF(ss_m ‖ ss_x, salt=0, info="hexhoot/v2/hk" ‖ ct_m ‖ e.pub ‖ pk.m ‖ pk.x, 32)
HK.Decaps(sk, ct)  → same with X25519(sk.x, e.pub) and ML-KEM.Decaps(sk.m, ct_m)
```

# Handshake: SIGMA-I with HK (run once per contact, and again after a reset)

Both peers have to be online, because Hyperswarm has no store-and-forward. Messages written while offline are queued and sent after the handshake.

```
A → B   M1: { v:2, sid_A (16B random), hk_pk_A (ephemeral) }
B → A   M2: { sid_B, ct = HK.Encaps(hk_pk_A), hk_pk_B (ephemeral, seeds the first ratchet turn),
              AEAD_{k_hs}( id_bundle_B, Sig_B(T2), MAC_{k_mac}(id_B) ) }
A → B   M3: { AEAD_{k_hs}( id_bundle_A, Sig_A(T3), MAC_{k_mac}(id_A) ) }

ss              = HK.Decaps / Encaps result
k_hs, k_mac, RK0 = HKDF(ss, salt=sid_A ‖ sid_B, info="hexhoot/v2/hs", 96) split into three 32-byte keys
T2 = H(M1 ‖ M2-without-the-encrypted-part),  T3 = H(T2 ‖ M2-encrypted-part)
```

- A checks that `fingerprint(id_bundle_B)` equals the address it dialled ([identity](/design/identity-and-addresses.md)). B does the same check against its contacts or pending requests.
- Identities are encrypted under `k_hs`, so a passive observer does not learn who is talking (SIGMA-I's identity protection).
- **Trade-off:** signing the transcript makes the handshake *non-deniable*. See Q12 in [open questions](/plan/open-questions.md).

# Ratchet: Double Ratchet with a KEM step in every turn

This follows the Signal Double Ratchet spec, using its symbol names, with one change: **every DH ratchet turn also carries an ML-KEM-1024 encapsulation.**

State per session:

- `RK`, the root key
- `CKs` and `CKr`, the sending and receiving chain keys
- `DHs`, our X25519 ratchet keypair, and `DHr`, theirs
- `KEMs`, our ML-KEM-1024 ratchet keypair, and `KEMr`, theirs
- `Ns`, `Nr`, `PN`, and `MKSKIPPED` (capped at 2000)

On a **sending turn**, when we send after receiving:

```
DHs  = new X25519;   KEMs_new = new ML-KEM-1024
(ct_k, ss_k) = ML-KEM.Encaps(KEMr)
RK, CKs = HKDF(ikm = X25519(DHs, DHr) ‖ ss_k, salt = RK, info = "hexhoot/v2/rk", 64)
header  = { dh: DHs.pub, kem_pub: KEMs_new.pub, kem_ct: ct_k, pn: PN, n: Ns }
KEMs = KEMs_new
```

The **receiver** mirrors this with `ML-KEM.Decaps(KEMs, kem_ct)`, then stores `KEMr = header.kem_pub`.

Per message:

- `CK, MK = HMAC(CK, 0x02), HMAC(CK, 0x01)`, as in the Signal spec.
- `key, nonce = HKDF(MK, salt=0, info="hexhoot/v2/msg", 44)`
- `ciphertext = AEAD(key, nonce, plaintext, ad = session_ad ‖ encode(header))`, where `session_ad = H(T3)` binds every message to the handshake.

## Properties to prove in tests (L1/L2) and in the review

| Property | How it comes about |
|---|---|
| Forward secrecy | Message and chain keys are deleted after use. Old `DHs`/`KEMs` secrets are deleted after the next turn. |
| Classical post-compromise security | Fresh X25519 in every turn |
| **Quantum** post-compromise security | Fresh ML-KEM encapsulation in every turn, mixed into `RK` |
| Hybrid | `RK` depends on the X25519 output *and* the ML-KEM secret, so breaking one is not enough |
| Out-of-order / loss | `MKSKIPPED`, capped at 2000 per chain, with skipped keys dropped after 7 days |
| Replay | A message key is consumed once. Duplicate `(dh, n)` pairs are rejected. |

# Session rules

- There is one session per contact. If both peers start a handshake at once, the one with the lower `sid` wins and the other is dropped. Add a test for this.
- Restoring a backup **never** restores ratchet state ([keyring](/design/keyring.md)). The session is re-established with a handshake.
- Multiple devices per identity are out of scope for 2.0.
