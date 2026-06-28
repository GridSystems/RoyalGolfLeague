# Tournament Mode — Design Spec

## Overview

A two-team match-play tournament feature for Royal Golf Club Copenhagen. Supports recurring events (mid-season invitational, Saturday fun formats). Two rounds: fourball betterball (Round 1) then singles (Round 2). Live hole-by-hole scoring with Ryder Cup-style leaderboard.

**Key constraints:**
- Single HTML file, vanilla JS, Supabase REST — no build step
- Reuses existing player, handicap, and tee infrastructure
- No new auth layer — captain identity = active player on device

---

## Tournament Lifecycle

```
setup → fourball_draw → round_1 → singles_draw → round_2 → complete
```

| Status | Who acts | What happens |
|---|---|---|
| `setup` | Admin | Creates tournament, assigns players, names captains |
| `fourball_draw` | Both captains | Alternating picks to fill 4 fourball matches |
| `round_1` | Scorers | Hole-by-hole scoring for all 4 fourball matches |
| `singles_draw` | Both captains | Alternating picks to fill 8 singles matches |
| `round_2` | Scorers | Hole-by-hole scoring for all 8 singles matches |
| `complete` | — | All matches finished, final result shown |

Tournament advances to the next status automatically when all conditions are met (e.g. all 4 fourballs complete → status becomes `singles_draw`). This is client-side: any device loading the tournament tab detects the condition and PATCHes the status. Idempotent — a second PATCH of the same status is harmless.

---

## Supabase Schema

### `tournaments`
```
id               bigint (Date.now() + random)
name             text
date             text (YYYY-MM-DD)
tee_id           text (FK → tees.id)
status           text ('setup'|'fourball_draw'|'round_1'|'singles_draw'|'round_2'|'complete')
team_a_name      text
team_b_name      text
team_a_captain_id bigint (FK → players.id)
team_b_captain_id bigint (FK → players.id)
created_at       timestamptz
```

### `tournament_players`
```
id               bigint
tournament_id    bigint (FK → tournaments.id)
player_id        bigint (FK → players.id)
team             text ('a'|'b')
```

### `tournament_matches`
```
id               bigint
tournament_id    bigint (FK → tournaments.id)
round            int (1 = fourball, 2 = singles)
match_num        int (1–4 for fourballs, 1–8 for singles)
team_a_p1_id     bigint (FK → players.id)
team_a_p2_id     bigint (FK → players.id, null for singles)
team_b_p1_id     bigint (FK → players.id, null until opponent picks)
team_b_p2_id     bigint (FK → players.id, null for singles + until pick)
status           text ('pending'|'in_progress'|'complete')
result           text (null|'a'|'b'|'half')
created_at       timestamptz
```

### `tournament_scores`
```
id               bigint
match_id         bigint (FK → tournament_matches.id)
hole             int (1–18)
player_id        bigint (FK → players.id)
gross            int
```

### Grants (add to supabase/grants.sql)
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournaments         TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_players  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_matches  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_scores   TO anon, authenticated;
```

---

## Handicap Calculation

All calculations use the tournament tee. All players in a match play the same tee.

```js
// Course handicap
courseHcp(player, tee, date) = round(hcpOnDate(player, date) × tee.slope / 113 + (tee.rating - TOTAL_PAR))

// Playing handicap (90% allowance)
playingHcp(player, tee, date) = round(courseHcp × 0.90)
```

### Fourball strokes
```
teamACombined = playingHcp(a_p1) + playingHcp(a_p2)
teamBCombined = playingHcp(b_p1) + playingHcp(b_p2)
diff = |teamACombined - teamBCombined|
receivingTeam = whichever has higher combined HCP
strokeHoles = holes where HOLE_HCP[hole] <= diff  (SI 1 through diff)
```
On a stroke hole: **both players** on the receiving team get +1 applied to their individual stableford calculation for that hole.

### Singles strokes
```
diff = |playingHcp(a_p1) - playingHcp(b_p1)|
receivingPlayer = whichever has higher playing HCP
strokeHoles = holes where HOLE_HCP[hole] <= diff
```

### Stableford per player per hole
```js
strokes = isStrokeHole && playerIsOnReceivingTeam ? 1 : 0
pts = Math.max(0, 2 + par + strokes - gross)
```

### Better ball (fourballs only)
```
teamScore(hole) = Math.max(pts_p1, pts_p2)
holeResult = teamA_score > teamB_score ? 'a' : teamB_score > teamA_score ? 'b' : 'half'
```

### Match state
```
holesWon = { a: count, b: count, half: count }
matchStatus = holesWon.a - holesWon.b  // positive = team A up
```

Auto-close prompt triggers when: `Math.abs(matchStatus) > holesRemaining`
e.g. 3 up with 2 to play → "Match over — Team A wins 3&2. Confirm?"

---

## Captain's Draw

### Identity
A player navigating to the Tournament tab while that tournament is in `fourball_draw` or `singles_draw` status:
- If `activeId === tournament.team_a_captain_id` → show Team A captain view
- If `activeId === tournament.team_b_captain_id` → show Team B captain view
- Otherwise → read-only spectator view

### Pick order
Odd match numbers (1, 3, 5, 7): Team A captain picks their side first, Team B responds.
Even match numbers (2, 4, 6, 8): Team B captain picks their side first, Team A responds.

**Fourballs:** each "pick" is selecting 2 players from your unplaced roster.
**Singles:** each "pick" is selecting 1 player from your unplaced roster.

### Draw flow per match
1. The initiating captain sees their unplaced players — taps two (fourball) or one (singles) to nominate
2. Their pick saves immediately to `tournament_matches` (fills `team_X_p1_id` / `team_X_p2_id`)
3. The other captain's screen updates (polls every 5 s) — they now see the opponent's pick and must respond
4. Responding captain selects from their unplaced players — saves
5. Match status → `pending` (waiting for scorer to start)
6. Next match opens for the appropriate captain

A match is open for scoring as soon as both sides are filled — scorers do not wait for the full draw.

### Draw screen layout
- Top: Round 1 points tally (after `singles_draw`)
- Middle: Match rows — each shows current state (unfilled / one side picked / both filled)
- Bottom: Bench — unplaced players from your team, tappable when it's your turn
- "Waiting for [opponent]…" shown when it's not your turn

---

## Scoring Screen

Accessed by tapping any active (`in_progress`) match from the tournament tab. No auth — any device can score any match.

When the scorer opens a match it transitions to `in_progress` and becomes visible on the leaderboard.

### Layout (per hole)
```
Match header: Team A name vs Team B name · current match status (e.g. "A 2UP thru 11")
HCP banner: "[Team] receive N strokes · SI 1–N (H__, H__, …) · Both [team] players receive stroke on each"
Hole card:
  - Hole number, par, SI
  - Stroke badge if this is a stroke hole for the receiving team
  - TEAM A section: two player cards (name, gross entry, stableford pts, ★ if best ball)
  - TEAM B section: two player cards — if stroke hole, "+1 stroke" label on each
  - Team row: Team A best ball pts vs Team B best ball pts · hole result
