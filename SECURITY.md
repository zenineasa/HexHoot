# Security policy

## Status

HexHoot 2.0 uses its own protocol, built from Electron's built-in cryptography. The protocol and its implementation **have not yet been reviewed by an independent cryptographer**. Version 2.0.0 will be released only after that review. Until then, please treat HexHoot as experimental.

## Supported versions

| Version | Supported |
|---|---|
| 2.x (in development) | Yes |
| 1.x | No. Version 1 has serious known flaws (see the [assessment](docs/assessment/crypto-findings.md)) and will not be fixed. Please don't use it. |

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Please don't open a public issue for a security problem.

A helpful report includes:

- the version or commit you tested,
- what an attacker needs (for example: someone on the same network, someone who knows your address, someone with your computer),
- steps to reproduce, or a test. The end-to-end harness in `test/e2e` can run several copies of the app and a misbehaving peer (`test/peers/evilPeer.js`), which is often the quickest way to show a problem.

You can expect an acknowledgement within a week. HexHoot is maintained by one person, so fixes may take longer; we will keep you updated and credit you in the release notes unless you prefer otherwise.

## What HexHoot protects

- **Message content**, end to end, against anyone on the network, including a future attacker with a quantum computer. Every key exchange combines P-521 with ML-KEM-1024, so it holds if either holds.
- **Past messages after a compromise** (forward secrecy), and **future messages once the attacker loses access** (post-compromise security), through the ratchet.
- **Who is talking to whom, on the wire,** for the most part. Envelopes carry no names, addresses or keys. Messages carry random-looking session tags. The first message of a handshake is addressed to the recipient's rendezvous topic, which anyone who already knows the recipient's address can compute.
- **Data on your computer** while it is at rest: the database is encrypted under a key that the operating system's keychain protects.
- **Your profile from strangers.** Nothing about you is sent to someone until you accept their friend request, and what a peer sends is shown as plain text, never as markup.

## What HexHoot does not protect against

These are known and accepted for 2.0. The [findings](docs/assessment/crypto-findings.md) and [open questions](docs/plan/open-questions.md) explain each one.

- **A weak or guessable password.** Your identity is derived from your name and password, so anyone who knows your name can try guesses offline. Each guess costs about 1 GiB of memory and several seconds, and a password of 16 characters or more is out of reach of brute force, but a well-known phrase (a quote, a lyric) can still be guessed. Choose something only you would think of. ([ADR-004](docs/decisions/adr-004-account-model.md))
- **A forgotten password.** There is no server and no recovery.
- **Someone who controls your computer** while HexHoot is unlocked, or malware running as you. The keychain protects data at rest, not a running session.
- **Online presence and IP addresses.** Someone who knows your address can find your computer on the DHT while you are online, and learn its IP address. On the local network, other HexHoot instances can see that you run HexHoot.
- **Blocking and slowing down delivery.** Anyone who can see or interfere with your traffic can drop it. Someone who sees one of your encrypted envelopes can also make your app redo a handshake (finding T8); this costs about 30 KB of traffic and loses no messages.
- **Deniability.** The handshake is signed, so a contact could prove to others that you talked to them ([Q12](docs/plan/open-questions.md)).
- **Using one account on two computers at once.** Signing in elsewhere moves your account rather than copying it ([Q7](docs/plan/open-questions.md)).

## For reviewers

The [external review package](docs/plan/external-review.md) lists the specifications, the code that implements them, the tests, and the questions we would most like answered.
