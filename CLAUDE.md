# Saturday League — Royal Golf Club Copenhagen
## Project Briefing for Claude Code

---

## What this is

A single-file HTML web app (`index.html`) for tracking Saturday League golf scores at Royal Golf Club Copenhagen. Built for a small group of regular players. Hosted on GitHub Pages as a PWA-ready web app.

**Live URL:** (update once deployed)
**Repo:** (update with your GitHub repo URL)

---

## Tech stack

- **Single file:** Everything — HTML, CSS, JS — lives in `index.html`. No build step, no npm, no framework.
- **Backend:** Supabase (Postgres) for all data persistence
- **Fonts:** Google Fonts (Playfair Display, DM Mono, DM Sans) via CDN
- **Hosting:** GitHub Pages

### Supabase config
```
URL:  https://qvjybtcbymexheqrjkai.supabase.co
Key:  eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2anlidGNieW1leGhlcXJqa2FpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNDUyMDAsImV4cCI6MjA4OTkyMTIwMH0.ODg9C2HU4exSpTt5ABfODz_vz3v0Uz_tQsL3XAuWJ-4
```

### Supabase tables

**players**
```
id           bigint (database-assigned 1..N — Phase 1)
name         text
color        int (index into COLORS array)
dgu_number   text (DGU membership number, "digits-digits" — variable length
             either side, e.g. 900-1831 or 1-123456; stored exactly as typed)
handicap     numeric (legacy, use hcp_history instead)
hcp_history  jsonb  [{date, value, note}] — sorted ascending by date
is_admin     boolean
created_at   timestamptz
archived_at  timestamptz (null = active; set by "Remove player")
legacy_id    bigint (pre-Phase-1 timestamp id; remove in Phase 2)
```

**rounds**
```
id           bigint (database-assigned)
player_id    bigint (FK → players.id)
course       text
date         text (YYYY-MM-DD)
tee_id       text
tee_name     text
tee_color    text
rating       numeric
slope        int
hcp_index    numeric (snapshot at time of round)
course_hcp   int
playing_hcp  int
notes        text
holes        jsonb  [{hole, score, par, hcp}] × 18
created_at   timestamptz
```

**season_entries**
```
id           bigint (database-assigned)
player_id    bigint (FK → players.id)
season_id    int (FK → SEASONS index in index.html)
amount       numeric (DKK paid; null = unpaid)
created_at   timestamptz
```
Members enter and withdraw (unpaid) themselves; marking paid needs admin mode; audited as
season_entered / entry_paid / entry_unpaid / season_withdrawn. SQL: `supabase/season_entries.sql`,
rollback: `season_entries_rollback.sql`.

**RLS:** Phase 2 release A (2026-09-24, `supabase/phase2a_auth.sql`) added real
permission rules for logged-in members — `p2_*` policies `TO authenticated`, e.g.
members read/write their own rounds and sign-ups, admins (admin mode) everything,
pending sign-ups only their own row. See **Supabase Auth** under Admin system for
how a request becomes `authenticated`. The old PIN route's `anon_all` allow-all
policy still exists `TO anon` on every table and keeps working until release B,
which happens once the Admin tab's move-over list is empty (see below).

**Credentials are hidden (Phase 0, 2026-09-24):** the public key cannot read
`players.email`, `players.pin` or the lockout columns (`pin_failures`,
`pin_locked_until`) — SELECT/UPDATE on `players` are column-level grants. PINs are
checked only by database functions via `sbRpc()`: `login`, `has_pin`, `check_pin`,
`set_first_pin`, `admin_reset_pin` (`supabase/phase0a_pin_functions.sql`). Five
wrong PINs lock an account for 15 minutes.
**Adding a column to `players`?** Add it to `PLAYER_COLS` in `index.html` *and* to the
column grants in `supabase/grants.sql` / `phase0b_hide_credentials.sql`, or the app
can't read it. Never grant SELECT on `players` table-wide.

---

## Course data — Royal Golf Club Copenhagen

```js
HOLE_PARS = [4,4,5,3,4,4,3,4,4, 4,4,4,3,5,4,3,5,5]  // total 72 (35 out / 37 in)
HOLE_HCP  = [4,14,8,18,12,10,16,6,2, 5,7,13,17,3,11,15,1,9]
```

**7 tees:**
| ID | Name | Rating | Slope |
|---|---|---|---|
| champion | Royal Champion | 77.9 | 153 |
| platinum | Royal Platinum | 77.6 | 153 |
| 62 | 62 Tee | 76.2 | 149 |
| 57 | 57 Tee | 73.1 | 144 |
| 54 | 54 Tee | 71.3 | 141 |
| 50 | 50 Tee | 69.5 | 134 |
| 43 | 43 Tee | 66.0 | 125 |

