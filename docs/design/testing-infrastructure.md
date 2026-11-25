---
type: Design
title: Testing infrastructure
description: Five test layers for HexHoot 2.0, centred on a multi-instance harness, modelled on Konjugate's interaction runner, that launches several HexHoot apps that message each other over a private DHT testnet and the LAN carrier.
tags: [design, testing, e2e, multi-instance, ci]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T12:30:00Z }
sources:
  - { id: konjugate, resource: "file:/Users/mac/Desktop/konjugate (commit c2667b4)", title: "Konjugate interaction-test runner: scripts/runInteractionTests.mjs, tests/interactionRunner.mjs, tests/drivers/electronWindowDriver.mjs, scripts/interactionRetry.mjs, scripts/interactionArtifacts.mjs" }
  - { id: hyperdht, resource: "https://github.com/holepunchto/hyperdht", title: "hyperdht (createTestnet for local bootstrap nodes)" }
---

# What exists today

Karma + karma-electron + QUnit run UI checks inside one Electron window. There are no unit tests for crypto or protocol code, and nothing tests two peers talking to each other. So any break in messaging is invisible to CI.

# Ideas taken from Konjugate

| Konjugate | HexHoot use |
|---|---|
| `scripts/runInteractionTests.mjs` spawns `electron . --interaction-test` with `userData` from `KONJUGATE_INTERACTION_USER_DATA` (a fresh `mkdtemp`) | The same, but **once per peer**: `HEXHOOT_TEST_USER_DATA` and `HEXHOOT_TEST_AGENT=alice`, each in its own temp directory |
| `--use-mock-keychain` so `safeStorage` never opens a Keychain prompt | Required, because the [keyring](/design/keyring.md) uses `safeStorage`. A separate scenario covers the passphrase fallback (Linux `basic_text`). |
| A driver "handle" (`evaluate`, `click`, `keyDown`, `title`, `close`…) over `webContents.executeJavaScript` / `sendInputEvent` | The same handle contract, with an added `peer` name. Scenarios address `alice.ui`, `bob.ui`, and so on. |
| Scenarios check ids, `data-*` attributes, and state, not wording | The same rule. Add `data-testid` and `data-state` to the Chat, AddFriend, and Login markup. |
| `interactionResults.json`, plus logs and failure screenshots under `…_ARTIFACTS` and a GitHub step summary | The same, with one log per peer (`alice.log`, `bob.log`) and an orchestrator log. CI uploads the folder. |
| `interactionRetry.mjs` re-runs failures once, reporting *flaky* instead of hiding them, with scenario groups | Re-used as is. Network scenarios are timing-sensitive, so this matters more here. |
| Memory watchdog over the app's process tree | Applied to every peer's process tree. A ratchet-state leak shows up as growth. |
| `KONJUGATE_INTERACTION_ONLY` filter | `HEXHOOT_TEST_ONLY` |

# The key difference: an orchestrator outside the apps

In Konjugate, the scenario runner lives *inside* the single app's main process. HexHoot needs several apps, so the runner moves to a **Node orchestrator** that controls each app over a control channel:

```
                 ┌──────────────────────────── orchestrator (node --test tests/e2e/*.e2e.mjs) ───────────────┐
                 │  testnet = await createTestnet(3)        // local hyperdht bootstrap, no public DHT       │
                 │  alice = await launchPeer('alice'); bob = await launchPeer('bob'); carol = …              │
                 │  scenario: alice.addFriend(bob.address) → bob.accept() → alice.send('hi') → bob.sees('hi')│
                 └───────┬───────────────────────────────┬───────────────────────────────┬──────────────────┘
          control (JSON lines over stdio / local socket) │                               │
         ┌───────────────▼──────────┐    ┌───────────────▼──────────┐    ┌───────────────▼──────────┐
         │ electron . --interaction-│    │ … HEXHOOT_TEST_AGENT=bob │    │ … carol (or "evil peer") │
         │ test  agent=alice        │    │ userData=/tmp/hh-bob-*   │    │                          │
         │ userData=/tmp/hh-alice-* │    └──────────────────────────┘    └──────────────────────────┘
         └──────────────────────────┘
                 ◀──────── Hyperswarm over the local testnet ────────▶ ◀────── LAN carrier on 127.0.0.1 ──────▶
```

## Test hooks in the app (only active with `--interaction-test`)

