---
type: Design
title: Testing infrastructure
description: Five test layers for HexHoot 2.0, centred on a multi-instance harness, modelled on Konjugate's interaction runner, that launches several HexHoot apps that message each other over a private DHT testnet and the LAN carrier.
tags: [design, testing, e2e, multi-instance, ci]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-26T12:00:00Z }
sources:
  - { id: konjugate, resource: "file:/Users/mac/Desktop/konjugate (commit c2667b4)", title: "Konjugate interaction-test runner: scripts/runInteractionTests.mjs, tests/interactionRunner.mjs, tests/drivers/electronWindowDriver.mjs, scripts/interactionRetry.mjs, scripts/interactionArtifacts.mjs" }
  - { id: hyperdht, resource: "https://github.com/holepunchto/hyperdht", title: "hyperdht (createTestnet for local bootstrap nodes)" }
---

# What exists today

*(Before 2026-11-26.)* Karma + karma-electron + QUnit ran UI checks inside one Electron window. There are no unit tests for crypto or protocol code, and nothing tests two peers talking to each other. So any break in messaging is invisible to CI.

# What exists now (2026-11-26)

| Piece | File | Notes |
|---|---|---|
| Driver | `test/e2e/driver.mjs` | Launches `electron . --interaction-test --use-mock-keychain --user-data-dir=<mkdtemp>` and drives the window over CDP: `evaluate`, `waitFor`, `click`, `type`, `core(method, ...)`, `screenshot`, `resize(width, height)` (device metrics, for the narrow layout), `killCore()` (kills this profile's Core process, as a crash would; macOS and Linux), `saveArtifacts`. Page errors and dialogs are recorded. |
| Orchestrator | `test/e2e/orchestrator.mjs` | `useNetwork({transport, peers, env, evil})` starts a 3-node hyperdht testnet in the test process (for `dht`) or picks free ports (for `lan`). It then launches one app per peer and adds UI-level actions for the Hive UI: `login`, `ready`, `waitForTransports`, `addFriend` (the dialog), `waitForKnock` (the knocking cell's name and images), `acceptFriendRequest` (let in), `waitForFriend`, `openChat`, `send`, `messages`, `waitForMessage`, `openContact`, `verify`, `press(key, modifiers)`, and `restart(whileDown)`, which closes the app, runs `whileDown`, and starts it again on the same profile and port. The handle object stays the same. `env` goes to every app (for example `HEXHOOT_TEST_FAULTS`). `evil` names headless adversarial peers. `befriend(a, b)` runs the whole friend flow through the UI. A failing test writes artifacts. |
| Test hooks | `modules/Main/testHooks.js` | `HEXHOOT_TRANSPORTS`, `HEXHOOT_DHT_BOOTSTRAP`, `HEXHOOT_LAN_PORT`, `HEXHOOT_LAN_PEERS`, `HEXHOOT_TEST_SCRYPT_N`, a cheap scrypt (the driver sets 16384) so that logging in takes milliseconds, `HEXHOOT_TEST_CLOCK_OFFSET_DAYS`, which runs Core's clock ahead so that a restart finds a password check due, and `HEXHOOT_TEST_FAULTS` (`drop:0.1,dup:0.05,reorder:0.1,delay:0-200`), which wraps every carrier in `modules/Protocol/faults.js` so that what it sends is dropped, duplicated, delayed or reordered. `HEXHOOT_TEST_RETRY_MS` caps Messenger's resend backoff (3 s to 60 s by default), so lossy runs finish in seconds ([Q15](/plan/open-questions.md)). These are inert in packaged builds and without `--interaction-test`; a packaged smoke run logged in at the real cost. |
| Readiness | Core `getTransportStatus()` | Returns `{name, ready, peers}` per transport and no key material. Tests wait until the DHT announce has completed, or until each LAN carrier knows every other peer. |
| Runner | `scripts/run-e2e.mjs` (`npm run test:e2e`) | Runs each `*.e2e.mjs` file separately. A failing file is run once more and reported as **flaky** if it then passes. Writes `results.json` and a GitHub step summary. `HEXHOOT_TEST_ONLY=friends,ui` filters by file name. |
| Artifacts | `test-results/e2e/<transport>-<peers>-<test>/` | `orchestrator.log`, plus `<peer>.log` (main and Core output), `<peer>.json` (page errors, dialogs) and `<peer>.png` for each peer. CI uploads the folder. Override with `HEXHOOT_E2E_ARTIFACTS`. |
| L3 tests | `test/e2e/friends-chat.e2e.mjs` | alice and bob over `dht`, then over `lan`: sign up, friend request, accept, profiles shown on both sides, chat both ways, no page errors. About 4 s per transport. Also mallory, whose display name is an XSS payload, sends bob a friend request: it is plain text in the request, the friends list, the chat header and the profile, and both sides show the same safety number (S1). |
| L3 tests | `test/e2e/chat.e2e.mjs` | 50 messages each way, interleaved, typed into the UI, over `dht`, over a faulty `lan`, and over both at once. Every message is shown and stored exactly once and is marked delivered. Without faults, each side's messages appear in the order they were sent. |
| L3 tests | `test/e2e/resilience.e2e.mjs` | bob closes, alice sends four messages that wait in her outbox, and bob gets them in order as soon as he is back (his LAN hello triggers the resend). alice's receipts follow. The "verified" mark survives the restart. Then both restart and keep chatting. |
| L3 tests | `test/e2e/group.e2e.mjs` | alice, bob and carol over `lan` and `dht`. Three friend requests and three conversations run at the same time, with no cross-talk in Core or on screen. |
| L4 peer | `test/peers/evilPeer.js` | A headless Core on the LAN carrier, run under Electron's Node as a child of the orchestrator and driven over IPC. It can send any message type and body through a real session, replay or tamper with any envelope it sent, post raw bytes as frames, and make plain HTTP requests. |
| L4 tests | `test/e2e/evil.e2e.mjs` | With alice's UI open: T2 (the LAN port says only `{application, protocol}`), S1 (a hostile name, about and photo stay inert), S3 (a stranger's chat is dropped, with no automatic reply), S2 (a spoofed profile changes only its sender's name, never its key, status or verified mark), malformed bodies and unknown types, replays and bit flips of HS1 and MSG envelopes, and malformed and oversized frames (413). Afterwards alice still chats, and there are no page errors. |
| L5 tests | `test/packaged/smoke.test.mjs` | See the L5 row in *Five test layers*. The driver's `launchApp({executable})` runs a packaged binary instead of the sources. Logging in took 122 s on an 8 GiB Mac under memory pressure and about 5 s with memory free, so the test allows 10 minutes. |
| Accessibility audit | `test/e2e/a11y.mjs` | Run in the page on each screen, in both themes, by `ui.e2e.mjs` and `hive.e2e.mjs`: WCAG AA contrast of every visible text, placeholder and icon over its real background (after animations settle), and controls or dialogs without an accessible name. `ui.e2e.mjs` checks that it catches a planted grey-on-grey paragraph and a nameless button. |
| Hive scenarios | `test/e2e/hive.e2e.mjs` | Two apps over `lan`: long, emoji-only and link messages (the link dialog, never opened), the "N new" button, the length counter, "Don't send" while the friend is away, unread marks on the cell and in Latest, Core killed and restarted (banner, same chat, draft kept, sending works, no errors), and blocking then unblocking. |
| Single-app tests | `test/e2e/ui.e2e.mjs` | Lockdown; bundled fonts and no remote stylesheet; password rules as you type and Core's reason shown inline; the hive and Home; Add a friend (own address, typo caught by the checksum, knocking selects the waiting cell, withdraw); the keyboard model (Ctrl+K, Ctrl+N, Ctrl+, and Esc); S4; appearance; About; language; the narrow layout; a restart that signs in through the (mock) OS keychain; the password check card, including Settings → Check now; the list view. Uses `launchApp({userData})`. |

The design below differs from what was built in two ways. The control channel is CDP rather than a JSON-lines channel, because the page already exposes everything the tests need. Each peer's profile is set with Chromium's `--user-data-dir` rather than `HEXHOOT_TEST_USER_DATA`. The memory watchdog and the `basic_text` keyring scenario at L3 (it is covered at L2) are still to do.

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
| L2 Core integration | `node --test`. Core is imported **without Electron** (dependency-injected `safeStorage`, paths, and transports). | Every push | 2–3 Cores in one process over in-memory or testnet transports: the SIGMA-I handshake, ratchet healing, simultaneous start, out-of-order delivery, restart and persistence, backup restore without ratchet state |
| L3 Multi-instance E2E | Orchestrator + N Electron apps (above) | Every push on Linux (xvfb), nightly on macOS and Windows | Real UI flows across peers |
| L4 Adversarial peer | Headless `tests/peers/evilPeer.mjs` that speaks protocol v2 using Core with no UI | With L3 | Regression tests for findings S1–S3 and T2–T5: XSS display names, spoofed `UserInformation`, a tampered bundle or fingerprint mismatch, replay, oversized or malformed frames, an unknown `v` |
| L5 Packaged smoke | `test/packaged/smoke.test.mjs` against the `out/` build (`npm run package`, then `npm run test:packaged`) | On release tags and by hand (`.github/workflows/packaged.yml`) | The fuses are set; `app.asar` holds no tests, docs or tooling; with every test hook set to an extreme, the app still logs in at the real scrypt cost (the known-answer address proves it), runs both real carriers, and has no password check due; the renderer is locked down; a restart signs in again (or unlocks with the password where the OS keyring is weak); no page errors or CSP violations. It uses the real carriers, so it announces a throwaway test identity on the public DHT and sweeps the local network. |

L1 also includes the **capability guard**: the [Electron crypto probe](/assessment/electron-crypto-capabilities.md) run with `ELECTRON_RUN_AS_NODE=1` against the bundled Electron, so an upgrade that drops ML-KEM-1024, ML-DSA-87, P-521, or SHA-512 fails CI. It also checks that scrypt N=2²⁰ still completes, and that invalid P-521 points are still rejected. Protocol tests cross-check ML-KEM and ML-DSA results against NIST ACVP vectors and `@noble/post-quantum`, which is a dev-only oracle that is never shipped.

L2 exists since 2026-11-26: `test/core/` runs Core with in-memory storage and injected transports. `DhtTransport.announced` resolves once a peer can be found on the DHT. Tests wait for it, because a lookup made earlier finds nobody and Hyperswarm does not retry for minutes. Until Karma is retired, `test/setupCore.js` runs an in-memory Core inside the Karma window, behind the same method allow-list as IPC.

**Core must be importable from plain Node** (the [roadmap's](/plan/roadmap.md) Phase 2) so L2 can run without Electron. **Caveat:** stock Node 24 uses OpenSSL, while Electron uses BoringSSL, and their supported algorithms differ (Node has SHA-3 and Argon2, Electron does not). L1 and L2 must therefore run under Electron's Node (`ELECTRON_RUN_AS_NODE=1 electron --test …`) and not the system `node`. Otherwise a primitive that only works in OpenSSL could slip in.

# First E2E scenarios

| Group | Scenario | Peers |
|---|---|---|
| onboarding | Create an account, then the same name and password give the same address in a fresh `userData`. The password check reports right and wrong without blocking. | alice, alice′ |
| friends | alice adds bob by `hh21…` address. bob sees a pending request (no auto-reply). Accept. Profiles appear on both sides. | alice, bob |
| chat | 50 messages each way, interleaved, then exact order and no duplicates on both sides | alice, bob |
| chat | The same, with `HEXHOOT_TEST_FAULTS` on | alice, bob |
| resilience | Kill bob mid-conversation, alice queues, bob restarts, the queue is delivered, and the session epoch has advanced | alice, bob |
| transports | `dht` only, `lan` only, and `both` (deduplicated by message `id`) | alice, bob |
| group-of-3 | alice↔bob, bob↔carol, carol↔alice running at the same time. No cross-talk between sessions. | alice, bob, carol |
| trust | Safety numbers match on both sides. Marking a contact verified survives a restart. | alice, bob |
| keyring | Linux `basic_text` backend forces a passphrase. A wrong passphrase fails without leaving partial state. | alice |
| security | Every L4 case is shown with the UI open, and the payloads render as inert text | alice, evil |

# Retiring Karma

Done 2026-11-26. The non-UI checks (package name and version, copyright headers, translations: every text in every language, every key the code asks for exists, and each translation keeps the English `{placeholders}`) are in `test/unit/repo.test.js`. The UI checks are in `test/e2e/ui.e2e.mjs`, which launches the app with a temporary profile and `--interaction-test`, and drives it over CDP (`test/e2e/driver.mjs`). Dialogs are accepted and recorded, and any page error fails the run. Code sent through DevTools is exempt from the CSP, so CSP checks run their probes from page timers. The multi-instance orchestrator extends the same driver (see *What exists now*).
