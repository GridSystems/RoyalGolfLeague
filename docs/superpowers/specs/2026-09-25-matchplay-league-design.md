# Season-long Matchplay League

**Date:** 2026-09-25 · **Status:** approved in conversation, awaiting spec review
**For:** next summer (2027). No deadline pressure — ship over the winter, try on a small test league first.

## Why

A second competition alongside the Saturday league: individual match play over the whole summer.
16 players, groups then playoffs, everyone plays exactly 5 matches, matches arranged by the
players themselves before a deadline.

## Decisions (made in brainstorming)

| # | Decision |
|---|---|
| 1 | **Extend the existing Tournament feature** with a second format (`league`) beside today's one-day team event (`team_day`); reuse its scoring screen, match status and stroke logic. No second copy. |
| 2 | **16 players**, **4 groups of 4**, round robin (3 matches each, 24 group matches in total) |
| 3 | **Playoffs: four brackets by group finishing position** — winners, runners-up, 3rds, 4ths. Each bracket: semi-finals, then final and 3rd/4th match → places 1–4, 5–8, 9–12, 13–16. Everyone plays exactly 5. |
| 4 | **Handicap:** playing handicap = round(course handicap × 90%) on the match tee and date; the lower player plays off **0**, the other receives the difference on stroke index 1…diff (a second stroke where diff > 18). Example: 12 and 20 (after allowance) → strokes on SI 1–8. |
| 5 | **Group points:** win 1, halve ½, loss 0. **Tie-breaks in order:** (a) result of the match between the tied players (for three or more: a mini-table of their matches against each other); (b) total holes won across the group stage; (c) lower average playing handicap across the player's group matches. |
| 6 | **Playoff halves:** sudden death from the start hole (1st or 10th tee, whichever the match started on), hole by hole at the same strokes, until a hole is won. Recorded as "won at the 19th / 20th …". |
| 7 | **Deadlines:** the admin sets a play-by date for each of the 5 rounds (group 1, 2, 3, semis, finals); a summer holiday break is simply a longer gap between two deadlines. |
| 8 | **Overdue matches:** the policy (walkover / halve / double forfeit) is **to be decided by the members**. The app lets an admin record any of the three, so any policy works without code changes. |
| 9 | **Entry:** opt-in; the **first 16** sign-ups are in, later ones form a **waiting list** that moves up if someone withdraws before the draw. Buy-in is a setting (may be 0); payment tracked like season entries. |
| 10 | **Draw: seeded.** The 16 are sorted by handicap index on the draw date into 4 pots of 4; each group gets one player from each pot at random. |
| 11 | **Scoring: hole-by-hole** on the existing match scoring screen; either player may enter; **no opponent confirmation**; the admin can correct any match. |
| 12 | **Matches are separate from Saturday rounds.** Always. |
| 13 | **Tee: 57 by default**; the players may choose another tee for their match if both agree (the existing per-match tee setting). |

## Data (extends the existing tournament tables)

- **tournaments** — `format text default 'team_day'` (`'team_day' | 'league'`), `deadlines jsonb`
  (`{"group_1":"YYYY-MM-DD", "group_2":…, "group_3":…, "semi":…, "final":…}`), `buy_in numeric default 0`,
  `max_players int default 16`, `default_tee_id text` ('57' for leagues).
- **tournament_players** — `entered_at timestamptz default now()` (sign-up order), `paid_at timestamptz`,
  `amount numeric` (CHECK: paid_at and amount both null or both set, amount ≥ 0), `recorded_by bigint`,
  `seed_pot int`, `group_num int`, `final_place int`.
- **tournament_matches** — `stage text` (`'group' | 'semi' | 'final' | 'place'`), `bracket int` (1–4),
  `group_round int` (1–3), `start_hole int default 1` (1 or 10), `extra_holes int default 0`,
  `outcome text default 'played'` (`'played' | 'walkover' | 'halve_decision' | 'double_forfeit'`),
  `decided_by bigint`.
- **tournament_scores** — unchanged; sudden-death holes are stored as holes 19, 20 … (hole number
  beyond 18 maps back to the start hole's sequence for par and stroke index).
- Existing team-day tournaments are untouched (`format` defaults to `'team_day'`).

## Flow

1. **Create** — admin: name, year, buy-in, default tee 57, the five deadlines.
2. **Entry** — members tap Enter on the Tournament tab; first 16 in, the rest waiting list; admin
   marks payments and can move a waiting-list player in before the draw. Uses the same entries
   panel as season entries (one shared view, not a copy).
3. **Draw** — admin presses Draw groups: pots by handicap index, one per group at random; groups
   lock; all 24 group matches are created with their group round and deadline.
4. **Group stage** — per group: table (P, W, H, L, points, holes won, average playing handicap,
   ordered by points then the tie-break chain), fixtures with round and deadline, "Overdue" once a
   deadline passes. A match closes itself when decided or after 18.
5. **Playoffs** — when all 24 group matches are finished or decided, the app creates the four
   brackets: semi-finals group A v B and C v D (by position); then final and 3rd/4th. A halved
   playoff match continues as sudden death on the same screen.
6. **Result** — places 1–16 on the Tournament tab; the bracket-1 winner in the Hall of Fame as
   "Matchplay champion".
7. **Admin** — edit any match; record walkover / halve by decision / double forfeit (a halve by
   decision only in the group stage; in playoffs the admin names who goes through); move
   deadlines; swap waiting-list players in before the draw.

## Permissions (Phase 2 pattern)

- Members: enter / withdraw themselves before the draw (own row, unpaid); read everything; write
  scores for matches they play in.
- A match's status/result may be set only by one of its two players or by an admin in admin mode
  (trigger-enforced).
- Admin in admin mode: create league, draw, payments, outcomes, deadlines, edits.
- Old PIN route: allow-all until release B, as every table.
- Audit: entered, withdrew, paid / unpaid, every admin match decision (outcome, result edit).

## Rollout

One migration script with the rehearsal switch (the user runs it), plus a rollback. No version-gate
change if the live app tolerates the new columns (it reads them only when `format='league'`).

## Testing

- Draw: each group has exactly one player from each pot; 16 distinct players.
- Fixtures: 24 group matches, every pair in a group exactly once, 2 per group per round.
- Standings: points; every tie-break step, including a three-way tie resolved by mini-table.
- Playoffs: brackets built from group positions; A v B and C v D; everyone reaches 5 matches.
- Strokes: low off zero, 90%, diff > 18, the 12 v 20 example (SI 1–8).
- Sudden death from the 1st and from the 10th; recorded hole count.
- Overdue marking; each admin outcome and its effect on standings / progression.
- Team-day tournaments: all existing tests stay green.
- PGlite: RLS matrix for the new columns (member scores only own matches; only players or admin
  close a match; members can't mark themselves paid).

## Out of scope

Automatic walkover rules (decided later by members), notifications/reminders, matches played
inside Saturday rounds, handicap limits, prize money split for the league.
