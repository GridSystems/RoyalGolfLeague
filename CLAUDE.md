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
id           bigint (Date.now() timestamp)
name         text
color        int (index into COLORS array)
handicap     numeric (legacy, use hcp_history instead)
hcp_history  jsonb  [{date, value, note}] — sorted ascending by date
is_admin     boolean
created_at   timestamptz
```

**rounds**
```
id           bigint (Date.now() + random)
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

**RLS:** Public read/write on both tables (app has no auth layer — admin is PIN-protected at UI level only).

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
3. **My Rounds** — personal stats, history, self-service HCP update
4. **Players** — roster (admin-only add/remove)
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
- **Admin PIN:** stored in `localStorage` key `sl_admin_pin`. Default: `saturday`. Session auth in `sessionStorage` key `admin_auth`.
- **Admin can:** add/remove players, edit any round, delete any round, manage HCP history for all players, bulk enter rounds, change PIN, reassign admin role.
- **Players can:** log rounds, view leaderboards, update their own HCP.

---

## Leaderboards

### Today
Live rounds for today's date. Shows holes completed, progress bar, stableford points. Per-player hole-by-hole scorecard below. Includes partial rounds (live scoring).

### Season
Best 4 stableford rounds per player, summed. Filterable by year.

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

## Key design decisions (don't change without reason)

- **Single HTML file** — deliberate. No build complexity. Easy to deploy and share.
- **Date.now() IDs** — used for both players and rounds. Simple, avoids Supabase serial conflicts with RLS.
- **HCP on date** — always calculated dynamically from hcp_history, never stored on round except as snapshot for display.
- **Playing HCP = Course HCP × 0.95** — WHS competition format.
- **Rounds created at entry start** — enables live leaderboard. Partial rounds are real data.
- **Admin = is_admin flag** — not first-by-created_at (which caused issues when player order varied).
- **No auth layer** — intentional for a small trusted group. Admin PIN is UI-only security.

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
