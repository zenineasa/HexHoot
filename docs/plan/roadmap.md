---
type: Plan
title: HexHoot 2.0 upgrade roadmap
description: Phases for hardening, toolchain upgrade, core-process split, post-quantum crypto with ratcheting and keyring, transport rewrite, and release, with exit criteria for each.
tags: [plan, roadmap, upgrade]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T12:00:00Z }
---

Each phase is a separate PR, or a short series of PRs, and keeps `main` buildable. The phases are ordered so that the most urgent risk is fixed first and the crypto work lands on a current toolchain.

# Phase 0: Emergency hardening

**Status: done (2026-11-26), not released.** v1 has no users to protect ([Q3](/plan/open-questions.md)), so there is no 1.0.6 release. The fixes stay in the codebase and carry into 2.0. They close S1–S3 (see [findings](/assessment/crypto-findings.md)).

- Render all peer-controlled text with `textContent` or an `escapeHTML()` helper, including names, about text, and photo URLs (allow only `data:image/(png|jpeg|webp);base64`).
- In `messageReceivedCallback`, require `senderInfo.key === messageObj.senderPublicKey` before `updateFriendInformation`. Ignore `UserInformation` from unknown contacts.
- Stop auto-replying to `FriendRequest`. Show it as a pending request.
- Wrap all `JSON.parse` calls in the network path with `try`/`catch`.
- Add a strict Content-Security-Policy `<meta>` to `modules/Main/index.html`.

**Exit (met):** a crafted `displayName` payload renders as text, a spoofed `UserInformation` is ignored, and the existing tests pass. Regression tests are in `test/core/core.test.js`, `test/Chat/tChatXSS.js`, and `test/unit/sanitize.test.js`.

# Phase 1: Toolchain and dependencies

**Status: done (2026-11-26) except the multi-instance harness, which moved to Phase 2.** Electron 45.5, Forge 8.0.1 with fuses, ESLint 10, Node ≥ 22.13, the lockfile committed, `ip`/`require-text`/`appdmg`/`eslint-config-google` removed, and one CI workflow on all three OS. `npm audit --omit=dev` reports 0 vulnerabilities. The dev tree still has one high advisory with no fix (`image-size` ICNS parsing, through `maker-dmg`). Karma passes on Electron 45, and the packaged macOS app runs with fuses on.

Follow the [dependency upgrade matrix](/plan/dependency-upgrade-matrix.md).

- Electron 30 → 45 and Forge 7 → 8. Raise the Node floor to 22.13 (CI matrix: 22.x, 24.x). Update `actions/*` to the current major versions.
- Remove `ip` (it has no fix), `ecdh` (the crypto is replaced in Phase 3), and `require-text` (replace with a `fs.readFileSync` helper).
- Remove the `appdmg` makefile flow and rely on `@electron-forge/maker-dmg`.
- Add `@electron-forge/plugin-fuses`: enable ASAR integrity and `OnlyLoadAppFromAsar`, and disable `RunAsNode` and `EnableNodeCliInspectArguments`.
- **Commit `package-lock.json`** (remove it from `.gitignore`) and add `npm audit --omit=dev --audit-level=high` to CI.
- ESLint 10. Replace `eslint-config-google` if it is incompatible, keeping the same rule values.
- **Testing skeleton** ([testing infrastructure](/design/testing-infrastructure.md)): `node --test` for L1 (done). The orchestrator, `testHooks.js`, and the first L3 scenario **moved to Phase 2**. Two v1 peers cannot run on one machine today: the DHT crashes the receiving renderer (T7), and the LAN carrier keys peers by IP.

**Exit:** `npm audit --omit=dev` reports zero high or critical vulnerabilities, the app runs and packages on all three operating systems, and CI is green.

# Phase 2: Core-process split and crypto spike

- **Renderer lockdown done (2026-11-26).** The window runs with `contextIsolation`, `sandbox`, and no Node.js. The page is native ES modules served from `app://hexhoot/modules/…`, and the handler serves only renderer file types. `preload.js` exposes only `window.hexhoot.core.call` and `.onEvent`. The `eval` templates are now an escaping `html` tagged template (`modules/Html`). The CSP has no `'unsafe-eval'`, and inline styles are limited to attributes (`style-src-attr`, for the logo SVG). External links open only when they are on the `Social/links.json` list. Only notification and clipboard-write permissions are granted. Karma is retired: non-UI checks are now L1, and UI checks are single-app E2E scenarios (`npm run test:e2e`, `test/e2e/driver.mjs` over CDP). The packaged app contains only `modules/`, production `node_modules`, `package.json`, `README`, and `LICENSE`. Finding S4 was found and fixed during the rewrite.
- Turn on `contextIsolation: true` and `nodeIntegration: false`. Add `preload.js` with a narrow `contextBridge` API (`window.hexhoot.*`).
- Move DBMessenger, the transports, and storage into a **Core** (the main process or an Electron `utilityProcess`). Core must be **importable from plain Node**, with `safeStorage`, paths, and transports injected, so L2 tests can run it without Electron. The renderer becomes UI only. Replace the `eval` template rendering with plain template functions.
  - **Core split done (2026-11-26).** `modules/Core` holds storage (`node:sqlite`), the v1 protocol, and the DHT and LAN transports, with no Electron imports. The main process forks it as a `utilityProcess` and gives each window its own `MessagePort`. Renderers can call only the methods in `rendererMethods`. `modules/DBMessenger` is now a thin client with the same method names, so the UI is unchanged. L2 tests (`npm run test:core`) run two Cores over an in-memory transport, the LAN carrier on 127.0.0.1, and a hyperdht testnet. This closes T7 and fixes T4 and T5. Old IndexedDB data is not migrated, because there are no users. The renderer lockdown (`contextIsolation`, sandbox, no `eval`) is the next commit.
