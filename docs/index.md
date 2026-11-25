---
okf_version: "0.2"
---

# HexHoot knowledge bundle

This folder is an [Open Knowledge Format v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) bundle. Every `.md` file except `index.md` and `log.md` is a concept with YAML frontmatter. Links that start with `/` are relative to this `docs/` folder.

# Start here

* [Upgrade roadmap](/plan/roadmap.md) - Phased plan for HexHoot 2.0: hardening, toolchain upgrade, post-quantum crypto, ratcheting, and keyring.
* [Open questions](/plan/open-questions.md) - Decisions the maintainer still has to make before or during implementation.

# Sections

* [Assessment](assessment/) - How HexHoot works today, what is wrong with its cryptography, and what `npm audit` reports.
* [Design](design/) - Target design for identity, sessions, ratcheting, the keyring, and the v2 wire protocol.
* [Decisions](decisions/) - Architecture decision records (ADRs).
* [Plan](plan/) - Roadmap, dependency upgrade matrix, and open questions.
