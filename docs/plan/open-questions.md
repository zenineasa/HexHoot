---
type: Open Questions
title: Open questions for the maintainer
description: Decisions that shape HexHoot 2.0 and need the maintainer's call, each with a recommendation.
tags: [plan, decisions]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T12:00:00Z }
---

| # | Question | Recommendation |
|---|---|---|
| Q1 | Replace username and password login with a random identity plus a recovery phrase? ([ADR-004](/decisions/adr-004-account-model.md)) | **Yes.** The current model cannot resist offline guessing, whatever the KDF. |
| Q2 | ~~Use libsignal or build our own?~~ | **Resolved 2026-11-25:** built-in Electron crypto only ([ADR-002](/decisions/adr-002-builtin-crypto-only.md)) |
| Q3 | Ship Phase 0 as a 1.0.6 patch to current users before the 2.0 work? | **Yes.** S1 is remote code execution from any peer. |
| Q4 | Core in the main process or in an Electron `utilityProcess`? | `utilityProcess`. It isolates crashes and keeps the main process small. `safeStorage` calls stay in main and pass the vault key once at unlock. |
| Q5 | Replace Karma (deprecated) now or later? | During 2.0. New tests go in `node:test`, and UI checks move to the multi-instance harness ([testing infrastructure](/design/testing-infrastructure.md)). Remove Karma once nothing depends on it. |
| Q11 | Run L3 multi-instance E2E on every push for all OS, or Linux per push and macOS/Windows nightly? | Linux per push, macOS and Windows nightly and on release tags, to keep CI minutes down |
| Q6 | Storage in Core: keep IndexedDB (through a hidden window) or move to SQLite (`better-sqlite3`, `node:sqlite`)? | `node:sqlite` if Electron 45's Node has it stable. Otherwise encrypted JSON files per contact. |
| Q7 | Multi-device (the same identity on two machines at once)? | Out of scope for 2.0. The recovery phrase *moves* an identity rather than cloning it. |
| Q8 | Store-and-forward when the recipient is offline (no server)? | Out of scope for 2.0. Queue locally and send on reconnect. Consider holding encrypted messages at mutual friends later. |
| Q12 | Deniability: the SIGMA-I handshake signs the transcript, which proves to third parties that two identities talked. Is that acceptable? | Acceptable for 2.0. A deniable alternative uses KEM-based authentication (each side encapsulates to the other's static ML-KEM identity key), which needs a long-term ML-KEM identity key. Revisit after the review. |
| Q13 | P-521 + ML-KEM-1024 in *every* ratchet turn adds about 3.3 KB per turn. Keep it, or rekey every N turns or T minutes (as PQ3 does)? | Every turn for 2.0. It is simplest and heals fastest. Measure on large group chats later. |
| Q14 | scrypt at N=2²⁰ needs 1 GiB of RAM and about 8 s on Apple Silicon (likely 15–30 s on older machines). It only runs for the passphrase unlocker and for backups. Keep it for every machine, or allow N=2¹⁹ on machines with less than 4 GiB of RAM? | Keep 2²⁰ everywhere, as decided. Show progress, run it asynchronously, and refuse to start (with a clear message) when free memory is below about 1.5 GiB, rather than silently weakening it. |
| Q9 | Rotating rendezvous topics to reduce online-presence leaks? | Later. Do this after 2.0, using a daily topic derived from the shared session secret for existing contacts. |
| Q10 | Use protomux / compact-encoding (Holepunch native) or a hand-rolled length prefix? | protomux on Hyperswarm and a length prefix on the LAN carrier |
