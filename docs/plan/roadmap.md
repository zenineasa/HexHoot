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
  - **Done (2026-11-26).** `test/e2e/orchestrator.mjs` and `test/e2e/friends-chat.e2e.mjs` run alice and bob over the DHT testnet and over the LAN carrier, about 4 s each. `scripts/run-e2e.mjs` retries once and writes `results.json`, and CI uploads `test-results/e2e`. The first run found S5.
- **Capability guard test** (L1), done 2026-11-26: `test/capability/capability.test.js`, run with `npm run test:capability` through `scripts/electron-node.js` so it runs on Electron's BoringSSL. It checks ML-KEM-1024, ML-DSA-87, P-521 (including invalid-point rejection), AES-256-GCM, SHA-512, HMAC and HKDF against published vectors, scrypt (N=2²⁰ in CI or with `HEXHOOT_SLOW_TESTS=1`), and `node:sqlite`. It passes on macOS arm64. CI covers Linux and Windows.

**Exit:** the UI works unchanged on top of IPC, two instances chat over the DHT testnet in the L3 harness (closing T7), and the capability guard is green on all OS. **Met on macOS (2026-11-26); Linux and Windows wait for the first CI run.**

# Phase 3: Crypto core v2

A new `modules/Crypto` (in Core), with unit tests in Node (`node:test`).

1. **Keyring** ([design](/design/keyring.md)): the vault key, the safeStorage and passphrase unlockers, and the encrypted record store. **Done 2026-11-26** as a library with L1 tests and a real-`safeStorage` test; Core starts using it with the new login in Phase 4.
2. **Identity** ([design](/design/identity-and-addresses.md)): name-and-password derivation (scrypt 2²⁰, ADR-004; replaced the recovery phrase on 2026-11-26), deterministic `ik_ec` (P-521, with rejection sampling) and `ik_pq` (ML-DSA-87), the bundle and its signatures, the `hh2:` address, and the safety number. **Done 2026-11-26** as a library with L1 tests. The address became Bech32m (`hh21…`).
3. **Hybrid KEM** (`HK`) and the **SIGMA-I handshake** ([spec](/design/session-and-ratchet.md)). **Done 2026-11-26** as a library with L1 tests (about 15 ms per handshake).
4. **Double Ratchet + ML-KEM** turns, skipped-key handling, and session persistence through the encrypted store. **Done 2026-11-26** as a library with L1 tests: forward secrecy, healing, replay, forgery, reordering and loss, and a 400-step random conversation.
5. **Encrypted backup** `.hexhoot2` with scrypt (N=2²⁰) + AES-256-GCM. **Done 2026-11-26** with L1 tests; it never contains session state.

Write the spec's test vectors first, then the code. Cross-check ML-KEM and ML-DSA results against `@noble/post-quantum` (dev-only) and the NIST ACVP vectors.

**Exit:** test vectors and property tests pass, covering round trips, out-of-order delivery, simultaneous starts, healing after state compromise (classical *and* post-quantum), a tampered bundle or transcript rejected, replay rejected, and backup restore without ratchet state. The spec is frozen for external review.

**Status (2026-11-26): done.** `modules/Crypto` holds the keyring, identity (name and password, ADR-004), HK, the handshake, the ratchet and the backup. It is covered by 63 L1 tests plus 3 slow ones at the real scrypt cost. Every exit item has a test: round trips, out-of-order delivery, simultaneous starts, healing (classical and post-quantum), tampered bundles and transcripts, replay, and restore without ratchet state. The crypto parts of the spec ([keyring](/design/keyring.md), [identity](/design/identity-and-addresses.md), [sessions](/design/session-and-ratchet.md)) are complete and proposed for freezing. The wire format around them is defined in Phase 4. Core does not use `modules/Crypto` yet; Phase 4 wires it in.

# Phase 4: Transport and protocol v2

**Commit 1 done (2026-11-26):** wire protocol, Messenger, and the DHT and LAN carriers, with L1/L2 tests (`npm run test:protocol`). 

**Commit 2 done (2026-11-26):** Core runs on v2.
- **Accounts:** name and password (ADR-004), and unlocking with the password where the OS keyring is weak.
- **Storage:** `EncryptedStore`, with HMAC'd ids.
- **Contacts and chat:** contacts by address, friend requests with no automatic reply, accept, decline, and mutual add. Chat has delivery receipts and safety numbers.
- **Other:** profile updates to friends, password checks (Core API), and `.hexhoot2` backup and restore.
- **Removed:** v1 crypto, storage, transports and the `ecdh` package.
- **UI:** adapted where v1 assumptions broke. Addresses replace keys, passwords need 16 characters with Core's reasons shown, there is an unlock form, a passphrase dialog for backups, and safety numbers on profiles. New strings come in five languages.
- **Tests:** L2 (`test/core`), and L3 adds a hostile display name sent by a real third peer and a restart that signs in through the OS keyring.

**Commit 3 done (2026-11-27):** the UI for v2.
- **Password checks:** a box in the corner (`modules/PasswordCheck`) with the ADR-004 messages in five languages. It is checked on every render and hourly, and it never blocks the app.
- **Progress:** an animated bar while scrypt runs, on login and unlock. Enter submits both forms.
- **Add friend:** opens on "Their code", with a hint on each tab and "Copied" feedback.
- **Verification:** the safety number in 16 groups of five digits, a "The numbers match" button that marks the contact verified (`Core#setVerified`, which peers cannot set), and a ✓ in the chat header.
- **Tests:** L3 covers the check being due after a restart 4 days later, a wrong answer, a right answer the next day, and "Not now". It also covers the default add-friend tab and marking a contact verified. The new hook is `HEXHOOT_TEST_CLOCK_OFFSET_DAYS`.

