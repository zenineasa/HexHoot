---
type: Architecture Decision Record
title: "ADR-004: Account model"
description: Replace the username and password brain wallet with a random identity, a 24-word recovery phrase, and an unlock backed by the OS keyring.
tags: [adr, identity, login, keyring]
status: draft
decision_status: Proposed
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T12:00:00Z }
---

# Context

v1 derives the identity from `SHA-256(username, password)` with a global salt. The public key is public, so every account can be guessed offline (F2). The README calls this "Zero-Knowledge-Proof based authentication". The property users actually rely on is "the same credentials give the same identity on any device, with no server".

# Options

| Option | Same identity on any device | Resistant to offline guessing | UX |
|---|---|---|---|
| A. Keep username and password, but use Argon2id (slow) | Yes | **No.** Slower, but still guessable per user, since the public key is still public. | Unchanged |
| B. **Random 256-bit identity + 24-word recovery phrase** (recommended) | Yes, with the phrase | **Yes** (2²⁵⁶) | Users must save the phrase |
| C. Random identity, encrypted backup file only | Only with the backup file | Yes | Users must keep the file |

# Decision (proposed)

**Option B**, with C (an encrypted backup that also holds contacts and messages) offered alongside. The day-to-day unlock goes through the [keyring](/design/keyring.md). An optional local passphrase protects the vault on a shared machine.

# Consequences

- The Login screen becomes Create account / Restore from phrase / Restore from backup.
- The README's "zero-knowledge-proof authentication" claim needs rewording. Authentication now means proving that you hold the identity key, which every handshake does.
- **Needs the maintainer's confirmation.** This changes the product's main promise ([open questions](/plan/open-questions.md), Q1).
