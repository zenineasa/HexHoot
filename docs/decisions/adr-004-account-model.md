---
type: Architecture Decision Record
title: "ADR-004: Account model"
description: Keep name and password as the identity, made far harder to guess with scrypt at N=2^20, a per-name salt and 16-character passwords. The OS keyring keeps users signed in, and occasional optional checks help them remember the password.
tags: [adr, identity, login, keyring, password]
status: stable
decision_status: Accepted
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-26T21:00:00Z }
verified: { by: "human:zenineasa", at: 2026-11-26T21:00:00Z }
---

# Context

v1 derives the identity from a single SHA-256 of the password. Because of S5, the name was never mixed in. The public key is public, so anyone can guess passwords offline, against every user at once (F2). The property users rely on is "the same name and password give the same identity on any device, with no server".

The options considered were:
- **A.** Keep name and password with a slow KDF.
- **B.** A random identity with a 24-word recovery phrase.
- **C.** A random identity with a backup file only.

# Decision

**Name and password (option A), strengthened.** The maintainer decided on 2026-11-26: *"I want name + password. We can't have it randomly generated; just make the users type in longer passwords."*

| Part | Choice |
|---|---|
| Derivation | `entropy = scrypt(NFKC(password), salt, N=2²⁰, r=8, p=1, 32 B)`, then the identity keys as in [identity](/design/identity-and-addresses.md). About 5–8 s and 1 GiB. |
| Salt | `SHA-512(parts("hexhoot/v2/identity-salt", name))`, so every account has to be attacked on its own, with no shared precomputation |
| Name | NFKC, lower case, trimmed, inner spaces collapsed: "Alice Liddell" and " alice  liddell " are the same account. 5–64 characters. |
| Password | At least **16 characters** (characters, not bytes, so any script works). It must not contain the name and must use at least 5 different characters. |
| Day to day | **No login.** The derived secret is kept in the [keyring](/design/keyring.md) and unlocked by the OS keyring. |
| Linux without a secret service | The keyring needs a passphrase there. The plan is to use the account password, so those users type it when the app starts. |
| Remembering it | Occasional, optional password checks (below) |
| Backup | The encrypted `.hexhoot2` file for contacts and messages. The identity itself comes back from the name and password. |

The parameters are fixed forever: changing N, the salt label or the normalization would change every identity.

## Password checks

Users who are never asked for their password forget it, and without a server a forgotten password means a lost account. So HexHoot now and then offers a check:

- **Non-blocking.** It is a small box in the corner, never a modal, and it can be dismissed. Nothing is locked.
- **Feedback.** It says only whether the password was right or wrong, with a friendly message. Nothing about the password is shown.
- **Spacing.** The first check comes 3 days after the account is made. Each right answer pushes the next one further out: 7, 14, 30, 60, then 90 days. A wrong answer brings it back to 1 day, and dismissing it postpones it by 2 days (`credentials.nextPasswordCheck`).
- **How it is checked.** The password goes through the full derivation, so the check takes as long as a login, and the result is compared with the stored secret in constant time (`Identity#checkPassword`). No faster password hash is stored anywhere.

Draft messages for the UI (Phase 4, to be translated):

| Result | Message |
|---|---|
| Right | "That's it! Your password is safe in your memory. We'll check in again in a while." |
| Right, after an earlier miss | "You've got it now! Practice makes it stick." |
| Wrong | "Not quite, and that's okay: you're still signed in and nothing has changed. If you have your password written down somewhere safe, take a look. We'll ask again tomorrow." |
| Dismissed | Nothing is shown. The box comes back in two days. |

# Consequences

- **Guessing is still possible, only much slower.** Anyone with a user's address can test guesses offline. Each guess costs about 1 GiB and several seconds, one account at a time, and a password of 16 characters or more is out of reach of brute force. A predictable password (a famous quote, a song lyric) can still fall to a dictionary attack. F2 is therefore mitigated, not closed, and the security of each account rests on its password.
- **A forgotten password cannot be recovered**, since there is no server. The password checks are the mitigation.
- **Creating an account or logging in on a new machine takes about 5–8 seconds**, and minutes on a machine short of memory. The UI shows progress, and `scryptOutlook()` tells it beforehand when to warn. Machines with less than 2 GiB of RAM are refused ([Q14](/plan/open-questions.md)).
- **The name cannot change without changing the identity.** The display name is a separate, editable profile field.
- The README's "zero-knowledge-proof authentication" wording still needs revisiting. Authentication is proving that you hold the identity key, which every handshake does.
