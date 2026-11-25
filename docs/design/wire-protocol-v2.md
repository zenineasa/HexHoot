---
type: Design
title: Wire protocol v2
description: Length-prefixed framing, outer envelope types, and the encrypted inner message schema shared by the Hyperswarm and LAN transports.
tags: [design, protocol, hyperswarm, lan]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T12:00:00Z }
---

# Framing

Hyperswarm streams carry a byte stream, not messages (T5). Both transports use `uint32_be length || frame`, with frames capped at 1 MiB. An alternative is `protomux` channels with `compact-encoding`, the Holepunch-native option (see [open questions](/plan/open-questions.md)).

# Outer envelope (not encrypted end to end; inside Hyperswarm Noise on the internet)

| Field | Type | Notes |
|---|---|---|
| `v` | u8 | Always `2`. Any other value is dropped. |
| `kind` | u8 | `1 HS1`, `2 HS2`, `3 HS3` (the SIGMA-I handshake), `4 MSG`, `5 ACK` |
| `from` | 32 B | Sender fingerprint |
| `to` | 32 B | Recipient fingerprint |
| `body` | bytes | Depends on `kind`: handshake messages per the [spec](/design/session-and-ratchet.md), or for `MSG` a ratchet header plus AES-256-GCM ciphertext |

During the handshake, `from` and `to` are **topic hashes**, not fingerprints. That keeps SIGMA-I's identity protection.

The `MSG` ratchet header is `dh` (P-521, 133 B) ‖ `pn` (u32) ‖ `n` (u32), plus `kem_pub` (1568 B) and `kem_ct` (1568 B) on a turn's first message. The header is authenticated as AEAD associated data.

The outer fields are parsed with strict length checks. Unknown `kind` values and oversized frames are dropped without a crash (T3).

# Inner plaintext (inside the ratchet's AES-256-GCM)

```json
{
  "id": "<128-bit random, base64url>",
  "ts": 1764072000000,
  "type": "chat | friend_request | friend_accept | profile | receipt",
  "body": { },
  "pad": "<random bytes up to the Padmé bucket size, minimum 1 KiB>"
}
```

- The chat DB key becomes `[contactFp, id]`, **not** the timestamp (F6). `ts` is display-only.
- The sender identity is taken from the *session* the message decrypted under, never from the body (S2).
- Padding uses **Padmé** (the PURBs paper) with a 1 KiB minimum. Lengths leak at most O(log log n) bits, at most 12% overhead, and every short message looks the same.
- Profile photos larger than about 256 KiB are sent in chunks.

# LAN transport changes

- `GET /` returns only `{application, protocol: 2}`. It no longer lists channels or peers (T2).
- Peers announce **topics** (see [identity](/design/identity-and-addresses.md)), never fingerprints or keys.
- Every message goes through the same v2 framing and envelopes. HTTP is only a carrier.
- Fix T3 (parsing) and T4 (the `!ip in` bug) as part of the rewrite.
