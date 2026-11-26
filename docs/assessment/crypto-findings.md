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

# Cryptography

| ID | Finding | Impact |
|---|---|---|
| F1 | **secp128r1** curve from the unmaintained pure-JS `ecdh` package (last published 2022). | About 64-bit security. Deprecated and practically breakable by a well-resourced attacker. Not constant-time. |
| F2 | **Brain-wallet identity.** The key comes from one fast SHA-256 with a *global* static salt, and the code keeps the *last* 128 bits (the comment says "first"). The minimum password length is 9. | The public key is published (it is the address and the DHT topic), so anyone can guess passwords offline at GPU speed against every user at once. |
| F3 | **No key derivation function.** The AES key is the public key of the ECDH shared secret, used as if it were a private key. | Non-standard, with at most 128 bits of entropy behind a 256-bit key. There is no domain separation. |
| F4 | **AES-256-CBC with no MAC.** | Ciphertexts are malleable, a padding oracle is possible, and there is no integrity check or associated data. |
| F5 | **One static key per contact pair, forever.** | No forward secrecy and no post-compromise security. A single key leak exposes all past and future traffic. |
| F6 | **No replay or ordering protection.** The chat DB key is the *sender-supplied* timestamp. | Replayed or forged messages can overwrite chat history. |
| F7 | **Private key stored in plaintext** in IndexedDB and in the `.hexhootjson` backup export. | Malware, a stolen disk, or a shared backup file gives away the identity. |
| F8 | `signMessage` and `verifySignature` exist but are never used. | Nothing is authenticated beyond F4's implicit check. |
| F9 | **No post-quantum protection.** | Recorded traffic can be decrypted later by a quantum attacker ("harvest now, decrypt later"). F1 makes this moot today, but it must be addressed in v2. |

# Transport and metadata

| ID | Finding |
|---|---|
| T1 | The Hyperswarm topic is the raw public key, so anyone with a user's address can find their IP address. |
| T2 | The LAN server answers unauthenticated `GET /` with every subscribed channel (that is, the user's public key) and its whole peer map. |
| T3 | LAN JSON bodies go to `JSON.parse` without `try`, and `assertIPInArrayAndReturn` throws inside request handlers. A malformed request can break the messenger. **Fixed 2026-11-26** (Phase 0): parsing is wrapped, bodies are capped at 4 MiB, and peer info is validated. |
| T4 | `!ip in this.hostsWithHexHootMap` is an operator-precedence bug that is always `false`, so gossip-based discovery never fires. **Fixed 2026-11-26** (Phase 2): the LAN carrier keys peers by `ip:port` and contacts gossiped peers directly, after validating them. |
| T5 | Hyperswarm `data` events are treated as whole messages. Stream chunks can split or merge, which breaks `JSON.parse` under load. **Fixed 2026-11-26** (Phase 2): each envelope is one line of JSON, and frames over 4 MiB close the connection. Protocol v2 replaces this with length-prefixed frames. |
| T6 | Hyperswarm's own Noise transport is classical-only (X25519/Ed25519). That is acceptable only if the inner end-to-end layer is post-quantum. |
| T7 | Hyperswarm runs in the renderer, which Holepunch does not support. `hyperdht` ≥ 6.37 calls `.unref()` on `setTimeout` results, which are numbers in a browser, so every incoming connection crashes the receiving renderer (found 2026-11-26 in a two-instance test). A remote peer can crash the app. **Fixed 2026-11-26** (Phase 2): networking runs in the Core `utilityProcess`. Two instances now befriend and chat through the UI without errors, and `test/core/network.test.js` covers the DHT testnet and the LAN carrier. |

# What is fine to keep

- Hyperswarm as the internet transport, which supplies hole punching and Noise-encrypted streams.
- Local-first storage in IndexedDB, once records are encrypted (see [keyring](/design/keyring.md)).
