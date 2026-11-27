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
| **Add a friend** (dialog over anything) | Paste their address; copy yours, QR code | "+" in the header, the "+ Add" cell, Home, Ctrl/⌘+N | Knock → the new "waiting" cell is selected. Close, Esc or a click outside → where you were |
| **Settings** (whole window) | Profile, account and security, backup, appearance, language, about | The gear, your own cell (opens Profile), Ctrl/⌘+, | "← Back" (labelled with where it returns: "← Bobby", "← Home") or Esc → exactly where you were |
| **Password check** (card, top right) | Non-blocking check (ADR-004) | When due, on any screen; Settings → "Check my password now" | Not now, Close |
| **Welcome** | First run, restore, unlock | First start; after removing the account | Signing in → Home |

Rules:

- **Esc always goes one step back:** dialog, then panel, then Settings or Requests, then conversation to Home.
- **Keyboard:** Ctrl/⌘+K focuses the friend search, Ctrl/⌘+N adds a friend, Ctrl/⌘+, opens Settings. In the hive, arrow keys move between cells and Enter opens one (to build).
- **Nothing navigates away under you.** A message arriving in another chat marks its cell and Latest entry; it never switches the open chat.
- **Every action ends somewhere visible:** letting someone in opens their chain, knocking selects their waiting cell, declining moves to the next request, removing the account opens Welcome. A short toast confirms each.

## Narrow windows (below 960 px, including the default 800 × 600)

The same places, one at a time: the hive is the root; a conversation, request or Requests replaces it with "← Hive" in its header; the contact panel covers the conversation; Add a friend is a sheet from the bottom; Settings is a whole page with "← Back". Esc behaves the same.

# Scenarios

Status: **designed** (in the mockup), **to check** (during the build), or **needs Core** (a Core addition first). After iteration 3 every scenario is designed; the connected prototype shows most of them, with a "simulate" option for a background message, the engine restarting and being offline.

## First run and account

| Scenario | Status |
|---|---|
| New account: name, password, live requirements, show password, creating keys | designed |
| Same name and password on another computer (the app cannot tell, so the wording fits both) | designed |
| Weak password: too short, contains the name, too repetitive | designed |
| Slow computer: warn before, honest progress | designed |
| Not enough memory (under 2 GiB) | designed |
| Restore a backup: choose file, wrong file, wrong passphrase, success | designed |
| No keychain (Linux): unlock with the password on every start, wrong password | designed |

## The hive

| Scenario | Status |
|---|---|
| New user with an empty hive: three steps to a first conversation | designed |
| Nobody selected: your status, your address, the password check | designed |
| Unread messages on a cell, and the Latest list | designed |
| Many friends: smaller cells, search, Hive/List switch | designed |
| Search with no results | designed |
| Your computer offline: banner, dimmed hive, everything waits | designed |
| Desktop notifications while HexHoot is in the background; clicking opens the chat | designed |
| Keyboard: arrow keys move between cells, Enter opens; each cell has a full label for screen readers | designed |

## Friend requests

| Scenario | Status |
|---|---|
| One or several knocking; Let in / Not now; Not now tells nobody | designed |
| Hostile or very long names: plain text, shortened, full name on hover | designed |
| A request you sent, still waiting | designed |
| Both added each other: friends at once | designed |
| Withdraw a request you sent | designed; needs Core |

## The conversation

| Scenario | Status |
|---|---|
| Just became friends: the start of the chain, suggested first lines | designed |
| A message waiting days for an offline friend; "Don't send" | designed; Don't send needs Core |
| Long messages collapse ("Show all"); emoji-only messages shown large | designed |
| Links shown as links that open only after a confirmation showing the full address | designed |
| Near the 64 KB limit: a counter | designed |
| Events on the chain: verified, request accepted | designed |
| Events on the chain: a friend changed their name or photo | designed; needs Core |
| Long history: "N new messages" jump | designed |
| The link per friend (direct, internet, unreachable) | designed; needs Core (reported per contact) |

## People, adding friends, settings and system

| Scenario | Status |
|---|---|
| Safety number, mark verified, remove the mark (contact panel) | designed |
| Remove a friend; block someone (contact panel, with confirmation) | designed; needs Core |
| Share your address (grouped, copy, QR code); paste theirs, checked as you type; your own address refused | designed |
| Someone already a friend ("Open the chat") or already waiting ("Show") | designed |
| Scan a QR code with a camera | needs Core (and a camera permission) |
| Settings: profile, backup, language, about, remove account (with confirmation) | designed |
| Appearance: night, day, follow the computer | designed |
| Password check: right, right after a miss, dismissed | designed |
| Password check answered wrongly: the reassuring message, then "You've got it now!" | designed |
| Photo too large: shrunk to fit, with a note | designed |
| Core restarting: a banner; typed text kept; sending resumes | designed |
| Long translations (Malayalam, German): buttons wrap, cards grow, cells use initials | designed |
| Reduced motion: the only animations (panel slide, progress) follow the system setting | designed |
| Backup: passphrase strength, saved confirmation | designed |
| Contrast measured in both themes, and a screen-reader pass | to check while building |

# Core additions the design asks for

All five are designed into the screens on the assumption that 2.0 includes them; each is small, and dropping one only removes a button.

| Addition | Used by |
|---|---|
| `withdrawFriendRequest(address)` | Requests: Withdraw |
| `removeContact(address)`, `blockAddress(address)` (drop their requests and messages) | Contact panel |
| `cancelUnsent(messageId)`: drop an undelivered message from the outbox | Conversation: Don't send |
| Per-contact link state (direct over LAN, internet, unreachable) | Conversation header, home status |
| Profile-change events (name, photo) | Events on the chain |