**Commit 4 done (2026-11-27):** the L3 scenario table and the L4 adversarial peer ([testing infrastructure](/design/testing-infrastructure.md)).
- **L3:** 50 messages each way through the UI over `dht`, over a faulty `lan`, and over both at once. Restarts mid-conversation, with the outbox delivered and the verified mark kept. alice, bob and carol talk at the same time over `lan` and over `dht`, with no cross-talk. The same name and password give the same address in a fresh profile.
- **Fault injection:** `HEXHOOT_TEST_FAULTS` wraps every carrier (`modules/Protocol/faults.js`). L1 and L2 tests cover the wrapper and real LAN carriers under loss. `HEXHOOT_TEST_RETRY_MS` shortens resends for those runs ([Q15](/plan/open-questions.md)).
- **L4:** `test/peers/evilPeer.js` attacks a real app with its UI open: T2, S1–S3, malformed bodies, unknown types, replays, bit flips, and malformed and oversized frames.
- **Fixed:** the chat box was cleared only after Core answered, so text typed meanwhile was wiped and lost (found by the 50-message run). Two friends-list refreshes could interleave and list everyone twice (found by the three-peer run). A forged RESET made both sides drop a good session; RESET now only retires it for sending (T8, found by L4).
- **Left for Phase 5:** two real machines over the public DHT (manual), and macOS and Windows runs in CI. The resend timing (Q15) and the display order under reordering (Q16) are open.

- [Wire protocol v2](/design/wire-protocol-v2.md): framing, envelopes, the inner schema, and padding.
- Hyperswarm: one long-lived swarm, `topic = SHA-512("hexhoot/v2/topic" ‖ fp)[0..32]`, and connection reuse keyed by fingerprint. Fix T5.
- LAN: carrier only, no channel disclosure. Fix T2–T4.
- UI: the new Login (name and password of 16 characters or more, with progress during the scrypt run), the occasional non-blocking password check (ADR-004), Add friend by `hh21…` address, pending requests, and safety-number verification.

- Build the L4 evil peer, and run the full L3 scenario table across alice, bob, and carol on the hyperdht testnet. (Karma was removed in Phase 2.)

**Exit:** the L3 and L4 suites are green on Linux per push and on macOS and Windows nightly, covering DHT only, LAN only, and both, with fault injection. Two real machines chat over the public DHT as a manual check. All findings F1–F9 and T1–T5 are closed, each with a regression test.

# Phase 5: Release 2.0.0

**UI revamp ("The Hive"), decided 2026-11-27** ([design](/design/ui-hive.md)), built in four commits: Core additions; the UI foundation and the hive; the screens; strings and tests. **UI commit 1 done (2026-11-27):** withdraw, remove, block, don't send, how friends were last heard from, and events in conversations, with L2 tests. **UI commit 2 done (2026-11-27):** the whole interface in the new design, so that every commit leaves a working app and green tests: tokens (night, day, follow the computer), bundled fonts, the shell and navigation, the hive, Home, the chain, requests, the contact panel, Add a friend, Settings, the welcome screen, the password check card, notifications, the offline banner and the narrow layout, with strings in all five languages and the E2E suite rewritten for it. **UI commit 3 done (2026-11-27):** long messages folded, emoji-only messages shown large, links that ask before opening, the 64 KB counter, "N new ↓", the list view for big hives, and the banner after Core restarts (back to the same place, draft kept). **UI commit 4 done (2026-11-27):** the accessibility pass: contrast measured on every screen in both themes by an E2E audit, with the failures fixed (field borders, the composer placeholder, a small label), messages read as one sentence, focus kept on redraws and shown on the composer, named dialogs, and tests that every text key exists and keeps its placeholders. Still open: a review of the ml, de, fr and it strings by native speakers, and a listen with VoiceOver.

**Commit 1 done (2026-11-27):** resends back off from 3 s to 60 s and go out at once when a carrier sees a peer appear (Q15). Received messages keep arrival order (Q16). The v1 export screen is dropped, because v1 has no users ([ADR-001](/decisions/adr-001-no-backward-compatibility.md)).

- ~~Migration screen~~: dropped 2026-11-27, because v1 has no users ([ADR-001](/decisions/adr-001-no-backward-compatibility.md)).
- Update the README (the account model and the reworded "zero-knowledge" claim) and add a `SECURITY.md`. **Done 2026-11-27**, together with the [external review package](/plan/external-review.md).
- L5: run the packaged-build smoke tests on every OS. **Done 2026-11-27:** `npm run test:packaged`, run on release tags by `.github/workflows/packaged.yml`; passes on macOS (arm64) locally. Since folded into `.github/workflows/release.yml` (below).
- Builds for every OS, published as a GitHub Release. **Workflow written 2026-11-27** (`.github/workflows/release.yml`, modelled on Konjugate's): a `v*` tag builds on native runners (macOS arm64 and x64, Windows x64, Linux x64 and arm64 on Ubuntu 22.04), installs and uninstalls the Windows build silently and checks its Start menu shortcut, runs the L5 smoke tests on each build, and publishes the DMGs, the Windows setup, and the .deb and .rpm packages with install notes for unsigned builds. A manual run builds and tests only. The installers are not code-signed yet. Building it found that the app never handled Squirrel's install events, so Windows installs made no shortcut; fixed in `modules/Main/index.js`.
- **External cryptographic review** of the handshake, ratchet, keyring, and wire protocol, against the frozen spec. This is required: HexHoot owns its protocol ([ADR-002](/decisions/adr-002-builtin-crypto-only.md)), so a 2.0.0 release waits on the review.
- Version set to 2.0.0 in `package.json` (2026-11-27), so builds carry it. Tagging `v2.0.0` publishes the release; that waits on the review above.
