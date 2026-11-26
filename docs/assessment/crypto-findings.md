---
type: Security Assessment
title: Cryptography and security findings
description: Ranked weaknesses in HexHoot 1.0.5's cryptography and peer-message handling, including a remote code execution path.
tags: [security, cryptography, assessment]
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T12:00:00Z }
sources:
  - { id: repo, resource: "git:67ca2c0", title: HexHoot main branch at commit 67ca2c0 }
---

All findings are against commit `67ca2c0`. The **Fix** column refers to the phase in the [roadmap](/plan/roadmap.md).

# Critical: fix before anything else

| ID | Finding | Where | Fix |
|---|---|---|---|
| S1 | **Remote code execution from any peer.** A peer's `displayName` and `about` go into `innerHTML` without escaping, and the window runs with `nodeIntegration: true` and `contextIsolation: false`. A display name such as `<img src=x onerror="require('child_process')...">` therefore runs as native code. | `modules/Chat/index.js:124`, `:159`, ViewProfile templates | Phase 0, **fixed 2026-11-26** |
| S2 | **Unauthenticated profile overwrite and friend injection.** `UserInformation` handling calls `updateFriendInformation(senderInfo)` and trusts `senderInfo.key` without checking that it equals the key that actually encrypted the message. Any peer can overwrite any contact's name or photo, or add themselves as a friend. Combined with S1, this is a wormable path to code execution. | `DBMessenger/index.js` `messageReceivedCallback` | Phase 0, **fixed 2026-11-26** |
| S3 | **Automatic profile disclosure.** A `FriendRequest` from anyone triggers an automatic reply containing the user's profile, with no consent step. | same | Phase 0 (consent, **fixed 2026-11-26**), Phase 3 (protocol) |
| S4 | **Every profile edit gives the same private key.** Saving the Edit Profile form called `writeLoggedInUserInfo` without a password, so `generatePrivateKey` hashed the literal string `"undefined"`. Every user who ever edited their profile ended up with the same key (`bf90b3bc…`), and anyone could read their messages and impersonate them. Found 2026-11-26 during the renderer rewrite. | `DBMessenger/index.js` `writeLoggedInUserInfo` (v1) | **Fixed 2026-11-26** (Phase 2): Core derives a key only from a password, and keeps the existing key otherwise. A caller-supplied key is never used. Regression tests are in `test/core/core.test.js` and `test/e2e/ui.e2e.mjs`. |
| S5 | **The key depends on the password alone.** `generatePrivateKey` hashes `info.username`, but the login form sends `displayName`, so the hash always contained `"undefined"`. Two users who chose the same password got the same identity and could read each other's messages. It also made F2 worse: one guessed password unlocks every account that uses it. Found 2026-11-26 by the first two-app E2E run, where alice and bob got the same key. | `DBMessenger/index.js` `writeLoggedInUserInfo` and `utils.js` `generatePrivateKey` (v1) | **Fixed 2026-11-26** (Phase 2): Core derives the key from the display name and the password, as the code intended. The same name and password still give the same key on any device. [ADR-004](/decisions/adr-004-account-model.md) replaces the scheme in Phase 3. Regression tests are in `test/core/core.test.js` and `test/e2e/friends-chat.e2e.mjs`. |

# Cryptography