| Hook | Purpose |
|---|---|
| `HEXHOOT_TEST_USER_DATA` | `app.setPath('userData', …)` before anything opens storage, as in Konjugate's `src/main.mjs` |
| `HEXHOOT_DHT_BOOTSTRAP` | Hyperswarm bootstrap nodes. Points at the testnet so CI never touches the public DHT. |
| `HEXHOOT_TRANSPORTS=dht\|lan\|both` | Tests each transport on its own and together |
| `HEXHOOT_LAN_PEERS=127.0.0.1:43946,…` | A static LAN peer list instead of the ping/ARP sweep. All peers share one host, each on its own port. |
| `HEXHOOT_TEST_FAULTS=drop:0.1,dup:0.05,reorder:0.1,delay:0-500` | Fault injection in the framing layer, to test the ratchet against loss, duplicates, and reordering |
| Control channel | Commands `evaluate`, `click`, `type`, `screenshot`, `core.getAddress`, `core.state`, `quit`. `core.*` reads Core state such as session epoch and pending queue, but **never key material**. |

The hooks live in a single `modules/Main/testHooks.js` that is only `require`d when the flag is present. Forge fuses in packaged builds plus a build-time check make sure release builds cannot turn them on.

# Five test layers

| Layer | Tool | Runs | What it covers |
|---|---|---|---|
| L1 Unit | `node --test` | Every push, all OS, seconds | Keyring with a fake `safeStorage`, identity derivation vectors, address and checksum, wire codec (fuzzed), ML-DSA bundle checks, record encryption |
| L2 Core integration | `node --test`. Core is imported **without Electron** (dependency-injected `safeStorage`, paths, and transports). | Every push | 2–3 Cores in one process over in-memory or testnet transports: PQXDH, ratchet healing, simultaneous start, out-of-order delivery, restart and persistence, backup restore without ratchet state |
| L3 Multi-instance E2E | Orchestrator + N Electron apps (above) | Every push on Linux (xvfb), nightly on macOS and Windows | Real UI flows across peers |
| L4 Adversarial peer | Headless `tests/peers/evilPeer.mjs` that speaks protocol v2 using Core with no UI | With L3 | Regression tests for findings S1–S3 and T2–T5: XSS display names, spoofed `UserInformation`, a tampered bundle or fingerprint mismatch, replay, oversized or malformed frames, an unknown `v` |
| L5 Packaged smoke | L3 scenarios against `out/` builds (Konjugate: `runPackagedInteractionTests.mjs`) | On release tags | Native libsignal loads in the packaged app, fuses are set, and test hooks are inert |

L2 has one design constraint for the [roadmap's](/plan/roadmap.md) Phase 2: **Core must be importable from plain Node.** `@signalapp/libsignal-client` is a Node-API module, so the same binary should load in Node and in Electron. Confirm this in the Phase 2 spike.

# First E2E scenarios

| Group | Scenario | Peers |
|---|---|---|
| onboarding | Create an account, then the recovery phrase restores the same address in a fresh `userData` | alice, alice′ |
| friends | alice adds bob by `hh2:` address. bob sees a pending request (no auto-reply). Accept. Profiles appear on both sides. | alice, bob |
| chat | 50 messages each way, interleaved, then exact order and no duplicates on both sides | alice, bob |
| chat | The same, with `HEXHOOT_TEST_FAULTS` on | alice, bob |
| resilience | Kill bob mid-conversation, alice queues, bob restarts, the queue is delivered, and the session epoch has advanced | alice, bob |
| transports | `dht` only, `lan` only, and `both` (deduplicated by message `id`) | alice, bob |
| group-of-3 | alice↔bob, bob↔carol, carol↔alice running at the same time. No cross-talk between sessions. | alice, bob, carol |
| trust | Safety numbers match on both sides. Marking a contact verified survives a restart. | alice, bob |
| keyring | Linux `basic_text` backend forces a passphrase. A wrong passphrase fails without leaving partial state. | alice |
| security | Every L4 case is shown with the UI open, and the payloads render as inert text | alice, evil |

# Retiring Karma

Move the existing `test/*/t*.js` checks to L1 (pure logic) or L3 (UI), then delete Karma, karma-electron, karma-qunit, and QUnit. `npm test` becomes `node --test`, and `npm run test:e2e` runs the orchestrator.
