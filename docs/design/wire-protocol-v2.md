---
type: Design
title: Wire protocol v2
description: Length-prefixed framing, a minimal outer envelope with no identities in it, Padmé-padded inner messages, and the Messenger session layer (handshakes, ratchets, outbox, receipts, reset) over the Hyperswarm and LAN carriers.
tags: [design, protocol, hyperswarm, lan]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-26T23:00:00Z }
---

Implemented on 2026-11-26 in `modules/Protocol`: `wire.js`, `Messenger.js`, `DhtCarrier.js` and `LanCarrier.js`. Tested in `test/protocol` (`npm run test:protocol`). Core switches to it in the next commit; until then the app still runs v1.

# Framing

Hyperswarm streams carry bytes, not messages (T5). Frames are `u32be length ‖ envelope`, at most 1 MiB, and a larger frame closes the connection. The LAN carrier sends one envelope per HTTP request. A hand-rolled length prefix was chosen over `protomux`, because it is a few lines, has no dependency, and works on both carriers ([Q10](/plan/open-questions.md)).

# Outer envelope

```
envelope = 0x02 (version) ‖ kind (1) ‖ to (32) ‖ body
```

| kind | name | `to` | body |
|---|---|---|---|
| 1 | HS1 | the responder's **topic** | M1 |
| 2 | HS2 | `sid_A` | M2 |
| 3 | HS3 | `sid_A` | M3 |
| 4 | MSG | the **session tag** = `SHA-512(parts("hexhoot/v2/session-tag", session_ad))[0..32]` | a ratchet message |
| 5 | RESET | the tag of a session the sender does not have | empty |

The [session spec](/design/session-and-ratchet.md) defines M1–M3 and the ratchet message.

**Changed from the draft:** the draft had `from` and `to` fingerprints on every message. Now **no identity or fingerprint appears outside the encryption**. `to` is a topic (only on HS1), a random handshake id, or a tag that looks random and cannot be linked to the identities. There is no `from`: the sender is whoever the session authenticated (S2). There is no ACK kind, because receipts are inner messages. A test checks that no fingerprint, address or identity key appears anywhere on the wire.

Anything malformed (wrong version, unknown kind, too short, too long) is dropped without an exception (T3).

# Inner message (inside the ratchet's AES-256-GCM)

```
inner = u32be length ‖ JSON {id, ts, type, body} ‖ zero padding
```

- **Padding** brings the whole to its Padmé size, with a 1 KiB minimum. Every short message is 1024 bytes, and longer ones leak at most O(log log n) bits with at most 12% overhead. A binary length prefix replaces the draft's `pad` field.
- `id` is 128 random bits (base64url), `ts` is display-only, and `body` is an object.
- `type` is one of `chat`, `friend_request`, `friend_accept`, `friend_withdraw` or `profile` (passed to the app), or `hello` and `receipt` (handled by the Messenger). `friend_withdraw` (empty body) takes back a request; the receiver drops it only if that request is still waiting for an answer.
- The chat key in storage is `[contact, id]`, not the timestamp (F6). Any invalid inner message is dropped.

# Messenger: sessions and delivery

- **Sending** puts a message in the outbox, which is stored. Without a session, a handshake starts: HS1 goes to the contact's topic on every carrier.
- **After HS2,** the initiator sends HS3 and then, *on the same link*, a `hello` and anything waiting, so nothing overtakes HS3. The responder can send once that `hello` arrives (see the ratchet spec).
- **Receipts.** Each received app message is acknowledged by its `id`, every copy of it, so the sender stops resending. It is delivered to the app once: ids are remembered per contact. Unacknowledged messages are sent again with backoff: after 3 s, then 6, 12, 24 and 48 s, then every 60 s (`firstRetryMs`, `retryMs`). They are also sent again at once when a carrier sees a peer appear (a new Hyperswarm connection, or a LAN instance that finds us or says hello), and on every new session ([Q15](/plan/open-questions.md)).
- **Crash safety.** The ratchet's new state is stored *before* anything encrypted with it is sent. Otherwise a crash could restore an older state and encrypt a different message under the same key and nonce, which is fatal for AES-GCM. A test checks, for every frame, that the stored state is already past it.
- **Ordering.** Work for each contact runs one at a time, and frames from each link are handled in order.
- **Unknown session.** A MSG for an unknown tag is parked for 2 s, because it may have overtaken the handshake that creates it (for example over the other carrier). It is retried when a session appears. If none does, the sender gets RESET. RESET *retires* only the named session: it is no longer used for sending, a new handshake starts at once, and the outbox is sent again. The retired session is kept for receiving, and further RESETs for it are ignored. RESET cannot be authenticated, so this makes a forged one cost a single handshake ([T8](/assessment/crypto-findings.md)). Frames that went to every LAN instance are never answered with RESET.
- **Simultaneous starts** end with two sessions per side. Both sides send on the one whose `sid_A` is lower and keep the other for receiving (at most two per contact). Outside a 60 s window the newest session wins, which covers a contact who restored a backup.
- **Authorization.** A handshake from someone the app refuses (`authorize` returns false) ends at M3, and nothing is delivered.

# Hyperswarm carrier (`DhtCarrier`)

- **One swarm per app.** It announces our topic, `SHA-512(parts("hexhoot/v2/topic", fp))[0..32]` (T1: not the key), and looks up the topics of people we write to.
- **Connections are reused both ways.** A connection is bound to a contact's topic once a session on it is authenticated, so replies need no new lookup.
- **Envelopes wait in a per-topic queue** (at most 1000) until a connection exists. The lookup is refreshed at most every 10 s while something waits.
- Hyperswarm's own Noise layer is classical only (T6). Everything inside it is post-quantum end to end already.

# LAN carrier (`LanCarrier`)

- `GET /` answers `{application: "hexhoot", protocol: 2}` and nothing else: no keys, channels or peer lists (T2). There is no gossip; discovery is the ping and ARP sweep, or a static list.
- `POST /hello` introduces an instance that has just found us, so discovery works both ways.
- `POST /frame` carries one envelope. `x-hexhoot-port` gives the sender's port so the receiver can answer, and requests on one link are sent strictly in order.
- **Peers do not reveal whom they serve.** An envelope for a topic nobody has been bound to (usually HS1) goes to every known instance, marked `x-hexhoot-broadcast`, and each drops what is not for it. Once a session exists, its frames go only to the contact's instance. The cost is that HS1 reaches every HexHoot on the LAN; it reveals only the topic, which anyone with the address can compute anyway.
- **Limitation:** an instance that lost its session cannot RESET a broadcast frame. Over LAN alone, the contact recovers when either side next starts a handshake.

# Tests

`npm run test:protocol`:

- **Framing:** any split or merge of the stream, oversized frames, malformed envelopes and inner messages, and Padmé.
- **The Messenger on an in-memory network:**
  - Friend request, receipts and chat both ways.
  - The outbox while the contact is offline.
  - 20% loss, 20% duplication and reordering, with each message delivered exactly once.
  - RESET after a lost session, and a restart from the store with no new handshake.
  - Simultaneous starts and a refused peer.
  - No identity on the wire, and state stored before its ciphertext is sent.
- **Real carriers:** LAN on 127.0.0.1, a Hyperswarm testnet, and both at once with duplicates dropped.
