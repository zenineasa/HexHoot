---
type: Architecture Decision Record
title: "ADR-001: No backward compatibility with v1"
description: HexHoot 2.0 is a clean break, so v1 clients, data, and identities are not supported.
tags: [adr, compatibility]
status: stable
decision_status: Accepted
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T12:00:00Z }
verified: { by: "human:zenineasa", at: 2026-11-25T11:20:00Z }
---

# Context

The maintainer said on 2026-11-25: *"I don't care if it is not backwards compatible; I just need the new versions to be compatible with each other."* Every v1 primitive is being replaced (see [findings](/assessment/crypto-findings.md)).

# Decision

- Ship version **2.0.0**. v2 drops any frame with `v != 2`.
- The IndexedDB `HexhootDB` v1 is not migrated. On first v2 launch, the app offers an *export of v1 chat history as plaintext JSON for the user's own records*, then deletes the v1 database.
- v1 identities are **not** carried over. A v1 key is weak (F1, F2), so keeping it would carry its weakness into v2.
- Contacts have to be re-added with v2 addresses.

# Consequences

- Users have to re-add friends. Release notes must say this clearly.
- There is no dual-stack code. This removes a whole class of downgrade attacks.
