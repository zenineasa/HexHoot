---
type: Design
title: Sessions and ratcheting
description: PQXDH (X25519 + ML-KEM-1024) to start a session, then the Triple Ratchet (Double Ratchet + SPQR) for forward secrecy and post-compromise security.
tags: [design, pqxdh, double-ratchet, spqr, ml-kem]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T12:00:00Z }
sources:
  - { id: pqxdh, resource: "https://signal.org/docs/specifications/pqxdh/", title: Signal PQXDH specification }
  - { id: dr, resource: "https://signal.org/docs/specifications/doubleratchet/", title: Signal Double Ratchet specification }
  - { id: libsignal, resource: "https://github.com/signalapp/libsignal", title: libsignal (AGPL-3.0-only) }
---

# Why a ratchet and not only a hybrid KEM

A single X25519MLKEM768 exchange per contact gives one strong key. If that key is stolen, the attacker can read the whole conversation. A **ratchet** derives a new key for every message and mixes in fresh key exchanges. That gives:

- **Forward secrecy.** Stealing today's state does not reveal yesterday's messages.
- **Post-compromise security.** The session heals after the attacker loses access.

SPQR adds post-quantum key exchanges *into* the ratchet, so healing also holds against a quantum attacker.

# Prekeys

libsignal's PQXDH expects a **prekey bundle**. HexHoot has no server, and peers are only reachable while online, so bundles are swapped **live** when two peers connect:

| Key | Rotation | Signed by |
|---|---|---|
| Signed prekey (X25519) | Every 7 days. The previous key is kept for 30 days. | `ik_c` (XEdDSA) and `ik_pq` (ML-DSA-65) |
| Kyber/ML-KEM last-resort prekey | Every 7 days | same |
| One-time X25519 and ML-KEM prekeys | Batch of 20, refilled when it runs low | same |

The extra ML-DSA-65 signature is checked by HexHoot *before* the bundle reaches `processPreKeyBundle`. This adds post-quantum **authentication** of prekeys, which Signal itself does not have.

# Handshake (first contact)

```
Alice (has Bob's address)                         Bob
  join topic(Bob) ─────────── Hyperswarm/LAN ───────▶
  ◀──────────── BUNDLE {identity bundle, bundle_sig, prekeys, prekey_sigs}
  check fingerprint(bundle) == address
  check XEdDSA ∧ ML-DSA-65 signatures
  processPreKeyBundle → session (PQXDH: X25519×3–4 + ML-KEM-1024)
  ─────────── PREKEY_MSG {FriendRequest + Alice's identity bundle} ──▶
                                                   check Alice's bundle and signatures
                                                   user clicks Accept (no auto-reply, see S3)
  ◀────────── MSG {FriendAccept + Bob's profile}   (normal ratchet message)
```

After this, every message is a libsignal `SignalMessage` that carries the Double Ratchet header and the SPQR `pqRatchet` payload.

# Session rules

- One session per contact per device. Multiple devices are out of scope for 2.0 (see [open questions](/plan/open-questions.md)).
- If both sides start a session at once, libsignal's session archive handles the simultaneous start. Add a test for this.
- Restoring a backup **never** restores ratchet state. That would reuse keys. Sessions start fresh after a restore.
- Out-of-order delivery is handled by libsignal's skipped-message keys, capped at 2000 per chain.

# To verify in the Phase 2 spike

- The ML-KEM parameter set libsignal 0.108 uses in PQXDH. The current Signal spec says ML-KEM-1024; confirm it in the code.
- That SPQR is enabled by default in `@signalapp/libsignal-client` 0.108, and how to require it for every session.
- That the native module loads in Electron 45 and in `utilityProcess` on macOS (arm64 and x64), Windows x64, and Linux x64.
