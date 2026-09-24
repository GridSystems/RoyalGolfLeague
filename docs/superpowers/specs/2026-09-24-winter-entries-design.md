# Winter 2027 — season rules and opt-in entry

**Date:** 2026-09-24 · **Status:** approved in conversation, awaiting spec review
**Deadline:** live before the Summer 2026 final (3 Oct) so entries can open; Winter starts 4 Oct.

## Why

Winter 2027 changes two rules — **best 3** rounds count (Summer: 4) and the buy-in is **DKK 175**
(Summer: 250) — and entry becomes **opt-in**: only members who enter and pay are in the pot and the
prize standings. Today every approved, non-social member is automatically in, and "4" and "250" are
written into the code.

## Decisions (made in brainstorming)

| # | Decision |
|---|---|
| 1 | Season rules live in the existing `SEASONS` array, next to the eclectic allowance |
| 2 | A member who hasn't entered still plays, but appears **only on Today** (no prize place) — not in the Season or Eclectic tables of an opt-in season |
| 3 | Entering later counts **all** that member's rounds from the start of the season |
| 4 | Two-step entry: the member taps **Enter** ("entered, awaiting payment"), the admin marks **paid** |
| 5 | Unpaid entrants are **in the standings**, tagged "unpaid"; the **pot counts paid entries only** |
| 6 | Entries are stored in a new table, `season_entries` |
| 7 | Members may withdraw while unpaid; admins can enter a player on their behalf; social members don't see Enter |

## Season settings

```js
const SEASONS=[
  {name:'Summer 2026',from:'0000-01-01',eclectic:0.95,best:4,buyIn:250,entry:false},
  {name:'Winter 2027',from:'2026-10-04',eclectic:0.60,best:3,buyIn:175,entry:true},
];
```

- `best` — number of rounds counted in the season (IPS) standings.
- `buyIn` — DKK per entrant; the default amount when an admin marks an entry paid.
- `entry:false` — every approved non-social member is in (Summer 2026 behaves exactly as today).
- **Entry season** — `entrySeason()` returns the current season if it has `entry:true`, otherwise the
  next season if that has `entry:true`, otherwise none. Entries for the next season open as soon as
  it is defined as opt-in, i.e. for the whole of the current season, not just its last week.

## Data: `season_entries`

```
season_entries(id bigint identity PK, season text NOT NULL, player_id bigint NOT NULL
               REFERENCES players(id) ON DELETE RESTRICT, entered_at timestamptz NOT NULL default now(),
               paid_at timestamptz, amount numeric, recorded_by bigint REFERENCES players(id) ON DELETE SET NULL,
               UNIQUE (season, player_id))
```

`paid_at` null = awaiting payment. `amount` and `recorded_by` are set when marked paid.

**Permissions** (Row Level Security, the Phase 2 release A pattern):

| Who | Read | Insert | Update | Delete |
|---|---|---|---|---|
| anon (old PIN route) | `anon_all` allow-all until release B, as every table | | | |
| member | all rows | own row only, `paid_at`/`amount`/`recorded_by` null | — | own row, only while unpaid |
| admin in admin mode | all | any | any (mark paid / undo) | any |

Explicit `GRANT … TO anon, authenticated` (standing rule: new public tables need it). `id` is
`GENERATED ALWAYS`; the app sends no id.

**Audit** (trigger → `private.audit`, as the fines ledger): `season_entered`, `season_withdrawn`
(delete), `entry_paid` (`paid_at` null → set, details `{season, amount}`), `entry_unpaid` (set → null).
No other details.

## App

**Member banner** (Leaderboards → Season, top; the same status in My Profile), shown for the entry
season to approved, non-social, signed-in members:

- not entered → "Enter Winter 2027 — DKK 175, best 3 rounds count" + **Enter**
- entered, unpaid → "You're entered — payment not yet recorded", the MobilePay link and amount, **Withdraw**
- paid → "You're entered and paid ✓"

**Admin → "Winter 2027 entries"** (collapsible, like the other admin sections; season = entry season):

- summary: "N entered · N paid · DKK X received"
- **Awaiting payment** — name, **Mark paid**, **Remove**
- **Paid** — name, date, **Undo**
- **Enter a player…** — pick an active, non-social member without an entry
- Mark paid / Undo / Remove / Enter-for need admin mode (existing `requireAdminMode` flow)

**Who is in the prizes** — one helper, `inPrizes(p, season)`: not social, and (season has
`entry:false` or the player has an entry for it). Used by Season standings, Eclectic standings (opt-in
seasons only — Summer 2026's Eclectic still lists social members), Hall of Fame winners, and Today's
prize ranks. In an opt-in season a non-entrant appears only on Today, without a prize place. Unpaid entrants get a small **unpaid** tag in the Season and Eclectic tables.

**Best N** — `seasonStandings` counts `seasonInfo(season).best` rounds; "Best 4" headings and labels
(Season table, Rules page, Hall of Fame) read the season's own `best`.

**Pot** — Rules page, for the current season: `entry:false` → approved non-social × `buyIn` (as today);
`entry:true` → sum of paid `amount`. Then the existing MobilePay-fee deduction and 50/50 split.
`SEASON_PAY_HTML` and the sign-up text show the entry season's `buyIn`.

## Rollout

1. `supabase/season_entries.sql` — rehearsal switch; table, grants, policies, audit trigger; checks
   (policy count, grant present, trigger present, no stray policies). `supabase/season_entries_rollback.sql`.
2. The user runs the rehearsal, then the real run.
3. Push (no version-gate change: the live app ignores the new table, so SQL first, then push).
4. Live check: banner, enter, admin mark paid, audit rows.

## Testing

- **PGlite:** the RLS matrix rows for `season_entries` (anon, pending, member, admin without and with
  admin mode × read/insert/update/delete); a member can't enter someone else, can't insert as paid,
  can't mark paid, can't withdraw a paid entry; one entry per player per season; every audit event.
- **Headless app:** banner states and enter/withdraw; admin section (mark paid, undo, remove,
  enter-for, totals); standings best 3 with entrants only and the unpaid tag; a late entry counts
  earlier rounds; pot from paid entries only; `entrySeason()` during Summer's last week.
- **Summer unchanged:** leaderboard render against the live snapshot matches before and after.

## Out of scope

Automated payment matching (MobilePay has no API here), refunds, per-season fines, changing
`is_social`.
