---
type: Architecture Overview
title: Current architecture (v1.0.5)
description: How HexHoot is structured today, with Electron renderer, DBMessenger, Hyperswarm and LAN transports, and IndexedDB storage.
tags: [architecture, as-is, electron, hyperswarm]
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T12:00:00Z }
sources:
  - { id: repo, resource: "git:67ca2c0", title: HexHoot main branch at commit 67ca2c0 }
---

# Process model

- One `BrowserWindow` (`modules/Main/index.js`) runs with `nodeIntegration: true` and `contextIsolation: false`. The whole app runs in the renderer, including key handling, crypto, the IndexedDB access, the Hyperswarm client, and a LAN HTTP server.
- UI modules (`Chat`, `Login`, `AddFriend`, `EditProfile`, `ViewProfile`, and others) render HTML templates with ``eval('`' + template + '`')`` and `innerHTML`.

# Messaging core: `modules/DBMessenger`

| File | Responsibility |
|---|---|
| `index.js` | Singleton facade. Stores friends and chats. Routes the three message types `ChatMessage`, `FriendRequest`, and `UserInformation`. |
| `DBWrapper.js` | IndexedDB `HexhootDB` v1 with the tables `Friends`, `Chat` (key `[peerKey, timestamp]`), `LoggedInUserInfo` (holds the **private key**), and `Preferences`. Provides JSON export and import. |
| `Messenger.js` | Internet transport over Hyperswarm. Topic = the recipient's raw public key. Opens one swarm per subscription and per recipient, and writes raw JSON to the stream with no framing. |
| `IntranetMessenger.js` | LAN transport. Plain HTTP server on port 43946+ with the routes `GET /`, `POST /`, `POST /subscribeChannels`, and `POST /message`. Discovers peers with ping sweeps and the ARP table. |
| `utils.js` | All cryptography (see [crypto findings](/assessment/crypto-findings.md)). |

# Identity and "login"

- Login derives the private key deterministically: `SHA-256(saltPrefix + password + "√" + username + saltSuffix)`, then keeps the hex digest's last 32 characters (128 bits). It is a *brain wallet*, so the same username and password give the same key on any device.
- The public key (secp128r1) is the user's address, their friend code, and their Hyperswarm topic.

# Message flow (today)

1. Sender computes `K = pub(ECDH(sk_A, pk_B))` (see findings F2 and F3).
2. Sender encrypts the JSON with AES-256-CBC under `K` and a random IV.
3. Sender sends `{senderPublicKey, iv, message}` as JSON over Hyperswarm **and** LAN HTTP.
4. The receiver recomputes `K` from `senderPublicKey`, decrypts, and dispatches the message.

There are no sessions, no forward secrecy, no message authentication beyond CBC padding, no replay protection, and no acknowledgements.

# Build and test

- Electron Forge 7 (makers: squirrel, dmg, deb, rpm, zip) plus a custom `makefile` that builds the DMG with `appdmg`.
- Tests: Karma + karma-electron + QUnit (UI-level). There are no unit tests for crypto.
- CI: GitHub Actions on Node 20 and 22, using `actions/checkout@v3` and `actions/setup-node@v3`.
- `package-lock.json` is in `.gitignore`, so builds are not reproducible and CI cannot audit a fixed dependency tree.