- **Multi-instance harness** (moved from Phase 1): the orchestrator, `testHooks.js` with `--use-mock-keychain`, per-peer `userData`, the hyperdht testnet, artifacts, and retry-once. The first L3 scenario: alice and bob exchange a friend request and chat.
- **Capability guard test** (L1), done 2026-11-26: `test/capability/capability.test.js`, run with `npm run test:capability` through `scripts/electron-node.js` so it runs on Electron's BoringSSL. It checks ML-KEM-1024, ML-DSA-87, P-521 (including invalid-point rejection), AES-256-GCM, SHA-512, HMAC and HKDF against published vectors, scrypt (N=2²⁰ in CI or with `HEXHOOT_SLOW_TESTS=1`), and `node:sqlite`. It passes on macOS arm64. CI covers Linux and Windows.

**Exit:** the UI works unchanged on top of IPC, two instances chat over the DHT testnet in the L3 harness (closing T7), and the capability guard is green on all OS.

# Phase 3: Crypto core v2

A new `modules/Crypto` (in Core), with unit tests in Node (`node:test`).

1. **Keyring** ([design](/design/keyring.md)): the vault key, the safeStorage and passphrase unlockers, and the encrypted record store.
2. **Identity** ([design](/design/identity-and-addresses.md)): the recovery phrase, deterministic `ik_ec` (P-521, with rejection sampling) and `ik_pq` (ML-DSA-87), the bundle and its signatures, the `hh2:` address, and the safety number.
3. **Hybrid KEM** (`HK`) and the **SIGMA-I handshake** ([spec](/design/session-and-ratchet.md)).
4. **Double Ratchet + ML-KEM** turns, skipped-key handling, and session persistence through the encrypted store.
5. **Encrypted backup** `.hexhoot2` with scrypt (N=2²⁰) + AES-256-GCM.

Write the spec's test vectors first, then the code. Cross-check ML-KEM and ML-DSA results against `@noble/post-quantum` (dev-only) and the NIST ACVP vectors.

**Exit:** test vectors and property tests pass, covering round trips, out-of-order delivery, simultaneous starts, healing after state compromise (classical *and* post-quantum), a tampered bundle or transcript rejected, replay rejected, and backup restore without ratchet state. The spec is frozen for external review.

# Phase 4: Transport and protocol v2

- [Wire protocol v2](/design/wire-protocol-v2.md): framing, envelopes, the inner schema, and padding.
- Hyperswarm: one long-lived swarm, `topic = SHA-512("hexhoot/v2/topic" ‖ fp)[0..32]`, and connection reuse keyed by fingerprint. Fix T5.
- LAN: carrier only, no channel disclosure. Fix T2–T4.
- UI: the new Login (create / restore), Add friend by `hh2:` address or QR, pending requests, and safety-number verification.

- Build the L4 evil peer, and run the full L3 scenario table across alice, bob, and carol on the hyperdht testnet. (Karma was removed in Phase 2.)

**Exit:** the L3 and L4 suites are green on Linux per push and on macOS and Windows nightly, covering DHT only, LAN only, and both, with fault injection. Two real machines chat over the public DHT as a manual check. All findings F1–F9 and T1–T5 are closed, each with a regression test.

# Phase 5: Release 2.0.0

- Migration screen: export v1 chat history as plaintext JSON, then wipe the v1 data ([ADR-001](/decisions/adr-001-no-backward-compatibility.md)).
- Update the README (the account model and the reworded "zero-knowledge" claim) and add a `SECURITY.md`.
- L5: run the packaged-build smoke tests on every OS.
- **External cryptographic review** of the handshake, ratchet, keyring, and wire protocol, against the frozen spec. This is required: HexHoot owns its protocol ([ADR-002](/decisions/adr-002-builtin-crypto-only.md)), so a 2.0.0 release waits on the review.
