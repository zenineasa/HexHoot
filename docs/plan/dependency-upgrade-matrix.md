---
type: Plan
title: Dependency upgrade matrix
description: Target version, or replacement, for every HexHoot dependency, and what the move involves.
tags: [plan, dependencies]
status: draft
stale_after: 2027-01-25T00:00:00Z
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T12:00:00Z }
sources:
  - { id: audit, resource: /assessment/dependency-audit.md, title: npm audit 2026-11-25 }
---

The latest versions were taken from the npm registry on 2026-11-25. "Phase" refers to the [roadmap](/plan/roadmap.md).

# Runtime dependencies

| Package | From | To | Phase | Notes |
|---|---|---|---|---|
| `hyperswarm` | ^4.7.14 | ^4.17.2 | 1 | Minor-version upgrade. Re-test `join`/`flush` behaviour. |
| `electron-squirrel-startup` | ^1.0.0 | ^1.0.1 | 1 | |
| `indexeddb-export-import` | ^2.1.5 | ^2.2.0, then **removed** | 1 → 3 | Replaced by the `.hexhoot2` encrypted backup |
| `ping` | ^0.4.4 | ^1.0.0 | 1 | Major version. Needs Node ≥ 22. Check `promise.probe` options. |
| `ip` | ^2.0.1 | **remove** | 1 | No fixed release. Use `os.networkInterfaces()`. |
| `ecdh` | ^0.2.0 | **remove** | 3 | Replaced by libsignal and noble |
| `require-text` | ^0.0.1 | **remove** | 1–2 | `fs.readFileSync(path.join(__dirname, f), 'utf8')` |
| `arptable-js`, `ipv4-range` | 0.0.x | keep / inline | 4 | Unmaintained and tiny. Inline during the LAN rewrite. |
| `@signalapp/libsignal-client` | — | **0.108.7 exact pin** | 2–3 | AGPL-3.0-only. Native module. |
| `@noble/post-quantum` | — | ^0.7.1 | 3 | ML-DSA-65 (and the X-Wing fallback) |
| `@noble/curves`, `@noble/hashes`, `@noble/ciphers` | — | ^2.4.0 | 3 | HKDF, BLAKE2b, Argon2id, XChaCha20-Poly1305 |
| `copyright-regex` | ^1.1.6 | move to devDependencies | 1 | Only the tests use it |

# Dev and build dependencies

| Package | From | To | Phase | Notes |
|---|---|---|---|---|
| `electron` | ^30.0.1 | ^45.5.0 | 1 | Fixes the high-severity advisories. Review the breaking changes for 31 through 45. |
| `@electron-forge/cli` and makers | ^7.4.0 | ^8.0.1 | 1 | Fixes the critical `tar` advisory and others. Needs Node ≥ 22.13. It should also remove the git-URL `@electron/node-gyp` dependency that npm 12 refuses by default (check). |
| `@electron-forge/plugin-fuses` + `@electron/fuses` | — | ^8 / ^2.1.3 | 1 | Hardening |
| `appdmg` (optional) | ^0.6.6 | **remove** | 1 | `maker-dmg` covers it. Port the custom icon steps into the Forge config. |
| `eslint` | ^9.1.1 | ^10.15.0 | 1 | |
| `eslint-config-google` | ^0.14.0 | replace if incompatible | 1 | Unmaintained. Copy its rule values into `eslint.config.js`. |
| `glob` | ^10.3.12 | ^14.0.6 | 1 | Fixes the `minimatch` advisory |
| `qunit` | ^2.20.1 | ^3.0.0 | 1 | Major version. Check `karma-qunit` 4.2.3 compatibility. |
| `karma`, `karma-electron`, `karma-qunit`, `qunit` | — | **remove** | 1 → 4 | Replaced by `node:test` and the multi-instance harness ([testing infrastructure](/design/testing-infrastructure.md)) |
| `hyperdht` (dev) | — | latest | 1 | `createTestnet` gives tests a local DHT bootstrap |
| `copyright-header` | ^0.4.6 | keep | — | Dev-only and stale |

# Platform

- Node engines floor: **22.13**. CI matrix: 22.x and 24.x on Ubuntu, macOS, and Windows.
- `actions/checkout@v3` and `actions/setup-node@v3` → current major versions.
- Commit `package-lock.json`.