---

## Handicap & scoring

```
Course HCP   = round(Index × Slope/113 + (Rating − Par))
Playing HCP  = round(Course HCP × 0.95)
Strokes/hole = SI ≤ Playing HCP → 1 stroke; if Playing HCP > 18, extra stroke where SI ≤ (Playing HCP − 18)
Stableford   = max(0, 2 + par + strokes − gross)
```

`hcpOnDate(player, date)` — returns correct HCP index for any given round date by walking hcp_history. Always use this, never `player.handicap` directly.

---

## App structure

### Navigation tabs
1. **Leaderboards** — Today (live), Season (best 4 rounds), Eclectic (best nett per hole)
2. **Log Round** — hole-by-hole group score entry, live-saves to Supabase
3. **My Rounds** — personal stats, round history, Dream Scorecard, GPS Stats
4. **My Profile** — name, membership number, handicap, colour, My Bag, units,
   GPS tracking mode. Owns all self-service identity and preference editing.
5. **Players** — roster (admin-only add/remove)
5. **⚙ Admin** — PIN-protected; bulk entry, HCP history, edit/delete rounds

### Key JS state variables
```js
players      // array, loaded from Supabase on init
allRounds    // array, loaded from Supabase on init
activeId     // currently selected player ID (persisted in localStorage 'sl_active_player')
selTeeId     // tee selected on Log Round screen
HE           // hole-entry state object (see below)
BE           // bulk entry state object (see below)
```

### HE (hole entry state) — Log Round
```js
HE = {
  playerList: [{p, phcp, index}],
  scores:     {pid: [null×18]},   // 0-indexed, hole-1 = scores[0]
  roundIds:   {pid: supabaseId},  // created at session start
  currentHole: 1,                 // 1-18
  currentPidx: 0,                 // index into playerList
  startHole:  1,                  // starting hole (may not be 1)
  tee, teeId, date, notes
}
```

Rounds are **created in Supabase when entry starts** (all scores null). Each hole is **PATCHed silently** after being confirmed. `saveGroupRound()` does a final PATCH and navigates away.

Enter key: next player same hole → last player advances to next hole, first player.

### BE (bulk entry state) — Admin
```js
BE = { date, teeId, notes, playerId, step: 'setup'|'scorecard' }
```

Admin bulk entry is **completely separate** from HE. One player at a time. Full 18-hole scorecard displayed at once (not hole-by-hole). On save, INSERTs to Supabase then resets to setup with same date/tee/notes for next player.

---

## Admin system

- **Admin player:** determined by `is_admin=true` flag in DB. Falls back to `players[0]` if none set.
- **SQL to set up:** `ALTER TABLE players ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false;` then set your row to `true` in Supabase Table Editor.
- **Admin PIN (old route only):** stored in `localStorage` key `sl_admin_pin`. Default: `saturday`. Session auth in `sessionStorage` key `admin_auth`. Only reached when there's no Supabase Auth session (`_session` is null, i.e. the player hasn't moved to the new login yet); removed in release B. See **Supabase Auth** in Key design decisions for the real login and admin mode.
- **Sign out:** Header shows a Sign out button for every signed-in user (both PIN and Supabase Auth routes).
- **Admin can:** add/remove players, edit any round, delete any round, manage HCP history for all players, bulk enter rounds, change PIN, reassign admin role, record season entry payments (Admin → <season> entries) — destructive actions need admin mode (below), not just `is_admin`.
- **Players can:** log rounds, view leaderboards, update their own HCP, and set
  their own name and DGU membership number (My Profile). An admin can edit any
  player's DGU number — needed for players who predate the field.
- **Sign-up requires a DGU number.** The column is nullable so existing players
  stay saveable; "required" is enforced in the sign-up form only.

---

## Leaderboards

### Today
Live rounds for today's date. Shows holes completed, progress bar, stableford points. Per-player hole-by-hole scorecard below. Includes partial rounds (live scoring).

### Season
Best 4 stableford rounds per player, summed. Filterable by season.

Seasons are named editions ("Summer 2026", "Winter 2027"), not calendar years —
defined by start date in the `SEASONS` array in `index.html`. Season, Eclectic,
My Dream Card and Fines all filter through `seasonOf(date)` / `inSeason()`. To
start a new edition, add a row to `SEASONS`.

Each `SEASONS` row carries its own **eclectic allowance** (95% Summer 2026, 60%
from Winter 2027). Everything else — season points, Today, Log Round — plays off
`PLAYING_ALLOWANCE` (95%). Pass the allowance to `calcPlayingHcp`; never change
its default to adjust the eclectic, as that rescores the whole app.

