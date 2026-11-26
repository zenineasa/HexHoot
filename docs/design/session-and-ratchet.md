---
type: Design
title: Sessions and ratcheting
description: The protocol spec, a SIGMA-I handshake over the hybrid ECDH P-521 + ML-KEM-1024 KEM, then a Double Ratchet with an ML-KEM-1024 step in every turn, using only Electron's built-in crypto at maximum strength.
tags: [design, handshake, double-ratchet, ml-kem, p-521, protocol-spec]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-26T19:00:00Z }
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

Implemented in `modules/Crypto/hybridKem.js` (2026-11-26). `parts(…)` is the length-prefixed encoding from the [keyring](/design/keyring.md).

```
HK.KeyGen()        → (P-521 keypair, ML-KEM-1024 keypair);  pk = pk.ec (133) ‖ pk.m (1568) = 1701 B
HK.Encaps(pk)      → e = fresh P-521;  ss_e = DH(e, pk.ec);  (ct_m, ss_m) = ML-KEM-1024.Encaps(pk.m)
                     ct = e.pub (133) ‖ ct_m (1568) = 1701 B
                     ss = HKDF(ikm = parts(ss_m, ss_e, e.pub, pk.ec, ct_m, pk.m), salt = 0⁶⁴, info = "hexhoot/v2/hk", 64)
HK.Decaps(sk, ct)  → the same, with DH(sk.ec, e.pub) and ML-KEM-1024.Decaps(sk.m, ct_m)
```

- The public keys and ciphertexts are part of the **key material**, not of `info`. Node limits HKDF `info` to 1024 bytes, which the earlier draft exceeded (3 KB). This has the shape of the CFRG hybrid combiners and X-Wing: both shared secrets plus the classical ciphertext and public key, with the ML-KEM values included as well.
- Malformed inputs are rejected before use: points off the curve (BoringSSL), ML-KEM keys with out-of-range coefficients (the FIPS 203 input check, confirmed in BoringSSL), and wrong lengths. A changed ML-KEM ciphertext gives a different secret (implicit rejection), which the AEAD that follows then rejects.

# Handshake: SIGMA-I with HK (run once per contact, and again after a reset)

Implemented in `modules/Crypto/handshake.js` (2026-11-26). Both peers have to be online, because Hyperswarm has no store-and-forward. Messages written while offline are queued and sent after the handshake.

```
A → B   M1 = 0x01 ‖ 0x02 (version) ‖ sid_A (32) ‖ hk_pk_A (1701)                                        1735 B
B → A   M2 = 0x02 ‖ sid_B (32) ‖ ct = HK.Encaps(hk_pk_A) (1701) ‖ hk_pk_B (1701)
             ‖ AEAD(k_B, bundle_B ‖ Sig_B("handshake-responder", T2) ‖ HMAC(k_mac, parts("B", fp_B)),
                    ad = parts("hexhoot/v2/hs-m2", T2))                                               15779 B
A → B   M3 = 0x03 ‖ AEAD(k_A, bundle_A ‖ Sig_A("handshake-initiator", T3) ‖ HMAC(k_mac, parts("A", fp_A)),
                         ad = parts("hexhoot/v2/hs-m3", T3))                                          12345 B

k_A, k_B, k_mac (32 B each), RK0 (64 B) = HKDF(ss, salt = sid_A ‖ sid_B, info = "hexhoot/v2/hs", 160)
T2         = SHA-512(parts("hexhoot/v2/hs-t2", M1, M2 up to the AEAD part))
T3         = SHA-512(parts("hexhoot/v2/hs-t3", T2, M2's AEAD part))
session_ad = SHA-512(parts("hexhoot/v2/hs-session", T3, M3))
```

`AEAD(k, …)` is `nonce (12) ‖ ciphertext ‖ tag (16)` with a random nonce, and each key is used once. `Sig` and the bundle are defined in [identity](/design/identity-and-addresses.md).

- Each direction has its own handshake key, so the two sides never reuse a key and nonce pair.
- A checks that `fingerprint(bundle_B)` equals the address it dialled, before it reveals anything. B answers anyone who knows its address, and decides at M3 through an `authorize(peer)` callback: contacts, or a stranger's friend request held as pending. A handshake with our own identity is refused.
- Identities are only ever sent encrypted, so a passive observer does not learn who is talking (SIGMA-I's identity protection). B's identity is protected from passive observers, and A's from active ones too.
- **Separate signature contexts** for the two roles mean a responder signature can never be reflected back as an initiator signature.
- **`session_ad` covers M3** as well (the earlier draft used `H(T3)`), so every ratchet message is bound to the whole handshake.
- **Ratchet seed:** `hk_pk_B` is B's first ratchet key. A starts the ratchet by sending to it, as Alice does with Bob's signed prekey in the Double Ratchet. The handshake hands over `RK0`, `session_ad`, the peer's `PublicIdentity`, and either `hk_pk_B` (A) or B's key pair (B).
- Handshake keys are zeroed once used, and A drops its `hk` private key after M2. Every step runs once, and a failed step ends that handshake.
- **Simultaneous start:** each side compares its own `sid_A` with the one in the M1 it received. The handshake with the lower `sid_A` continues: its initiator ignores the other M1, and the other side abandons its own M1 and answers. Equal sids happen with probability 2⁻²⁵⁶.
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