| ID | Finding | Impact |
|---|---|---|
| F1 | **secp128r1** curve from the unmaintained pure-JS `ecdh` package (last published 2022). | About 64-bit security. Deprecated and practically breakable by a well-resourced attacker. Not constant-time. **Closed 2026-11-26** (Phase 4): v1 crypto and the `ecdh` package are removed. Identities are P-521 + ML-DSA-87, and key agreement is P-521 + ML-KEM-1024. |
| F2 | **Brain-wallet identity.** The key comes from one fast SHA-256 with a *global* static salt, and the code keeps the *last* 128 bits (the comment says "first"). The minimum password length is 9. Because of S5, the name was never mixed in. | The public key is published (it is the address and the DHT topic), so anyone can guess passwords offline at GPU speed against every user at once. **Mitigated 2026-11-26 ([ADR-004](/decisions/adr-004-account-model.md)):** scrypt at 2²⁰ (about 1 GiB and several seconds per guess), a per-name salt, and passwords of 16 characters or more. Offline guessing remains possible against predictable passwords. |
| F3 | **No key derivation function.** The AES key is the public key of the ECDH shared secret, used as if it were a private key. | Non-standard, with at most 128 bits of entropy behind a 256-bit key. There is no domain separation. **Closed 2026-11-26** (Phase 4): every key comes from HKDF-SHA-512 with domain-separated labels ([sessions](/design/session-and-ratchet.md)). |
| F4 | **AES-256-CBC with no MAC.** | Ciphertexts are malleable, a padding oracle is possible, and there is no integrity check or associated data. **Closed 2026-11-26** (Phase 4): AES-256-GCM everywhere, with associated data binding each message to its header and session. |
| F5 | **One static key per contact pair, forever.** | No forward secrecy and no post-compromise security. A single key leak exposes all past and future traffic. **Closed 2026-11-26** (Phase 4): a Double Ratchet with fresh P-521 and ML-KEM-1024 in every turn. |
| F6 | **No replay or ordering protection.** The chat DB key is the *sender-supplied* timestamp. | Replayed or forged messages can overwrite chat history. **Closed 2026-11-26** (Phase 4): the ratchet rejects replays, and chat records are keyed by contact, direction and random id, never by a timestamp. Covered by a Core test. |
| F7 | **Private key stored in plaintext** in IndexedDB and in the `.hexhootjson` backup export. | Malware, a stolen disk, or a shared backup file gives away the identity. **Closed 2026-11-26** (Phase 4): the identity secret is stored under the keyring (OS keyring or passphrase), and backups are `.hexhoot2` (scrypt + AES-256-GCM). |
| F8 | `signMessage` and `verifySignature` exist but are never used. | Nothing is authenticated beyond F4's implicit check. **Closed 2026-11-26** (Phase 4): hybrid ECDSA P-521 + ML-DSA-87 signatures authenticate the identity bundle and the handshake. |
| F9 | **No post-quantum protection.** | Recorded traffic can be decrypted later by a quantum attacker ("harvest now, decrypt later"). F1 makes this moot today, but it must be addressed in v2. **Closed 2026-11-26** (Phase 4): ML-KEM-1024 in the handshake and in every ratchet turn, ML-DSA-87 in every signature. |

# Transport and metadata

| ID | Finding |
|---|---|
| T1 | The Hyperswarm topic is the raw public key, so anyone with a user's address can find their IP address. **Closed 2026-11-26** (Phase 4): the topic is `SHA-512(parts("hexhoot/v2/topic", fingerprint))`. Anyone with the address can still compute it, so finding someone online still needs their address (Q9). |
| T2 | The LAN server answers unauthenticated `GET /` with every subscribed channel (that is, the user's public key) and its whole peer map. **Closed 2026-11-26** (Phase 4): `GET /` answers only `{application, protocol}`, and there is no gossip ([wire protocol](/design/wire-protocol-v2.md)). |
| T3 | LAN JSON bodies go to `JSON.parse` without `try`, and `assertIPInArrayAndReturn` throws inside request handlers. A malformed request can break the messenger. **Fixed 2026-11-26** (Phase 0): parsing is wrapped, bodies are capped at 4 MiB, and peer info is validated. |
| T4 | `!ip in this.hostsWithHexHootMap` is an operator-precedence bug that is always `false`, so gossip-based discovery never fires. **Fixed 2026-11-26** (Phase 2): the LAN carrier keys peers by `ip:port` and contacts gossiped peers directly, after validating them. |
| T5 | Hyperswarm `data` events are treated as whole messages. Stream chunks can split or merge, which breaks `JSON.parse` under load. **Fixed 2026-11-26** (Phase 2): each envelope is one line of JSON, and frames over 4 MiB close the connection. Protocol v2 replaces this with length-prefixed frames. |
| T6 | Hyperswarm's own Noise transport is classical-only (X25519/Ed25519). That is acceptable only if the inner end-to-end layer is post-quantum. **Accepted**: Hyperswarm's classical Noise layer only carries ciphertext that is already post-quantum end to end. Its job is transport privacy, not message security. |
| T7 | Hyperswarm runs in the renderer, which Holepunch does not support. `hyperdht` ≥ 6.37 calls `.unref()` on `setTimeout` results, which are numbers in a browser, so every incoming connection crashes the receiving renderer (found 2026-11-26 in a two-instance test). A remote peer can crash the app. **Fixed 2026-11-26** (Phase 2): networking runs in the Core `utilityProcess`. Two instances now befriend and chat through the UI without errors, and `test/core/network.test.js` covers the DHT testnet and the LAN carrier. Since 2026-11-26 the L3 test `test/e2e/friends-chat.e2e.mjs` runs two separate apps over both. |

# What is fine to keep

- Hyperswarm as the internet transport, which supplies hole punching and Noise-encrypted streams.
- Local-first storage in IndexedDB, once records are encrypted (see [keyring](/design/keyring.md)).