Each `SEASONS` row also carries `best` (rounds counted in the Season standings), `buyIn` (DKK) and
`entry`. `entry:false` (Summer 2026): every approved non-social member is in. `entry:true` (Winter
2027 onwards): only players with a `season_entries` row are in the prizes — `inPrizes(p, season)`
treats a non-entrant exactly like a social member, and an unpaid entrant carries an "unpaid" tag. The
pot for an opt-in season is the sum of paid `amount`s. `entrySeason()` is the season taking entries:
the current one if it needs entry, else the next — so entries open before a season starts.

### Hall of Fame
Winners per season: Eclectic (complete 18-hole cards only, social members
excluded), Best 4 IPS, most fined (by count) and the season's fine pot. Computed
live from `seasonStandings` / `eclecticStandings` / `finesStandings` — the same
functions the leaderboards use — so there is no winners table to keep in sync.
Ties share the title. The current season shows as "In progress · current leaders".

Records rows (all players, social included — no prize money): most gross birdies
(par−1), most gross eagles (par−2 or better, so an ace on a par 3 also counts),
every hole in one, and the longest day — fewest stableford points in a *finished*
round (all 18 holes scored or picked up).

### Eclectic
Per-player best nett score per hole across the season. Ranked by total nett. "My Card ↓" button scrolls to active player's card (highlighted with their colour). Each card has `id="eclectic_{pid}"`.

---

## Score entry — Log Round

1. Player selects date, tee, notes, starting hole (1, 10, or custom), and which players are in the group
2. "Enter Scores →" creates round records in Supabase immediately (all holes null) — rounds visible on Today leaderboard right away
3. Hole-by-hole card UI: one hole at a time, all players listed vertically
4. Enter navigates: next player same hole → last player → next hole, first player
5. After each complete hole, all player rounds are PATCHed silently
6. "Save All Rounds" does final PATCH and navigates to leaderboard
7. **Resume:** if today's partial rounds exist, Log Round screen shows a resume banner

### Starting hole
`heOrderedHoles(startHole)` returns [startHole, startHole+1, ..., 18, 1, ..., startHole-1]. Navigation wraps correctly. After hole 18, next is hole 1 if started elsewhere.

---

## The Saturday draw

One implementation, in `index.html`. There is **no** edge function and no cron —
`supabase/functions/friday-draw` was deleted 2026-08-16.

- `shuffleDraw()` — Fisher-Yates. **Never** `sort(()=>Math.random()-0.5)`: that
  comparator is inconsistent, so V8 leaves players near their original order. It
  measured 286% off uniform, with the last signup staying last 48% of the time.
- `drawPairWeights(before)` — recency-weighted memory of who played with whom over
  the last 4 *drawn* Saturdays (weights 8/4/2/1). Counting drawn Saturdays, not
  calendar weeks, keeps the memory intact across cancelled weeks.
- `chooseBestDraw()` — builds 200 candidates, keeps the lowest-scoring, picks at
  random among ties so Re-randomise still varies.
- `autoDrawIfDue()` — runs on `init()`. From Friday noon through Saturday, if the
  upcoming Saturday has sign-ups and no draw, it locks the event and draws. The
  first person to open the app creates the draw.
- **`run_draw`** (Phase 2 release A) — the app still computes the allocation
  (`chooseBestDraw`), but the write goes through `public.run_draw(p_date, p_tee_times,
  p_alloc)`, a `SECURITY DEFINER` RPC, not a raw PATCH. It revalidates everything the
  browser sent — the allocation covers every sign-up for the date exactly once, tee
  times are real, the date is the upcoming Saturday and the draw is due (Friday noon
  through Saturday, Copenhagen time, via `private.draw_clock()` so tests can pin it),
  not already drawn — before writing. An event with no tee times falls back to the
  supplied list. Concurrent calls for a date are serialised by
  `pg_advisory_xact_lock`.
  It sets a transaction-local `app.drawing` flag so its own write passes the
  `protect_signup_fields` trigger, which otherwise refuses to let anyone but an admin
  in admin mode set `group_num`/`tee_time`. Callable by `anon` too, until release B.

**Repeats are not a bug.** At 8 players in 2 groups any pair shares a group 42.9%
of the time by chance, and with two foursomes the minimum possible repeat count is
4 pairs, not 0. The gate minimises; it cannot forbid.

**Why the cron went:** it duplicated the algorithm, the two copies drifted (only
one got the Fisher-Yates fix), and it died silently for five weeks — an unhandled
`NOT NULL` on `saturday_events.id`, which it never supplied. Nobody noticed until
pairings felt stale. A draw computed on demand has no scheduler to fail quietly.

