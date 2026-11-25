---
type: Dependency Audit
title: npm audit, 2026-11-25
description: npm audit found 36 vulnerabilities (1 critical, 29 high, 3 moderate, 3 low), mostly from Electron 30 and Electron Forge 7.
tags: [dependencies, npm-audit, security]
status: stable
stale_after: 2027-01-25T00:00:00Z
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T12:00:00Z }
sources:
  - { id: audit, resource: "npm audit (npm 12.0.2, Node 24.19.0)", title: npm audit run against a freshly resolved lockfile }
  - { id: registry, resource: "https://registry.npmjs.org", title: npm registry latest versions on 2026-11-25 }
---

# How it was run

There is no committed lockfile, so one was resolved with `npm install --package-lock-only --ignore-scripts --allow-git=all`. npm 12 refuses git dependencies by default, and Forge 7 pulls `@electron/node-gyp` from a git URL. `npm audit` then ran against that lockfile.

# Summary

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 29 |
| Moderate | 3 |
| Low | 3 |

# Root causes

| Direct dependency | Current | Fix | Notes |
|---|---|---|---|
| `electron` | ^30.0.1 | **45.5.0** (major) | Advisories fixed in later versions include an ASAR integrity bypass, context-isolation bypass, `shell.openPath` null byte, DevTools injection, and vulnerable `extract-zip`. |
| `@electron-forge/*` (cli and five makers) | ^7.4.0 | **8.0.1** (major) | The critical `tar` advisory and high-severity `cacache`, `make-fetch-happen`, `tmp`, `@electron/rebuild`, and `@electron/packager` advisories come in through Forge 7. Forge 8 requires Node ≥ 22.13. |
| `ip` | ^2.0.1 | **none** | SSRF advisory (`isPublic`) with no fixed release. **Remove it** and use `os.networkInterfaces()`. |
| `appdmg` (optional) | ^0.6.6 | npm suggests 0.5.2, a *downgrade* | Pulls in a vulnerable `image-size`. Drop the custom `makefile` DMG flow and use `@electron-forge/maker-dmg`. |
| `glob` (dev) | ^10.3.12 | 14.0.6 | Brings in the `minimatch` ReDoS advisory. |

# Staleness of other direct dependencies

| Package | Current | Latest | Action |
|---|---|---|---|
| `hyperswarm` | ^4.7.14 | 4.17.2 | Upgrade |
| `ping` | ^0.4.4 | 1.0.0 (Node ≥ 22) | Upgrade, check the API |
| `indexeddb-export-import` | ^2.1.5 | 2.2.0 | Upgrade, or replace with the encrypted backup format ([keyring](/design/keyring.md)) |
| `electron-squirrel-startup` | ^1.0.0 | 1.0.1 | Upgrade |
| `eslint` | ^9.1.1 | 10.15.0 | Upgrade. `eslint-config-google` 0.14.0 is unmaintained and needs a check for compatibility with ESLint 10. |
| `qunit` / `karma-qunit` | 2.x / 4.2 | 3.0.0 / 4.2.3 | Upgrade. Karma has been deprecated upstream since 2023, so plan a migration. |
| `ecdh` | ^0.2.0 | 0.2.0 (2022) | **Remove.** It is replaced by the new crypto stack. |
| `require-text` | 0.0.1 (2022) | n/a | Replace with a few lines using `fs.readFileSync` |
| `arptable-js`, `ipv4-range`, `copyright-regex`, `copyright-header` | 2022 | n/a | Unmaintained. Keep for now, or inline them. |

The target versions are in the [dependency upgrade matrix](/plan/dependency-upgrade-matrix.md).
