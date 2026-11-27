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
| `indexeddb-export-import` | ^2.1.5 | ^2.2.0, then **removed** | 1 → 2 | Removed 2026-11-26: Core exports the same JSON from `node:sqlite`. Phase 3 replaces it with the `.hexhoot2` encrypted backup |
| `ping` | ^0.4.4 | ^1.0.0 | 1 | Major version. Needs Node ≥ 22. Check `promise.probe` options. |
| `ip` | ^2.0.1 | **remove** | 1 | No fixed release. Use `os.networkInterfaces()`. |
| `ecdh` | ^0.2.0 | **remove** | 3 | Replaced by Electron's built-in `crypto` ([ADR-002](/decisions/adr-002-builtin-crypto-only.md)) |
| `require-text` | ^0.0.1 | **remove** | 1–2 | `fs.readFileSync(path.join(__dirname, f), 'utf8')` |
| `arptable-js`, `ipv4-range` | 0.0.x | keep / inline | 4 | Unmaintained and tiny. Inline during the LAN rewrite. |
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
| `karma`, `karma-electron`, `karma-qunit`, `qunit` | — | **removed 2026-11-26** | 2 | Replaced by `node:test` and the multi-instance harness ([testing infrastructure](/design/testing-infrastructure.md)) |
| `@noble/post-quantum` (dev) | — | ^0.7.1 | 3 | **Test oracle only, never shipped.** Cross-checks ML-KEM and ML-DSA. |
| `hyperdht` (dev) | — | ^6.37.0 (added 2026-11-26) | 2 | `createTestnet` gives tests a local DHT bootstrap |
| `copyright-header` | ^0.4.6 | keep | — | Dev-only and stale |

No third-party crypto library is shipped at runtime. Every primitive comes from Electron's `crypto` and `safeStorage` ([capability probe](/assessment/electron-crypto-capabilities.md)).

# Platform

- Node engines floor: **22.13**. CI runs one Node version, the newest LTS (`lts/*`), on Ubuntu, macOS, and Windows (changed 2026-11-27; before, 22.x and 24.x). The app itself runs on Electron's own Node.
- `actions/checkout@v3` and `actions/setup-node@v3` → current major versions.
- Commit `package-lock.json`.
