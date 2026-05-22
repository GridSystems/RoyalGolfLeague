# Dual-Scorer System — Design

**Date:** 2026-05-22

## Goal

Allow two players to independently score the same group's round simultaneously — one via Log Round hole-by-hole entry, one via GPS tracker End Hole confirmations. Scores are compared live; conflicts must be resolved by the scorer who entered incorrectly before the round can be submitted.

## Current state

- `HE` (hole entry state) is in-memory only — lost on app close
- `groupPlayerIds` and `playerTees` are in-memory only — group must be rebuilt from scratch after every app close
- `rounds` table has a single `holes` JSONB column — one scorecard per round, no second scorer
- Resume flow requires navigating a banner → Step 1b → manually re-ticking group members

## Changes

---

### 1. Data model

Two new columns on the `rounds` table (already added to Supabase):

```sql
ALTER TABLE public.rounds ADD COLUMN IF NOT EXISTS marker_id bigint;
ALTER TABLE public.rounds ADD COLUMN IF NOT EXISTS marker_holes jsonb;
```

- `marker_id` — player ID of the second scorer marking this round
- `marker_holes` — their independent scorecard, same structure as `holes`: `[{hole, score, par, hcp}×18]`

`holes` = scorer A's scorecard (Log Round).
`marker_holes` = scorer B's scorecard (GPS tracker End Hole).
Neither is authoritative — they must converge before submission.

---

### 2. Group session persistence

On `heInit` (round start) and on resume, save to `localStorage` key `sl_active_group`:

```json
{
  "date": "2026-05-22",
  "players": [{"id": 123, "teeId": "platinum"}, ...],
  "startHole": 1,
  "scorerPlayerId": 456
}
```

`scorerPlayerId` = `activeId` at session start. Each phone knows which player it is in the group.

**Auto-restore on Log Round open:**
If `sl_active_group` exists, date matches today, and those player rounds exist in Supabase with < 18 holes scored — show a single **"Resume round with [Name, Name…] →"** button above the setup form. Tapping it bypasses setup entirely and drops straight into the scoring screen via `heInit` with the saved player/tee data.

**Clear** `sl_active_group` from localStorage when `saveGroupRound()` completes successfully.

---

### 3. Log Round scorer flow

Score entry is unchanged — hole-by-hole, patching `holes` on each player's round.

**On `heInit`:** each round is created with `marker_id = null` and `marker_holes = null`. These are populated later when the GPS tracker connects.

**Hole progress bar indicators** — each hole button gets a three-state badge when a second scorer is active (i.e. any round in the group has `marker_holes != null`):

| State | Condition | Display |
|---|---|---|
| ○ | Only one scorer has entered, or neither | Grey (current empty style) |
| ✓ | Both entered, values match for all players | Green |
| ⚠ | Both entered, values differ for any player | Amber |

If no round in the group has `marker_holes`, indicators stay as today (no change for solo scoring).

---

### 4. GPS tracker scorer flow

**"Scoring for" at GPS setup:**
A new checklist section appears below the existing tee/date/hole selectors. Shows all players who have rounds today at the same tee time as the GPS tracker's own round (matched via `activeId`'s round `tee_time`). Falls back to all rounds for today's date if the GPS tracker has no round for today.

GPS tracker selects which players they are scoring for. Selection stored in `GR.scoringForIds` (array of player IDs).

**End Hole confirmation:**
The GPS tracker first confirms their own gross score as today. Then, for each player in `GR.scoringForIds`, a per-player score confirmation appears in sequence — same shot-count hint, same confirm/adjust input. The GPS tracker steps through each player before advancing to the next hole.

On confirm for each player:
- Patches `marker_holes[hole-1].score` on that player's round in Supabase
- Sets `marker_id` to `activeId` on that round if not already set
- Does NOT touch `holes`

**If `scoringForIds` is empty:** End Hole behaves exactly as today — scores feed into `finishGpsRound` → `holes` only, no marker logic.

---

### 5. Live comparison and conflict resolution

After either scorer patches a score, the app reloads the affected round from `allRounds` (or re-fetches) and computes hole state for all players:

```
for each hole h (1–18):
  for each player p in group:
    a = holes[h].score for p
    b = marker_holes[h].score for p
    if a == null || b == null → ○
    if a === b → ✓
    if a !== b → ⚠
hole state = worst of all players (⚠ > ○ > ✓)
```

**Resolution modal** — opened by tapping a ⚠ hole indicator:

```
Hole 7 — Par 4

  Chris    You: 5    Other: 4    [Accept 4]
  Nick     You: 6    Other: 6    ✓
  James    You: 4    Other: 5    [Accept 5]
```

- "You" = the score on your side (`holes` for Log Round scorer, `marker_holes` for GPS tracker)
- "Other" = the score on their side
- **[Accept N]** patches only your own side to match theirs
- ✓ rows are display-only — no action needed
- Modal closes automatically when all rows are ✓
- Either scorer can open the resolution modal — but each can only act on their own side

The app determines "your side" from `sl_active_group.scorerPlayerId` matched against `activeId`:
- If `activeId` is the Log Round scorer → "You" = `holes`
- If `activeId` is the GPS tracker (`marker_id`) → "You" = `marker_holes`

---

### 6. Submit gate

`saveGroupRound()` checks every player's round before saving:

- If `marker_holes` is present on a player's round: all 18 `holes[h].score` must equal all 18 `marker_holes[h].score`
- If `marker_holes` is null (solo scoring): saves as normal

If any ⚠ conflicts remain, submission is blocked. Error message lists the specific holes and players with unresolved conflicts:

> "Cannot save — unresolved conflicts on Hole 7 (Chris, James), Hole 12 (Chris)"

No partial saves.

---

## Out of scope

- More than two scorers per round
- UUID migration (tracked separately — `Date.now()` bigint IDs used throughout)
- Real-time push (second scorer's changes appear on reload / next patch, not via websocket)
- Scorer assignment for solo rounds (marker logic only activates when `marker_holes` is present)
