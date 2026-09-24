# Phase 1 — Clean IDs and foreign keys

**Date:** 2026-09-24 · **Status:** approved design, awaiting spec review
**Roadmap:** Phase 1 of 4 (0 hide credentials — live · **1 IDs + FKs** · 2 real login + RLS · 3 GDPR rights)

## Why

Every row's ID is invented by the browser from `Date.now()`, sometimes plus a small
random number. IDs created in the same millisecond can clash (a group starting Log
Round creates several rounds at once), they are 13-digit noise, and nothing links the
tables: deleting a player or round leaves orphans. Found on 2026-09-24:

| Orphan | Rows |
|---|---|
| `fines.round_id` → deleted round | 30 (18 re-linkable to the player's only round that day, 12 not) |
| `fines.player_id` → deleted player | 5 (DKK 60, 2 players) |
| `saturday_signups.player_id` → deleted player | 3 (May 2026) |
| `tournament_players.player_id` → deleted player | 2 |

## Decisions

1. **Database-assigned sequential IDs; renumber every existing row** in creation order
   (`created_at`, then old id). `gps_shots` already works this way and is only locked down.
2. **Removing a player archives them** (`archived_at`); history is kept. Real deletion is
   Phase 3's deliberate GDPR erase.
3. **Orphans:** re-link the 18 fines, clear the other 12 links (fines kept); move the 5
   fines to one archived **"Former member"** player (fine pot stays DKK 4820); delete the 3
   sign-ups and 2 tournament entries.
4. **Rollout: one transaction, one push.** Rehearsed first with automatic rollback.
5. **Timing:** aim to go live 2026-09-24 (Thursday evening — outside the Friday-noon to
   Saturday draw/play window).

## Database end state

**Renumbered, identity `GENERATED ALWAYS`:** `players`, `rounds`, `fines`,
`fine_payments`, `fine_types`, `saturday_events`, `saturday_signups`, `tournaments`,
`tournament_players`, `tournament_matches`, `tournament_scores`.
**Locked to database-assigned only (no renumber):** `gps_shots`.
**Untouched:** `tees` (text ids), `green_polygons` / `fairway_polygons` (keyed by hole),
`survey_points` (already uuid, empty).

`GENERATED ALWAYS` means an insert that supplies its own id is refused — timestamp ids
cannot come back, even from a hand-written SQL fix.

**Foreign keys — one rule: rows that belong to a player cannot outlive them; rows that
mention a player survive with the mention cleared.** All are `ON UPDATE CASCADE`.

| Column | References | On delete |
|---|---|---|
| `rounds.player_id` | players | RESTRICT |
| `fines.player_id` | players | RESTRICT |
| `fine_payments.player_id` | players | RESTRICT |
| `saturday_signups.player_id` | players | RESTRICT |
| `gps_shots.player_id` | players | RESTRICT |
| `tournament_players.player_id` | players | RESTRICT |
| `tournament_scores.player_id` | players | RESTRICT |
| `rounds.marker_id` | players | SET NULL |
| `fines.issued_by` | players | SET NULL |
| `fine_payments.recorded_by` | players | SET NULL |
| `tournaments.team_a_captain_id`, `team_b_captain_id` | players | SET NULL |
| `tournament_matches.team_{a,b}_p{1,2}_id` | players | SET NULL |
| `fines.round_id` | rounds | SET NULL |
| `fines.fine_type_id` | fine_types | RESTRICT (types are deactivated, not deleted) |
| `tournament_players.tournament_id` | tournaments | CASCADE |
| `tournament_matches.tournament_id` | tournaments | CASCADE |
| `tournament_scores.match_id` | tournament_matches | CASCADE |

SET NULL columns drop `NOT NULL` where they have it.

**New `players` columns:** `archived_at timestamptz` (null = active) and
`legacy_id bigint` (old timestamp id; players only; removed in Phase 2). Both go into
`PLAYER_COLS` and the column-level SELECT grants; `archived_at` also into the UPDATE
grant (Phase 0 rule).

`public.login()` refuses archived players.

## Migration script — `supabase/phase1_ids.sql`

One transaction, in order:

1. **Guard:** abort if any round dated today is partly scored.
2. **Backup:** copy every affected table into schema `phase1_backup` (not API-exposed).
3. **Orphans** as decided.
4. **Add** `archived_at`, `legacy_id` (= current id).
5. **Add foreign keys** (`ON UPDATE CASCADE`), then **renumber** each table with one
   `UPDATE … SET id = row_number()` — references follow automatically. New ids (small)
   and old ids (13 digits) cannot collide mid-update.
6. **Identity:** `GENERATED ALWAYS AS IDENTITY`, starting after the table's max id;
   grant sequence usage to `anon`, `authenticated`.
7. **Checks** — any failure raises and rolls everything back:
   - per-table row counts = before − deliberate deletions (+1 Former member);
   - total fines DKK and total payments DKK unchanged;
   - rounds per player unchanged (matched via `legacy_id`);
   - ids are exactly 1…N per renumbered table.

**Rehearsal:** first line `rehearsal := true`. The script does everything, then raises an
exception whose message is the check report — which undoes it all. Real run: set it to
`false`; it commits and returns the same report.

**`supabase/phase1_rollback.sql`** restores the tables from `phase1_backup` — an emergency
brake for shortly after go-live (rows saved after the migration would be lost).
**`supabase/phase1_cleanup.sql`** drops `phase1_backup` after a week of normal use.

## App changes — `index.html`

- **No invented ids:** remove `id:` from all 20 insert payloads; always use the row the
  database returns (drop the `saved||payload` fallback; `addPlayer` and sign-up switch
  from the local payload to the saved row).
- **Archive:** "Remove player" sets `archived_at` (confirmation says history is kept). The
  admin roster gets a **Former members** list with **Restore**.
- **Hidden when archived** (pick lists): player picker, Log Round group, issue fine,
  record payment, bulk entry, tournament assignment, Players roster, admin
  handicap-history panel.
- **Still shown when archived** (history): Season, Eclectic, Fines, Hall of Fame, admin
  rounds filter, rules-page pot count (they paid).
- **Old browser ids:** after data loads, a remembered/session player id that is not a
  current id but matches a `legacy_id` is replaced by the new id, and the
  `sl_units_{id}` / `sl_gps_detail_{id}` keys are renamed. No match → session cleared →
  normal login. A saved Log Round group with old ids is discarded.

## Testing

- **Committed harness** in `tests/` (runner + Phase 0 suite + Phase 1 suite), headless
  Chrome, network stubbed:
  - no insert sends `id`; each flow keeps the returned row;
  - Remove → archive PATCH, never DELETE; Restore clears it;
  - archived players absent from every pick list, present in every leaderboard;
  - legacy id translation, key renames, unknown id clears the session.
- **Before/after on real data:** read-only snapshot just before the real run, rendered
  through every leaderboard, Hall of Fame and Fines; repeated after with the new app.
  Text must match except the one expected difference: a "Former member" row (5 fines)
  appears in the Fines table.
- **Rehearsal report** reviewed before the real run.
- **Live:** confirm an insert gets the next id (create + delete a test fine type, with
  the user's OK).

## Rollout

1. Build SQL, rollback, cleanup, app, tests.
2. User runs the rehearsal, pastes the report; iterate until clean.
3. Real run (weekday evening, no live round) → immediate push → before/after comparison
   and live checks.
4. After a week: run `phase1_cleanup.sql`.

**Error window:** ~80 s between the SQL and the new app going live, during which an
old-version save fails (the database refuses its invented id). A reload fixes it.

## Estimate

| Task | Hours |
|---|---|
| Migration SQL with checks and rehearsal mode | 2.5 |
| Rollback + cleanup scripts | 0.5 |
| Remove id generation (20 sites) | 1 |
| Archive: remove→archive, Former members + Restore, pick-list filters | 2 |
| Legacy id translation + login change | 0.75 |
| Behaviour tests + move harness into repo | 1.5 |
| Before/after comparison tooling | 1 |
| Rehearsal round-trips | 1 |
| Go-live + live checks | 0.5 |
| **Total** | **10.75** |

## Out of scope

Real login and row-level permissions (Phase 2); GDPR export/erase, privacy notice,
retention (Phase 3); dropping `legacy_id` (Phase 2).