Keypad (1–9, backspace, Next Hole →)
"Entering: [current player name]" — cycles through all 4 players per hole
Hole strip: previous holes colour-coded (S/L/½) · current hole highlighted
```

### Entry order per hole
Cycles: Team A P1 → Team A P2 → Team B P1 → Team B P2 → Next hole

Each player's gross saves to `tournament_scores` after entry using UPSERT on `(match_id, hole, player_id)` — scorer can re-enter a score to correct it before advancing. After all 4 entered, hole result is computed and displayed before advancing.

### Singles scoring
Same screen but only 2 players. No "better ball" row — just individual stableford comparison.

### Match close
Auto-prompt when `Math.abs(matchStatus) > holesRemaining`.
Manual close button always visible ("Close match" with confirm dialog).
On close: `tournament_matches.status = 'complete'`, `result` set to `'a'|'b'|'half'`.

---

## Tournament Tab — Leaderboard

Visible to all. Auto-refreshes every 30 s (or on return to tab).

### Team score header
```
[Team A name]   [A pts] – [B pts]   [Team B name]
```
Points = sum of completed match results only. 1pt per win, 0.5pt per half.

### Match rows (Ryder Cup style)
```
[Team A players] | [status/result] | [Team B players]
```
- Winning side: team colour wash on their name cell (red for A, blue for B)
- Halved: neutral wash on both
- Pending/not started: no wash, greyed
- Status cell: "2&1 F" (complete), "1UP H14 🔴" (live), "—" (not started)

### Live match expansion
Active matches show the hole strip below the name row (S/L/½ per hole, current hole highlighted in gold).

### Round tabs
Tab row: "Fourballs" | "Singles" — defaults to active round.

### Admin controls (admin-only, inline)
- During `setup`: "Edit tournament" button
- During draw phases: "Override draw" — admin can fill any unfilled pick
- During scoring: no extra controls (scoring is open to all)
- Complete: "Reset tournament" (with confirm)

---

## Navigation

New "Tournament" tab added to main nav between "Sign Up" and "Tee Sheet". Only visible when at least one tournament exists in Supabase. If multiple tournaments exist, a dropdown/selector at the top of the tab lets the user pick which one to view.

---

## SQL Migration

Run once in Supabase SQL Editor:

```sql
CREATE TABLE IF NOT EXISTS public.tournaments (
  id bigint PRIMARY KEY,
  name text NOT NULL,
  date text NOT NULL,
  tee_id text NOT NULL,
  status text NOT NULL DEFAULT 'setup',
  team_a_name text NOT NULL DEFAULT 'Team A',
  team_b_name text NOT NULL DEFAULT 'Team B',
  team_a_captain_id bigint,
  team_b_captain_id bigint,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tournament_players (
  id bigint PRIMARY KEY,
  tournament_id bigint NOT NULL REFERENCES public.tournaments(id),
  player_id bigint NOT NULL,
  team text NOT NULL CHECK (team IN ('a','b'))
);

CREATE TABLE IF NOT EXISTS public.tournament_matches (
  id bigint PRIMARY KEY,
  tournament_id bigint NOT NULL REFERENCES public.tournaments(id),
  round int NOT NULL,
  match_num int NOT NULL,
  team_a_p1_id bigint,
  team_a_p2_id bigint,
  team_b_p1_id bigint,
  team_b_p2_id bigint,
  status text NOT NULL DEFAULT 'pending',
  result text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tournament_scores (
  id bigint PRIMARY KEY,
  match_id bigint NOT NULL REFERENCES public.tournament_matches(id),
  hole int NOT NULL,
  player_id bigint NOT NULL,
  gross int NOT NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournaments         TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_players  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_matches  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_scores   TO anon, authenticated;
```

---

## Out of Scope

- More than 2 teams
- More than 2 rounds
- Stroke play format
- Player substitutions mid-tournament
- Historical tournament archive (beyond what Supabase retains)