## Key design decisions (don't change without reason)

- **Single HTML file** — deliberate. No build complexity. Easy to deploy and share.
- **Database-assigned IDs** (Phase 1, 2026-09-24) — every table's `id` is `GENERATED ALWAYS AS IDENTITY`; inserts send no `id` and keep the row PostgREST returns. Never reintroduce `Date.now()` ids — the database refuses them. Foreign keys: rows that belong to a player RESTRICT their deletion; mentions (issued_by, recorded_by, marker, captains, match slots) SET NULL. Removing a player sets `archived_at`; use `activePlayers()` for pick lists and `players` for history.
- **Version gate** (Phase 1; minimum now **3** as of Phase 2 release A) — every API request sends `x-app-version`; `public.require_current_app()` (PostgREST pre-request) refuses older versions with HTTP 426 and the app reloads itself. For a release that must not coexist with the previous one, bump `APP_VERSION` in `index.html`, `x-app-version` in `course-mapper.html` (`SB_H`) *and* `tests/sql/snapshot.mjs` (`H`), and the gate's minimum in `phase2a_auth.sql`, together — `tests/sql/version.test.mjs` checks all four agree. Anything else calling the API needs the header too.
- **HCP on date** — always calculated dynamically from hcp_history, never stored on round except as snapshot for display.
- **Playing HCP = Course HCP × 0.95** — WHS competition format.
- **Rounds created at entry start** — enables live leaderboard. Partial rounds are real data.
- **Admin = is_admin flag** — not first-by-created_at (which caused issues when player order varied).
- **Supabase Auth** (Phase 2 release A, 2026-09-24, `supabase/phase2a_auth.sql`) — real
  login replaces the trusted-group assumption: email + password (min 8 chars), forgot
  password via PKCE (the reset link must be opened on the requesting device/browser),
  a set-up flow that links an existing member's first login to their player row by
  email, and sign-up that creates a pending player — all three share one trigger,
  `private.link_login`, on `auth.users`. It also retries the email match on every
  sign-in of a still-unlinked login (so fixing `players.email` is enough), but only
  confirmation ever creates a player. `players.user_id` (uuid, unique, FK →
  `auth.users.id`) is what makes a login a player; `private.current_player()` /
  `acting_player()` / `is_member()` / `is_admin()` (schema `private`, no Data API
  grants) read it. **Admin mode** is stronger than `is_admin`: it also needs `aal2`
  plus a `totp` entry in the JWT's `amr` no older than 12 hours, checked by
  `private.is_admin()` and mirrored client-side by `adminModeActive()`. A write an
  admin isn't yet in admin mode for comes back refused (`42501`, or an empty
  UPDATE/DELETE result — RLS filtering rows looks identical to "not found"); the app
  prompts once for the authenticator code (`requireAdminMode()`, shared across
  concurrent callers, throws on cancel) and retries. RLS policies are `p2_*`,
  `TO authenticated`; the old PIN route's `anon_all` policy stays `TO anon` on every
  table until release B — the Admin tab's move-over list tracks who's left. Every
  admin/auth-relevant change is written by `private.audit()` (never directly
  callable) into `audit_log` (admin-only read, self-trims after 12 months); triggers
  on `auth.users`/`auth.mfa_factors` catch `OTHERS` and only `RAISE WARNING` — a
  logging failure must never block a login. Rollback: `supabase/phase2a_rollback.sql`
  (re-applicable afterwards).

---

## Version history

| Version | Date | Notes |
|---|---|---|
| v1.0 | 2026-03-26 | Hole-by-hole log round working, all base features |
| v2.0 | 2026-03-26 | Live scoring, resume round, starting hole, admin PIN, eclectic My Card, CSS polish |
| v3.0 | 2026-03-26 | Bulk entry rebuilt as standalone one-player-at-a-time scorecard |

Current stable: **v3.0**

---

## File structure (GitHub repo)

```
index.html          ← the entire app
CLAUDE.md           ← this file
```

When adding PWA support, also add:
```
manifest.json
sw.js
icon-192.png
icon-512.png
```

---

## Common tasks

**Update a player's HCP manually (DB):**
Edit `hcp_history` JSONB array in Supabase Table Editor. Format: `[{"date":"2026-03-01","value":14.2,"note":"Manual"}]`

**Reset admin PIN:**
In browser console: `localStorage.setItem('sl_admin_pin', 'newpin')`

**Check if round was saved:**
Supabase Table Editor → rounds → filter by player_id and date

**Add a new tee:**
Add entry to `TEES` array in JS. Format: `{id, name, color, rating, slope, dist:[18 values]}`
