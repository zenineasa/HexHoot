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
| `kind` | u8 | `1 HELLO`, `2 BUNDLE`, `3 PREKEY_MSG`, `4 MSG`, `5 ACK` |
| `from` | 32 B | Sender fingerprint |
| `to` | 32 B | Recipient fingerprint |
| `body` | bytes | Depends on `kind` (a libsignal ciphertext for `PREKEY_MSG` and `MSG`) |

The outer fields are parsed with strict length checks. Unknown `kind` values and oversized frames are dropped without a crash (T3).

# Inner plaintext (inside libsignal encryption)

```json
{
  "id": "<128-bit random, base64url>",
  "ts": 1764072000000,
  "type": "chat | friend_request | friend_accept | profile | receipt",
  "body": { },
  "pad": "<random bytes to the next 256-byte bucket>"
}
```

- The chat DB key becomes `[contactFp, id]`, **not** the timestamp (F6). `ts` is display-only.
- The sender identity is taken from the *session* the message decrypted under, never from the body (S2).
- Padding to 256-byte buckets hides exact message length.
- Profile photos larger than about 256 KiB are sent in chunks.

# LAN transport changes

- `GET /` returns only `{application, protocol: 2}`. It no longer lists channels or peers (T2).
- Peers announce **topics** (see [identity](/design/identity-and-addresses.md)), never fingerprints or keys.
- Every message goes through the same v2 framing and envelopes. HTTP is only a carrier.
- Fix T3 (parsing) and T4 (the `!ip in` bug) as part of the rewrite.
