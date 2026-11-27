---
type: Design
title: The Hive UI - scenarios and navigation
description: The HexHoot 2.0 interface ("The Hive"), with every scenario it must handle, where each is designed, the navigation model between screens, and the Core additions some scenarios need.
tags: [design, ui, ux, navigation, accessibility]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-27T12:00:00Z }
sources:
  - { id: mockup, resource: "https://claude.ai/artifact/8TrbDzVBYx17j4rgwCmsp7", title: "HexHoot 2.0 UI mockup (private design canvas)" }
---

# The concept

The v1 interface, and the first v2 mockup, looked like any other messenger. The maintainer chose a direction built on what is particular to HexHoot (2026-11-27):

- **Contacts are a honeycomb ("your hive")**, shaped like the logo's hexagons. A friend request is a cell glowing amber ("knocking"), a request you sent is a faint "waiting" cell, and the last cell is "+ Add". A short **Latest** list under the hive restores the order by recency that a grid loses.
- **A conversation is a chain.** A spine runs down the middle: their messages on one side, yours on the other, each on a small hexagon that is hollow while it waits for your friend to come online and filled once delivered.
- **The header shows the link**, not just a name: your cell and theirs, joined by a solid line (direct, local network), a dashed one (internet) or a dotted one (unreachable; messages wait).
- **Colours:** "night" (ink-indigo, amber accent, after the owl's eyes) and "day" (warm paper). The logo is the original white outline with its eyes, and the wordmark stays Noto Sans JP bold. Names and headings use Space Grotesk, body text Inter.

The mockup is a private design canvas ([source](https://claude.ai/artifact/8TrbDzVBYx17j4rgwCmsp7)); its "Connected prototype" artboard has every route below working.

# Navigation model

## Wide windows (960 px and more)

| Place | What it is | How you get there | How you leave |
|---|---|---|---|
| **Hive** (left, always visible) | Search, the honeycomb, Latest, your own cell | Always there | — |
| **Home** (right pane) | "You are reachable", your address, add a friend, shortcuts | Start-up; the HexHoot wordmark; Esc from a chat; clicking the selected cell again | Pick a cell |
| **Conversation** (right pane) | Header with the link, the chain, the composer | A cell, a Latest entry, a desktop notification, letting someone in | Esc → Home; another cell |
| **Request** (right pane) | One person knocking: Let in / Not now | A knocking cell | Let in → their (empty) conversation. Not now → the next request, or Home |
| **Requests** (right pane) | Everyone knocking | "N knocking" above the hive, "See all" on a request (only when more than one) | Back → where you were |
| **Contact panel** (slides in on the right) | Photo, about, safety number, verify, address, remove/block | The name or ⓘ in a conversation header | Close or Esc → the conversation, unchanged |
| **Add a friend** (dialog over anything) | Paste their address; copy yours | "+" in the header, the "+ Add" cell, Home, Ctrl/⌘+N | Knock → the new "waiting" cell is selected. Close, Esc or a click outside → where you were |
| **Settings** (whole window) | Profile, account and security, backup, appearance, language, about | The gear, your own cell (opens Profile), Ctrl/⌘+, | "← Back" (labelled with where it returns: "← Bobby", "← Home") or Esc → exactly where you were |
| **Password check** (card, top right) | Non-blocking check (ADR-004) | When due, on any screen; Settings → "Check my password now" | Not now, Close |
| **Welcome** | First run, restore, unlock | First start; after removing the account | Signing in → Home |

Rules:

- **Esc always goes one step back:** dialog, then panel, then Settings or Requests, then conversation to Home.
- **Keyboard:** Ctrl/⌘+K focuses the friend search, Ctrl/⌘+N adds a friend, Ctrl/⌘+, opens Settings. In the hive, arrow keys move between cells by their position on screen, and Enter opens one.
- **Nothing navigates away under you.** A message arriving in another chat marks its cell and Latest entry; it never switches the open chat.
- **Every action ends somewhere visible:** letting someone in opens their chain, knocking selects their waiting cell, declining moves to the next request, removing the account opens Welcome. A short toast confirms each.

## Narrow windows (below 960 px, including the default 800 × 600)

The same places, one at a time: the hive is the root; a conversation, request or Requests replaces it with "← Hive" in its header; the contact panel covers the conversation; Add a friend is a sheet from the bottom; Settings is a whole page with "← Back". Esc behaves the same.

# Scenarios

Status: **built** (in the app since UI commit 2), **designed** (in the mockup, not built yet), **to check**, or **needs Core**. The connected prototype in the mockup shows most of them.

## First run and account

| Scenario | Status |
|---|---|
| New account: name, password, live requirements, show password, creating keys | built |
| Same name and password on another computer (the app cannot tell, so the wording fits both) | built |
| Weak password: too short, contains the name, too repetitive | built (the first two as you type, the third from Core, shown inline) |
| Slow computer: warn before, honest progress | built (Core's estimate picks the message) |
| Not enough memory (under 2 GiB) | designed |
| Restore a backup: choose file, wrong file, wrong passphrase, success | built |
| No keychain (Linux): unlock with the password on every start, wrong password | built |

## The hive

| Scenario | Status |
|---|---|
| New user with an empty hive: three steps to a first conversation | built |
| Nobody selected: your status, your address, the password check | built |
| Unread messages on a cell, and the Latest list | built (a mark, not a count) |
| Many friends: smaller cells, search, Hive/List switch | built (the switch appears above 15 cells; the choice is kept) |
| Search with no results | built |
| Your computer offline: banner, dimmed hive, everything waits | built |
| Desktop notifications while HexHoot is in the background; clicking opens the chat | built |
| Keyboard: arrow keys move between cells, Enter opens; each cell has a full label for screen readers | built |

## Friend requests

| Scenario | Status |
|---|---|
| One or several knocking; Let in / Not now; Not now tells nobody | built |
| Hostile or very long names: plain text, shortened, full name on hover | built |
| A request you sent, still waiting | built |
| Both added each other: friends at once | built |
| Withdraw a request you sent | built |

## The conversation

| Scenario | Status |
|---|---|
| Just became friends: the start of the chain, suggested first lines | built, without suggested lines |
| A message waiting days for an offline friend; "Don't send" | built |
| Long messages collapse ("Show all"); emoji-only messages shown large | built (over 1200 characters or 20 lines; up to 6 emoji) |
| Links shown as links that open only after a confirmation showing the full address | built |
| Near the 64 KB limit: a counter | built (from 2000 characters left) |
| Events on the chain: verified, request accepted | built |
| Events on the chain: a friend changed their name or photo | built |
| Long history: "N new messages" jump | built: while reading further up, "N new ↓" jumps to the end |
| The link per friend (direct, internet, unreachable) | built |

## People, adding friends, settings and system

| Scenario | Status |
|---|---|
| Safety number, mark verified, remove the mark (contact panel) | built |
| Remove a friend; block someone (contact panel, with confirmation) | built |
| Share your address (grouped, copy); paste theirs, checked as you type; your own address refused | built |
| Someone already a friend ("Open the chat") or already waiting ("Show") | built |
| QR code of your address, and scanning one | dropped (see below) |
| Settings: profile, backup, language, about, remove account (with confirmation) | built, with a Blocked section |
| Appearance: night, day, follow the computer | built |
| Password check: right, right after a miss, dismissed | built |
| Password check answered wrongly: the reassuring message, then "You've got it now!" | built |
| Photo too large: shrunk to fit, with a note | built (320 px JPEG) |
| Core restarting: a banner; typed text kept; sending resumes | built: the window reloads, says so for 8 s, and returns to the same place with the draft |
| Long translations (Malayalam, German): buttons wrap, cards grow, cells use initials | built |
| Reduced motion: the only animations (panel slide, progress) follow the system setting | built |
| Backup: passphrase strength, saved confirmation | built (length) |
| Contrast measured in both themes, and a screen-reader pass | to check while building |

# Decisions made while building

- **Cells keep their place.** Friends are in alphabetical order, so a cell stays where you last saw it; Latest gives the order by recency.
- **An event never navigates.** A background event (a request withdrawn, a profile changed) only adjusts the pane if the user has not moved since it arrived, and a request that was let in rather than withdrawn never sends the window Home.
- **Problems are shown where they happen.** The welcome screen, Add a friend and backup show errors inline; the app opens no alert boxes.
- **Fonts are bundled** (`modules/Fonts`, SIL Open Font License), so the CSP allows fonts and styles only from the app itself and nothing is fetched from Google.
- **No QR code.** HexHoot runs on desktops: most have no camera, and holding a laptop up to another screen is awkward. Read with a phone, the address still has to reach the other computer, which is more work than copying it into a message. A QR encoder was built and then removed before committing. Reconsider only if there is a mobile client.
- **Web links from messages can open in the browser.** Before, the main process opened only the social links. It now also opens plain http(s) links without credentials; the page calls it only after the user confirms a dialog that shows the full address and its host.
- **On a narrow window, the hive is Home.** The address and shortcuts that Home shows on a wide window are in Add a friend and Settings.

# Core additions the design asks for

All five are in Core since Phase 5's UI commit 1 (2026-11-27), with L2 tests in `test/core/people.test.js`.

| Addition | Core API | Used by |
|---|---|---|
| Withdraw a request | `withdrawFriendRequest(address)`: a request still in the outbox is not sent; otherwise a `friend_withdraw` follows it | Requests, the waiting cell's conversation |
| Remove a friend | `removeContact(address)`: profile, conversation and session go; they are not told and may knock again | Contact panel |
| Block | `blockAddress(address)`, `unblockAddress`, `getBlocked`: removes them, refuses their handshakes, drops anything that still arrives; kept in backups | Contact panel, Settings |
| Don't send | `cancelUnsent(address, id)`: an undelivered message leaves the outbox and the conversation (a copy already on its way may still arrive) | Waiting messages |
| How a friend was last heard from | `getContactLinks()` → `{address: {via: 'lan' or 'dht', at}}`, and a `link` event when it changes or after 5 minutes of silence | Conversation header, Home |
| Events in a conversation | `getConversation(address)`: messages and events (`accepted` by me, them or both; `verified`, `unverified`, `renamed` with from and to, `photo`) | The chain |

HexHoot cannot know whether a friend is online right now without sending something, so the header describes the last time a friend was heard from ("direct, 2 minutes ago") rather than claiming presence.
