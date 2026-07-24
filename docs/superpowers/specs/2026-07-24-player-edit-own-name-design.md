# Let players edit their own name

**Date:** 2026-07-24
**Status:** Approved

## Problem

A player's name is set once — at sign-up, or by an admin using "Add Player" — and
can never be changed in the app. Typos, nicknames and married names all require
someone to open the Supabase table editor. Neither players nor admins have a way
to fix a name from the UI.

## Goal

A player can rename themselves from the app. An admin can rename anyone.

## Why this is cheap

`players.name` already exists. Names are never denormalised into `rounds`,
`tournaments`, `tournament_matches` or `fines` — those tables store `player_id`
only, and every display derives the name via a lookup into the in-memory
`players` array. A rename therefore needs no migration and no backfill; it
propagates as soon as the affected views re-render.

## Design

### Data

`sbUpdate('players', id, {name})`, then update `p.name` on the in-memory object.
No schema change.

### Modal — `#editNameModal`

Placed next to `#myHcpModal` in the modal block. Same `modal modal-sm` shape as
the existing `#editEmailModal`:

- `Current Name` — readonly, dimmed
- `New Name` — text input, `maxlength="40"`
- Cancel / Save

### `openEditName(id)`

Mirrors `openEditEmail`. Called with no argument from My Rounds, where it
defaults to `activeId`; called with a player id from the admin panel.

Guard: proceed only if `id === activeId` or `isAdmin()`. This is the same trust
boundary `setPlayer()` already enforces — a session is pinned to one player
unless that player is an admin.

### `saveEditName()`

1. Trim the input.
2. Reject empty.
3. If another player already has that name (case-insensitive), `confirm()`
   rather than block. Duplicates are legal — it is a small trusted group and
   login is by email, so the name is display-only — but they make leaderboards
   ambiguous, so they are worth a nudge.
4. `sbUpdate` → update `p.name` → toast → close modal.
5. Re-render: `renderMyRounds()`, `renderGrid()`, and `renderAdmin()` when the
   admin panel is present. If the renamed player is the active player, also
   refresh `#playerName` and `#playerAvatar` (text and background), the same
   three lines `setPlayer()` uses.

### Entry points

- **My Rounds panel header** — `Edit Name` button beside the existing
  `Update My HCP` button (`#myHcpBtn`), shown and hidden by the same rule.
- **Admin player row** — `Edit Name` button beside `Edit Email` and `Reset PIN`,
  calling `openEditName(p.id)`.

Both open the same modal and go through the same save function.

## Known consequence, not a bug

`ini()` derives avatar initials from the name, so renaming changes a player's
initials everywhere their avatar appears. That is correct behaviour.

## Testing

The repo has no test harness — it is a single static HTML file with no build
step — so verification is manual, in the browser:

1. Rename yourself → header name, avatar initials, Players grid, My Rounds title
   and leaderboards all show the new name.
2. Reload the page → the new name persisted.
3. Admin renames another player → that player's row updates.
4. Empty name → rejected with a message, nothing saved.
5. Name matching another player → confirm prompt; cancelling saves nothing.

## Out of scope

- Name history / audit trail. Nobody has asked for it and no view would show it.
- Uniqueness constraints in the database.
- Renaming from the player picker or header avatar.
