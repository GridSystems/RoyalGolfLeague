# Profile screen + DGU membership number

**Date:** 2026-08-16
**Status:** Approved

## Problem

Two problems, one screen.

**There is no profile.** A player's identity and preferences are scattered across
two unrelated tabs. `Edit Name` and `Update My HCP` are buttons wedged into the
header of the **My Rounds** panel; the units toggle sits beside them; the GPS
tracking preference is a collapsible panel below the rounds table; and `My Bag`
is stranded on the **Players** tab, which is otherwise the club roster. A player
looking for "my settings" has nowhere to go.

**There is no membership number.** The club's DGU number is not stored at all.
`players.is_social` is a standings-exclusion flag, not an identifier.

## Goal

A Profile screen that owns identity and preferences, holding a new DGU
membership number. My Rounds keeps performance data only.

## Design

### Data

One nullable column, following `add_social_member.sql`:

```sql
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS dgu_number TEXT;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.players TO anon, authenticated;
```

New file `supabase/add_dgu_number.sql`. The `GRANT` is redundant for a new column
on an already-granted table, but is included to match the house pattern.

**Nullable, despite being required at sign-up.** Every existing player has none.
A `NOT NULL` column would make every existing row invalid and block unrelated
saves. Required is enforced at the sign-up form, not in the schema.

`TEXT`, not a numeric type — a DGU number has a hyphen and may carry leading
zeros, both of which a numeric column destroys.

### Validation — the rule that matters

```
^\d+-\d+$
```

Digits, exactly one hyphen, digits. Variable length on both sides. Applied after
trimming. Max 20 characters.

**Store exactly as typed. Never reformat.** Real examples are `900-1831` and
`1-123456`, so the segments are not fixed-width. This makes a digits-only input
ambiguous: `9001831` could be `900-1831` or `9-001831`, and there is no rule that
decides. Any attempt to insert the hyphen for the user would silently corrupt
roughly half of all entries. The hyphen is therefore required from the user, and
the stored string is byte-for-byte what they typed.

Rejected: no hyphen, more than one hyphen, letters, spaces, empty segments.

### Profile screen — `#view-profile`

A new `view-*` div and nav tab, following the existing pattern.

The screen is mostly **adoption, not new code**. `openEditName()`,
`showMyHcp()`, `openBagModal()`, `toggleUnits()` and `renderGpsPreferencePanel()`
move across unchanged and keep their existing modals and save paths. The only
genuinely new logic is the DGU field.

Sections:

- **Identity** — name, DGU number, handicap index, colour swatch (**display only**;
  no colour picker exists today and adding one is out of scope)
- **Equipment** — My Bag
- **Preferences** — units (m/yds), GPS tracking detail mode

### What moves

| Element | From | To |
|---|---|---|
| `myNameBtn` | My Rounds header | Profile |
| `myHcpBtn` | My Rounds header | Profile |
| `unitsBtn` | My Rounds header | Profile |
| `myGpsPrefWrap` | My Rounds body | Profile |
| `myBagBtn` | **Players** tab header | Profile |
| DGU number | *new* | Profile |

**My Rounds keeps** `myStats`, `sortSel`, `myTable`, the Dream Scorecard panel
and the GPS Stats sub-tab. Its header reduces to the title and the sort select.

**Players keeps** the roster grid and `addPlayerBtn`.

### `saveDguNumber()`

Mirrors `saveMyHcp()`, which is the closest existing analogue:

1. Trim the input.
2. Validate against the pattern; on failure, message and stop.
3. Return early if unchanged — no pointless PATCH.
4. `sbUpdate('players', id, {dgu_number})` → update `p.dgu_number` in memory →
   toast → close modal.
5. Re-render `renderProfile()`, `renderGrid()`, and `renderAdmin()` when present.

Guard: proceed only if `id === activeId` or `isAdmin()` — the same trust boundary
`openEditName` established.

### Sign-up — now required

`signupPlayer()` gains a DGU field between email and handicap, validated with the
same pattern and the same message. It joins the existing required set (name,
email, PIN), rejecting before insert with the established
`signupError` treatment.

Handicap stays optional. That is unchanged behaviour and out of scope here.

### Admin

The admin player row gains `Edit DGU`, beside `Edit Name` / `Edit Email` /
`Reset PIN`, calling the same modal with a player id — the pattern
`openEditName(id)` already uses. An admin can set a number for the existing
players who predate the field.

### Display

Visible to everyone, as requested:

- **Profile** — under the player's name
- **Club Roster** — on each player card
- **Admin player row** — beside email

Players without a number render `—`, not an empty gap.

## Deployment ordering — a hard constraint

The site is GitHub Pages off `main`, so **merging to `main` is the production
deploy**. There is one Supabase project and no staging.

The migration must therefore run **before** the merge. If `main` goes live first,
every Profile save and every sign-up PATCHes a column that does not exist and
PostgREST returns 400.

1. Run `supabase/add_dgu_number.sql` in the Supabase SQL editor
2. Verify the column exists
3. Merge `feature/profile-screen` → `main`

The reverse order breaks sign-up for every new player.

## Testing

No test harness and no Node on this machine, so the previous
puppeteer-with-stubs approach is not reproducible. Equivalent isolation is
achieved by driving a local copy of `index.html` in Chrome with `sbUpdate`
stubbed, asserting in-page — **no production rows touched**.

Stubbed assertions:

- Validation accepts `900-1831` and `1-123456`; rejects `9001831`, `900-1831-2`,
  `900-abc`, `900-`, `-1831`, empty, and a 21-character input
- The stored value is identical to the input — no reformatting
- Unchanged value issues no PATCH
- Sign-up rejects a missing or malformed DGU before insert
- Non-admin editing another player is refused
- Every moved control still works from Profile: name, HCP, bag, units, GPS mode
- My Rounds still renders without its moved buttons; Players still renders
  without My Bag

Live pass, against the author's own record only, touching **only
`dgu_number`** — no scores, no fines, no other column:

1. Set `900-1831` on own profile → appears on Profile, Club Roster, Admin
2. Reload → persisted
3. Edit to another valid value → updates; reload → persisted
4. Enter `9001831` → rejected, nothing saved
5. Restore the original value

## Out of scope

- Uniqueness constraint on `dgu_number`. Nobody has asked; duplicates are a data
  entry problem, not a correctness one.
- Backfilling existing players. Admin can set them as needed.
- Validating the number against any DGU service.
- Making handicap required at sign-up.
- Any change to how handicap history, bag or GPS preferences *work* — they move
  screens, their internals are untouched.
