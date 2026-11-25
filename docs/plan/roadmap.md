---
type: Plan
title: HexHoot 2.0 upgrade roadmap
description: Phases for hardening, toolchain upgrade, core-process split, post-quantum crypto with ratcheting and keyring, transport rewrite, and release, with exit criteria for each.
tags: [plan, roadmap, upgrade]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T12:00:00Z }
---

Each phase is a separate PR, or a short series of PRs, and keeps `main` buildable. The phases are ordered so that the most urgent risk is fixed first and the crypto work lands on a current toolchain.

# Phase 0: Emergency hardening (ship as 1.0.6)

The current users are exposed to S1–S3 (see [findings](/assessment/crypto-findings.md)), so this phase is patched into v1 before the rewrite.

- Render all peer-controlled text with `textContent` or an `escapeHTML()` helper, including names, about text, and photo URLs (allow only `data:image/(png|jpeg|webp);base64`).
- In `messageReceivedCallback`, require `senderInfo.key === messageObj.senderPublicKey` before `updateFriendInformation`. Ignore `UserInformation` from unknown contacts.
- Stop auto-replying to `FriendRequest`. Show it as a pending request.
- Wrap all `JSON.parse` calls in the network path with `try`/`catch`.
- Add a strict Content-Security-Policy `<meta>` to `modules/Main/index.html`.

**Exit:** a crafted `displayName` payload renders as text, a spoofed `UserInformation` is ignored, and the existing tests pass.

# Phase 1: Toolchain and dependencies

Follow the [dependency upgrade matrix](/plan/dependency-upgrade-matrix.md).

- Electron 30 → 45 and Forge 7 → 8. Raise the Node floor to 22.13 (CI matrix: 22.x, 24.x). Update `actions/*` to the current major versions.
- Remove `ip` (it has no fix), `ecdh` (the crypto is replaced in Phase 3), and `require-text` (replace with a `fs.readFileSync` helper).
- Remove the `appdmg` makefile flow and rely on `@electron-forge/maker-dmg`.
- Add `@electron-forge/plugin-fuses`: enable ASAR integrity and `OnlyLoadAppFromAsar`, and disable `RunAsNode` and `EnableNodeCliInspectArguments`.
- **Commit `package-lock.json`** (remove it from `.gitignore`) and add `npm audit --omit=dev --audit-level=high` to CI.
- ESLint 10. Replace `eslint-config-google` if it is incompatible, keeping the same rule values.
- **Testing skeleton** ([testing infrastructure](/design/testing-infrastructure.md)): `node --test` for L1, the orchestrator plus `testHooks.js` with `--use-mock-keychain`, per-peer `userData`, artifacts, and retry-once. The first L3 scenario runs two v1 peers chatting over the LAN carrier, as a baseline before the rewrite.

**Exit:** `npm audit --omit=dev` reports zero high or critical vulnerabilities, the app runs and packages on all three operating systems, and CI is green.

# Phase 2: Core-process split and crypto spike

- Turn on `contextIsolation: true` and `nodeIntegration: false`. Add `preload.js` with a narrow `contextBridge` API (`window.hexhoot.*`).
- Move DBMessenger, the transports, and storage into a **Core** (the main process or an Electron `utilityProcess`). Core must be **importable from plain Node**, with `safeStorage`, paths, and transports injected, so L2 tests can run it without Electron. The renderer becomes UI only. Replace the `eval` template rendering with plain template functions.
- Add the **capability guard test** (L1), which runs the [capability probe](/assessment/electron-crypto-capabilities.md) under the bundled Electron on all three OS. It has already passed on macOS arm64. Windows and Linux are still to be confirmed.

**Exit:** the UI works unchanged on top of IPC, and the capability guard is green on all OS.

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

- Build the L4 evil peer, and run the full L3 scenario table across alice, bob, and carol on the hyperdht testnet. Remove Karma.

**Exit:** the L3 and L4 suites are green on Linux per push and on macOS and Windows nightly, covering DHT only, LAN only, and both, with fault injection. Two real machines chat over the public DHT as a manual check. All findings F1–F9 and T1–T5 are closed, each with a regression test.

# Phase 5: Release 2.0.0

- Migration screen: export v1 chat history as plaintext JSON, then wipe the v1 data ([ADR-001](/decisions/adr-001-no-backward-compatibility.md)).
- Update the README (the account model and the reworded "zero-knowledge" claim) and add a `SECURITY.md`.
- L5: run the packaged-build smoke tests on every OS.
- **External cryptographic review** of the handshake, ratchet, keyring, and wire protocol, against the frozen spec. This is required: HexHoot owns its protocol ([ADR-002](/decisions/adr-002-builtin-crypto-only.md)), so a 2.0.0 release waits on the review.
