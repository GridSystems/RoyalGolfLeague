# Season-long Matchplay League Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second tournament format, `league`: a 16-player, season-long individual matchplay league (4 seeded groups of 4, round robin, then four playoff brackets by group position, places 1–16), played hole by hole on the existing match scoring screen, with strict, tested rules for what happens when a finished match is edited.

**Architecture:** Extend the existing tournament tables and code, with no second copy. Everything a league shows is **derived** every time from match rows, scores and admin outcomes. That covers each match's decision, group tables, who plays in each playoff slot, final places and the champion. All pure logic sits in plain functions that can be tested without the DOM: `mlDecide`, `mlDrawGroups`, `mlFixtures`, `mlStandings`, `mlPlan`, `mlPlaces`, `mlGate`. Every write to a league match goes through one function, `mlChange`. It first tries the change on copies and runs the edit rules (`mlGate`). It then either refuses and writes nothing, or it writes the change, syncs the stored status/result cache and updates the affected playoff slots in place. The database adds columns, CHECKs, one trigger that decides who may change what on a league match, restrictive score policies, entry policies and an audit trigger. There is no version-gate change.

**Tech Stack:** Single-file vanilla JS app (`index.html`, CRLF), Supabase Postgres + PostgREST, PGlite SQL tests (`node --test`), headless-Chrome app tests (`tests/run.ps1`).

**Spec:** `docs/superpowers/specs/2026-09-25-matchplay-league-design.md`

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/matchplay_league.sql` (create) | Migration: columns, CHECKs, unique indexes, helper functions, trigger `protect_league_match`, trigger `protect_league`, entry policies, restrictive score policies, audit triggers, CHECKS block, rehearsal switch |
| `supabase/matchplay_league_rollback.sql` (create) | Undo: deletes league tournaments, drops everything the migration added; team day untouched; safe to re-run |
| `tests/sql/matchplay.test.mjs` (create) | PGlite: RLS/trigger matrix, CHECKs, uniques, audit, rehearsal/rollback |
| `index.html` (modify) | League pure logic (block before `function currentHcp(player){`), league live/UI/admin code (block before `function renderSaturdayAdmin(){`), small edits to `tmMatchHcpInfo`, `tmHoleResult`, `teOpenMatch`, `renderMatchScoring`, `teEnter`, hole navigation, `teChangeTee`, `renderTournament`, `renderAdminTournament`, entries panel generalisation, Hall of Fame, `init`, `AUDIT_LABELS` |
| `tests/matchplay.test.js` (create) | Headless browser tests for everything in `index.html` |
| `CLAUDE.md` (modify) | Matchplay league section |

## Global Constraints

- **Extend, don't duplicate** (spec decision 1). League code reuses `tmPlayingHcp`, `tmMatchHcpInfo`, `tmHoleResult`, `strokesOnHole`, `teOpenMatch`/`renderMatchScoring`, `shuffleDraw`, `entryBoxHtml`/`entriesPanelHtml` (generalised from season entries) and `adminEntryWrite`.
- **Team day stays as it is.** `format` defaults to `'team_day'`. No team-day behaviour, permission or render changes. The one shared-code change: singles now use `strokesOnHole(diff, i)`. That gives the same strokes whenever diff ≤ 18 and fixes diff > 18.
- **Handicap:** playing handicap = `round(course handicap × 0.90)` on the match tee and the match's `played_on` date (`tmPlayingHcp`, unchanged). The lower player plays off **0**. The other receives the difference: one stroke on SI 1…diff, and a second where diff > 18 (SI 1…diff−18). Example: 12 v 20 → strokes on SI 1–8.
- **Group points:** win 1, halve ½, loss 0. Admin outcomes give walkover 1/0, halve by decision ½/½, double forfeit 0/0 (played and lost for both), and none of them adds any holes won. **Tie-breaks, in order:** (a) results among the tied players (a mini-table of their own matches when three or more are tied); (b) total holes won in the group stage; (c) lower average playing handicap over the player's *played* group matches (none → ranks last on this step); (d) seed pot (never tied inside a group). A step that splits a tied set restarts the chain at (a) for each smaller tied set.
- **Playoffs:** bracket b (1 Winners, 2 Runners-up, 3 Thirds, 4 Fourths) = group position b. Semi 1 = Group A b-th v Group B b-th; semi 2 = C v D. Final = the two semi winners; 3rd/4th = the two semi losers. Places run 4(b−1)+1 … 4b. The two semis are round 4 (match_num 2b−1, 2b). The final is round 5, match_num 2b−1, and the 3rd/4th match is round 5, match_num 2b.
- **Sudden death** (playoffs only): holes 19, 20 … replay the course from the match's `start_hole` (1 or 10), at the same strokes (`tmHoleIdx`). The match is decided by the first hole won, e.g. "won at the 20th", with `extra_holes` = 2.
- **Deadlines:** `tournaments.deadlines` = `{"group_1","group_2","group_3","semi","final"}` (YYYY-MM-DD), one per round 1–5 (`ML_ROUND_KEYS`). A match is **Overdue** when `today() > deadline` and it isn't decided.
- **A match's decision is derived, never trusted from storage.** `mlDecide` walks the play order and stops at the deciding hole. `status`/`result`/`extra_holes`/`played_on` are a cache written by `mlSyncFields` after every change. A league match is **started** once it has any score or an admin outcome (`outcome ≠ 'played'`). Opening the scoring screen does not start a league match.
- **THE EDIT RULES (strictly tested; user requirement):**
  1. Editing or re-deciding a GROUP match (a score, the tee, the start hole, or an admin outcome) recomputes the group standings. If **any** playoff match has started (a score or an outcome), the change is **refused**, with a message naming the blocking match, and **nothing** is written. Otherwise every playoff slot is rebuilt from the new standings.
  2. Editing a SEMI-FINAL: if its bracket's final or 3rd/4th match has started, the change is **refused** (naming it) and nothing changes. Otherwise those two matches are rebuilt. Other brackets are never touched.
  3. Editing a FINAL or 3rd/4th match changes final places, and for the bracket-1 final the Hall of Fame champion, and **nothing else**.
  4. **Re-opening** follows the same rules. If a correction means a closed match is no longer decided, the match re-opens (`status` back to `in_progress`, `result` null). Examples: a 3&2 that becomes 2 up with 2 to play, or a playoff match that is now level after 18 and needs sudden death. Every playoff slot that depended on it is emptied, provided it hasn't started.
  5. **Admin outcomes** (walkover, `halve_decision` [group only], double forfeit) are edits and follow rules 1–3. A playoff double forfeit must name who goes through (`result` 'a'/'b').
  6. **Rebuild = the same match rows updated in place.** All 40 league match rows are created at the draw. Playoff slots are filled, emptied or re-filled by PATCHing `team_a_p1_id`/`team_b_p1_id`. They are never deleted or re-inserted.
  7. **Final places and the champion are derived on every render** (`mlPlaces`, `mlChampion`). There is no stored place column, so nothing can go stale.
- **Permissions (Phase 2 pattern):**
  - A league match's status/result/tee/start hole/played_on/extra holes may be changed only by one of its two players, or by an admin in admin mode. Only an admin can change a finished match, and outcomes are admin-only. These are enforced by the trigger `protect_league_match`.
  - Any member may fill an **empty**, unstarted playoff slot. Overwriting or emptying a filled slot needs admin mode.
  - Scores for league matches: only the match's two players (for either of them), and only until the match is finished; admins always. These are restrictive policies.
  - Entries: members enter or withdraw themselves (own row, unpaid, before the draw). `entered_at` is forced to the insert time. Members can't mark themselves paid.
  - League tournament rows are admin-only. The old PIN route (anon) stays allow-all until release B.
- **Writes:** `sbUpdate`/`sbDelete`/`sbInsert` returning `[]` is a **failure** (RLS filtered it). Treat it the way `adminEntryWrite` does. Admin writes call `requireAdminMode()` first. Player names in new league UI go through `escHtml`.
- **No version-gate change.** `APP_VERSION` stays 3. The live app reads the new columns only for `format='league'`.
- **Files:** `index.html` and the repo's existing files are CRLF. Keep them CRLF, and check that `git diff --stat` shows no whole-file churn. New code goes in these places:
  - League pure logic goes immediately **before** `function currentHcp(player){`.
  - League live, UI and admin code goes immediately **before** `function renderSaturdayAdmin(){`.
  - Each task appends below the previous task's block, so blocks stay in task order.
- **Tests that must stay green:** winter **66**, phase0 **27**, phase1 **37**, phase2a **76**, SQL **108** (plus the new file), and `leaderboards.render.js` against `%TEMP%\rgc-phase1\snapshot-live-2026-09-24.json`.
- **Commits:** end every commit message with these two lines, preceded by a blank line:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01N6cfxP9mcgmYjbs4UMRCnG
  ```
  Commit with `git commit -F- <<'EOF' … EOF` from the Bash tool. Stay on branch `matchplay-league`.

## Review Focus

1. **The 30-second Tournament refresh replaces every match object while someone is scoring.** Their next score must update the live match object, not a stale copy, so status and progression don't drift. Pinned in Task 7 ("after a refresh, scoring updates the live match object").
2. **A player with no handicap history at the draw** (`hcpOnDate` → undefined) must land in the last pot, and the draw must not crash or produce `NaN` pots. Pinned in Task 9 ("a player with no handicap lands in the last pot").
3. **An admin cancels the authenticator prompt while correcting a finished match.** Nothing is written, not even the score. Pinned in Task 7 ("admin mode cancelled: refused, nothing written").
4. **Tournament rows loaded before the migration runs** (no `format` field) must still render as team day. Pinned in Task 6 ("a tournament without format renders as team day").
5. **Player names containing HTML** in league tables, fixtures and brackets must be escaped. Pinned in Task 6 ("names are escaped").

## Spec rulings (ambiguities resolved in this plan)

- `default_tee_id`: not added. The existing `tournaments.tee_id` is the league's default tee (57 in the create form).
- `group_round`: not added. The existing `tournament_matches.round` is used: 1–3 for the group rounds, 4 for the semis, 5 for the final and 3rd/4th. That maps one-to-one onto the five deadlines.
- `final_place`: not added. Places are derived on every render (edit rule 7).
- `played_on` (new column): the day of the match's first score, which sets the handicap date ("on the match tee and date").
- League `tournament_players.team` = `'league'`. The column is NOT NULL.
- League `tournaments.status`: `'entry'` then `'drawn'`. The group, playoff and finished phases are derived.
- All 40 match rows are created at the draw. Playoff slots are filled, emptied and re-filled in place.
- Any member may fill an empty, unstarted playoff slot (this is how progression happens after a member closes a match). Overwriting or emptying a slot needs admin mode.
- After a match is decided, only an admin can change it. Players can't re-open their own match.
- A group edit is refused once **any** playoff match has started, even one the edit wouldn't affect. This is the literal rule.
- "Started" means any score or an admin outcome. Opening the scoring screen doesn't start a league match.
- Group double forfeit counts as played and lost for both, with 0 points. No admin outcome adds holes won.
- Average playing handicap covers played group matches only. A player with none ranks last on that step. After tie-break (c) comes the seed pot, which always separates players within a group.
- Equal handicap indexes across a pot boundary are ordered by sign-up time. A player with no handicap goes in the last pot.
- The draw needs exactly 16 players in. `max_players` stays 16 and isn't editable.
- Admin "Move in" sets the waiting player's `entered_at` just ahead of the 16th player in.
- Social members may enter a league. The spec doesn't exclude them, and prize money is out of scope.
- `entered_at` is forced to the insert time for members (`WITH CHECK entered_at = now()`).
- Singles strokes use `strokesOnHole(diff)` for every singles match, team day included. The strokes are identical whenever diff ≤ 18.
- Restrictions on scores and matches apply to league matches only. Team-day permissions are unchanged.
- The Hall of Fame champion is listed under `seasonOf(tournaments.date)` (the league's start date).
- The Reset button (`resetTournament`) is not offered for leagues.

---

### Task 1: Migration, rollback and permission tests

**Files:**
- Create: `supabase/matchplay_league.sql`
- Create: `supabase/matchplay_league_rollback.sql`
- Test: `tests/sql/matchplay.test.mjs`

**Interfaces:**
- Consumes: `private.is_admin()`, `private.is_member()`, `private.current_player()`, `private.audit(action,target,details)` from `supabase/phase2a_auth.sql`. Test helpers `productionDb`, `as`, `persona`, `run`, `sqlFile` come from `tests/sql/testbed.mjs`.
- Produces (DB):
  - `tournaments`: `format text` ('team_day'|'league'), `deadlines jsonb`, `buy_in numeric`, `max_players int`.
  - `tournament_players`: `entered_at`, `paid_at`, `amount`, `recorded_by`, `seed_pot`, `group_num`.
  - `tournament_matches`: `stage` ('group'|'semi'|'final'|'place'), `bracket`, `start_hole`, `extra_holes`, `outcome` ('played'|'walkover'|'halve_decision'|'double_forfeit'), `decided_by`, `played_on text`.
  - League `tournament_players.team` is `'league'`. League `tournaments.status` is `'entry'` then `'drawn'`.
  - Audit actions: `league_entered`, `league_withdrawn`, `league_paid`, `league_unpaid`, `league_entry_moved`, `match_outcome`, `match_edited`, `match_players_changed`.

- [ ] **Step 1: Write the failing test**

Create `tests/sql/matchplay.test.mjs`:

```js
import test from 'node:test'; import assert from 'node:assert/strict';
import { productionDb, as, persona, run, sqlFile } from './testbed.mjs';
const REAL = f => sqlFile(f).replace('SELECT true AS rehearsal', 'SELECT false AS rehearsal');
const one = async (db, q, p) => (await db.query(q, p)).rows[0];
// 'denied' = refused by RLS or a trigger (42501); any other error shows its own SQLSTATE.
const tryQ = async (db, sql) => { try { const r = await db.query(sql); return r.rows.length || r.affectedRows; } catch (e) { return e.code === '42501' ? 'denied' : (e.code || e.message); } };
// Back to the superuser with no login claims — as() leaves claims set, and the league triggers read auth.uid().
const su = async db => { await db.exec('RESET ROLE'); await db.query(`SELECT set_config('request.jwt.claims', '{}', false)`); };

async function world() {
  const db = await productionDb();
  assert.equal(await run(db, REAL('phase2a_auth.sql')), null);
  assert.equal(await run(db, REAL('matchplay_league.sql')), null);
  await su(db);
  await db.query(`UPDATE public.players SET approved=false WHERE id=5`);
  const id = async (q, p) => (await one(db, q + ' RETURNING id', p)).id;
  const L = await id(`INSERT INTO public.tournaments(name,date,tee_id,format,status,buy_in,deadlines) VALUES ('Matchplay 2027','2027-04-01','57','league','drawn',200,'{"group_1":"2027-05-15"}')`);
  const E = await id(`INSERT INTO public.tournaments(name,date,tee_id,format,status,buy_in) VALUES ('Next league','2028-04-01','57','league','entry',200)`);
  const TD = (await one(db, `SELECT min(id) AS id FROM public.tournaments WHERE format='team_day'`)).id;
  const M = (round, num, stage, bracket, a, b, status = 'pending', result = null) => id(
    `INSERT INTO public.tournament_matches(tournament_id,round,match_num,stage,bracket,team_a_p1_id,team_b_p1_id,status,result) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [L, round, num, stage, bracket, a, b, status, result]);
  const m = {
    own: await M(1, 1, 'group', null, 2, 3, 'in_progress'),     // the member (player 2) plays in this one
    other: await M(1, 2, 'group', null, 3, 4, 'in_progress'),   // … and not in this one
    done: await M(2, 1, 'group', null, 2, 4, 'complete', 'a'),  // finished; the member won
    semiEmpty: await M(4, 1, 'semi', 1, null, null),
    semiFilled: await M(4, 2, 'semi', 1, 6, 7),
    td: await id(`INSERT INTO public.tournament_matches(tournament_id,round,match_num) VALUES ($1,2,1)`, [TD]),
  };
  await db.query(`INSERT INTO public.tournament_scores(match_id,hole,player_id,gross) VALUES ($1,1,3,5)`, [m.other]);
  await db.query(`INSERT INTO public.tournament_players(tournament_id,player_id,team,group_num,seed_pot) VALUES ($1,3,'league',1,2),($1,4,'league',1,3)`, [L]);
  await db.query(`INSERT INTO public.tournament_players(tournament_id,player_id,team) VALUES ($1,3,'league')`, [E]);
  const P = { anon: null, pending: await persona(db, { playerId: 5 }), member: await persona(db, { playerId: 2 }),
    adminNo2fa: await persona(db, { playerId: 1, admin: true }) };
  P.admin = { ...P.adminNo2fa, aal: 'aal2', amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) - 60 }] };
  return { db, P, L, E, TD, m };
}

const SCORE = (mid, hole, pid) => `INSERT INTO public.tournament_scores(match_id,hole,player_id,gross) VALUES (${mid},${hole},${pid},4)`;
const MATCH = (mid, set) => `UPDATE public.tournament_matches SET ${set} WHERE id=${mid}`;
const ENTER = (tid, pid, extra = '', vals = '') => `INSERT INTO public.tournament_players(tournament_id,player_id,team${extra}) VALUES (${tid},${pid},'league'${vals})`;
const MATRIX = [
  // scores: members score only matches they play in (for either player), and only until finished
  ['member', 'score own match (either player)',        w => SCORE(w.m.own, 1, 3), 1],
  ['member', 'score a match they are not in',          w => SCORE(w.m.other, 2, 3), 'denied'],
  ['member', 'score for someone outside the match',    w => SCORE(w.m.own, 1, 9), 'denied'],
  ['member', 'delete a score in a match they are not in', w => `DELETE FROM public.tournament_scores WHERE match_id=${w.m.other}`, 0],
  ['member', 'score own finished match',               w => SCORE(w.m.done, 1, 2), 'denied'],
  ['admin',  'score any match, finished too',          w => SCORE(w.m.done, 1, 2), 1],
  ['anon',   'score any match (PIN route)',            w => SCORE(w.m.other, 2, 3), 1],
  ['member', 'team-day score, not in the match (unchanged)', w => SCORE(w.m.td, 1, 9), 1],
  // match status / result / outcome / players
  ['member', 'close own match',                        w => MATCH(w.m.own, `status='complete', result='a'`), 1],
  ['member', 'change own match tee and start hole',    w => MATCH(w.m.own, `tee_id='54', start_hole=10`), 1],
  ['member', 'close a match they are not in',          w => MATCH(w.m.other, `status='complete', result='a'`), 'denied'],
  ['member', 're-open own finished match',             w => MATCH(w.m.done, `status='in_progress', result=NULL`), 'denied'],
  ['member', 'record an outcome on own match',         w => MATCH(w.m.own, `outcome='walkover', result='a'`), 'denied'],
  ['member', 'change who plays a group match',         w => MATCH(w.m.own, `team_b_p1_id=9`), 'denied'],
  ['member', 'fill an empty playoff slot',             w => MATCH(w.m.semiEmpty, `team_a_p1_id=2, team_b_p1_id=9`), 1],
  ['member', 'overwrite a filled playoff slot',        w => MATCH(w.m.semiFilled, `team_a_p1_id=2`), 'denied'],
  ['adminNo2fa', 'record an outcome',                  w => MATCH(w.m.other, `outcome='walkover', result='a'`), 'denied'],
  ['admin',  'record an outcome',                      w => MATCH(w.m.other, `outcome='walkover', result='a'`), 1],
  ['admin',  're-open a finished match',               w => MATCH(w.m.done, `status='in_progress', result=NULL`), 1],
  ['admin',  'rebuild a filled playoff slot',          w => MATCH(w.m.semiFilled, `team_a_p1_id=2`), 1],
  ['anon',   'record an outcome (PIN route)',          w => MATCH(w.m.other, `outcome='walkover', result='a'`), 1],
  // the league row itself
  ['member', 'move a league deadline',                 w => `UPDATE public.tournaments SET deadlines='{}' WHERE id=${w.L}`, 'denied'],
  ['member', 'rename a team-day tournament (unchanged)', w => `UPDATE public.tournaments SET name='Cup' WHERE id=${w.TD}`, 1],
  ['admin',  'move a league deadline',                 w => `UPDATE public.tournaments SET deadlines='{}' WHERE id=${w.L}`, 1],
  // entries
  ['member', 'enter self in an open league',           w => ENTER(w.E, 2), 1],
  ['member', 'enter someone else',                     w => ENTER(w.E, 6), 'denied'],
  ['member', 'enter self as paid',                     w => ENTER(w.E, 2, ',paid_at,amount', ',now(),200'), 'denied'],
  ['member', 'enter self with an earlier sign-up time', w => ENTER(w.E, 2, ',entered_at', `,now()-interval '1 day'`), 'denied'],
  ['member', 'enter self already placed in a group',   w => ENTER(w.E, 2, ',group_num,seed_pot', ',1,1'), 'denied'],
  ['member', 'enter self into a drawn league',         w => ENTER(w.L, 2), 'denied'],
  ['member', 'mark someone paid',                      w => `UPDATE public.tournament_players SET paid_at=now(), amount=200 WHERE tournament_id=${w.E}`, 0],
  ['pending', 'enter self',                            w => ENTER(w.E, 5), 'denied'],
  ['admin',  'mark an entry paid',                     w => `UPDATE public.tournament_players SET paid_at=now(), amount=200 WHERE tournament_id=${w.E} AND player_id=3`, 1],
  ['admin',  'enter a player',                         w => ENTER(w.E, 6), 1],
];
for (const [who, what, sql, want] of MATRIX) test(`${who}: ${what}`, async () => {
  const w = await world(); await as(w.db, w.P[who]);
  assert.equal(await tryQ(w.db, sql(w)), want);
});

test('a member withdraws their own league entry only while unpaid and before the draw', async () => {
  const { db, P, E } = await world();
  const del = `DELETE FROM public.tournament_players WHERE tournament_id=${E} AND player_id=2`;
  await as(db, P.member);
  await db.query(ENTER(E, 2));
  assert.equal(await tryQ(db, `UPDATE public.tournament_players SET paid_at=now(), amount=200 WHERE tournament_id=${E} AND player_id=2`), 0);
  assert.equal(await tryQ(db, del), 1);
  await db.query(ENTER(E, 2));
  await su(db); await db.query(`UPDATE public.tournament_players SET paid_at=now(), amount=200 WHERE tournament_id=${E} AND player_id=2`);
  await as(db, P.member); assert.equal(await tryQ(db, del), 0);                 // paid: stays
  await su(db); await db.query(`UPDATE public.tournament_players SET paid_at=NULL, amount=NULL WHERE tournament_id=${E} AND player_id=2`);
  await db.query(`UPDATE public.tournaments SET status='drawn' WHERE id=${E}`);
  await as(db, P.member); assert.equal(await tryQ(db, del), 0);                 // drawn: stays
});

test('the league CHECKs hold', async () => {
  const { db, m, L, E } = await world();
  const bad = [
    MATCH(m.semiFilled, `outcome='halve_decision', result='half'`),  // halve by decision: group only
    MATCH(m.other, `outcome='walkover'`),                             // a walkover needs a winner
    MATCH(m.semiFilled, `outcome='double_forfeit'`),                  // playoff: name who goes through
    MATCH(m.td, `outcome='walkover', result='a'`),                    // outcomes are league-only
    MATCH(m.own, `start_hole=5`),
    MATCH(m.own, `extra_holes=-1`),
    MATCH(m.own, `stage='quarter'`),
    MATCH(m.own, `bracket=1`),                                        // group matches have no bracket
    `UPDATE public.tournaments SET format='cup' WHERE id=${L}`,
    `UPDATE public.tournaments SET buy_in=-1 WHERE id=${L}`,
    `UPDATE public.tournament_players SET paid_at=now() WHERE tournament_id=${E}`,   // paid_at without amount
    `UPDATE public.tournament_players SET seed_pot=5 WHERE tournament_id=${E}`,
  ];
  for (const sql of bad) assert.equal(await tryQ(db, sql), '23514', sql);
  assert.equal(await tryQ(db, MATCH(m.semiFilled, `outcome='double_forfeit', result='b'`)), 1);
  assert.equal(await tryQ(db, MATCH(m.other, `outcome='double_forfeit', result=NULL`)), 1);
  assert.equal(await tryQ(db, MATCH(m.own, `outcome='halve_decision', result='half'`)), 1);
});

test('one row per league match slot and one entry per player', async () => {
  const { db, L, E, TD } = await world();
  assert.equal(await tryQ(db, `INSERT INTO public.tournament_matches(tournament_id,round,match_num,stage) VALUES (${L},1,1,'group')`), '23505');
  assert.equal(await tryQ(db, `INSERT INTO public.tournament_matches(tournament_id,round,match_num) VALUES (${TD},2,1)`), 1);  // team day: unchanged
  assert.equal(await tryQ(db, ENTER(E, 3)), '23505');
});

test('entries, payments and admin match decisions are audited; a player closing their own match is not', async () => {
  const { db, P, L, E, m } = await world();
  await as(db, P.member); await db.query(MATCH(m.own, `status='complete', result='a'`));
  await as(db, P.admin);
  await db.query(ENTER(E, 6));
  await db.query(`UPDATE public.tournament_players SET paid_at=now(), amount=200, recorded_by=1 WHERE tournament_id=${E} AND player_id=6`);
  await db.query(`UPDATE public.tournament_players SET paid_at=NULL, amount=NULL, recorded_by=NULL WHERE tournament_id=${E} AND player_id=6`);
  await db.query(`DELETE FROM public.tournament_players WHERE tournament_id=${E} AND player_id=6`);
  await db.query(MATCH(m.other, `outcome='walkover', result='b', decided_by=1`));
  await db.query(MATCH(m.done, `status='in_progress', result=NULL`));
  await db.query(MATCH(m.semiFilled, `team_a_p1_id=8`));
  await su(db);
  const six = (await db.query(`SELECT action, actor_player_id, details FROM public.audit_log WHERE target_player_id=6 ORDER BY id`)).rows;
  assert.deepEqual(six.map(r => r.action), ['league_entered', 'league_paid', 'league_unpaid', 'league_withdrawn']);
  assert.equal(six[0].actor_player_id, 1);
  assert.deepEqual(six[1].details, { tournament_id: E, amount: 200 });
  const ms = (await db.query(`SELECT action, details FROM public.audit_log WHERE action LIKE 'match_%' ORDER BY id`)).rows;
  assert.deepEqual(ms.map(r => r.action), ['match_outcome', 'match_edited', 'match_players_changed']);
  assert.deepEqual(ms[0].details, { tournament_id: L, match_id: m.other, outcome: 'walkover', result: 'b' });
  assert.deepEqual(ms[1].details, { tournament_id: L, match_id: m.done, from: 'a', to: null, status: 'in_progress' });
  assert.deepEqual(ms[2].details, { tournament_id: L, match_id: m.semiFilled, from: [6, 7], to: [8, 7] });
});

test('rehearsal changes nothing; a second real run refuses; rollback removes the league and keeps team day', async () => {
  const db = await productionDb();
  assert.equal(await run(db, REAL('phase2a_auth.sql')), null);
  const col = async () => (await one(db, `SELECT count(*)::int n FROM information_schema.columns WHERE table_name='tournaments' AND column_name='format'`)).n;
  assert.match(await run(db, sqlFile('matchplay_league.sql')), /REHEARSAL OK/);
  assert.equal(await col(), 0);
  assert.equal(await run(db, REAL('matchplay_league.sql')), null);
  assert.equal((await one(db, `SELECT count(*)::int n FROM public.tournaments WHERE format <> 'team_day'`)).n, 0);   // existing rows: team day
  assert.equal((await one(db, `SELECT count(*)::int n FROM public.tournament_players WHERE entered_at IS NULL`)).n, 0);
  assert.match(await run(db, REAL('matchplay_league.sql')), /already set up/);
  const teamDay = (await one(db, `SELECT count(*)::int n FROM public.tournaments`)).n;
  await db.query(`INSERT INTO public.tournaments(name,date,tee_id,format,status) VALUES ('L','2027-04-01','57','league','entry')`);
  assert.equal(await run(db, sqlFile('matchplay_league_rollback.sql')), null);
  assert.equal(await col(), 0);
  assert.equal((await one(db, `SELECT count(*)::int n FROM public.tournaments`)).n, teamDay);
  assert.equal((await one(db, `SELECT count(*)::int n FROM pg_proc WHERE proname IN ('is_league','league_open','may_score','protect_league','protect_league_match','audit_league_players','audit_league_match')`)).n, 0);
  assert.equal((await one(db, `SELECT count(*)::int n FROM pg_policies WHERE policyname LIKE 'p2_tplayer_%' OR policyname LIKE 'p2_tscore_league_%'`)).n, 0);
  assert.equal(await run(db, sqlFile('matchplay_league_rollback.sql')), null);   // safe to re-run
  assert.equal(await run(db, REAL('matchplay_league.sql')), null);               // and re-applicable
});

test('refuses to run before Phase 2 release A', async () => {
  const db = await productionDb();
  assert.match(await run(db, REAL('matchplay_league.sql')), /phase2a_auth\.sql must be applied first/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/sql/matchplay.test.mjs`
Expected: FAIL. Every test errors with `ENOENT … supabase/matchplay_league.sql`.

- [ ] **Step 3: Write the migration**

Create `supabase/matchplay_league.sql`:

```sql
-- Royal Golf Club — season-long matchplay league (tournaments.format = 'league').
-- Spec: docs/superpowers/specs/2026-09-25-matchplay-league-design.md
-- Run in the Supabase SQL Editor (project qvjybtcbymexheqrjkai). REHEARSAL FIRST: with the switch on
-- (true) it runs everything, reports, then rolls back. Set it to false for the real run.
-- Needs phase2a_auth.sql (Phase 2 release A). Undo: matchplay_league_rollback.sql.
-- No version-gate change: the live app reads the new columns only for format = 'league'.
BEGIN;
CREATE TEMP TABLE ml_mode ON COMMIT DROP AS SELECT true AS rehearsal;   -- ◀◀ THE SWITCH
CREATE TEMP TABLE ml_report (ord serial, line text) ON COMMIT DROP;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tournaments' AND column_name = 'format') THEN
    RAISE EXCEPTION 'The matchplay league is already set up (tournaments.format exists). Nothing was changed.';
  END IF;
  IF to_regprocedure('private.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'phase2a_auth.sql must be applied first. Nothing was changed.';
  END IF;
END $$;

-- ===== Columns (every existing tournament becomes team_day) ==============================
ALTER TABLE public.tournaments
  ADD COLUMN format text NOT NULL DEFAULT 'team_day' CHECK (format IN ('team_day', 'league')),
  ADD COLUMN deadlines jsonb,                  -- {"group_1","group_2","group_3","semi","final"}: play-by dates
  ADD COLUMN buy_in numeric NOT NULL DEFAULT 0 CHECK (buy_in >= 0),
  ADD COLUMN max_players int NOT NULL DEFAULT 16 CHECK (max_players > 0);
ALTER TABLE public.tournament_players
  ADD COLUMN entered_at timestamptz NOT NULL DEFAULT now(),   -- sign-up order: first max_players in, the rest wait
  ADD COLUMN paid_at timestamptz,
  ADD COLUMN amount numeric,
  ADD COLUMN recorded_by bigint REFERENCES public.players(id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN seed_pot int CHECK (seed_pot BETWEEN 1 AND 4),
  ADD COLUMN group_num int CHECK (group_num BETWEEN 1 AND 4),
  ADD CONSTRAINT tplayers_paid_amount CHECK ((paid_at IS NULL) = (amount IS NULL)),
  ADD CONSTRAINT tplayers_amount_nonneg CHECK (amount IS NULL OR amount >= 0);
-- round: 1–3 group rounds, 4 semi-finals, 5 finals and 3rd/4th — one per deadline.
ALTER TABLE public.tournament_matches
  ADD COLUMN stage text CHECK (stage IN ('group', 'semi', 'final', 'place')),
  ADD COLUMN bracket int CHECK (bracket BETWEEN 1 AND 4),
  ADD COLUMN start_hole int NOT NULL DEFAULT 1 CHECK (start_hole IN (1, 10)),
  ADD COLUMN extra_holes int NOT NULL DEFAULT 0 CHECK (extra_holes >= 0),
  ADD COLUMN outcome text NOT NULL DEFAULT 'played' CHECK (outcome IN ('played', 'walkover', 'halve_decision', 'double_forfeit')),
  ADD COLUMN decided_by bigint REFERENCES public.players(id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN played_on text,                   -- YYYY-MM-DD of the first score: the handicap date
  ADD CONSTRAINT tmatches_bracket_for_playoffs CHECK (stage IS NULL OR (stage = 'group') = (bracket IS NULL)),
  ADD CONSTRAINT tmatches_outcome_league_only CHECK (outcome = 'played' OR stage IS NOT NULL),
  ADD CONSTRAINT tmatches_halve_group_only CHECK (outcome <> 'halve_decision' OR (stage = 'group' AND result = 'half')),
  ADD CONSTRAINT tmatches_walkover_winner CHECK (outcome <> 'walkover' OR result IN ('a', 'b')),
  ADD CONSTRAINT tmatches_forfeit_goes_through CHECK (outcome <> 'double_forfeit'
    OR (stage = 'group' AND result IS NULL) OR (stage <> 'group' AND result IN ('a', 'b')));

-- One row per league match slot: all 40 are created at the draw, so a double press can't duplicate.
CREATE UNIQUE INDEX tournament_matches_league_slot ON public.tournament_matches (tournament_id, round, match_num) WHERE stage IS NOT NULL;
-- One entry per player per tournament (team day's assign already guards this in the app).
CREATE UNIQUE INDEX tournament_players_once ON public.tournament_players (tournament_id, player_id);

-- ===== Helpers ==============================================================================
CREATE FUNCTION private.is_league(p_tournament bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
  $$ SELECT coalesce((SELECT format = 'league' FROM public.tournaments WHERE id = p_tournament), false) $$;
CREATE FUNCTION private.league_open(p_tournament bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
  $$ SELECT EXISTS (SELECT 1 FROM public.tournaments WHERE id = p_tournament AND format = 'league' AND status = 'entry') $$;
-- Who may write a score row: team day as before (true); a league match's two players (for either of
-- them) until it is finished; an admin in admin mode always — but only for the match's own players.
CREATE FUNCTION private.may_score(p_match bigint, p_player bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(CASE
    WHEN m.id IS NULL OR NOT private.is_league(m.tournament_id) THEN true
    WHEN p_player IS DISTINCT FROM m.team_a_p1_id AND p_player IS DISTINCT FROM m.team_b_p1_id THEN false
    WHEN private.is_admin() THEN true
    ELSE m.status <> 'complete' AND private.current_player() IN (m.team_a_p1_id, m.team_b_p1_id) END, false)
  FROM (SELECT 1) one LEFT JOIN public.tournament_matches m ON m.id = p_match $$;
GRANT EXECUTE ON FUNCTION private.is_league(bigint), private.league_open(bigint), private.may_score(bigint, bigint) TO anon, authenticated;

-- ===== League matches: who may change what ===================================================
-- Requests without a login (the old PIN route) pass unchanged until release B, as everywhere.
CREATE FUNCTION private.protect_league_match() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE me bigint := private.current_player(); started boolean;
BEGIN
  IF auth.uid() IS NULL OR private.is_admin() OR NOT private.is_league(OLD.tournament_id) THEN RETURN NEW; END IF;
  -- The league's shape and admin decisions: admin mode only.
  IF NEW.tournament_id IS DISTINCT FROM OLD.tournament_id OR NEW.stage IS DISTINCT FROM OLD.stage
     OR NEW.bracket IS DISTINCT FROM OLD.bracket OR NEW.round IS DISTINCT FROM OLD.round
     OR NEW.match_num IS DISTINCT FROM OLD.match_num OR NEW.outcome IS DISTINCT FROM OLD.outcome
     OR NEW.decided_by IS DISTINCT FROM OLD.decided_by
     OR NEW.team_a_p2_id IS DISTINCT FROM OLD.team_a_p2_id OR NEW.team_b_p2_id IS DISTINCT FROM OLD.team_b_p2_id THEN
    RAISE EXCEPTION 'Only an admin in admin mode can change that.' USING ERRCODE = '42501';
  END IF;
  -- Filling an EMPTY playoff slot as results come in: any member. Never overwriting or emptying one.
  IF NEW.team_a_p1_id IS DISTINCT FROM OLD.team_a_p1_id OR NEW.team_b_p1_id IS DISTINCT FROM OLD.team_b_p1_id THEN
    started := OLD.status <> 'pending' OR EXISTS (SELECT 1 FROM public.tournament_scores WHERE match_id = OLD.id);
    IF OLD.stage = 'group' OR started
       OR (NEW.team_a_p1_id IS DISTINCT FROM OLD.team_a_p1_id AND OLD.team_a_p1_id IS NOT NULL)
       OR (NEW.team_b_p1_id IS DISTINCT FROM OLD.team_b_p1_id AND OLD.team_b_p1_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Only an admin in admin mode can change who plays in a match.' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- Playing the match: only its two players, and a finished match only an admin can re-open.
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.result IS DISTINCT FROM OLD.result
     OR NEW.extra_holes IS DISTINCT FROM OLD.extra_holes OR NEW.start_hole IS DISTINCT FROM OLD.start_hole
     OR NEW.tee_id IS DISTINCT FROM OLD.tee_id OR NEW.played_on IS DISTINCT FROM OLD.played_on THEN
    IF me IS NULL OR (me IS DISTINCT FROM OLD.team_a_p1_id AND me IS DISTINCT FROM OLD.team_b_p1_id) THEN
      RAISE EXCEPTION 'Only the two players (or an admin) can score this match.' USING ERRCODE = '42501';
    END IF;
    IF OLD.status = 'complete' THEN
      RAISE EXCEPTION 'This match is finished — only an admin can change it.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.protect_league_match() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER protect_league_match BEFORE UPDATE ON public.tournament_matches
  FOR EACH ROW EXECUTE FUNCTION private.protect_league_match();

-- A league's own row (deadlines, buy-in, status): admin mode only. Team day: unchanged.
CREATE FUNCTION private.protect_league() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR private.is_admin() THEN RETURN NEW; END IF;
  IF (OLD.format = 'league' OR NEW.format = 'league') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Only an admin in admin mode can change the league.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.protect_league() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER protect_league BEFORE UPDATE ON public.tournaments FOR EACH ROW EXECUTE FUNCTION private.protect_league();

-- ===== Policies ===============================================================================
-- Entries: members enter themselves (unpaid, not placed, signed up now) while entries are open, and
-- withdraw while unpaid and before the draw. Admin mode (existing p2_admin): everything.
CREATE POLICY p2_tplayer_enter ON public.tournament_players FOR INSERT TO authenticated
  WITH CHECK (private.is_member() AND player_id = private.current_player() AND team = 'league'
              AND paid_at IS NULL AND amount IS NULL AND recorded_by IS NULL AND group_num IS NULL AND seed_pot IS NULL
              AND entered_at = now() AND private.league_open(tournament_id));
CREATE POLICY p2_tplayer_withdraw ON public.tournament_players FOR DELETE TO authenticated
  USING (private.is_member() AND player_id = private.current_player() AND paid_at IS NULL AND private.league_open(tournament_id));
-- League scores: restrictive, so they narrow the existing member policies without touching team day.
CREATE POLICY p2_tscore_league_ins ON public.tournament_scores AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (private.may_score(match_id, player_id));
CREATE POLICY p2_tscore_league_upd ON public.tournament_scores AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (private.may_score(match_id, player_id)) WITH CHECK (private.may_score(match_id, player_id));
CREATE POLICY p2_tscore_league_del ON public.tournament_scores AS RESTRICTIVE FOR DELETE TO authenticated
  USING (private.may_score(match_id, player_id));

-- ===== Audit ==================================================================================
CREATE FUNCTION private.audit_league_players() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF private.is_league(OLD.tournament_id) THEN
      PERFORM private.audit('league_withdrawn', OLD.player_id, jsonb_build_object('tournament_id', OLD.tournament_id));
    END IF;
    RETURN OLD;
  END IF;
  IF NOT private.is_league(NEW.tournament_id) THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM private.audit('league_entered', NEW.player_id, jsonb_build_object('tournament_id', NEW.tournament_id));
    IF NEW.paid_at IS NOT NULL THEN
      PERFORM private.audit('league_paid', NEW.player_id, jsonb_build_object('tournament_id', NEW.tournament_id, 'amount', NEW.amount));
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.paid_at IS NULL AND NEW.paid_at IS NOT NULL THEN
    PERFORM private.audit('league_paid', NEW.player_id, jsonb_build_object('tournament_id', NEW.tournament_id, 'amount', NEW.amount));
  ELSIF OLD.paid_at IS NOT NULL AND NEW.paid_at IS NULL THEN
    PERFORM private.audit('league_unpaid', NEW.player_id, jsonb_build_object('tournament_id', NEW.tournament_id, 'amount', OLD.amount));
  END IF;
  IF NEW.entered_at IS DISTINCT FROM OLD.entered_at THEN
    PERFORM private.audit('league_entry_moved', NEW.player_id, jsonb_build_object('tournament_id', NEW.tournament_id));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.audit_league_players() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER audit_league_players AFTER INSERT OR UPDATE OR DELETE ON public.tournament_players
  FOR EACH ROW EXECUTE FUNCTION private.audit_league_players();

-- Every admin match decision: an outcome, a finished match re-decided or re-opened, a filled slot changed.
CREATE FUNCTION private.audit_league_match() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_league(NEW.tournament_id) THEN RETURN NEW; END IF;
  IF NEW.outcome IS DISTINCT FROM OLD.outcome OR (NEW.outcome <> 'played' AND NEW.result IS DISTINCT FROM OLD.result) THEN
    PERFORM private.audit('match_outcome', NEW.team_a_p1_id, jsonb_build_object('tournament_id', NEW.tournament_id,
      'match_id', NEW.id, 'outcome', NEW.outcome, 'result', NEW.result));
  ELSIF OLD.status = 'complete' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.result IS DISTINCT FROM OLD.result) THEN
    PERFORM private.audit('match_edited', NEW.team_a_p1_id, jsonb_build_object('tournament_id', NEW.tournament_id,
      'match_id', NEW.id, 'from', OLD.result, 'to', NEW.result, 'status', NEW.status));
  END IF;
  IF (OLD.team_a_p1_id IS NOT NULL AND NEW.team_a_p1_id IS DISTINCT FROM OLD.team_a_p1_id)
     OR (OLD.team_b_p1_id IS NOT NULL AND NEW.team_b_p1_id IS DISTINCT FROM OLD.team_b_p1_id) THEN
    PERFORM private.audit('match_players_changed', NEW.team_a_p1_id, jsonb_build_object('tournament_id', NEW.tournament_id,
      'match_id', NEW.id, 'from', jsonb_build_array(OLD.team_a_p1_id, OLD.team_b_p1_id), 'to', jsonb_build_array(NEW.team_a_p1_id, NEW.team_b_p1_id)));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.audit_league_match() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER audit_league_match AFTER UPDATE ON public.tournament_matches
  FOR EACH ROW EXECUTE FUNCTION private.audit_league_match();

-- ===== CHECKS =====
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM information_schema.columns WHERE table_schema = 'public'
    AND table_name::text || '.' || column_name::text IN ('tournaments.format', 'tournaments.deadlines', 'tournaments.buy_in',
      'tournaments.max_players', 'tournament_players.entered_at', 'tournament_players.paid_at', 'tournament_players.amount',
      'tournament_players.recorded_by', 'tournament_players.seed_pot', 'tournament_players.group_num', 'tournament_matches.stage',
      'tournament_matches.bracket', 'tournament_matches.start_hole', 'tournament_matches.extra_holes', 'tournament_matches.outcome',
      'tournament_matches.decided_by', 'tournament_matches.played_on');
  IF n <> 17 THEN RAISE EXCEPTION 'Expected 17 new columns, found %', n; END IF;
  INSERT INTO ml_report(line) VALUES ('new columns: 17');
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'public' AND policyname IN
    ('p2_tplayer_enter', 'p2_tplayer_withdraw', 'p2_tscore_league_ins', 'p2_tscore_league_upd', 'p2_tscore_league_del');
  IF n <> 5 THEN RAISE EXCEPTION 'Expected 5 new policies, found %', n; END IF;
  INSERT INTO ml_report(line) VALUES ('new policies: 5');
  SELECT count(*) INTO n FROM pg_trigger WHERE NOT tgisinternal
    AND tgname IN ('protect_league', 'protect_league_match', 'audit_league_players', 'audit_league_match');
  IF n <> 4 THEN RAISE EXCEPTION 'Expected 4 new triggers, found %', n; END IF;
  INSERT INTO ml_report(line) VALUES ('new triggers: 4');
  IF EXISTS (SELECT 1 FROM public.tournaments WHERE format <> 'team_day') THEN
    RAISE EXCEPTION 'Existing tournaments must all be team_day';
  END IF;
  INSERT INTO ml_report(line) VALUES ('existing tournaments: ' || (SELECT count(*) FROM public.tournaments) || ', all team_day');
  IF NOT has_table_privilege('authenticated', 'public.tournament_players', 'INSERT')
     OR NOT has_table_privilege('anon', 'public.tournament_matches', 'UPDATE')
     OR NOT has_function_privilege('authenticated', 'private.may_score(bigint,bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'grants missing';
  END IF;
  INSERT INTO ml_report(line) VALUES ('grants: tables + helper functions');
END $$;

NOTIFY pgrst, 'reload schema';
DO $$ BEGIN
  INSERT INTO ml_report(line) VALUES ('ALL CHECKS PASSED');
  IF (SELECT rehearsal FROM ml_mode) THEN
    RAISE EXCEPTION 'REHEARSAL OK — everything was rolled back. Report:%',
      E'\n' || (SELECT string_agg(line, E'\n' ORDER BY ord) FROM ml_report);
  END IF;
END $$;
SELECT line FROM ml_report ORDER BY ord;
COMMIT;
```

Create `supabase/matchplay_league_rollback.sql`:

```sql
-- Royal Golf Club — undo matchplay_league.sql. League tournaments (their entries, matches and scores)
-- are deleted; team-day tournaments are untouched; the audit log keeps its league rows.
-- Redeploy the previous app straight after. Safe to re-run.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tournaments' AND column_name = 'format') THEN
    EXECUTE 'DELETE FROM public.tournaments WHERE format = ''league''';   -- cascades to players, matches, scores
  END IF;
END $$;
DROP TRIGGER IF EXISTS protect_league ON public.tournaments;
DROP TRIGGER IF EXISTS protect_league_match ON public.tournament_matches;
DROP TRIGGER IF EXISTS audit_league_match ON public.tournament_matches;
DROP TRIGGER IF EXISTS audit_league_players ON public.tournament_players;
DROP POLICY IF EXISTS p2_tplayer_enter ON public.tournament_players;
DROP POLICY IF EXISTS p2_tplayer_withdraw ON public.tournament_players;
DROP POLICY IF EXISTS p2_tscore_league_ins ON public.tournament_scores;
DROP POLICY IF EXISTS p2_tscore_league_upd ON public.tournament_scores;
DROP POLICY IF EXISTS p2_tscore_league_del ON public.tournament_scores;
DROP FUNCTION IF EXISTS private.protect_league();
DROP FUNCTION IF EXISTS private.protect_league_match();
DROP FUNCTION IF EXISTS private.audit_league_players();
DROP FUNCTION IF EXISTS private.audit_league_match();
DROP FUNCTION IF EXISTS private.may_score(bigint, bigint);
DROP FUNCTION IF EXISTS private.league_open(bigint);
DROP FUNCTION IF EXISTS private.is_league(bigint);
DROP INDEX IF EXISTS public.tournament_matches_league_slot;
DROP INDEX IF EXISTS public.tournament_players_once;
ALTER TABLE public.tournaments DROP COLUMN IF EXISTS format, DROP COLUMN IF EXISTS deadlines,
  DROP COLUMN IF EXISTS buy_in, DROP COLUMN IF EXISTS max_players;
ALTER TABLE public.tournament_players DROP COLUMN IF EXISTS entered_at, DROP COLUMN IF EXISTS paid_at,
  DROP COLUMN IF EXISTS amount, DROP COLUMN IF EXISTS recorded_by, DROP COLUMN IF EXISTS seed_pot, DROP COLUMN IF EXISTS group_num;
ALTER TABLE public.tournament_matches DROP COLUMN IF EXISTS stage, DROP COLUMN IF EXISTS bracket,
  DROP COLUMN IF EXISTS start_hole, DROP COLUMN IF EXISTS extra_holes, DROP COLUMN IF EXISTS outcome,
  DROP COLUMN IF EXISTS decided_by, DROP COLUMN IF EXISTS played_on;
NOTIFY pgrst, 'reload schema';
COMMIT;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/sql/matchplay.test.mjs`
Expected: PASS, all tests (34 matrix rows + 6).
Then run the full SQL suite: `Push-Location tests/sql; node --test; Pop-Location`
Expected: the previous 108 still pass, plus the new ones.

- [ ] **Step 5: Commit**

```bash
git add supabase/matchplay_league.sql supabase/matchplay_league_rollback.sql tests/sql/matchplay.test.mjs
git commit -F- <<'EOF'
feat(db): matchplay league — columns, CHECKs, match/score/entry permissions, audit

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01N6cfxP9mcgmYjbs4UMRCnG
EOF
```

---

### Task 2: Strokes, hole order and deciding a match

**Files:**
- Modify: `index.html`, in `tmMatchHcpInfo` (~line 1187), `tmHoleResult` (~1213–1226), and a new block before `function currentHcp(player){`
- Create: `tests/matchplay.test.js`

**Interfaces:**
- Consumes: `tmMatchHcpInfo(match,date)`, `tmHoleResult(holeIdx,match,hcpInfo,grossByPid)`, `strokesOnHole(phcp,i)`, `ordinal(n)`, `today()`.
- Produces:
  - `ML_ROUND_KEYS` (string[5]) and `ML_BRACKETS` (string[4]).
  - `tmIsFourball(m) → bool`.
  - `tmMatchDate(m,t) → 'YYYY-MM-DD'`.
  - `mlPlayOrder(m) → number[18]`.
  - `tmHoleIdx(m,hole) → 0..17`.
  - `mlNextHole(m,h) → number` and `mlPrevHole(m,h) → number`.
  - `mlDecide(m,hcpInfo,scores) → {decided,winner:'a'|'b'|'half'|null,holes:{a,b},up,thru,extra,started,label}`.
  - The test file skeleton with helpers `P`, `M`, `card`, `holes`.

- [ ] **Step 1: Write the failing test**

Create `tests/matchplay.test.js`:

```js
// Matchplay league. Run: powershell -NoProfile -File tests/run.ps1 -Test tests/matchplay.test.js
setTimeout(async function(){
  const out=[];const T=(n,c,d='')=>out.push((c?'PASS ':'FAIL ')+n+(c?'':' :: '+d));
  const calls=[];let respond=()=>[];
  window.fetch=async(url,opts={})=>{url=String(url);const body=opts.body?JSON.parse(opts.body):null;calls.push({url,method:opts.method||'GET',body});
    const b=respond(url,body,opts.method||'GET');const st=b&&b.__status||200;return{ok:st<400,status:st,json:async()=>b,text:async()=>JSON.stringify(b)};};
  const reset=fn=>{calls.length=0;respond=fn||(()=>[]);};
  window.toast=()=>{};window.setLoading=()=>{};window.confirm=()=>true;window.alert=m=>{window.__alert=m;};
  tees=[..._TEES_SEED];_session=null;today=()=>'2027-05-10';
  // A player with one handicap index; a league match between a and b (group unless x says otherwise).
  const P=(id,name,idx=18,x={})=>({id,name,color:id%10,hcp_history:[{date:'2026-01-01',value:idx,note:''}],approved:true,is_social:false,...x});
  const M=(id,a,b,x={})=>({id,tournament_id:900,round:1,match_num:1,stage:'group',bracket:null,team_a_p1_id:a,team_b_p1_id:b,team_a_p2_id:null,team_b_p2_id:null,
    status:'pending',result:null,start_hole:1,extra_holes:0,outcome:'played',decided_by:null,played_on:null,tee_id:null,_teeId:'57',...x});
  // Score rows for a match: rows of [hole, grossA, grossB].
  const card=(m,rows)=>rows.flatMap(([h,ga,gb])=>[{match_id:m.id,hole:h,player_id:m.team_a_p1_id,gross:ga},{match_id:m.id,hole:h,player_id:m.team_b_p1_id,gross:gb}]);
  const holes=(from,to,ga,gb)=>{const r=[];for(let h=from;h<=to;h++)r.push([h,ga,gb]);return r;};
  try{
    // ── Task 2: strokes, hole order, deciding a match ──
    {
      players=[P(1,'Ann',9.3),P(2,'Bo',16.4),P(3,'Cy',2),P(4,'Di',24)];
      const t57=_TEES_SEED.find(t=>t.id==='57');
      T('90% of course handicap on the 57 tee: 9.3 → 12, 16.4 → 20',tmPlayingHcp(players[0],t57,'2027-05-10')===12&&tmPlayingHcp(players[1],t57,'2027-05-10')===20);
      let m=M(1,1,2),info=tmMatchHcpInfo(m,'2027-05-10');
      T('12 v 20: the 20 receives 8, the 12 plays off 0',info.diff===8&&info.receivingTeam==='b'&&info.phA1===12&&info.phB1===20);
      const wonBy=(mm,inf,ga,gb)=>HOLE_HCP.map((si,i)=>tmHoleResult(i,mm,inf,{[mm.team_a_p1_id]:ga,[mm.team_b_p1_id]:gb}).result);
      T('12 v 20, level gross: B wins exactly the SI 1–8 holes',wonBy(m,info,4,4).every((x,i)=>x===(HOLE_HCP[i]<=8?'b':'half')));
      m=M(2,3,4);info=tmMatchHcpInfo(m,'2027-05-10');
      T('diff > 18: 4 v 29 gives 25 strokes',info.diff===25&&info.receivingTeam==='b');
      T('diff 25: two strokes on SI 1–7 (B wins 5 v 4 there), one elsewhere (halved)',wonBy(m,info,4,5).every((x,i)=>x===(HOLE_HCP[i]<=7?'b':'half')));
      const td1={id:50,tournament_id:901,round:1,match_num:1,team_a_p1_id:1,team_a_p2_id:3,team_b_p1_id:2,team_b_p2_id:4,_teeId:'57'};
      info=tmMatchHcpInfo(td1,'2027-05-10');
      T('team day round 1 is still a fourball: the lowest of four plays off 0',tmIsFourball(td1)&&info.phA2===0&&info.phA1===8&&info.phB1===16&&info.phB2===25);
      T('a league match in round 1 is singles, not a fourball',!tmIsFourball(M(3,1,2,{round:1})));
      const td2={id:51,tournament_id:901,round:2,match_num:1,team_a_p1_id:1,team_b_p1_id:2,team_a_p2_id:null,team_b_p2_id:null,_teeId:'57'};
      info=tmMatchHcpInfo(td2,'2027-05-10');
      T('team day singles (diff ≤ 18) unchanged: strokes on SI 1–8',wonBy(td2,info,4,4).every((x,i)=>x===(HOLE_HCP[i]<=8?'b':'half'))&&info.strokeHoles.length===8);
      T('handicap date: team day uses the tournament date, a league match the day it was played',tmMatchDate(td2,{date:'2027-07-04'})==='2027-07-04'&&tmMatchDate(M(9,1,2,{played_on:'2027-06-01'}),{})==='2027-06-01'&&tmMatchDate(M(9,1,2),{})==='2027-05-10');
      // hole order
      T('start on the 1st: 1…18',mlPlayOrder(M(4,1,2)).join()==='1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18');
      const m10=M(5,1,2,{start_hole:10,stage:'semi',bracket:1,round:4});
      T('start on the 10th: 10…18 then 1…9',mlPlayOrder(m10).join()==='10,11,12,13,14,15,16,17,18,1,2,3,4,5,6,7,8,9');
      T('sudden death replays from the start hole: from 1st 19 = hole 1; from 10th 19 = hole 10, 20 = hole 11',tmHoleIdx(M(6,1,2),19)===0&&tmHoleIdx(m10,19)===9&&tmHoleIdx(m10,20)===10&&tmHoleIdx(m10,5)===4);
      T('next hole: 18 → 1 from the 10th; after the 9th a playoff goes to 19; then 20',mlNextHole(m10,18)===1&&mlNextHole(m10,9)===19&&mlNextHole(m10,19)===20);
      T('a group match never goes past its 18th hole',mlNextHole(M(7,1,2),18)===18);
      T('previous hole: 1 → 18 from the 10th; 19 → 9; the first hole stays',mlPrevHole(m10,1)===18&&mlPrevHole(m10,19)===9&&mlPrevHole(m10,10)===10&&mlPrevHole(m10,21)===20);
      // deciding a match (two level players: nett = gross)
      players.push(P(11,'Eve',18),P(12,'Fin',18));
      const lv=(id,x={})=>M(id,11,12,x);
      const decide=(mm,rows)=>mlDecide(mm,tmMatchHcpInfo(mm,'2027-05-10'),card(mm,rows));
      const g=lv(20);let d=decide(g,[...holes(1,3,3,4),...holes(4,16,4,4)]);
      T('3 up with 2 to play closes the match: 3&2, thru 16',d.decided&&d.winner==='a'&&d.label==='3&2'&&d.thru===16&&d.holes.a===3&&d.holes.b===0);
      d=decide(g,[...holes(1,3,3,4),...holes(4,16,4,4),[17,9,3],[18,9,3]]);
      T('holes after the match was decided are ignored',d.label==='3&2'&&d.holes.b===0);
      d=decide(g,[...holes(1,17,4,4),[18,3,4]]);T('won on the 18th: 1UP',d.decided&&d.winner==='a'&&d.label==='1UP');
      d=decide(g,holes(1,18,4,4));T('group match level after 18: halved',d.decided&&d.winner==='half'&&d.label==='Halved');
      d=decide(g,holes(1,5,4,4));T('in progress: undecided, A/S thru 5, started',!d.decided&&d.label==='A/S thru 5'&&d.started);
      T('no scores: not started',!decide(g,[]).started);
      d=decide(g,[[1,4,4],...holes(2,3,3,4),...holes(4,16,4,4)]);
      T('a corrected hole turns 3&2 into 2 up with 2 to play: the match is undecided again',!d.decided&&d.up===2&&d.thru===16);
      d=decide(g,[...holes(1,3,4,3),...holes(4,16,4,4)]);T('a correction can flip the winner',d.winner==='b'&&d.label==='3&2');
      d=decide(g,[[1,0,5],...holes(2,17,4,4),[18,4,4]]);T('a pickup (0) loses the hole: A picked up on the 1st, B wins 1UP',d.winner==='b'&&d.label==='1UP');
      const s1=lv(21,{stage:'semi',bracket:1,round:4});
      d=decide(s1,holes(1,18,4,4));T('playoff level after 18: sudden death, undecided',!d.decided&&/sudden death/.test(d.label));
      d=decide(s1,[...holes(1,18,4,4),[19,4,4],[20,4,3]]);
      T('sudden death: won at the 20th by B, 2 extra holes',d.decided&&d.winner==='b'&&d.label==='won at the 20th'&&d.extra===2);
      const s10=lv(22,{stage:'semi',bracket:1,round:4,start_hole:10});
      d=decide(s10,[...holes(10,12,3,4),...holes(13,18,4,4),...holes(1,7,4,4)]);
      T('from the 10th: 3&2 after 16 holes played (the 7th)',d.decided&&d.label==='3&2'&&d.thru===16);
      // sudden death at the same strokes: B receives 4 (SI 1–4); level in 18 because B scores 5 on SI 1–4
      const sd=start=>{const mm=M(23,1,2,{stage:'semi',bracket:1,round:4,start_hole:start});
        return mlDecide(mm,{receivingTeam:'b',diff:4},card(mm,[...HOLE_HCP.map((si,i)=>[i+1,4,si<=4?5:4]),[19,4,4]]));};
      T('sudden death from the 1st plays hole 1 (SI 4): the stroke wins it at the 19th',sd(1).winner==='b'&&sd(1).label==='won at the 19th');
      T('sudden death from the 10th plays hole 10 (SI 5): no stroke, still level',!sd(10).decided&&sd(10).extra===1);
      T('walkover: decided for the named player',decide(lv(24,{outcome:'walkover',result:'b'}),[]).winner==='b');
      d=decide(lv(25,{outcome:'halve_decision',result:'half'}),[]);T('halve by decision: half, started',d.winner==='half'&&d.started&&d.decided);
      d=decide(lv(26,{outcome:'double_forfeit'}),[]);T('group double forfeit: decided, nobody wins',d.decided&&d.winner===null);
      T('playoff double forfeit: the named player goes through',decide(lv(27,{outcome:'double_forfeit',result:'a',stage:'semi',bracket:1,round:4}),[]).winner==='a');
    }
    // ── end ──
  }catch(e){out.push('FAIL EXCEPTION :: '+e.stack);}
  await new Promise(r=>setTimeout(r,150));
  const pre=document.createElement('pre');pre.id='RESULT';pre.textContent=out.join('\n');document.body.innerHTML='';document.body.appendChild(pre);
},400);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `powershell -NoProfile -File tests/run.ps1 -Test tests/matchplay.test.js`
Expected: FAIL. Some early tests pass, then `FAIL EXCEPTION :: ReferenceError: tmIsFourball is not defined`.

- [ ] **Step 3: Write the implementation**

In `tmMatchHcpInfo`, replace:
```js
  if(match.round===1){
    // Fourball: lowest HCP across all four players becomes 0; others get the difference
```
with:
```js
  if(tmIsFourball(match)){
    // Fourball: lowest HCP across all four players becomes 0; others get the difference
```

In `tmHoleResult`, replace:
```js
  if(match.round===1){
    // Fourball: each player gets individual strokes based on their adjusted HCP
```
with:
```js
  if(tmIsFourball(match)){
    // Fourball: each player gets individual strokes based on their adjusted HCP
```
and replace the singles branch:
```js
  }else{
    // Singles: team differential — weaker team receives strokes on lowest SI holes
    const isStroke=hcpInfo.strokeHoles.includes(holeIdx);
    sA1=isStroke&&hcpInfo.receivingTeam==='a'?1:0;
    sA2=0; sB2=0;
    sB1=isStroke&&hcpInfo.receivingTeam==='b'?1:0;
  }
```
with:
```js
  }else{
    // Singles: the lower player plays off 0; the other receives the difference — one stroke on
    // SI 1…diff, a second where diff > 18 (the same as strokeHoles whenever diff ≤ 18).
    const s=strokesOnHole(hcpInfo.diff,holeIdx);
    sA1=hcpInfo.receivingTeam==='a'?s:0;
    sA2=0; sB2=0;
    sB1=hcpInfo.receivingTeam==='b'?s:0;
  }
```

Immediately before `function currentHcp(player){`, insert:
```js
// ── Matchplay league (tournaments.format='league') ────────────────────────────
// Spec: docs/superpowers/specs/2026-09-25-matchplay-league-design.md. The league reuses the
// tournament tables, the scoring screen and the stroke logic above; these are its pure rules.
const ML_ROUND_KEYS=['group_1','group_2','group_3','semi','final'];   // match.round 1–5 → its deadline
const ML_BRACKETS=['Winners','Runners-up','Thirds','Fourths'];       // bracket 1–4 → places 1–4 … 13–16
// Team day's round 1 is fourballs; league matches are always singles, whatever their round.
const tmIsFourball=m=>m.round===1&&!m.stage;
// Handicap date: team day plays on the tournament date, a league match on the day it was played.
const tmMatchDate=(m,t)=>m.stage?(m.played_on||today()):t.date;
// Play order: 1–18, or 10–18 then 1–9 for a match that started on the 10th.
const mlPlayOrder=m=>(m.start_hole||1)===10?[10,11,12,13,14,15,16,17,18,1,2,3,4,5,6,7,8,9]:[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18];
// 0-based course hole for a hole number. Sudden death is stored as holes 19, 20 … and replays the
// course from the start hole at the same strokes: from the 1st, 19 is hole 1; from the 10th, hole 10.
function tmHoleIdx(m,hole){return hole<=18?hole-1:((m.start_hole||1)-1+(hole-19))%18;}
function mlNextHole(m,h){if(h>=19)return h+1;const o=mlPlayOrder(m),i=o.indexOf(h);return i<17?o[i+1]:m.stage==='group'?h:19;}
function mlPrevHole(m,h){if(h>19)return h-1;const o=mlPlayOrder(m);if(h===19)return o[17];const i=o.indexOf(h);return i>0?o[i-1]:h;}
const mlLiveLabel=(up,thru)=>!thru?'—':up===0?`A/S thru ${thru}`:`${Math.abs(up)}UP thru ${thru}`;
// A league match's decision, derived every time from its scores and admin outcome — never trusted
// from the stored status/result, so a corrected score re-opens or re-decides it. Walks the play order
// and stops at the hole that decides it (holes after that were never needed). A group match level
// after 18 is halved; a playoff goes on to sudden death (holes 19+) until a hole is won.
// winner: 'a' | 'b' | 'half' | null (group double forfeit: nobody). started: any score or an outcome.
function mlDecide(m,hcp,scores){
  const o=m.outcome||'played',playoff=m.stage!=='group';
  const base={decided:false,winner:null,holes:{a:0,b:0},up:0,thru:0,extra:0,started:scores.length>0||o!=='played',label:'—'};
  if(o==='walkover')return{...base,decided:true,winner:m.result,label:'W/O'};
  if(o==='halve_decision')return{...base,decided:true,winner:'half',label:'Halved by decision'};
  if(o==='double_forfeit')return{...base,decided:true,winner:playoff?m.result:null,label:'Double forfeit'};
  const g={};for(const s of scores)(g[s.hole]||(g[s.hole]={}))[s.player_id]=s.gross;
  const a=m.team_a_p1_id,b=m.team_b_p1_id;
  const res=h=>{const x=g[h];return x&&x[a]!=null&&x[b]!=null?tmHoleResult(tmHoleIdx(m,h),m,hcp,x).result:null;};
  const holes={a:0,b:0};let up=0,thru=0;
  for(const h of mlPlayOrder(m)){
    const r=res(h);if(r==null)return{...base,holes,up,thru,label:mlLiveLabel(up,thru)};
    if(r!=='half')holes[r]++;up=holes.a-holes.b;thru++;
    const left=18-thru;
    if(Math.abs(up)>left)return{...base,decided:true,winner:up>0?'a':'b',holes,up,thru,label:left?`${Math.abs(up)}&${left}`:`${Math.abs(up)}UP`};
  }
  if(!playoff)return{...base,decided:true,winner:'half',holes,up,thru,label:'Halved'};
  for(let h=19;h<19+54;h++){
    const r=res(h);
    if(r==null)return{...base,holes,up,thru,extra:h-19,label:`A/S after 18 · sudden death${h>19?` (${h-19} played)`:''}`};
    if(r!=='half')return{...base,decided:true,winner:r,holes,up,thru,extra:h-18,label:`won at the ${ordinal(h)}`};
  }
  return{...base,holes,up,thru,extra:54,label:'A/S after 18 · sudden death'};
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `powershell -NoProfile -File tests/run.ps1 -Test tests/matchplay.test.js`
Expected: PASS, 0 failed.
Run: `powershell -NoProfile -File tests/run.ps1 -Test tests/phase2a.test.js`
Expected: 76 passed.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/matchplay.test.js
git commit -F- <<'EOF'
feat: matchplay league — hole order, sudden death, low-off-zero strokes, match decision

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01N6cfxP9mcgmYjbs4UMRCnG
EOF
```

---

### Task 3: Seeded draw, fixtures and deadlines

**Files:**
- Modify: `index.html` (append to the league pure block, directly after Task 2's code, still before `function currentHcp(player){`)
- Test: `tests/matchplay.test.js` (insert above `    // ── end ──`)

**Interfaces:**
- Consumes: `shuffleDraw(arr)` (Fisher-Yates), `ML_ROUND_KEYS`, `ML_BRACKETS`, `today()`.
- Produces:
  - `mlDrawGroups(entrants:[{pid,index}]) → [[pid×4]×4]`, each group in pot order.
  - `ML_PAIRS`.
  - `mlFixtures(groups) → rows[40]`, each `{stage,bracket,round,match_num,team_a_p1_id,team_b_p1_id}`.
  - `mlGroupOf(m) → 1..4`.
  - `mlDeadline(t,m) → date|null`.
  - `mlOverdue(t,m,rec) → bool`.
  - `mlMatchName(r) → string`.

- [ ] **Step 1: Write the failing test**

Insert above `    // ── end ──`:
```js
    // ── Task 3: draw, fixtures, deadlines ──
    {
      const ents=[5,30,12,1,22,8,17,3,26,14,9,20,2,28,11,6].map((index,i)=>({pid:100+i,index}));
      const potOf={};[...ents].sort((x,y)=>x.index-y.index).forEach((e,i)=>potOf[e.pid]=Math.floor(i/4)+1);
      let okPots=true,okDistinct=true;const seenInA=new Set();
      for(let k=0;k<200;k++){const gs=mlDrawGroups(ents);
        if(!gs.every(g=>g.map(p=>potOf[p]).join()==='1,2,3,4'))okPots=false;
        if(new Set(gs.flat()).size!==16)okDistinct=false;
        seenInA.add(gs[0][0]);}
      T('draw: every group has one player from each pot, in pot order',okPots);
      T('draw: 16 distinct players',okDistinct);
      T('draw: which pot-1 player lands in group A varies',seenInA.size===4);
      const tie=[...Array(16)].map((_,i)=>({pid:200+i,index:i<3?1:i<5?10:20+i}));   // 203 and 204 tie on 10 across the pot 1/2 boundary
      T('draw: an index tie across a pot boundary goes by sign-up order',mlDrawGroups(tie).some(g=>g[0]===203)&&mlDrawGroups(tie).every(g=>g[0]!==204));
      const GR=[[1,2,3,4],[5,6,7,8],[9,10,11,12],[13,14,15,16]];
      const fx=mlFixtures(GR),grp=fx.filter(r=>r.stage==='group');
      T('fixtures: 40 rows — 24 group matches, 8 semis, 4 finals, 4 third/fourth',fx.length===40&&grp.length===24&&fx.filter(r=>r.stage==='semi').length===8&&fx.filter(r=>r.stage==='final').length===4&&fx.filter(r=>r.stage==='place').length===4);
      T('fixtures: every pair in a group meets exactly once',GR.every(g=>{const ps=grp.filter(r=>g.includes(r.team_a_p1_id)).map(r=>[r.team_a_p1_id,r.team_b_p1_id].sort((x,y)=>x-y).join('-'));return ps.length===6&&new Set(ps).size===6&&ps.every(p=>p.split('-').every(x=>g.includes(+x)));}));
      T('fixtures: 2 matches per group per round, each player once a round',GR.every((g,gi)=>[1,2,3].every(rd=>{const ms=grp.filter(r=>r.round===rd&&mlGroupOf(r)===gi+1);return ms.length===2&&new Set(ms.flatMap(r=>[r.team_a_p1_id,r.team_b_p1_id])).size===4;})));
      T('fixtures: round + match number identify every slot',new Set(fx.map(r=>r.round+'-'+r.match_num)).size===40);
      T('fixtures: playoff slots start empty, semis round 4, finals and 3rd/4th round 5',fx.filter(r=>r.stage!=='group').every(r=>r.team_a_p1_id==null&&r.team_b_p1_id==null&&r.bracket>=1)&&fx.filter(r=>r.stage==='semi').every(r=>r.round===4)&&fx.filter(r=>r.stage==='final'||r.stage==='place').every(r=>r.round===5));
      T('match names',mlMatchName({stage:'group',round:2,match_num:3})==='Group B · round 2'&&mlMatchName({stage:'semi',bracket:2,match_num:4})==='Runners-up semi-final 2'&&mlMatchName({stage:'final',bracket:1,match_num:1})==='Winners final'&&mlMatchName({stage:'place',bracket:4,match_num:8})==='Fourths 3rd/4th');
      const LGd={deadlines:{group_1:'2027-05-15',group_2:'2027-06-15',group_3:'2027-07-31',semi:'2027-08-20',final:'2027-09-10'}};
      today=()=>'2027-05-16';
      T('deadline by round: 1 → group_1, 4 → semi, 5 → final',mlDeadline(LGd,{round:1})==='2027-05-15'&&mlDeadline(LGd,{round:4})==='2027-08-20'&&mlDeadline(LGd,{round:5})==='2027-09-10');
      T('overdue: past the deadline and undecided',mlOverdue(LGd,{round:1},{decided:false}));
      T('not overdue once decided',!mlOverdue(LGd,{round:1},{decided:true}));
      today=()=>'2027-05-15';T('not overdue on the deadline day itself',!mlOverdue(LGd,{round:1},{decided:false}));
      T('no deadlines set: never overdue',!mlOverdue({},{round:1},{decided:false}));
      today=()=>'2027-05-10';
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `powershell -NoProfile -File tests/run.ps1 -Test tests/matchplay.test.js`
Expected: FAIL with `ReferenceError: mlDrawGroups is not defined`.

- [ ] **Step 3: Write the implementation**

Append after `mlDecide` (still before `function currentHcp(player){`):
```js
// The draw (spec decision 10): the 16 sorted by handicap index on the draw date, lowest first, make
// four pots of four; each group gets one player from each pot at random (shuffleDraw = Fisher-Yates).
// entrants: [{pid, index}] in sign-up order — the sort is stable, so equal indexes keep that order.
// Returns groups A–D, each [pot-1 pid, pot-2 pid, pot-3 pid, pot-4 pid].
function mlDrawGroups(entrants){
  const s=[...entrants].sort((x,y)=>x.index-y.index);
  const pots=[0,1,2,3].map(k=>shuffleDraw(s.slice(k*4,k*4+4).map(e=>e.pid)));
  return[0,1,2,3].map(g=>pots.map(pot=>pot[g]));
}
// Round robin in pot order: round 1 1v4 2v3, round 2 1v3 4v2, round 3 1v2 3v4.
const ML_PAIRS=[[[0,3],[1,2]],[[0,2],[3,1]],[[0,1],[2,3]]];
// Every league match, created together at the draw: 24 group matches (round 1–3, match_num 2g-1 and
// 2g for group g) and 16 playoff slots — per bracket b two semis (round 4, match_num 2b-1 and 2b),
// the final (round 5, 2b-1) and the 3rd/4th match (round 5, 2b). Playoff players are filled in as
// results come in and re-filled in place by the edit rules; rows are never deleted.
function mlFixtures(groups){
  const rows=[];
  groups.forEach((g,gi)=>ML_PAIRS.forEach((pairs,ri)=>pairs.forEach(([x,y],k)=>
    rows.push({stage:'group',bracket:null,round:ri+1,match_num:gi*2+k+1,team_a_p1_id:g[x],team_b_p1_id:g[y]}))));
  for(let b=1;b<=4;b++)for(const [stage,round,n] of [['semi',4,b*2-1],['semi',4,b*2],['final',5,b*2-1],['place',5,b*2]])
    rows.push({stage,bracket:b,round,match_num:n,team_a_p1_id:null,team_b_p1_id:null});
  return rows;
}
const mlGroupOf=m=>Math.ceil(m.match_num/2);   // group matches: 1–4 = A–D
const mlDeadline=(t,m)=>(t.deadlines||{})[ML_ROUND_KEYS[m.round-1]]||null;
// Overdue: its round's play-by date has passed and it isn't decided. What happens then is the
// members' call (spec decision 8); the admin records it as an outcome.
const mlOverdue=(t,m,rec)=>{const d=mlDeadline(t,m);return !!d&&!rec.decided&&today()>d;};
function mlMatchName(r){
  const B=ML_BRACKETS[r.bracket-1];
  return r.stage==='group'?`Group ${'ABCD'[mlGroupOf(r)-1]} · round ${r.round}`
    :r.stage==='semi'?`${B} semi-final ${r.match_num%2?1:2}`:r.stage==='final'?`${B} final`:`${B} 3rd/4th`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `powershell -NoProfile -File tests/run.ps1 -Test tests/matchplay.test.js`
Expected: PASS, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/matchplay.test.js
git commit -F- <<'EOF'
feat: matchplay league — seeded draw, 40 fixtures, deadlines and overdue

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01N6cfxP9mcgmYjbs4UMRCnG
EOF
```

---

### Task 4: Group standings and every tie-break

**Files:**
- Modify: `index.html` (append to the league pure block)
- Test: `tests/matchplay.test.js`

**Interfaces:**
- Consumes: the match record shape `{stage,a,b,decided,winner,holes:{a,b},ph:{a,b}|null}`. Task 6's `mlRecord` produces it.
- Produces: `mlStandings(pids:number[4], recs, seeds:{pid:pot}) → [{pid,P,W,H,L,pts,holes,avgPh,pos}]`, ordered.

- [ ] **Step 1: Write the failing test**

Insert above `    // ── end ──`:
```js
    // ── Task 4: group standings and tie-breaks ──
    {
      const rec=(a,b,winner,x={})=>({stage:'group',a,b,decided:winner!==undefined,winner:winner===undefined?null:winner,holes:{a:0,b:0},ph:null,started:true,...x});
      const order=(recs,seeds={1:1,2:2,3:3,4:4})=>mlStandings([1,2,3,4],recs,seeds).map(s=>s.pid).join(',');
      let st=mlStandings([1,2,3,4],[rec(1,4,'a'),rec(2,3,'half'),rec(1,3,'b'),rec(4,2,'b'),rec(1,2,undefined),rec(3,4,undefined)],{1:1,2:2,3:3,4:4});
      const row=pid=>st.find(s=>s.pid===pid);
      T('table: P W H L and points (1 / ½ / 0); undecided matches not counted',row(1).P===2&&row(1).W===1&&row(1).L===1&&row(1).pts===1&&row(2).H===1&&row(2).pts===1.5&&row(4).P===2&&row(4).pts===0);
      T('table: ordered by points, positions 1–4',st[0].pts===1.5&&st[3].pid===4&&st.map(s=>s.pos).join()==='1,2,3,4');
      T('(a) two tied: the winner of their match ranks higher, even with fewer holes won',
        order([rec(1,2,'b',{holes:{a:0,b:1}}),rec(1,3,'a',{holes:{a:9,b:0}}),rec(2,4,'b',{holes:{a:0,b:2}}),rec(3,4,'a'),rec(1,4,'a',{holes:{a:5,b:0}}),rec(2,3,'a',{holes:{a:1,b:0}})])==='2,1,3,4');
      T('(b) tied and halved against each other: more group holes won ranks higher',
        order([rec(1,2,'half'),rec(1,3,'a',{holes:{a:2,b:0}}),rec(2,3,'a',{holes:{a:5,b:0}}),rec(1,4,'b'),rec(2,4,'b'),rec(3,4,'b')])==='4,2,1,3');
      T('(c) then lower average playing handicap',
        order([rec(1,2,'half',{ph:{a:14,b:10}}),rec(1,3,'a',{ph:{a:14,b:9}}),rec(2,3,'a',{ph:{a:10,b:9}}),rec(1,4,'b',{ph:{a:14,b:3}}),rec(2,4,'b',{ph:{a:10,b:3}}),rec(3,4,'b',{ph:{a:9,b:3}})])==='4,2,1,3');
      const flat=[rec(1,2,'half'),rec(1,3,'a'),rec(2,3,'a'),rec(1,4,'b'),rec(2,4,'b'),rec(3,4,'b')];
      T('(d) and finally seed pot',order(flat,{1:2,2:1,3:3,4:4})==='4,2,1,3'&&order(flat)==='4,1,2,3');
      // 1 beat 2, 2 beat 3, 1 halved 3; 1–4 double forfeit, 2–4 halved, 3 beat 4 → 1, 2, 3 all on 1½
      const three=[rec(1,2,'a',{holes:{a:1,b:0}}),rec(2,3,'a',{holes:{a:1,b:0}}),rec(1,3,'half'),rec(1,4,null),rec(2,4,'half'),rec(3,4,'a',{holes:{a:9,b:0}})];
      T('three-way tie resolved by the mini-table of their own matches (not holes, not seed)',order(three,{1:3,2:2,3:1,4:4})==='1,2,3,4');
      st=mlStandings([1,2,3,4],three,{1:3,2:2,3:1,4:4});
      T('double forfeit: played and lost for both, no points',row(4).L===2&&row(4).P===3&&row(1).L===1&&row(1).pts===1.5);
      T('three-way circle (equal mini-table) falls to holes won, then head-to-head again for the pair still level',
        order([rec(1,2,'a',{holes:{a:2,b:0}}),rec(2,3,'a',{holes:{a:1,b:0}}),rec(3,1,'a',{holes:{a:4,b:0}}),rec(1,4,'a',{holes:{a:3,b:0}}),rec(2,4,'a',{holes:{a:1,b:0}}),rec(3,4,'a',{holes:{a:1,b:0}})])==='3,1,2,4');
      st=mlStandings([1,2,3,4],[rec(1,2,'a',{ph:{a:10,b:20}}),rec(1,3,'a'),rec(1,4,'a',{ph:{a:14,b:2}})],{1:1,2:2,3:3,4:4});
      T('average playing handicap: played matches only (a walkover has none)',row(1).avgPh===12&&row(3).avgPh===null);
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `powershell -NoProfile -File tests/run.ps1 -Test tests/matchplay.test.js`
Expected: FAIL with `ReferenceError: mlStandings is not defined`.

- [ ] **Step 3: Write the implementation**

Append to the league pure block:
```js
// A group's table. recs: match records ({a,b,decided,winner,holes,ph}); seeds: {pid: seed_pot}.
// Points from decided matches: win 1, halve ½, loss 0 (a double forfeit is a loss for both). Order:
// points, then (a) the tied players' results against each other — a mini-table for three or more —
// (b) holes won in the group, (c) lower average playing handicap over played matches, (d) seed pot
// (never level inside a group). A step that splits a tied set restarts at (a) for each smaller set.
function mlStandings(pids,recs,seeds){
  const row={};for(const p of pids)row[p]={pid:p,P:0,W:0,H:0,L:0,pts:0,holes:0,phs:[]};
  for(const r of recs){if(!r.decided)continue;
    for(const s of['a','b']){const x=row[r[s]];if(!x)continue;
      x.P++;x.holes+=r.holes[s];if(r.ph)x.phs.push(r.ph[s]);
      if(r.winner==='half'){x.H++;x.pts+=0.5;}else if(r.winner===s){x.W++;x.pts+=1;}else x.L++;}}
  for(const x of Object.values(row))x.avgPh=x.phs.length?x.phs.reduce((t,v)=>t+v,0)/x.phs.length:null;
  const rank=ids=>{
    if(ids.length<2)return ids;
    const set=new Set(ids);
    const keys=[   // higher ranks first
      id=>recs.filter(r=>r.decided&&set.has(r.a)&&set.has(r.b)&&(r.a===id||r.b===id)).reduce((t,r)=>t+(r.winner==='half'?0.5:r[r.winner]===id?1:0),0),
      id=>row[id].holes,
      id=>row[id].avgPh==null?-Infinity:-row[id].avgPh,
      id=>-(seeds[id]??99)];
    for(const k of keys){
      const v=new Map(ids.map(id=>[id,k(id)])),vals=[...new Set(v.values())].sort((x,y)=>y-x);
      if(vals.length>1)return vals.flatMap(val=>rank(ids.filter(id=>v.get(id)===val)));
    }
    return ids;
  };
  const byPts=[...new Set(pids.map(p=>row[p].pts))].sort((x,y)=>y-x);
  return byPts.flatMap(v=>rank(pids.filter(p=>row[p].pts===v))).map((p,i)=>({...row[p],pos:i+1}));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `powershell -NoProfile -File tests/run.ps1 -Test tests/matchplay.test.js`
Expected: PASS, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/matchplay.test.js
git commit -F- <<'EOF'
feat: matchplay league — group standings with the full tie-break chain

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01N6cfxP9mcgmYjbs4UMRCnG
EOF
```

---

### Task 5: Playoff plan, final places and the edit rules (pure)

**Files:**
- Modify: `index.html` (append to the league pure block)
- Test: `tests/matchplay.test.js`

**Interfaces:**
- Consumes: `mlStandings`, `mlGroupOf`, `mlMatchName`, and the record shape (plus `id,round,match_num,bracket,started`).
- Produces:
  - `mlPlan(recs,groups,seeds) → {want:{[matchId]:{a,b}}, tables, groupsDone}`.
  - `mlPlaces(recs) → [{place,pid}]`, sorted.
  - `mlChampion(recs) → pid|null`.
  - `mlGate(before,after,id,groups,seeds) → {blocker:rec} | {updates:[{id,team_a_p1_id,team_b_p1_id}]}`.
  - Test helpers `G`, `SEEDS` (shared by later sections).

- [ ] **Step 1: Write the failing test**

Insert above `    // ── end ──`:
```js
    // ── Task 5: playoffs, places and the edit rules ──
    const G=[[1,2,3,4],[5,6,7,8],[9,10,11,12],[13,14,15,16]],SEEDS={};G.forEach(g=>g.forEach((p,i)=>SEEDS[p]=i+1));
    {
      const fresh=()=>mlFixtures(G).map((m,i)=>({id:i+1,stage:m.stage,round:m.round,match_num:m.match_num,bracket:m.bracket,a:m.team_a_p1_id,b:m.team_b_p1_id,decided:false,winner:null,holes:{a:0,b:0},ph:null,started:false,label:'—'}));
      const win=(r,w)=>Object.assign(r,{decided:true,started:true,winner:w,holes:w==='a'?{a:3,b:0}:w==='b'?{a:0,b:3}:{a:1,b:1}});
      const better=r=>SEEDS[r.a]<SEEDS[r.b]?'a':'b';
      const grouped=()=>{const rs=fresh();rs.filter(r=>r.stage==='group').forEach(r=>win(r,better(r)));return rs;};
      const put=(rs,ups)=>{for(const u of ups){const r=rs.find(x=>x.id===u.id);r.a=u.team_a_p1_id;r.b=u.team_b_p1_id;}return rs;};
      const settle=rs=>put(rs,Object.entries(mlPlan(rs,G,SEEDS).want).filter(([id,w])=>{const r=rs.find(x=>x.id===+id);return w.a!==r.a||w.b!==r.b;}).map(([id,w])=>({id:+id,team_a_p1_id:w.a,team_b_p1_id:w.b})));
      const clone=rs=>rs.map(r=>({...r,holes:{...r.holes}}));
      const find=(rs,stage,b,n)=>rs.find(r=>r.stage===stage&&r.bracket===b&&(n==null||r.match_num===n));
      const slots=r=>r.a+'v'+r.b;
      const semisPlayed=()=>{const rs=settle(grouped());for(let b=1;b<=4;b++){win(find(rs,'semi',b,b*2-1),'a');win(find(rs,'semi',b,b*2),'a');}return settle(rs);};
      const full=()=>{const rs=semisPlayed();for(let b=1;b<=4;b++){win(find(rs,'final',b),'a');win(find(rs,'place',b),'a');}return rs;};
      const stA=rs=>mlStandings(G[0],rs.filter(r=>r.stage==='group'&&mlGroupOf(r)===1),SEEDS).map(x=>x.pid).join(',');
      // progression
      let before=grouped();const lastG=before.filter(r=>r.stage==='group').pop();Object.assign(lastG,{decided:false,winner:null});
      let after=clone(before);win(after.find(r=>r.id===lastG.id),better(lastG));
      let g=mlGate(before,after,lastG.id,G,SEEDS);
      T('last group match decided: all 8 semis filled',!g.blocker&&g.updates.length===8);
      put(after,g.updates);
      T('Winners semis: A1 v B1 and C1 v D1',slots(find(after,'semi',1,1))==='1v5'&&slots(find(after,'semi',1,2))==='9v13');
      T('Fourths semis: A4 v B4 and C4 v D4',slots(find(after,'semi',4,7))==='4v8'&&slots(find(after,'semi',4,8))==='12v16');
      T('finals wait for the semis',g.updates.every(u=>after.find(r=>r.id===u.id).stage==='semi'));
      const fl=full(),pl=mlPlaces(fl);
      T('places 1–16: each once, 16 different players',pl.map(x=>x.place).join()===[...Array(16)].map((_,i)=>i+1).join()&&new Set(pl.map(x=>x.pid)).size===16);
      T('Winners bracket gives places 1–4: 1, 9, 5, 13',pl.slice(0,4).map(x=>x.pid).join()==='1,9,5,13');
      T('champion: the Winners final winner',mlChampion(fl)===1);
      T('everyone plays exactly 5 matches',[...Array(16)].every((_,i)=>fl.filter(r=>r.decided&&(r.a===i+1||r.b===i+1)).length===5));
      T('group edit before the playoffs exist: nothing else changes',(()=>{const b0=fresh();win(b0[0],'a');const a0=clone(b0);win(a0[0],'b');const x=mlGate(b0,a0,1,G,SEEDS);return !x.blocker&&x.updates.length===0;})());
      // E1 — group edit, playoffs filled, none started → brackets rebuilt in place
      const b1=settle(grouped()),ab=b1.find(r=>r.stage==='group'&&r.round===3&&r.a===1&&r.b===2);
      T('E1 before: group A order 1,2,3,4',stA(b1)==='1,2,3,4');
      const a1=clone(b1);win(a1.find(r=>r.id===ab.id),'b');
      T('E1 after: 2 tops group A',stA(a1)==='2,1,3,4');
      g=mlGate(b1,a1,ab.id,G,SEEDS);
      T('E1: group edit with no playoff match started rebuilds the brackets',!g.blocker&&g.updates.length===2);
      put(a1,g.updates);
      T('E1: Winners semi 1 now 2 v 5; Runners-up semi 1 now 1 v 6',slots(find(a1,'semi',1,1))==='2v5'&&slots(find(a1,'semi',2,3))==='1v6');
      T('E1: the same match rows are updated (ids kept)',g.updates.every(u=>b1.some(r=>r.id===u.id&&r.stage==='semi')));
      // E2 — group edit once ANY playoff match has started → refused, nothing changes
      const b2=settle(grouped());find(b2,'semi',4,7).started=true;
      const a2=clone(b2);win(a2.find(r=>r.id===ab.id),'b');
      g=mlGate(b2,a2,ab.id,G,SEEDS);
      T('E2: group edit refused once any playoff match has started (even another bracket)',!!g.blocker&&!g.updates);
      T('E2: the refusal names the blocking match',mlMatchName(g.blocker)==='Fourths semi-final 1');
      // E3 — a group match re-opened (no longer decided) → every semi emptied
      const b3=settle(grouped()),a3=clone(b3);Object.assign(a3.find(r=>r.id===ab.id),{decided:false,winner:null});
      g=mlGate(b3,a3,ab.id,G,SEEDS);
      T('E3: re-opened group match empties all 8 semis',!g.blocker&&g.updates.length===8&&g.updates.every(u=>u.team_a_p1_id==null&&u.team_b_p1_id==null));
      T('E3: group A table drops the re-opened match',mlStandings(G[0],a3.filter(r=>r.stage==='group'&&mlGroupOf(r)===1),SEEDS).find(x=>x.pid===1).P===2);
      // E4 — semi edit, final and 3rd/4th unstarted → exactly those two rebuilt
      const b4=semisPlayed(),sf1=find(b4,'semi',1,1);
      T('E4 before: Winners final 1 v 9, 3rd/4th 5 v 13',slots(find(b4,'final',1))==='1v9'&&slots(find(b4,'place',1))==='5v13');
      const a4=clone(b4);win(a4.find(r=>r.id===sf1.id),'b');
      g=mlGate(b4,a4,sf1.id,G,SEEDS);
      T('E4: semi edit rebuilds its final and 3rd/4th only',!g.blocker&&g.updates.length===2);
      put(a4,g.updates);
      T('E4: Winners final now 5 v 9; 3rd/4th 1 v 13',slots(find(a4,'final',1))==='5v9'&&slots(find(a4,'place',1))==='1v13');
      T('E4: other brackets untouched',[2,3,4].every(b=>slots(find(a4,'final',b))===slots(find(b4,'final',b))));
      // E5 — semi edit refused once its final or 3rd/4th has started; another bracket doesn't block
      let b5=semisPlayed();find(b5,'final',1).started=true;let a5=clone(b5);win(a5.find(r=>r.id===sf1.id),'b');
      g=mlGate(b5,a5,sf1.id,G,SEEDS);
      T('E5: semi edit refused once its final has started, naming it',!!g.blocker&&mlMatchName(g.blocker)==='Winners final');
      b5=semisPlayed();find(b5,'place',1).started=true;a5=clone(b5);win(a5.find(r=>r.id===sf1.id),'b');
      g=mlGate(b5,a5,sf1.id,G,SEEDS);
      T('E5: refused when only its 3rd/4th has started',!!g.blocker&&mlMatchName(g.blocker)==='Winners 3rd/4th');
      b5=semisPlayed();find(b5,'final',2).started=true;a5=clone(b5);win(a5.find(r=>r.id===sf1.id),'b');
      g=mlGate(b5,a5,sf1.id,G,SEEDS);
      T('E5: another bracket\'s final having started does not block',!g.blocker&&g.updates.length===2);
      // E6 — semi re-opened (now needs sudden death) → final and 3rd/4th emptied
      const b6=semisPlayed(),a6=clone(b6);Object.assign(a6.find(r=>r.id===sf1.id),{decided:false,winner:null});
      g=mlGate(b6,a6,sf1.id,G,SEEDS);
      T('E6: a re-opened semi empties its final and 3rd/4th',!g.blocker&&g.updates.length===2&&g.updates.every(u=>u.team_a_p1_id==null&&u.team_b_p1_id==null));
      // E7 — final edit: places and champion only
      const b7=full(),fin1=find(b7,'final',1),a7=clone(b7);win(a7.find(r=>r.id===fin1.id),'b');
      g=mlGate(b7,a7,fin1.id,G,SEEDS);
      T('E7: final edit changes no playoff slot',!g.blocker&&g.updates.length===0);
      T('E7: places 1 and 2 swap; places 3–16 unchanged',mlPlaces(a7).slice(0,4).map(x=>x.pid).join()==='9,1,5,13'&&mlPlaces(a7).slice(4).map(x=>x.pid).join()===mlPlaces(b7).slice(4).map(x=>x.pid).join());
      T('E7: the champion follows the final',mlChampion(b7)===1&&mlChampion(a7)===9);
      Object.assign(a7.find(r=>r.id===fin1.id),{decided:false,winner:null});
      T('E7: an undecided final leaves places 1–2 and the champion empty',mlChampion(a7)===null&&!mlPlaces(a7).some(x=>x.place<=2)&&mlPlaces(a7).length===14);
      // E8 — 3rd/4th edit
      const pl1=find(b7,'place',1),a8=clone(b7);win(a8.find(r=>r.id===pl1.id),'b');
      g=mlGate(b7,a8,pl1.id,G,SEEDS);
      T('E8: 3rd/4th edit: no slot changes, places 3 and 4 swap, champion unchanged',!g.blocker&&g.updates.length===0&&mlPlaces(a8).slice(2,4).map(x=>x.pid).join()==='13,5'&&mlChampion(a8)===1);
      // E9 — playoff double forfeit naming who goes through
      const b9=settle(grouped());win(find(b9,'semi',1,1),'a');
      const sf2=find(b9,'semi',1,2),a9=clone(b9);Object.assign(a9.find(r=>r.id===sf2.id),{decided:true,started:true,winner:'b',holes:{a:0,b:0}});
      g=mlGate(b9,a9,sf2.id,G,SEEDS);put(a9,g.updates);
      T('E9: playoff double forfeit: the named player goes through to the final',slots(find(a9,'final',1))==='1v13'&&slots(find(a9,'place',1))==='5v9');
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `powershell -NoProfile -File tests/run.ps1 -Test tests/matchplay.test.js`
Expected: FAIL with `ReferenceError: mlGate is not defined`.

- [ ] **Step 3: Write the implementation**

Append to the league pure block:
```js
// Who should be in each playoff slot, from the match records alone. Semis once every group match is
// decided (bracket b: Group A b-th v Group B b-th, Group C b-th v Group D b-th); a bracket's final
// (the semi winners) and 3rd/4th (the losers) once both its semis are decided with the players the
// plan puts there. want: {matchId: {a, b}} — nulls = not yet decided.
function mlPlan(recs,groups,seeds){
  const want={},group=recs.filter(r=>r.stage==='group');
  const tables=groups.map((g,gi)=>mlStandings(g,group.filter(r=>mlGroupOf(r)===gi+1),seeds));
  const groupsDone=group.length===24&&group.every(r=>r.decided);
  for(let b=1;b<=4;b++){
    const pos=gi=>groupsDone?(tables[gi][b-1]?.pid??null):null;
    const s=[{a:pos(0),b:pos(1)},{a:pos(2),b:pos(3)}];
    const semis=recs.filter(r=>r.stage==='semi'&&r.bracket===b).sort((x,y)=>x.match_num-y.match_num);
    semis.forEach((r,i)=>want[r.id]=s[i]);
    const ok=(r,i)=>s[i].a!=null&&r.a===s[i].a&&r.b===s[i].b&&r.decided&&(r.winner==='a'||r.winner==='b');
    const both=semis.length===2&&semis.every(ok);
    const W=r=>r[r.winner],L=r=>r[r.winner==='a'?'b':'a'];
    for(const r of recs.filter(r=>r.bracket===b&&(r.stage==='final'||r.stage==='place')))
      want[r.id]=!both?{a:null,b:null}:r.stage==='final'?{a:W(semis[0]),b:W(semis[1])}:{a:L(semis[0]),b:L(semis[1])};
  }
  return{want,tables,groupsDone};
}
// Final places 1–16 from the finals and 3rd/4th matches — derived every time, never stored.
function mlPlaces(recs){
  const out=[];
  for(const r of recs)if((r.stage==='final'||r.stage==='place')&&r.decided&&(r.winner==='a'||r.winner==='b')){
    const p=(r.bracket-1)*4+(r.stage==='final'?1:3);
    out.push({place:p,pid:r[r.winner]},{place:p+1,pid:r[r.winner==='a'?'b':'a']});
  }
  return out.sort((x,y)=>x.place-y.place);
}
const mlChampion=recs=>mlPlaces(recs).find(x=>x.place===1)?.pid??null;
// THE EDIT RULES. before/after: every record of the league without and with a proposed change to
// match `id`. A group change is refused once ANY playoff match has started; a semi change once its
// bracket's final or 3rd/4th has; a final or 3rd/4th change never is (it only moves places). Refused →
// {blocker}: nothing may be written. Otherwise {updates}: the playoff slots (same rows, in place) that
// the new plan fills, re-fills or empties.
function mlGate(before,after,id,groups,seeds){
  const m=before.find(r=>r.id===id);
  const locked=m.stage==='group'?before.filter(r=>r.stage!=='group'&&r.started)
    :m.stage==='semi'?before.filter(r=>r.bracket===m.bracket&&(r.stage==='final'||r.stage==='place')&&r.started):[];
  if(locked.length)return{blocker:locked[0]};
  const {want}=mlPlan(after,groups,seeds);
  const changed=after.filter(r=>want[r.id]&&(want[r.id].a!==r.a||want[r.id].b!==r.b));
  const hit=changed.find(r=>r.started);   // never move a match already under way
  if(hit)return{blocker:hit};
  return{updates:changed.map(r=>({id:r.id,team_a_p1_id:want[r.id].a,team_b_p1_id:want[r.id].b}))};
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `powershell -NoProfile -File tests/run.ps1 -Test tests/matchplay.test.js`
Expected: PASS, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/matchplay.test.js
git commit -F- <<'EOF'
feat: matchplay league — playoff plan, derived places, and the edit rules gate

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01N6cfxP9mcgmYjbs4UMRCnG
EOF
```

---

### Task 6: League records and the Tournament tab views

**Files:**
- Modify: `index.html`:
  - `renderTournament` (after `  activeTournamentId=tourn.id;`).
  - A new live/UI block immediately before `function renderSaturdayAdmin(){`.
- Test: `tests/matchplay.test.js`

**Interfaces:**
- Consumes:
  - From Tasks 2–5: `mlDecide`, `tmMatchHcpInfo`, `mlStandings`, `mlPlan`, `mlPlaces`, `mlChampion`, `mlGroupOf`, `mlDeadline`, `mlOverdue`, `mlMatchName`, `ML_BRACKETS`.
  - Existing: `isAdmin()`, `activeId`, `escHtml`, `fd`, `ordinal`.
- Produces:
  - `mlRecord(m,t,scores) → record` and `mlRecords(t,ms=tournamentMatches,sc=tournamentScores) → record[]`.
  - `mlGroups(t) → {groups,seeds}`.
  - `mlEntryRows(t) → rows` (sign-up order) and `mlEntries(t) → {es,in,waiting}`.
  - `mlName(pid) → escaped name` and `mlCanOpen(m,rec) → bool`.
  - `let mlTab` ('groups'|'playoffs'|'results').
  - `renderLeagueHtml(t)`, `mlEntryHtml(t)`, `mlMatchRowHtml(t,m,rec)`, `mlGroupsHtml`, `mlPlayoffsHtml`, `mlResultsHtml`.
  - Test helpers (shared): `LG`, `league()`, `entryLeague(n)`, `gm()`, `semi(b,n)`, `fin(b,stage)`, `decideLocal(m,w)`, `seedWin(m)`, `fillLocal()`, `W(w)`, `tc()`, `byId(id)`, `stub()`, `sid`.

- [ ] **Step 1: Write the failing test**

Insert above `    // ── end ──`:
```js
    // ── Task 6: the Tournament tab for a league ──
    const LG={id:900,name:'Matchplay 2027',date:'2027-04-01',tee_id:'57',format:'league',status:'drawn',buy_in:200,max_players:16,
      deadlines:{group_1:'2027-05-15',group_2:'2027-06-15',group_3:'2027-07-31',semi:'2027-08-20',final:'2027-09-10'}};
    // A drawn league: players 1–16 all index 18 (nett = gross), groups G, 40 matches (ids 1–40), no scores.
    const league=()=>{tournaments=[{...LG}];activeTournamentId=900;TE.matchId=null;mlTab='groups';
      players=[...Array(16)].map((_,i)=>P(i+1,'P'+(i+1)));players[0].is_admin=true;activeId=2;
      tournamentPlayers=G.flatMap((g,gi)=>g.map((pid,k)=>({id:100+pid,tournament_id:900,player_id:pid,team:'league',group_num:gi+1,seed_pot:k+1,entered_at:new Date(Date.UTC(2027,2,1,10,0,pid)).toISOString(),paid_at:null,amount:null})));
      tournamentMatches=mlFixtures(G).map((r,i)=>({id:i+1,tournament_id:900,status:'pending',result:null,start_hole:1,extra_holes:0,outcome:'played',decided_by:null,played_on:null,tee_id:null,team_a_p2_id:null,team_b_p2_id:null,_teeId:'57',...r}));
      tournamentScores=[];};
    // An open league with n entries (players 1–n signed up in that order; 20 players exist).
    const entryLeague=n=>{tournaments=[{...LG,status:'entry'}];activeTournamentId=900;TE.matchId=null;
      players=[...Array(20)].map((_,i)=>P(i+1,'P'+(i+1)));players[0].is_admin=true;
      tournamentPlayers=[...Array(n)].map((_,i)=>({id:300+i+1,tournament_id:900,player_id:i+1,team:'league',entered_at:new Date(Date.UTC(2027,2,1,10,0,i)).toISOString(),paid_at:null,amount:null,group_num:null,seed_pot:null}));
      tournamentMatches=[];tournamentScores=[];};
    let sid=1000;
    const stub=()=>reset((u,b,m)=>m==='POST'&&u.includes('tournament_scores')?[{id:++sid,...b}]:m==='PATCH'?[{...b,id:+(u.match(/id=eq\.(\d+)/)||[])[1]}]:[]);
    const byId=id=>tournamentMatches.find(m=>m.id===id);
    const gm=()=>tournamentMatches.filter(m=>m.stage==='group');
    const semi=(b,n)=>tournamentMatches.find(m=>m.stage==='semi'&&m.bracket===b&&m.match_num===b*2-2+n);
    const fin=(b,stage='final')=>tournamentMatches.find(m=>m.stage===stage&&m.bracket===b);
    const W=w=>w==='a'?[3,5]:[5,3];
    // Decide a match locally, no requests: the winner takes holes 1–10 (10&8).
    const decideLocal=(m,w)=>{tournamentScores.push(...card(m,holes(1,10,...W(w))));Object.assign(m,{status:'complete',result:w,played_on:'2027-05-01'});};
    const seedWin=m=>{const s={};tournamentPlayers.forEach(e=>s[e.player_id]=e.seed_pot);return s[m.team_a_p1_id]<s[m.team_b_p1_id]?'a':'b';};
    // Put the planned players into every playoff slot, locally (what mlChange writes).
    const fillLocal=()=>{const t=tournaments[0],{groups,seeds}=mlGroups(t),{want}=mlPlan(mlRecords(t),groups,seeds);for(const m of tournamentMatches)if(want[m.id]){m.team_a_p1_id=want[m.id].a;m.team_b_p1_id=want[m.id].b;}};
    const tc=()=>document.getElementById('tournamentContent').innerHTML;
    {
      league();today=()=>'2027-05-16';
      gm().filter(m=>mlGroupOf(m)===1&&m.round<3).forEach(m=>decideLocal(m,seedWin(m)));
      T('records: one per league match, decided from the scores',mlRecords(tournaments[0]).length===40&&mlRecords(tournaments[0]).filter(r=>r.decided).length===4&&mlRecords(tournaments[0])[0].label==='10&8');
      T('records: playing handicaps kept for played matches',mlRecords(tournaments[0])[0].ph.a===mlRecords(tournaments[0])[0].ph.b);
      T('groups from the draw, in pot order, with seeds',JSON.stringify(mlGroups(tournaments[0]).groups)===JSON.stringify(G)&&mlGroups(tournaments[0]).seeds[7]===3);
      renderTournament();let html=tc();
      T('league: Groups, Playoffs and Results tabs; no team-day tabs',/>Groups</.test(html)&&/>Playoffs</.test(html)&&/>Results</.test(html)&&!/Fourballs/.test(html));
      T('four group tables with P W H L Pts Holes Avg PH',(html.match(/>Group [ABCD]</g)||[]).length===4&&/>Pts</.test(html)&&/>Avg PH</.test(html));
      const blockA=html.split('>Group B<')[0];
      T('group A ordered by points',blockA.indexOf('>P1<')<blockA.indexOf('>P2<')&&blockA.indexOf('>P2<')<blockA.indexOf('>P3<'));
      T('fixtures show their round and play-by date',/Round 1 · play by 15 May 2027/.test(html));
      T('Overdue: the six undecided round-1 matches past 15 May, not the decided ones',(html.match(/>Overdue</g)||[]).length===6);
      T('decided result shown',/10&amp;8/.test(html));
      T('rows open for the two players while undecided',html.includes('teOpenMatch(5)')&&!html.includes('teOpenMatch(2)')&&!html.includes('teOpenMatch(6)'));
      activeId=1;renderTournament();html=tc();
      T('an admin can open any match, decided ones too',html.includes('teOpenMatch(2)')&&html.includes('teOpenMatch(6)'));
      mlTab='playoffs';renderTournament();html=tc();
      T('Playoffs: four brackets with their places',/Winners — places 1–4/.test(html)&&/Fourths — places 13–16/.test(html));
      T('Playoffs: how the semis are made',/Group A 1st v Group B 1st/.test(html));
      mlTab='results';renderTournament();
      T('Results: nothing yet',/Places appear as the finals/.test(tc()));
      gm().forEach(m=>{if(m.status!=='complete')decideLocal(m,seedWin(m));});fillLocal();
      for(let b=1;b<=4;b++){decideLocal(semi(b,1),'a');decideLocal(semi(b,2),'a');}fillLocal();
      for(let b=1;b<=4;b++){decideLocal(fin(b),'a');decideLocal(fin(b,'place'),'a');}
      renderTournament();html=tc();
      T('Results: 16 places, the champion marked',(html.match(/<tr><td>\d+(st|nd|rd|th)</g)||[]).length===16&&/🏆 P1</.test(html));
      mlTab='groups';players[2].name='<b>X</b>';players[3].archived_at='2027-05-01';renderTournament();
      T('names are escaped',!document.getElementById('tournamentContent').querySelector('b')&&/&lt;b&gt;X/.test(tc()));
      T('an archived player still shows by name',/>P4</.test(tc()));
      entryLeague(17);renderTournament();html=tc();
      T('entry phase: 16 in and a waiting list',/In \(16\/16\)/.test(html)&&/Waiting list/.test(html));
      tournaments=[{id:5,name:'Cup',date:'2026-07-04',tee_id:'57',status:'round_1',team_a_name:'Reds',team_b_name:'Blues'}];activeTournamentId=5;tournamentMatches=[];
      renderTournament();
      T('a tournament without format (before the migration) renders as team day',/Fourballs/.test(tc())&&/Reds/.test(tc()));
      today=()=>'2027-05-10';activeId=2;
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `powershell -NoProfile -File tests/run.ps1 -Test tests/matchplay.test.js`
Expected: FAIL with `ReferenceError: mlRecords is not defined`. The helpers' assignment to `mlTab` just creates a global until the app declares it.

- [ ] **Step 3: Write the implementation**

In `renderTournament`, replace:
```js
  activeTournamentId=tourn.id;
```
with:
```js
  activeTournamentId=tourn.id;
  if(tourn.format==='league'){el.innerHTML=selectorHtml+renderLeagueHtml(tourn);return;}
```

Immediately before `function renderSaturdayAdmin(){`, insert:
```js
// ── Matchplay league: live data and the Tournament tab ────────────────────────
// One match's record for the pure rules (mlStandings, mlPlan, mlGate), derived from its scores and
// outcome every time. ph: both players' playing handicaps (90%, match tee and day) when it was played.
function mlRecord(m,t,scores){
  const mm={...m,_teeId:m.tee_id||t.tee_id},both=m.team_a_p1_id!=null&&m.team_b_p1_id!=null;
  const hcp=both?tmMatchHcpInfo(mm,m.played_on||today()):null;
  const d=both?mlDecide(mm,hcp,scores):{decided:false,winner:null,holes:{a:0,b:0},up:0,thru:0,extra:0,started:false,label:'—'};
  const played=both&&(m.outcome||'played')==='played'&&scores.length>0;
  return{id:m.id,stage:m.stage,round:m.round,match_num:m.match_num,bracket:m.bracket,a:m.team_a_p1_id,b:m.team_b_p1_id,...d,ph:played?{a:hcp.phA1,b:hcp.phB1}:null};
}
function mlRecords(t,ms=tournamentMatches,sc=tournamentScores){
  return ms.filter(m=>m.tournament_id===t.id&&m.stage).map(m=>mlRecord(m,t,sc.filter(s=>s.match_id===m.id)));
}
// Groups A–D from the draw ([[pot-1 pid … pot-4 pid]×4]) and each drawn player's seed pot.
function mlGroups(t){
  const groups=[[],[],[],[]],seeds={};
  for(const e of tournamentPlayers)if(e.tournament_id===t.id&&e.group_num){groups[e.group_num-1][e.seed_pot-1]=e.player_id;seeds[e.player_id]=e.seed_pot;}
  return{groups,seeds};
}
// Entries in sign-up order. Before the draw the first max_players are in and the rest wait, moving up
// as anyone ahead withdraws; after it, "in" is whoever was drawn into a group.
const mlEntryRows=t=>tournamentPlayers.filter(e=>e.tournament_id===t.id).sort((x,y)=>Date.parse(x.entered_at)-Date.parse(y.entered_at)||x.id-y.id);
function mlEntries(t){
  const es=mlEntryRows(t),cap=t.max_players||16;
  return t.status==='entry'?{es,in:es.slice(0,cap),waiting:es.slice(cap)}:{es,in:es.filter(e=>e.group_num!=null),waiting:es.filter(e=>e.group_num==null)};
}
const mlName=id=>id==null?'—':escHtml(players.find(p=>p.id===id)?.name||'#'+id);
// Players open their own undecided matches; an admin opens any (to correct it).
const mlCanOpen=(m,rec)=>m.team_a_p1_id!=null&&m.team_b_p1_id!=null&&(m.outcome||'played')==='played'
  &&(isAdmin()||(!rec.decided&&(activeId===m.team_a_p1_id||activeId===m.team_b_p1_id)));
let mlTab='groups';
function renderLeagueHtml(t){
  const tee=tees.find(x=>x.id===t.tee_id)?.name||t.tee_id;
  const head=`<div style="margin-bottom:0.75rem"><h2 style="font-family:'Playfair Display',serif;font-size:1.3rem;margin:0 0 0.25rem">${escHtml(t.name)}</h2>
    <div style="font-size:0.8rem;color:rgba(255,255,255,0.5)">Matchplay league · ${escHtml(tee)} unless both players agree another · 90% handicap, the lower player off 0${Number(t.buy_in)>0?' · DKK '+Number(t.buy_in):''}</div></div>`;
  if(t.status==='entry')return head+mlEntryHtml(t);
  const recs=mlRecords(t),{groups,seeds}=mlGroups(t);
  const tab=(k,l)=>`<button class="sub-tab${mlTab===k?' active':''}" onclick="mlTab='${k}';renderTournament()">${l}</button>`;
  const body=mlTab==='playoffs'?mlPlayoffsHtml(t,recs):mlTab==='results'?mlResultsHtml(t,recs):mlGroupsHtml(t,recs,groups,seeds);
  return head+`<div style="display:flex;gap:0.5rem;margin-bottom:0.75rem">${tab('groups','Groups')}${tab('playoffs','Playoffs')}${tab('results','Results')}</div>`+body;
}
function mlEntryHtml(t){
  const {in:inn,waiting}=mlEntries(t),cap=t.max_players||16,h=s=>`<h4 style="margin:0.75rem 0 0.3rem;font-size:0.85rem">${s}</h4>`;
  const li=e=>`<li>${mlName(e.player_id)}${Number(t.buy_in)>0&&!e.paid_at?' <span class="tag" style="font-size:0.6rem;padding:1px 5px;background:rgba(240,160,48,0.15);color:#f0a030">unpaid</span>':''}</li>`;
  return`<div style="font-size:0.85rem;margin-bottom:0.5rem">Entries are open. The first ${cap} are in; after that, a waiting list moves up if anyone withdraws before the draw.</div>`
    +h(`In (${inn.length}/${cap})`)+(inn.length?`<ol style="margin:0;padding-left:1.4rem">${inn.map(li).join('')}</ol>`:'<div class="empty">Nobody yet.</div>')
    +(waiting.length?h('Waiting list')+`<ol style="margin:0;padding-left:1.4rem">${waiting.map(li).join('')}</ol>`:'');
}
function mlMatchRowHtml(t,m,rec){
  const dl=mlDeadline(t,m),late=mlOverdue(t,m,rec),click=mlCanOpen(m,rec)?`onclick="teOpenMatch(${m.id})" `:'';
  const side=(id,s)=>`<span style="${rec.decided&&rec.winner===s?'font-weight:700;color:var(--gold-l)':''}">${mlName(id)}</span>`;
  return`<div ${click}style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:0.5rem 0.65rem;margin-bottom:0.35rem;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px${click?';cursor:pointer':''}">
    <div><div style="font-size:0.85rem">${side(m.team_a_p1_id,'a')} v ${side(m.team_b_p1_id,'b')}</div>
    <div style="font-size:0.68rem;color:rgba(255,255,255,0.4)">${m.stage==='group'?'Round '+m.round:escHtml(mlMatchName(m))}${dl?' · play by '+fd(dl):''}</div></div>
    <div style="font-size:0.78rem;text-align:right;white-space:nowrap">${escHtml(rec.label)}${late?' <span class="tag" style="font-size:0.6rem;padding:1px 5px;background:rgba(220,80,80,0.15);color:#e06060">Overdue</span>':''}</div></div>`;
}
function mlGroupsHtml(t,recs,groups,seeds){
  const f=v=>v%1?`${Math.floor(v)}½`:String(v);
  return groups.map((g,gi)=>{
    const rows=mlStandings(g,recs.filter(r=>r.stage==='group'&&mlGroupOf(r)===gi+1),seeds).map(s=>`<tr><td>${s.pos}</td><td class="left">${mlName(s.pid)}</td><td>${s.P}</td><td>${s.W}</td><td>${s.H}</td><td>${s.L}</td><td><strong>${f(s.pts)}</strong></td><td>${s.holes}</td><td>${s.avgPh==null?'—':s.avgPh.toFixed(1)}</td></tr>`).join('');
    const fx=tournamentMatches.filter(m=>m.tournament_id===t.id&&m.stage==='group'&&mlGroupOf(m)===gi+1).sort((x,y)=>x.round-y.round||x.match_num-y.match_num);
    return`<div style="margin-bottom:1.25rem"><h3 style="font-family:'Playfair Display',serif;font-size:1rem;margin:0 0 0.4rem">Group ${'ABCD'[gi]}</h3>
      <div class="rt-wrap"><table class="rt"><thead><tr><th>#</th><th class="left">Player</th><th title="Played">P</th><th title="Won">W</th><th title="Halved">H</th><th title="Lost">L</th><th>Pts</th><th title="Holes won">Holes</th><th title="Average playing handicap">Avg PH</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div style="margin-top:0.5rem">${fx.map(m=>mlMatchRowHtml(t,m,recs.find(r=>r.id===m.id))).join('')}</div></div>`;
  }).join('')+`<p style="font-size:0.72rem;color:rgba(255,255,255,0.35)">Win 1 · halve ½ · loss 0. Level on points: the result between the tied players (a mini-table for three or more), then holes won, then the lower average playing handicap.</p>`;
}
function mlPlayoffsHtml(t,recs){
  const ms=tournamentMatches.filter(m=>m.tournament_id===t.id&&m.stage&&m.stage!=='group');
  return[1,2,3,4].map(b=>{
    const row=(stage,n)=>{const m=ms.find(x=>x.stage===stage&&x.bracket===b&&(n==null||x.match_num===b*2-2+n));return m?mlMatchRowHtml(t,m,recs.find(r=>r.id===m.id)):'';};
    const o=ordinal(b);
    return`<div style="margin-bottom:1.25rem"><h3 style="font-family:'Playfair Display',serif;font-size:1rem;margin:0 0 0.25rem">${ML_BRACKETS[b-1]} — places ${b*4-3}–${b*4}</h3>
      <div style="font-size:0.7rem;color:rgba(255,255,255,0.4);margin-bottom:0.4rem">Semi-finals: Group A ${o} v Group B ${o} · Group C ${o} v Group D ${o}. A level match goes to sudden death.</div>
      ${row('semi',1)}${row('semi',2)}${row('final')}${row('place')}</div>`;
  }).join('');
}
function mlResultsHtml(t,recs){
  const pl=mlPlaces(recs),champ=mlChampion(recs);
  if(!pl.length)return'<div class="empty">Places appear as the finals and 3rd/4th matches finish.</div>';
  return`<div class="rt-wrap"><table class="rt"><thead><tr><th>Place</th><th class="left">Player</th></tr></thead><tbody>${pl.map(x=>`<tr><td>${ordinal(x.place)}</td><td class="left">${x.pid===champ?'🏆 ':''}${mlName(x.pid)}</td></tr>`).join('')}</tbody></table></div>`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `powershell -NoProfile -File tests/run.ps1 -Test tests/matchplay.test.js`
Expected: PASS, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/matchplay.test.js
git commit -F- <<'EOF'
feat: matchplay league — Tournament tab: groups, fixtures, overdue, brackets, places

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01N6cfxP9mcgmYjbs4UMRCnG
EOF
```

---

### Task 7: Scoring a league match: `mlChange`, the scoring screen, self-heal

**Files:**
- Modify: `index.html`:
  - `teOpenMatch` (whole function).
  - `renderMatchScoring` (listed lines).
  - `teChangeTee`, `teGoPrevHole`, `teGoNextHole`, `teEnter` (one line).
  - `init` (one line).
  - The league live block (append).
- Test: `tests/matchplay.test.js`

**Interfaces:**
- Consumes:
  - From earlier tasks: `mlRecord`, `mlRecords`, `mlGroups`, `mlGate`, `mlPlan`, `mlMatchName`, `mlNextHole`, `mlPrevHole`, `mlPlayOrder`, `tmHoleIdx`, `tmIsFourball`, `tmMatchDate`.
  - Existing: `sbUpdate`, `sbInsert`, `sbDeleteWhere`, `requireAdminMode`, `TE`, `_teBuffer`, `teBack`.
- Produces:
  - `mlChange(matchId,{patch,score}) → Promise<{ok:true,rec}|{ok:false,msg}>`: the only writer for league matches.
  - `mlSyncFields(m,rec) → {status,result,extra_holes[,played_on]}`.
  - `mlPatch(m,body)`: throws on `[]`.
  - `mlScoreEnter(gross)`.
  - `mlOpenHole(m,byPid,order,decided) → hole`.
  - `teSetStart(h)`, `teCanPrev()`, `teCanNext()`.
  - `mlHealAll()`.

- [ ] **Step 1: Write the failing test**

Insert above `    // ── end ──`:
```js
    // ── Task 7: scoring through mlChange — the edit rules on real writes ──
    {
      const scoreHole=async(m,h,ga,gb)=>{await mlChange(m.id,{score:{hole:h,player_id:m.team_a_p1_id,gross:ga}});return mlChange(m.id,{score:{hole:h,player_id:m.team_b_p1_id,gross:gb}});};
      league();stub();
      gm().slice(0,23).forEach(m=>decideLocal(m,seedWin(m)));
      const last=gm()[23];
      let res=await scoreHole(last,1,...W(seedWin(last)));
      const p1=calls.find(c=>c.method==='PATCH'&&c.url.includes(`tournament_matches?id=eq.${last.id}`));
      T('first score: match in progress, played today',res.ok&&p1&&p1.body.status==='in_progress'&&p1.body.played_on==='2027-05-10');
      T('a score is saved as a tournament_scores row',calls.some(c=>c.method==='POST'&&c.url.includes('tournament_scores')&&c.body.hole===1));
      for(let h=2;h<=10;h++)res=await scoreHole(last,h,...W(seedWin(last)));
      T('10 up with 8 to play: closed by itself, result saved',res.ok&&res.rec.label==='10&8'&&last.status==='complete'&&last.result==='a');
      T('group stage done: the 8 semis are filled (A1 v B1 first)',[1,2,3,4].every(b=>semi(b,1).team_a_p1_id!=null&&semi(b,2).team_b_p1_id!=null)&&semi(1,1).team_a_p1_id===1&&semi(1,1).team_b_p1_id===5);
      T('the finals wait',tournamentMatches.filter(m=>m.round===5).every(m=>m.team_a_p1_id==null));
      // refused: a playoff match has a score → a group correction writes nothing
      tournamentScores.push({id:1,match_id:semi(4,1).id,hole:1,player_id:semi(4,1).team_a_p1_id,gross:4});
      stub();activeId=1;
      const g0=gm()[0];
      res=await mlChange(g0.id,{score:{hole:1,player_id:g0.team_a_p1_id,gross:5}});
      T('group edit after a playoff match started: refused, naming it',!res.ok&&/Fourths semi-final 1/.test(res.msg));
      T('refused: nothing written, the old score kept',calls.length===0&&tournamentScores.find(s=>s.match_id===g0.id&&s.hole===1&&s.player_id===g0.team_a_p1_id).gross===3);
      // re-open: a 3&2 corrected to 2 up with 2 to play; semis filled, none started → all emptied
      league();stub();
      gm().forEach((m,i)=>{if(i){decideLocal(m,seedWin(m));return;}tournamentScores.push(...card(m,[...holes(1,3,...W(seedWin(m))),...holes(4,16,4,4)]));Object.assign(m,{status:'complete',result:seedWin(m),played_on:'2027-05-01'});});
      fillLocal();
      const Y=gm()[0];activeId=1;
      res=await mlChange(Y.id,{score:{hole:1,player_id:Y.team_a_p1_id,gross:5}});   // hole 1 now halved
      T('a correction re-opens a 3&2: in progress, no result',res.ok&&!res.rec.decided&&Y.status==='in_progress'&&Y.result===null);
      T('re-opened group match: all 8 semis emptied in place',tournamentMatches.filter(m=>m.stage==='semi').every(m=>m.team_a_p1_id==null&&m.team_b_p1_id==null)&&calls.filter(c=>c.method==='PATCH'&&c.body.team_a_p1_id===null).length===8);
      // a playoff 1UP corrected to level → sudden death; its final and 3rd/4th emptied, then refilled
      league();stub();gm().forEach(m=>decideLocal(m,seedWin(m)));fillLocal();
      const S=semi(1,1);tournamentScores.push(...card(S,[...holes(1,17,4,4),[18,3,4]]));Object.assign(S,{status:'complete',result:'a',played_on:'2027-08-01'});
      decideLocal(semi(1,2),'a');fillLocal();
      T('before: Winners final 1 v 9',fin(1).team_a_p1_id===1&&fin(1).team_b_p1_id===9);
      activeId=1;res=await mlChange(S.id,{score:{hole:18,player_id:S.team_a_p1_id,gross:4}});
      T('a semi corrected to level after 18 re-opens for sudden death',res.ok&&!res.rec.decided&&S.status==='in_progress'&&S.result===null&&/sudden death/.test(res.rec.label));
      T('its final and 3rd/4th are emptied',fin(1).team_a_p1_id==null&&fin(1,'place').team_a_p1_id==null);
      await scoreHole(S,19,4,4);res=await scoreHole(S,20,3,4);
      T('sudden death: won at the 20th; extra_holes 2 saved; final refilled',res.rec.label==='won at the 20th'&&S.status==='complete'&&S.result==='a'&&S.extra_holes===2&&fin(1).team_a_p1_id===1&&fin(1).team_b_p1_id===9);
      // an RLS-filtered update (200, []) is a failure
      league();reset((u,b,m)=>m==='POST'?[{id:++sid,...b}]:[]);activeId=2;
      const own=gm().find(m=>m.team_a_p1_id===2||m.team_b_p1_id===2);
      res=await mlChange(own.id,{score:{hole:1,player_id:2,gross:4}});
      T('an RLS-filtered update (0 rows) is reported, not silently accepted',!res.ok&&/Couldn't save/.test(res.msg)&&own.status==='pending');
      // Review Focus: admin mode cancelled while correcting a finished match
      league();gm().forEach(m=>decideLocal(m,seedWin(m)));stub();activeId=1;
      const keepRAM=requireAdminMode;window.requireAdminMode=async()=>false;
      res=await mlChange(gm()[0].id,{score:{hole:1,player_id:gm()[0].team_a_p1_id,gross:5}});
      T('admin mode cancelled: refused, nothing written',!res.ok&&calls.length===0);
      window.requireAdminMode=keepRAM;
      // Review Focus: the 30-second refresh replaces every match object while someone is scoring
      league();stub();activeId=2;const mine=gm().find(m=>m.team_a_p1_id===2||m.team_b_p1_id===2);
      teOpenMatch(mine.id);
      tournamentMatches=tournamentMatches.map(m=>({...m}));
      _teBuffer='4';await teEnter();
      T('after a refresh, scoring updates the live match object, not a stale copy',byId(mine.id).status==='in_progress'&&TE.match===byId(mine.id)&&TE.currentPlayerIdx===1);
      TE.matchId=null;
      // the scoring screen
      league();stub();activeId=1;const st10=semi(1,1);Object.assign(st10,{team_a_p1_id:1,team_b_p1_id:5,start_hole:10});
      teOpenMatch(st10.id);let html=tc();
      T('opens on the 10th for a match started there, without marking it started',TE.currentHole===10&&calls.length===0&&st10.status==='pending');
      T('scoring screen: player names, no team names, no Close match button',/P1/.test(html)&&/P5/.test(html)&&!/Team A/.test(html)&&!/teCloseMatchPrompt/.test(html));
      T('an unstarted league match offers the start hole',/teSetStart/.test(html));
      TE.matchId=null;tournamentScores.push(...card(st10,holes(1,18,4,4)));st10.status='in_progress';
      teOpenMatch(st10.id);html=tc();
      T('a level playoff opens on the 19th: sudden death, plays as hole 10',TE.currentHole===19&&/sudden death · plays as 10/.test(html)&&!/teSetStart/.test(html));
      T('navigation: back from the 19th goes to the 9th (last in play order)',teCanPrev()&&mlPrevHole(TE.match,19)===9);
      TE.matchId=null;
      league();players[0].hcp_history=[{date:'2026-01-01',value:2,note:''}];players[3].hcp_history=[{date:'2026-01-01',value:24,note:''}];stub();
      teOpenMatch(gm()[0].id);   // 1 v 4: 4 v 29 → 25 strokes
      T('diff over 18: the banner says every hole, two on SI 1–7',/every hole, two on SI 1–7/.test(tc()));
      TE.matchId=null;
      tournaments.push({id:901,name:'Cup',date:'2027-05-10',tee_id:'57',status:'round_2',team_a_name:'Reds',team_b_name:'Blues'});
      tournamentMatches.push({id:77,tournament_id:901,round:2,match_num:1,team_a_p1_id:1,team_b_p1_id:2,team_a_p2_id:null,team_b_p2_id:null,status:'pending',result:null,_teeId:'57'});
      stub();teOpenMatch(77);html=tc();
      T('team day untouched: opens on hole 1, marks in progress, team names, Close match',TE.currentHole===1&&calls.some(c=>c.method==='PATCH'&&c.body.status==='in_progress')&&/Reds/.test(html)&&/teCloseMatchPrompt/.test(html));
      TE.matchId=null;
      // self-heal: a decided group stage whose semi writes failed gets them filled (fill only)
      league();gm().forEach(m=>decideLocal(m,seedWin(m)));stub();activeId=5;
      await mlHealAll();
      T('heal: empty semis filled from the results',calls.filter(c=>c.method==='PATCH').length===8&&semi(1,1).team_a_p1_id===1);
      stub();await mlHealAll();T('heal again: nothing to do',calls.length===0);
      activeId=2;
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `powershell -NoProfile -File tests/run.ps1 -Test tests/matchplay.test.js`
Expected: FAIL with `ReferenceError: mlChange is not defined`.

- [ ] **Step 3: Write the implementation**

**3a.** Append to the league live block (after `mlResultsHtml`):
```js
// The stored status/result/extra_holes are a cache of the derived decision, rewritten after every change.
function mlSyncFields(m,rec){
  const f={status:rec.decided?'complete':rec.started?'in_progress':'pending',result:rec.decided&&rec.winner?rec.winner:null,extra_holes:rec.extra};
  if(!m.played_on&&(m.outcome||'played')==='played'&&rec.started)f.played_on=today();   // the handicap date
  return f;
}
async function mlPatch(m,b){const rows=await sbUpdate('tournament_matches',m.id,b);if(!rows||!rows.length)throw new Error('not saved');Object.assign(m,b);}
// EVERY change to a league match goes through here: a score, the tee or start hole, an admin outcome.
// The change is tried on copies first; mlGate refuses it (nothing written) or names the playoff slots
// that follow from it. Then: the score, the match's own fields and its synced cache, then those slots.
async function mlChange(matchId,{patch=null,score=null}={}){
  const m=tournamentMatches.find(x=>x.id===matchId),t=m&&tournaments.find(x=>x.id===m.tournament_id);
  if(!m||!t)return{ok:false,msg:'Match not found.'};
  // Correcting a finished match, or any outcome, is an admin decision.
  if((m.status==='complete'||(patch&&'outcome' in patch))&&!await requireAdminMode())return{ok:false,msg:'Admin mode is needed for that.'};
  const same=s=>s.match_id===matchId&&s.hole===score.hole&&s.player_id===score.player_id;
  const mp={...m,...(patch||{})};
  const ms=tournamentMatches.map(x=>x.id===matchId?mp:x);
  const sc=score?[...tournamentScores.filter(s=>!same(s)),{match_id:matchId,...score}]:tournamentScores;
  const {groups,seeds}=mlGroups(t);
  const g=mlGate(mlRecords(t),mlRecords(t,ms,sc),matchId,groups,seeds);
  if(g.blocker)return{ok:false,msg:`Can't change this now: ${mlMatchName(g.blocker)} has already started. Clear that match's scores and outcome first, then try again.`};
  const rec=mlRecords(t,ms,sc).find(r=>r.id===matchId);
  try{
    if(score){
      await sbDeleteWhere('tournament_scores',`match_id=eq.${matchId}&hole=eq.${score.hole}&player_id=eq.${score.player_id}`);
      const [saved]=await sbInsert('tournament_scores',{match_id:matchId,...score});
      if(!saved)throw new Error('score not saved');
      tournamentScores=[...tournamentScores.filter(s=>!same(s)),saved];
    }
    const want={...(patch||{}),...mlSyncFields(mp,rec)};
    const diff=Object.fromEntries(Object.entries(want).filter(([k,v])=>m[k]!==v));
    if(Object.keys(diff).length)await mlPatch(m,diff);
    for(const u of g.updates)await mlPatch(tournamentMatches.find(x=>x.id===u.id),{team_a_p1_id:u.team_a_p1_id,team_b_p1_id:u.team_b_p1_id});
  }catch(e){return{ok:false,msg:'Couldn\'t save — '+e.message};}
  return{ok:true,rec};
}
// Where the scoring screen opens: the first hole in play order not yet scored by both, going on into
// sudden death for a level playoff. A decided match (an admin reviewing it) opens on its first hole.
function mlOpenHole(m,byPid,order,decided){
  const first=mlPlayOrder(m)[0];if(decided)return first;
  const done=h=>order.every(pid=>byPid[pid]?.[h]!=null);
  for(let h=first,i=0;i<72;i++){if(!done(h))return h;const n=mlNextHole(m,h);if(n===h)return h;h=n;}
  return first;
}
// League scoring from the keypad: every score goes through mlChange (edit rules, decision, slots).
async function mlScoreEnter(gross){
  TE.match=tournamentMatches.find(x=>x.id===TE.matchId)||TE.match;   // the 30s refresh replaces match objects
  const pid=TE.playerOrder[TE.currentPlayerIdx],hole=TE.currentHole;
  const wasComplete=TE.playerOrder.every(p=>TE.scores[p]?.[hole]!=null);
  _teBuffer='';
  const r=await mlChange(TE.matchId,{score:{hole,player_id:pid,gross}});
  if(!r.ok){alert(r.msg);renderMatchScoring();return;}
  (TE.scores[pid]||(TE.scores[pid]={}))[hole]=gross;
  if(wasComplete){renderMatchScoring();return;}                    // correcting a hole: stay on it
  TE.currentPlayerIdx++;
  if(TE.currentPlayerIdx>=TE.playerOrder.length){
    TE.currentPlayerIdx=0;
    if(r.rec.decided){toast(`Match over — ${r.rec.label}`);teBack();return;}
    TE.currentHole=mlNextHole(TE.match,hole);
  }
  renderMatchScoring();
}
async function teSetStart(h){
  const r=await mlChange(TE.matchId,{patch:{start_hole:h}});
  if(!r.ok)alert(r.msg);else{TE.currentHole=h;TE.currentPlayerIdx=0;}
  renderMatchScoring();
}
// Fill any playoff slot the results already decide but a failed write left empty — fill only, never
// overwrite (members may do this). Like autoDrawIfDue: no scheduler that can die quietly.
async function mlHealAll(){
  for(const t of tournaments.filter(t=>t.format==='league'&&t.status!=='entry')){
    const {groups,seeds}=mlGroups(t),{want}=mlPlan(mlRecords(t),groups,seeds);
    for(const m of tournamentMatches.filter(m=>want[m.id]&&m.team_a_p1_id==null&&m.team_b_p1_id==null&&want[m.id].a!=null))
      try{await mlPatch(m,{team_a_p1_id:want[m.id].a,team_b_p1_id:want[m.id].b});}catch(e){console.warn('league heal:',e.message);}
  }
}
```

**3b.** Replace the whole `teOpenMatch` function with:
```js
function teOpenMatch(matchId){
  const match=tournamentMatches.find(m=>m.id===matchId);if(!match)return;
  const tournament=tournaments.find(t=>t.id===match.tournament_id);if(!tournament)return;
  const teeId=match.tee_id||tournament.tee_id;
  const tee=tees.find(t=>t.id===teeId)||{slope:113,rating:COURSE_PAR,id:teeId};
  match._teeId=tee.id;
  const hcpInfo=tmMatchHcpInfo(match,tmMatchDate(match,tournament));
  const playerOrder=[match.team_a_p1_id];
  if(match.team_a_p2_id)playerOrder.push(match.team_a_p2_id);
  playerOrder.push(match.team_b_p1_id);
  if(match.team_b_p2_id)playerOrder.push(match.team_b_p2_id);

  // Load existing scores
  const scores={};
  const mScores=tournamentScores.filter(s=>s.match_id===matchId);
  for(const s of mScores){
    if(!scores[s.player_id])scores[s.player_id]={};
    scores[s.player_id][s.hole]=s.gross;
  }

  // First incomplete hole — a league match walks its play order and on into sudden death
  let currentHole=1;
  if(match.stage)currentHole=mlOpenHole(match,scores,playerOrder,mlRecord(match,tournament,mScores).decided);
  else for(let h=1;h<=18;h++){
    const allScored=playerOrder.every(pid=>scores[pid]?.[h]!=null);
    if(!allScored){currentHole=h;break;}
    if(h===18){currentHole=18;}
  }

  TE={matchId,match,tournament,tee,hcpInfo,playerOrder,currentPlayerIdx:0,currentHole,furthestHole:currentHole,scores};
  _teBuffer='';

  // Team day marks a match started on opening; a league match is started by its first score (mlChange).
  if(match.status==='pending'&&!match.stage){
    sbUpdate('tournament_matches',matchId,{status:'in_progress'}).catch(()=>{});
    match.status='in_progress';
  }

  renderMatchScoring();
}
```

**3c.** In `renderMatchScoring`, make these exact replacements (each old string is unique in the file):

| Old | New |
|---|---|
| `const{match,tournament,tee,hcpInfo,playerOrder,currentPlayerIdx,currentHole,scores}=TE;` | `const{match,tee,hcpInfo,playerOrder,currentPlayerIdx,currentHole,scores}=TE;`<br>`  // A league match shows the two players where team day shows team names.`<br>`  const pFirst=id=>escHtml((players.find(p=>p.id===id)?.name||'?').split(' ')[0]);`<br>`  const tournament=match.stage?{...TE.tournament,team_a_name:pFirst(match.team_a_p1_id),team_b_name:pFirst(match.team_b_p1_id)}:TE.tournament;` |
| `const holeIdx=currentHole-1;` | `const holeIdx=tmHoleIdx(match,currentHole);` |
| `const isStroke=hcpInfo.strokeHoles.includes(holeIdx); // for singles` | `const recvStrokes=strokesOnHole(hcpInfo.diff,holeIdx),isStroke=recvStrokes>0; // singles: the receiving side's strokes` |
| `const isFourball=match.round===1;` | `const isFourball=tmIsFourball(match);` |
| `strokes=isStroke&&onReceiving?1:0;` | `strokes=onReceiving?recvStrokes:0;` |
| `const statusText=state.matchStatus===0?` | `const statusText=match.stage?mlRecord(match,tournament,mScores).label:state.matchStatus===0?` |
| `SI 1–${hcpInfo.diff}</div>` | `${hcpInfo.diff>18?`every hole, two on SI 1–${hcpInfo.diff-18}`:`SI 1–${hcpInfo.diff}`}</div>` |
| `<button class="btn btn-ghost btn-sm" onclick="teCloseMatchPrompt()" style="font-size:0.7rem">Close match</button>` | `${match.stage?'':`<button class="btn btn-ghost btn-sm" onclick="teCloseMatchPrompt()" style="font-size:0.7rem">Close match</button>`}` |
| `${currentHole>1?` | `${teCanPrev()?` |
| `${currentHole<(TE.furthestHole\|\|currentHole)?` | `${teCanNext()?` |
| `<span style="font-weight:700">Hole ${currentHole}</span>` | `<span style="font-weight:700">Hole ${currentHole}${currentHole>18?` <span style="font-weight:400;font-size:0.75rem;color:#f5c518">sudden death · plays as ${holeIdx+1}</span>`:''}</span>` |

(In the table, `\|\|` is a literal `||`.)

Also in `renderMatchScoring`, directly after the closing `</div>` of the Tee selector row (the line `<select onchange="teChangeTee(this.value)" …>${teeOpts}</select>` is followed by `  </div>`), insert:
```js
  ${match.stage&&!mlRecord(match,tournament,tournamentScores.filter(s=>s.match_id===match.id)).started?`<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem">
    <span style="font-size:0.75rem;color:rgba(255,255,255,0.4)">Start:</span>
    <select onchange="teSetStart(+this.value)" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#fff;font-size:0.78rem;padding:3px 8px;outline:none"><option value="1"${(match.start_hole||1)===1?' selected':''}>1st tee</option><option value="10"${match.start_hole===10?' selected':''}>10th tee</option></select>
  </div>`:''}
```

**3d.** Replace `teChangeTee`:
```js
async function teChangeTee(teeId){
  const t=tees.find(x=>x.id===teeId);if(!t)return;
  if(TE.match.stage){const r=await mlChange(TE.matchId,{patch:{tee_id:teeId}});if(!r.ok){alert(r.msg);renderMatchScoring();return;}}
  TE.tee=t;
  TE.match._teeId=teeId;
  TE.match.tee_id=teeId;
  TE.hcpInfo=tmMatchHcpInfo(TE.match,tmMatchDate(TE.match,TE.tournament));
  renderMatchScoring();
  if(!TE.match.stage)sbUpdate('tournament_matches',TE.matchId,{tee_id:teeId}).catch(()=>toast('Tee save failed',2000));
}
```

**3e.** Replace the two lines `function teGoPrevHole(){…}` and `function teGoNextHole(){ … }` (the whole function, through its closing `}`) with:
```js
// A league match moves through its play order (and on into sudden death); team day as before.
function teCanPrev(){return TE.match.stage?mlPrevHole(TE.match,TE.currentHole)!==TE.currentHole:TE.currentHole>1;}
function teCanNext(){
  if(!TE.match.stage)return TE.currentHole<(TE.furthestHole||TE.currentHole);
  return TE.playerOrder.every(p=>TE.scores[p]?.[TE.currentHole]!=null)&&mlNextHole(TE.match,TE.currentHole)!==TE.currentHole;
}
function teGoPrevHole(){if(!teCanPrev())return;TE.currentHole=TE.match.stage?mlPrevHole(TE.match,TE.currentHole):TE.currentHole-1;TE.currentPlayerIdx=0;_teBuffer='';renderMatchScoring();}
function teGoNextHole(){
  if(!teCanNext())return;
  if(TE.match.stage){TE.currentHole=mlNextHole(TE.match,TE.currentHole);TE.currentPlayerIdx=0;_teBuffer='';renderMatchScoring();return;}
  const far=TE.furthestHole||TE.currentHole;
  // Skip past fully-scored holes to the first incomplete one, but never beyond the furthest hole reached
  let n=TE.currentHole+1;
  while(n<far&&TE.playerOrder.every(pid=>TE.scores[pid]?.[n]!=null))n++;
  TE.currentHole=n;TE.currentPlayerIdx=0;_teBuffer='';
  renderMatchScoring();
}
```

**3f.** In `teEnter`, directly after the line `  if(isNaN(gross)||gross<0||gross>15){toast('Enter score 0–15');return;}`, insert:
```js
  if(TE.match.stage)return mlScoreEnter(gross);   // league: through mlChange
```

**3g.** In `init`, replace `  await autoDrawIfDue();` with:
```js
  await autoDrawIfDue();
  await mlHealAll();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `powershell -NoProfile -File tests/run.ps1 -Test tests/matchplay.test.js`
Expected: PASS, 0 failed.
Run: `powershell -NoProfile -File tests/run.ps1 -Test tests/phase2a.test.js`
Expected: 76 passed.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/matchplay.test.js
git commit -F- <<'EOF'
feat: matchplay league — scoring via mlChange: auto-close, re-open, sudden death, rebuilds

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01N6cfxP9mcgmYjbs4UMRCnG
EOF
```

---

### Task 8: Entries and the waiting list, sharing the season-entries view

**Files:**
- Modify: `index.html`:
  - `entryStatusHtml`, `renderAdminEntries`, `adminEntryWrite` (~5348–5410).
  - `renderLeagueHtml` and `mlEntryHtml` (Task 6).
  - `renderAdminTournament` (first lines).
  - The league live block (append).
- Test: `tests/matchplay.test.js`; `tests/winter.test.js` must stay at 66.

**Interfaces:**
- Consumes: `mlEntries`, `mlEntryRows`, `mlName`, `sbInsert`, `sbUpdate`, `sbDelete`, `requireAdminMode`, `MOBILEPAY_URL`, `activePlayers()`.
- Produces:
  - `entryBoxHtml({name,e,buyIn,blurb,enter,withdraw,waiting}) → html`: the shared member box.
  - `entriesPanelHtml({es,buyIn,cap,fn:{paid,undo,remove,enterFor,moveIn},others,selId}) → html`: the shared admin panel.
  - `adminEntryWrite(save,apply,done,redraw)`.
  - `mlEntryBoxHtml(t)`, `mlJoin(tid)`, `mlWithdraw(tid)`.
  - `mlMarkPaid(id)`, `mlUndoPaid(id)`, `mlRemoveEntry(id)`, `mlEnterFor()`, `mlMoveIn(id)`.
  - `mlT()`, `mlRedraw()`.
  - `mlAdminHtml(t)` (first version, entries only; Task 9 replaces it).

- [ ] **Step 1: Write the failing test**

Insert above `    // ── end ──`:
```js
    // ── Task 8: entries — the shared entry box and admin panel ──
    const adm=()=>document.getElementById('adminTournamentBody').innerHTML;
    {
      entryLeague(17);activeId=17;renderTournament();
      T('17 entries: 16 in, #17 waiting',mlEntries(tournaments[0]).in.length===16&&mlEntries(tournaments[0]).waiting[0].player_id===17);
      T('member box: entered, #1 on the waiting list, pay link, withdraw',/#1 on the waiting list/.test(tc())&&tc().includes(MOBILEPAY_URL)&&/mlWithdraw\(900\)/.test(tc()));
      activeId=18;renderTournament();
      T('not entered: Enter, with the buy-in',/Enter Matchplay 2027/.test(tc())&&/DKK 200/.test(tc())&&/mlJoin\(900\)/.test(tc()));
      reset((u,b,m)=>m==='POST'&&u.includes('tournament_players')?[{id:400,entered_at:'2027-03-02T10:00:00Z',paid_at:null,amount:null,group_num:null,seed_pot:null,...b}]:[]);
      await mlJoin(900);
      const post=calls.find(c=>c.method==='POST');
      T('Enter posts own player and team league only',post&&post.body.player_id===18&&post.body.team==='league'&&post.body.tournament_id===900&&!('entered_at' in post.body)&&!('paid_at' in post.body));
      T('…and lands at #2 on the waiting list',/#2 on the waiting list/.test(tc()));
      activeId=3;reset((u,b,m)=>m==='DELETE'?[{id:303}]:[]);await mlWithdraw(900);
      T('a withdrawal moves the first waiting player in (derived; nothing else written)',mlEntries(tournaments[0]).in.some(e=>e.player_id===17)&&calls.filter(c=>c.method!=='DELETE').length===0);
      activeId=4;reset(()=>[]);await mlWithdraw(900);
      T('an RLS-filtered withdraw (0 rows) keeps the entry',mlEntryRows(tournaments[0]).some(e=>e.player_id===4));
      entryLeague(3);tournaments[0].buy_in=0;activeId=2;renderTournament();
      T('free league: entered, no pay link',/entered in Matchplay 2027\./.test(tc())&&!tc().includes(MOBILEPAY_URL));
      league();activeId=2;renderTournament();
      T('after the draw: no Withdraw, payment status still shown',!/mlWithdraw/.test(tc())&&/payment not yet recorded/.test(tc()));
      // admin panel — the same view as season entries
      entryLeague(17);activeId=1;renderAdminTournament();
      T('league admin: the shared entries panel, with a waiting list',/17 entered · 0 paid · DKK 0 received · 1 waiting/.test(adm())&&/Waiting list/.test(adm())&&/mlMoveIn\(317\)/.test(adm()));
      T('enter-for lists members not yet entered',/id="mlEntryFor"/.test(adm())&&/value="18"/.test(adm())&&!/value="17"/.test(adm()));
      reset((u,b,m)=>m==='PATCH'?[{...tournamentPlayers.find(e=>e.id===+u.match(/id=eq\.(\d+)/)[1]),...b}]:[]);
      await mlMoveIn(317);
      const mv=calls.find(c=>c.method==='PATCH'),at=pid=>Date.parse(tournamentPlayers.find(e=>e.player_id===pid).entered_at);
      T('Move in: one write, just ahead of the last player in',mv&&Date.parse(mv.body.entered_at)<at(16)&&Date.parse(mv.body.entered_at)>at(15));
      T('…17 is in, 16 tops the waiting list',mlEntries(tournaments[0]).in.some(e=>e.player_id===17)&&mlEntries(tournaments[0]).waiting[0].player_id===16);
      await mlMarkPaid(301);
      const mp=calls.filter(c=>c.method==='PATCH').pop();
      T('Mark paid: the league buy-in and who recorded it',mp.body.amount===200&&mp.body.recorded_by===1&&!!mp.body.paid_at&&!!tournamentPlayers.find(e=>e.id===301).paid_at);
      reset(()=>[]);await mlUndoPaid(301);
      T('an RLS-filtered undo (0 rows) leaves the payment',!!tournamentPlayers.find(e=>e.id===301).paid_at);
      reset((u,b,m)=>m==='POST'?[{id:500,entered_at:'2027-03-03T00:00:00Z',paid_at:null,amount:null,...b}]:[]);
      document.getElementById('mlEntryFor').value='18';await mlEnterFor();
      T('Enter player posts that player for the league',calls.some(c=>c.method==='POST'&&c.body.player_id===18&&c.body.tournament_id===900&&c.body.team==='league'));
      league();activeId=1;renderAdminTournament();
      T('after the draw: payments only — no Remove, Move in or Enter player',/16 entered/.test(adm())&&!/mlRemoveEntry|mlMoveIn|mlEntryFor/.test(adm()));
      activeId=2;
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `powershell -NoProfile -File tests/run.ps1 -Test tests/matchplay.test.js`
Expected: FAIL. The member-box assertions fail first (`#1 on the waiting list`), then `ReferenceError: mlJoin is not defined`.

- [ ] **Step 3: Write the implementation**

**3a.** Replace `entryStatusHtml` (the whole function, 7 lines, from `// Enter / pay / withdraw for the season taking entries.` to its closing `}`) with:
```js
// The member's entry box, shared by season entries and matchplay leagues (one view, not a copy).
// o: {name, e (their entry or undefined), buyIn, blurb, enter/withdraw (onclick code, null = hide),
//     waiting (their waiting-list position, 0 = in)}.
function entryBoxHtml(o){
  const box=c=>`<div class="info-box" style="margin-bottom:1rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">${c}</div>`;
  const out=o.withdraw?`<button class="btn btn-ghost btn-sm" onclick="${o.withdraw}">Withdraw</button>`:'';
  const wait=o.waiting?` You're #${o.waiting} on the waiting list.`:'';
  if(!o.e)return o.enter?box(`<span><strong>Enter ${o.name}</strong> — ${o.buyIn>0?`DKK ${o.buyIn}, `:''}${o.blurb}.</span><button class="btn btn-warn btn-sm" onclick="${o.enter}">Enter</button>`):'';
  if(!o.e.paid_at&&o.buyIn>0)return box(`<span>You're entered in ${o.name} — payment not yet recorded.${wait} <a href="${MOBILEPAY_URL}" target="_blank" rel="noopener" style="color:var(--gold-l)">Pay DKK ${o.buyIn} via MobilePay →</a></span>${out}`);
  return box(`<span>You're entered in ${o.name}${o.e.paid_at?' and paid ✓':'.'}${wait}</span>${o.e.paid_at?'':out}`);
}
// Enter / pay / withdraw for the season taking entries. Social and pending members see nothing.
function entryStatusHtml(p,s){return entryBoxHtml({name:s.name,e:entryOf(p.id,s.name),buyIn:s.buyIn,blurb:`best ${s.best} rounds count`,enter:'enterSeason()',withdraw:'withdrawEntry()'});}
```

**3b.** Replace `renderAdminEntries` (the whole function) with:
```js
// The entries panel, shared by season entries and matchplay leagues (one view, not a copy).
// o: {es: entries in sign-up order, buyIn, cap: places (the rest are the waiting list; 0 = no cap),
//     fn: {paid, undo, remove, enterFor, moveIn} — global function names, null hides that action,
//     others: players who could be entered, selId: id of the enter-for <select>}.
function entriesPanelHtml(o){
  const f=o.fn,nm=id=>escHtml(players.find(p=>p.id===id)?.name||'#'+id);
  const line=(e,right)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0"><span>${nm(e.player_id)}</span><span style="display:flex;gap:6px;align-items:center">${right}</span></div>`;
  const head=t=>`<div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.08em;color:rgba(255,255,255,0.4);margin:0.75rem 0 4px">${t}</div>`;
  const rm=e=>f.remove?`<button class="btn btn-danger btn-sm" onclick="${f.remove}(${e.id})">Remove</button>`:'';
  const cap=o.cap||o.es.length,inn=o.es.slice(0,cap),waiting=o.es.slice(cap);
  const paid=o.es.filter(e=>e.paid_at),unpaid=inn.filter(e=>!e.paid_at);
  const received=paid.reduce((t,e)=>t+Number(e.amount||0),0);
  const money=o.buyIn>0
    ?head('Awaiting payment')+(unpaid.length?unpaid.map(e=>line(e,`<button class="btn btn-warn btn-sm" onclick="${f.paid}(${e.id})">Mark paid</button>${rm(e)}`)).join(''):'<div class="empty">Nobody.</div>')
     +head('Paid')+(paid.length?paid.map(e=>line(e,`<span style="font-size:0.75rem;color:rgba(255,255,255,0.4)">${fd(e.paid_at.slice(0,10))}</span><button class="btn btn-ghost btn-sm" onclick="${f.undo}(${e.id})">Undo</button>`)).join(''):'<div class="empty">Nobody yet.</div>')
    :head('Entered')+(inn.length?inn.map(e=>line(e,rm(e))).join(''):'<div class="empty">Nobody yet.</div>');
  return`<div style="font-size:0.85rem;color:var(--gold-l)">${o.es.length} entered · ${paid.length} paid · DKK ${received} received${waiting.length?` · ${waiting.length} waiting`:''}</div>`
    +money
    +(waiting.length?head('Waiting list')+waiting.map((e,i)=>line(e,`<span style="font-size:0.75rem;color:rgba(255,255,255,0.4)">#${i+1}</span>${f.moveIn?`<button class="btn btn-ghost btn-sm" onclick="${f.moveIn}(${e.id})">Move in</button>`:''}${rm(e)}`)).join(''):'')
    +(f.enterFor&&o.others.length?`<div style="display:flex;gap:6px;margin-top:0.9rem"><select id="${o.selId}">${o.others.map(p=>`<option value="${p.id}">${escHtml(p.name)}</option>`).join('')}</select><button class="btn btn-ghost btn-sm" onclick="${f.enterFor}()">Enter player</button></div>`:'');
}
// Admin: who entered the season taking entries, who has paid, and entering someone on their behalf.
function renderAdminEntries(){
  const body=document.getElementById('adminEntriesBody'),title=document.getElementById('adminEntriesTitle');if(!body||!title)return;
  const s=entrySeason();
  if(!s){title.textContent='Season entries';body.innerHTML='<div class="empty">No season is taking entries.</div>';return;}
  title.textContent=`${s.name} entries`;
  body.innerHTML=entriesPanelHtml({es:seasonEntries.filter(e=>e.season===s.name),buyIn:s.buyIn,cap:0,selId:'entryForPlayer',
    fn:{paid:'markEntryPaid',undo:'undoEntryPaid',remove:'removeEntry',enterFor:'enterPlayerFor'},
    others:activePlayers().filter(p=>!p.is_social&&!entryOf(p.id,s.name))});
}
```

**3c.** Replace `adminEntryWrite` with:
```js
async function adminEntryWrite(save,apply,done,redraw=()=>{renderAdminEntries();renderSeasonLb();}){
  if(!await requireAdminMode())return;
  try{const rows=await save();if(!rows||!rows.length)throw new Error('not saved');apply(rows);toast(done);}
  catch(e){toast('Couldn\'t save — '+e.message);}
  redraw();
}
```

**3d.** In `renderLeagueHtml` (Task 6), replace:
```js
  if(t.status==='entry')return head+mlEntryHtml(t);
```
with:
```js
  if(t.status==='entry')return head+mlEntryBoxHtml(t)+mlEntryHtml(t);
```
and replace:
```js
  return head+`<div style="display:flex;gap:0.5rem;margin-bottom:0.75rem">${tab('groups','Groups')}
```
with:
```js
  return head+mlEntryBoxHtml(t)+`<div style="display:flex;gap:0.5rem;margin-bottom:0.75rem">${tab('groups','Groups')}
```

**3e.** In `renderAdminTournament`, replace:
```js
  const tourn=(activeTournamentId&&tournaments.find(t=>t.id===activeTournamentId))||tournaments[0]||null;

  const createHtml=`
```
with:
```js
  const tourn=(activeTournamentId&&tournaments.find(t=>t.id===activeTournamentId))||tournaments[0]||null;
  if(tourn&&tourn.format==='league'){el.innerHTML=mlAdminHtml(tourn);return;}

  const createHtml=`
```

**3f.** Append to the league live block:
```js
// ── Matchplay league: entries ──────────────────────────────────────────────
const mlT=()=>tournaments.find(t=>t.id===activeTournamentId);
const mlRedraw=()=>{renderAdminTournament();renderTournament();};
const replaceTp=row=>{if(row)tournamentPlayers=tournamentPlayers.map(x=>x.id===row.id?row:x);};
function mlEntryBoxHtml(t){
  if(!players.some(p=>p.id===activeId))return'';   // pending sign-ups aren't in players
  const open=t.status==='entry',e=mlEntryRows(t).find(x=>x.player_id===activeId),{waiting}=mlEntries(t);
  return entryBoxHtml({name:escHtml(t.name),e,buyIn:Number(t.buy_in||0),blurb:`${t.max_players||16} places, then a waiting list`,
    enter:open?`mlJoin(${t.id})`:null,withdraw:open&&e&&!e.paid_at?`mlWithdraw(${t.id})`:null,waiting:e?waiting.indexOf(e)+1:0});
}
async function mlJoin(tid){
  const t=tournaments.find(x=>x.id===tid);if(!t||t.status!=='entry'||mlEntryRows(t).some(e=>e.player_id===activeId))return;
  try{const [row]=await sbInsert('tournament_players',{tournament_id:tid,player_id:activeId,team:'league'});if(!row)throw new Error('not saved');tournamentPlayers.push(row);toast(`Entered ${t.name}`);}
  catch(e){toast('Couldn\'t enter — '+e.message);}
  renderTournament();
}
async function mlWithdraw(tid){
  const t=tournaments.find(x=>x.id===tid),e=t&&mlEntryRows(t).find(x=>x.player_id===activeId);
  if(!e||e.paid_at||t.status!=='entry')return;
  if(!confirm(`Withdraw from ${t.name}?`))return;
  try{const rows=await sbDelete('tournament_players',e.id);
    if(rows.length){tournamentPlayers=tournamentPlayers.filter(x=>x.id!==e.id);toast('Entry withdrawn');}
    else toast('Couldn\'t withdraw — the entry may already be marked paid, or the draw made.');}
  catch(err){toast('Couldn\'t withdraw — '+err.message);}
  renderTournament();
}
function mlMarkPaid(id){const t=mlT();return adminEntryWrite(()=>sbUpdate('tournament_players',id,{paid_at:new Date().toISOString(),amount:Number(t.buy_in||0),recorded_by:activeId}),r=>replaceTp(r[0]),'Marked paid',mlRedraw);}
function mlUndoPaid(id){return adminEntryWrite(()=>sbUpdate('tournament_players',id,{paid_at:null,amount:null,recorded_by:null}),r=>replaceTp(r[0]),'Payment undone',mlRedraw);}
function mlRemoveEntry(id){if(!confirm('Remove this entry?'))return;return adminEntryWrite(()=>sbDelete('tournament_players',id),()=>{tournamentPlayers=tournamentPlayers.filter(x=>x.id!==id);},'Entry removed',mlRedraw);}
function mlEnterFor(){const pid=+document.getElementById('mlEntryFor').value,t=mlT();
  return adminEntryWrite(()=>sbInsert('tournament_players',{tournament_id:t.id,player_id:pid,team:'league'}),r=>tournamentPlayers.push(r[0]),'Player entered',mlRedraw);}
// Move a waiting-list player in: one write puts them just ahead of the last player in, who drops to
// the top of the waiting list.
function mlMoveIn(id){const {in:inn}=mlEntries(mlT()),last=inn[inn.length-1];if(!last)return;
  return adminEntryWrite(()=>sbUpdate('tournament_players',id,{entered_at:new Date(Date.parse(last.entered_at)-1).toISOString()}),r=>replaceTp(r[0]),'Moved in',mlRedraw);}
// Admin panel for a league (Task 9 adds the draw, deadlines and outcomes).
function mlAdminHtml(t){
  const {es,in:inn}=mlEntries(t),before=t.status==='entry',entered=new Set(es.map(e=>e.player_id));
  return`<h4 style="margin:0 0 0.5rem;font-size:0.9rem">${escHtml(t.name)} <span style="font-size:0.7rem;opacity:0.5">${before?'entries open':'drawn'}</span></h4>`
    +entriesPanelHtml({es:before?es:inn,buyIn:Number(t.buy_in||0),cap:before?(t.max_players||16):0,selId:'mlEntryFor',
      fn:{paid:'mlMarkPaid',undo:'mlUndoPaid',remove:before?'mlRemoveEntry':null,enterFor:before?'mlEnterFor':null,moveIn:before?'mlMoveIn':null},
      others:before?activePlayers().filter(p=>!entered.has(p.id)):[]});
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `powershell -NoProfile -File tests/run.ps1 -Test tests/matchplay.test.js`
Expected: PASS, 0 failed.
Run: `powershell -NoProfile -File tests/run.ps1 -Test tests/winter.test.js`
Expected: `66 passed, 0 failed`. The season box and panel produce the same HTML as before.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/matchplay.test.js
git commit -F- <<'EOF'
feat: matchplay league — entries and waiting list on the shared entries box and panel

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01N6cfxP9mcgmYjbs4UMRCnG
EOF
```

---

### Task 9: Admin — create a league, draw, deadlines, outcomes

**Files:**
- Modify: `index.html`:
  - `renderAdminTournament` (the Task 8 line, the `if(!tourn)` line and `${createHtml}`).
  - `mlAdminHtml` (replace).
  - `AUDIT_LABELS`.
  - The league live block (append).
- Test: `tests/matchplay.test.js`

**Interfaces:**
- Consumes: `mlDrawGroups`, `mlFixtures`, `mlGroups`, `mlEntries`, `mlChange`, `mlRecords`, `mlMatchName`, `entriesPanelHtml`, `hcpOnDate`, `requireAdminMode`, `mlRedraw`, `replaceTp`.
- Produces:
  - `ML_ROUND_LABELS`, `mlDeadlinesOk(dl) → bool`.
  - `mlCreateHtml()`, `mlPickerHtml()`, `mlCreate()`.
  - `mlDraw(tid)`, `mlSaveDeadlines(tid)`.
  - `mlSetOutcome(matchId,kind,side)`, `mlSetOutcomeFromForm()`.
  - The final `mlAdminHtml(t)`.

- [ ] **Step 1: Write the failing test**

Insert above `    // ── end ──`:
```js
    // ── Task 9: admin — create, draw, deadlines, outcomes ──
    const setV=(id,v)=>{document.getElementById(id).value=v;};
    {
      tournaments=[];tournamentPlayers=[];tournamentMatches=[];tournamentScores=[];activeTournamentId=null;TE.matchId=null;
      players=[...Array(20)].map((_,i)=>P(i+1,'P'+(i+1)));players[0].is_admin=true;activeId=1;
      renderAdminTournament();
      T('admin: the New matchplay league form, tee 57 by default',!!document.getElementById('mlNewName')&&document.getElementById('mlNewTee').value==='57');
      setV('mlNewName','Matchplay 2027');setV('mlNewDate','2027-04-01');setV('mlNewBuyIn','200');
      ['2027-05-15','2027-06-15','2027-07-31','2027-08-20','2027-09-10'].forEach((d,i)=>setV('mlDl_'+ML_ROUND_KEYS[i],d));
      setV('mlDl_semi','');reset(()=>[]);await mlCreate();
      T('create refuses a missing deadline',calls.length===0);
      setV('mlDl_semi','2027-07-01');await mlCreate();
      T('create refuses deadlines out of order',calls.length===0);
      setV('mlDl_semi','2027-08-20');
      reset((u,b,m)=>m==='POST'&&u.includes('/tournaments?')?[{id:900,created_at:'x',...b}]:[]);
      await mlCreate();
      const cp=calls.find(c=>c.method==='POST');
      T('create posts a league: format, entry, tee 57, buy-in, five deadlines',cp&&cp.body.format==='league'&&cp.body.status==='entry'&&cp.body.tee_id==='57'&&cp.body.buy_in===200&&Object.keys(cp.body.deadlines).join()===ML_ROUND_KEYS.join()&&tournaments[0].id===900);
      // draw
      entryLeague(16);activeId=1;
      [5,30,12,1,22,8,17,3,26,14,9,20,2,28,11,6].forEach((v,i)=>players[i].hcp_history=[{date:'2026-01-01',value:v,note:''}]);
      players[15].hcp_history=[];   // Review Focus: no handicap at all
      const drawStub=()=>reset((u,b,m)=>m==='PATCH'&&u.includes('tournament_players')?[{...tournamentPlayers.find(e=>e.id===+u.match(/id=eq\.(\d+)/)[1]),...b}]
        :m==='POST'&&u.includes('tournament_matches')?b.map((r,i)=>({id:i+1,...r})):m==='PATCH'?[{...tournaments[0],...b}]:[]);
      drawStub();await mlDraw(900);
      const pp=calls.filter(c=>c.method==='PATCH'&&c.url.includes('tournament_players'));
      T('draw: 16 players each get a group and a pot',pp.length===16&&new Set(pp.map(c=>c.body.group_num+'-'+c.body.seed_pot)).size===16);
      const potOf2=pid=>tournamentPlayers.find(e=>e.player_id===pid).seed_pot;
      T('draw: pot 1 is the four lowest indexes',[4,13,8,1].every(pid=>potOf2(pid)===1));
      T('draw: a player with no handicap lands in the last pot',potOf2(16)===4);
      const mp2=calls.find(c=>c.method==='POST'&&c.url.includes('tournament_matches'));
      T('draw: one request creates all 40 matches for this league',mp2&&mp2.body.length===40&&mp2.body.every(r=>r.tournament_id===900&&r.status==='pending'));
      T('draw: the league is marked drawn',tournaments[0].status==='drawn'&&calls.some(c=>c.method==='PATCH'&&c.url.includes('/tournaments?')&&c.body.status==='drawn'));
      const placed=JSON.stringify(tournamentPlayers.map(e=>[e.player_id,e.group_num,e.seed_pot]));
      tournaments[0].status='entry';tournamentMatches=[];drawStub();await mlDraw(900);
      T('re-pressing Draw after a partial failure keeps the groups',calls.filter(c=>c.url.includes('tournament_players')).length===0&&JSON.stringify(tournamentPlayers.map(e=>[e.player_id,e.group_num,e.seed_pot]))===placed&&tournamentMatches.length===40);
      entryLeague(15);reset(()=>[]);await mlDraw(900);
      T('the draw needs exactly 16 in',calls.length===0);
      renderAdminTournament();
      T('before the draw: Draw groups disabled until 16 are in',/Draw groups \(15\/16 in\)/.test(adm())&&document.querySelector('#adminTournamentBody button[onclick^="mlDraw"]').disabled);
      // deadlines
      league();activeId=1;renderAdminTournament();
      T('admin panel after the draw: outcome tool listing the matches, dates editor',!!document.getElementById('mlOutMatch')&&document.getElementById('mlOutMatch').options.length===24&&!!document.getElementById('mlEd_group_1'));
      setV('mlEd_final','2027-09-30');reset((u,b,m)=>m==='PATCH'?[{...tournaments[0],...b}]:[]);
      await mlSaveDeadlines(900);
      T('move a deadline: saved',tournaments[0].deadlines.final==='2027-09-30'&&calls.some(c=>c.body&&c.body.deadlines&&c.body.deadlines.final==='2027-09-30'));
      setV('mlEd_semi','2027-10-01');reset(()=>[]);await mlSaveDeadlines(900);
      T('deadlines out of order are refused',calls.length===0);
      // outcomes
      league();activeId=1;stub();
      const gA=gm()[0];
      await mlSetOutcome(gA.id,'walkover');
      T('a walkover needs a winner: nothing written',calls.length===0);
      await mlSetOutcome(gA.id,'walkover','b');
      const op=calls.find(c=>c.method==='PATCH'&&c.url.includes(`id=eq.${gA.id}`));
      T('group walkover: outcome, winner, who decided, closed',op&&op.body.outcome==='walkover'&&op.body.result==='b'&&op.body.decided_by===1&&op.body.status==='complete');
      const tblA=()=>mlStandings(G[0],mlRecords(tournaments[0]).filter(r=>r.stage==='group'&&mlGroupOf(r)===1),mlGroups(tournaments[0]).seeds);
      T('…counts in the table: 1 point to the walkover winner, no holes',tblA().find(s=>s.pid===gA.team_b_p1_id).pts===1&&tblA().find(s=>s.pid===gA.team_b_p1_id).holes===0);
      stub();await mlSetOutcome(gA.id,'played');
      T('clearing an outcome re-derives from the scores (none: back to pending)',gA.outcome==='played'&&gA.status==='pending'&&gA.result===null&&gA.decided_by===null);
      const sA=semi(1,1);Object.assign(sA,{team_a_p1_id:1,team_b_p1_id:5});stub();
      await mlSetOutcome(sA.id,'halve_decision');
      T('halve by decision refused in the playoffs',calls.length===0);
      await mlSetOutcome(sA.id,'double_forfeit');
      T('a playoff double forfeit must name who goes through',calls.length===0);
      // outcomes are edits: refused once a playoff started; otherwise the brackets rebuild
      league();gm().forEach(m=>decideLocal(m,seedWin(m)));fillLocal();activeId=1;
      tournamentScores.push({id:2,match_id:semi(2,1).id,hole:1,player_id:semi(2,1).team_a_p1_id,gross:4});stub();window.__alert=null;
      await mlSetOutcome(gm()[5].id,'double_forfeit');
      T('an outcome on a group match once a playoff started: refused, blocker named, nothing written',calls.length===0&&/Runners-up semi-final 1/.test(window.__alert||''));
      tournamentScores=tournamentScores.filter(s=>s.id!==2);stub();
      await mlSetOutcome(gm()[4].id,'walkover','b');   // group A: 1 v 2 → walkover to 2
      T('an outcome with no playoff started rebuilds the semis from the new table',semi(1,1).team_a_p1_id===2&&semi(2,1).team_a_p1_id===1);
      decideLocal(semi(1,2),'a');stub();
      await mlSetOutcome(semi(1,1).id,'double_forfeit','b');
      T('playoff double forfeit: the named player goes through to the final',fin(1).team_a_p1_id===5&&fin(1).team_b_p1_id===9&&fin(1,'place').team_a_p1_id===2);
      T('audit log names the league actions',AUDIT_LABELS.match_outcome==='Match outcome recorded'&&AUDIT_LABELS.league_entered==='Entered matchplay league');
      activeId=2;
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `powershell -NoProfile -File tests/run.ps1 -Test tests/matchplay.test.js`
Expected: FAIL at `admin: the New matchplay league form` (no `#mlNewName`), then `FAIL EXCEPTION :: TypeError` (setting `.value` on null).

- [ ] **Step 3: Write the implementation**

**3a.** In `renderAdminTournament`, make three changes. Together they keep the team-day create form, the league create form and the tournament picker on every branch, and the team-day form stays first in the DOM, which `createTournament`'s `button.btn-primary` lookup relies on.
- Delete the Task 8 line `  if(tourn&&tourn.format==='league'){el.innerHTML=mlAdminHtml(tourn);return;}`.
- Replace `  if(!tourn){el.innerHTML=createHtml;return;}` with:
```js
  if(!tourn){el.innerHTML=createHtml+mlCreateHtml();return;}
  if(tourn.format==='league'){el.innerHTML=createHtml+mlCreateHtml()+mlPickerHtml()+'<hr style="border-color:rgba(255,255,255,0.08);margin:1rem 0">'+mlAdminHtml(tourn);return;}
```
- Replace `  ${createHtml}` with `  ${createHtml}${mlCreateHtml()}${mlPickerHtml()}`.

**3b.** In `AUDIT_LABELS`, replace `fine_deleted:'Fine deleted'};` with:
```js
fine_deleted:'Fine deleted',league_entered:'Entered matchplay league',league_withdrawn:'Withdrew from matchplay league',league_paid:'League entry paid',league_unpaid:'League payment undone',league_entry_moved:'Moved in from the waiting list',match_outcome:'Match outcome recorded',match_edited:'Finished match changed',match_players_changed:'Playoff players changed'};
```

**3c.** Replace the Task 8 `mlAdminHtml` (the comment line `// Admin panel for a league (Task 9 adds the draw, deadlines and outcomes).` and the function) with the following, and append the rest:
```js
const ML_ROUND_LABELS={group_1:'Group round 1',group_2:'Group round 2',group_3:'Group round 3',semi:'Semi-finals',final:'Finals and 3rd/4th'};
// All five play-by dates set, each after the one before (a summer break is just a longer gap).
const mlDeadlinesOk=dl=>ML_ROUND_KEYS.every((k,i)=>dl[k]&&(!i||dl[k]>dl[ML_ROUND_KEYS[i-1]]));
const mlLabelStyle='font-size:0.75rem;color:rgba(255,255,255,0.5)';
// Admin panel for a league: entries and payments (shared panel), the draw, play-by dates, outcomes.
function mlAdminHtml(t){
  const {es,in:inn}=mlEntries(t),before=t.status==='entry',entered=new Set(es.map(e=>e.player_id)),dl=t.deadlines||{};
  const sub=s=>`<h4 style="margin:1rem 0 0.5rem;font-size:0.85rem">${s}</h4>`;
  let html=`<h4 style="margin:0 0 0.5rem;font-size:0.9rem">${escHtml(t.name)} <span style="font-size:0.7rem;opacity:0.5">${before?'entries open':'drawn'}</span></h4>`
    +entriesPanelHtml({es:before?es:inn,buyIn:Number(t.buy_in||0),cap:before?(t.max_players||16):0,selId:'mlEntryFor',
      fn:{paid:'mlMarkPaid',undo:'mlUndoPaid',remove:before?'mlRemoveEntry':null,enterFor:before?'mlEnterFor':null,moveIn:before?'mlMoveIn':null},
      others:before?activePlayers().filter(p=>!entered.has(p.id)):[]});
  if(before)html+=`<div style="margin-top:1rem"><button class="btn btn-primary btn-sm" onclick="mlDraw(${t.id})"${inn.length===16?'':' disabled'}>Draw groups (${inn.length}/16 in)</button></div>`;
  html+=sub('Play-by dates')+`<div style="display:grid;gap:0.4rem">${ML_ROUND_KEYS.map(k=>`<label style="${mlLabelStyle}">${ML_ROUND_LABELS[k]} <input id="mlEd_${k}" type="date" class="input" value="${dl[k]||''}"></label>`).join('')}<button class="btn btn-ghost btn-sm" onclick="mlSaveDeadlines(${t.id})">Save dates</button></div>`;
  if(!before){
    const recs=mlRecords(t);
    const opts=tournamentMatches.filter(m=>m.tournament_id===t.id&&m.stage&&m.team_a_p1_id!=null&&m.team_b_p1_id!=null)
      .map(m=>`<option value="${m.id}">${escHtml(mlMatchName(m))}: ${mlName(m.team_a_p1_id)} v ${mlName(m.team_b_p1_id)} — ${escHtml(recs.find(r=>r.id===m.id).label)}</option>`).join('');
    html+=sub('Record an outcome')+`<div style="display:grid;gap:0.4rem"><select id="mlOutMatch" class="input">${opts}</select>
      <select id="mlOutKind" class="input"><option value="played">Played — clear any decision</option><option value="walkover:a">Walkover to the first-named</option><option value="walkover:b">Walkover to the second-named</option><option value="halve_decision">Halve by decision (group only)</option><option value="double_forfeit">Double forfeit (group)</option><option value="double_forfeit:a">Double forfeit — first-named goes through (playoff)</option><option value="double_forfeit:b">Double forfeit — second-named goes through (playoff)</option></select>
      <button class="btn btn-warn btn-sm" onclick="mlSetOutcomeFromForm()">Record</button></div>
      <div style="font-size:0.72rem;color:rgba(255,255,255,0.35);margin-top:0.4rem">To correct a score, open the match on the Tournament tab. A change that would move a playoff match already under way is refused.</div>`;
  }
  return html;
}
function mlCreateHtml(){
  return`<div style="margin:1rem 0"><h4 style="margin:0 0 0.75rem;font-size:0.9rem">New matchplay league</h4><div style="display:grid;gap:0.5rem">
    <input id="mlNewName" class="input" placeholder="League name" value="Matchplay ${new Date().getFullYear()+1}">
    <label style="${mlLabelStyle}">Starts <input id="mlNewDate" type="date" class="input"></label>
    <label style="${mlLabelStyle}">Buy-in (DKK) <input id="mlNewBuyIn" type="number" min="0" class="input" value="0"></label>
    <label style="${mlLabelStyle}">Default tee <select id="mlNewTee" class="input">${tees.filter(t=>!t.archived).map(t=>`<option value="${t.id}"${t.id==='57'?' selected':''}>${escHtml(t.name)}</option>`).join('')}</select></label>
    ${ML_ROUND_KEYS.map(k=>`<label style="${mlLabelStyle}">${ML_ROUND_LABELS[k]} — play by <input id="mlDl_${k}" type="date" class="input"></label>`).join('')}
    <button class="btn btn-primary btn-sm" onclick="mlCreate()">Create league</button></div></div>`;
}
const mlPickerHtml=()=>tournaments.length>1?`<select class="input" style="margin-bottom:0.75rem" onchange="activeTournamentId=+this.value;renderAdminTournament();renderTournament()">${tournaments.map(t=>`<option value="${t.id}"${t.id===activeTournamentId?' selected':''}>${escHtml(t.name)}${t.format==='league'?' (league)':''}</option>`).join('')}</select>`:'';
async function mlCreate(){
  const v=id=>document.getElementById(id).value.trim();
  const deadlines=Object.fromEntries(ML_ROUND_KEYS.map(k=>[k,v('mlDl_'+k)]));
  if(!v('mlNewName')||!v('mlNewDate')){alert('A name and a start date are needed.');return;}
  if(!mlDeadlinesOk(deadlines)){alert('Set all five play-by dates, each after the one before.');return;}
  if(!await requireAdminMode())return;
  try{
    const [saved]=await sbInsert('tournaments',{name:v('mlNewName'),date:v('mlNewDate'),tee_id:v('mlNewTee')||'57',format:'league',status:'entry',buy_in:Number(v('mlNewBuyIn')||0),max_players:16,deadlines});
    if(!saved)throw new Error('not saved');
    tournaments.unshift(saved);activeTournamentId=saved.id;document.getElementById('tabTournament').style.display='';toast('League created ✅');
  }catch(e){alert('Error: '+e.message);}
  mlRedraw();
}
async function mlSaveDeadlines(tid){
  const t=tournaments.find(x=>x.id===tid),dl=Object.fromEntries(ML_ROUND_KEYS.map(k=>[k,document.getElementById('mlEd_'+k).value]));
  if(!mlDeadlinesOk(dl)){alert('Set all five play-by dates, each after the one before.');return;}
  if(!await requireAdminMode())return;
  try{const [row]=await sbUpdate('tournaments',tid,{deadlines:dl});if(!row)throw new Error('not saved');t.deadlines=dl;toast('Dates saved');}
  catch(e){alert('Couldn\'t save — '+e.message);}
  mlRedraw();
}
// The draw: pots by handicap index today, groups, then all 40 matches in one request, then 'drawn'.
// Pressing it again after a failure resumes: players already placed keep their group and pot.
async function mlDraw(tid){
  const t=tournaments.find(x=>x.id===tid);if(!t||t.status!=='entry')return;
  const {in:inn}=mlEntries(t);
  if(inn.length!==16){alert('The draw needs exactly 16 players in.');return;}
  if(!confirm('Draw the groups? Entries close and all the league matches are created.'))return;
  if(!await requireAdminMode())return;
  try{
    if(!inn.every(e=>e.group_num!=null)){
      const idx=pid=>hcpOnDate(players.find(p=>p.id===pid)||{hcp_history:[]},today())??54;   // no handicap → last pot
      const groups=mlDrawGroups(inn.map(e=>({pid:e.player_id,index:idx(e.player_id)})));
      for(const [gi,g] of groups.entries())for(const [k,pid] of g.entries()){
        const [row]=await sbUpdate('tournament_players',inn.find(e=>e.player_id===pid).id,{group_num:gi+1,seed_pot:k+1});
        if(!row)throw new Error('not saved');replaceTp(row);
      }
    }
    if(!tournamentMatches.some(m=>m.tournament_id===t.id)){
      const saved=await sbInsert('tournament_matches',mlFixtures(mlGroups(t).groups).map(r=>({...r,tournament_id:t.id,status:'pending'})));
      if(!saved||saved.length!==40)throw new Error('matches not saved');
      saved.forEach(m=>{m._teeId=m.tee_id||t.tee_id;tournamentMatches.push(m);});
    }
    const [tr]=await sbUpdate('tournaments',t.id,{status:'drawn'});if(!tr)throw new Error('not saved');
    t.status='drawn';toast('Groups drawn 🏆');
  }catch(e){alert('The draw didn\'t finish — '+e.message+'. Press Draw groups again to complete it.');}
  mlRedraw();
}
// Admin decisions on a league match — edits like any other, through mlChange and the edit rules.
// kind: 'played' (clear) | 'walkover' | 'halve_decision' (group only) | 'double_forfeit'.
// side 'a'|'b': the walkover winner, or in a playoff double forfeit who goes through.
async function mlSetOutcome(matchId,kind,side=null){
  const m=tournamentMatches.find(x=>x.id===matchId);if(!m)return;
  const playoff=m.stage!=='group',named=kind==='walkover'||(kind==='double_forfeit'&&playoff);
  if(kind==='halve_decision'&&playoff){alert('A halve by decision is only for group matches.');return;}
  if(named&&side!=='a'&&side!=='b'){alert(kind==='walkover'?'Choose who gets the walkover.':'In the playoffs, name who goes through.');return;}
  const patch={outcome:kind,decided_by:kind==='played'?null:activeId,result:named?side:kind==='halve_decision'?'half':null};
  const r=await mlChange(matchId,{patch});
  if(!r.ok)alert(r.msg);else toast(kind==='played'?'Outcome cleared':`Recorded: ${r.rec.label}`);
  mlRedraw();
}
function mlSetOutcomeFromForm(){const [k,s]=document.getElementById('mlOutKind').value.split(':');return mlSetOutcome(+document.getElementById('mlOutMatch').value,k,s||null);}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `powershell -NoProfile -File tests/run.ps1 -Test tests/matchplay.test.js`
Expected: PASS, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/matchplay.test.js
git commit -F- <<'EOF'
feat: matchplay league — admin: create, seeded draw, play-by dates, outcomes as edits

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01N6cfxP9mcgmYjbs4UMRCnG
EOF
```

---

### Task 10: Hall of Fame "Matchplay champion", docs, full regression

**Files:**
- Modify: `index.html` (`renderHallOfFame`)
- Modify: `CLAUDE.md`
- Test: `tests/matchplay.test.js`

**Interfaces:**
- Consumes: `mlChampion`, `mlRecords`, `seasonOf`, `getSeasons`.
- Produces: a Hall of Fame row `🥇 Matchplay champion` for each season with a league that starts in it (`seasonOf(t.date)`).

- [ ] **Step 1: Write the failing test**

Insert above `    // ── end ──`:
```js
    // ── Task 10: Hall of Fame ──
    {
      league();gm().forEach(m=>decideLocal(m,seedWin(m)));fillLocal();
      for(const b of[1,2,3,4]){decideLocal(semi(b,1),'a');decideLocal(semi(b,2),'a');}fillLocal();
      tournaments[0].date='2026-11-01';   // starts in Winter 2027
      allRounds=[{id:1,player_id:1,date:'2026-11-07',tee_id:'platinum',holes:HOLE_PARS.map((par,i)=>({hole:i+1,par,hcp:HOLE_HCP[i],score:par}))}];
      allFines=[];seasonEntries=[];
      const champRow=()=>{renderHallOfFame();const f=document.getElementById('fameBody').innerHTML;return f.includes('Matchplay champion')?f.split('Matchplay champion')[1].split('</tr>')[0]:null;};
      T('Hall of Fame: a Matchplay champion row, empty until the final is decided',champRow()!==null&&!/Matchplay 2027/.test(champRow()));
      decideLocal(fin(1),'b');
      T('the Winners final winner is champion, derived from the matches',/<\/div>P9<\/div>/.test(champRow())&&/Matchplay 2027/.test(champRow()));
      tournamentScores=tournamentScores.filter(s=>s.match_id!==fin(1).id);decideLocal(fin(1),'a');
      T('…and follows a corrected final',/<\/div>P1<\/div>/.test(champRow()));
      tournaments[0].date='2026-05-01';
      T('a season without a league has no Matchplay row',champRow()===null);
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `powershell -NoProfile -File tests/run.ps1 -Test tests/matchplay.test.js`
Expected: FAIL `Hall of Fame: a Matchplay champion row …`.

- [ ] **Step 3: Write the implementation**

In `renderHallOfFame`, directly after the line `    const longest=tied(full,x=>x.pts).map(x=>({p:x.p,record:`${x.pts} pts · ${fd(x.r.date)}`}));`, insert:
```js
    // Matchplay leagues that start in this season: the Winners final's winner, derived from the matches.
    const leagues=tournaments.filter(t=>t.format==='league'&&seasonOf(t.date)===season);
    const mW=leagues.map(t=>({p:players.find(p=>p.id===mlChampion(mlRecords(t))),record:escHtml(t.name)})).filter(w=>w.p);
```
and replace:
```js
        ${rows(`🏆 Best ${seasonInfo(season).best} IPS`,iW)}
```
with:
```js
        ${rows(`🏆 Best ${seasonInfo(season).best} IPS`,iW)}
        ${leagues.length?rows('🥇 Matchplay champion',mW):''}
```

In `CLAUDE.md`, after the "### Hall of Fame" section's first paragraph (the one ending `…shows as "In progress · current leaders".`), add the sentence:
```
A season in which a matchplay league starts also shows **Matchplay champion**: the Winners final's winner, derived live from the matches (`mlChampion`).
```
Then add a new section before `## Key design decisions (don't change without reason)`:
```markdown
## Matchplay league

A second tournament format beside the one-day team event: `tournaments.format='league'`
(team day is `'team_day'`, the default). Migration `supabase/matchplay_league.sql`
(+ `matchplay_league_rollback.sql`). Spec: `docs/superpowers/specs/2026-09-25-matchplay-league-design.md`.

- **Shape.** 16 players drawn into 4 groups of 4. The draw makes pots by handicap index,
  one player per pot in each group (`mlDrawGroups`). Each group plays a round robin in
  rounds 1–3. Then come four brackets by group position (Winners, Runners-up, Thirds,
  Fourths): semis A v B and C v D in round 4, then the final and 3rd/4th in round 5.
  That gives places 1–16, and everyone plays 5 matches. All 40 match rows are created at
  the draw (`mlFixtures`). Playoff players are filled in as results come in. Each round
  has a play-by date in `tournaments.deadlines` (`group_1`…`final`); after it, an
  undecided match shows **Overdue**.
- **Handicap:** 90% of course handicap on the match tee and `played_on` day. The lower
  player plays off 0 and the other gets the difference on SI 1…diff, with a second
  stroke where diff > 18 (`strokesOnHole(diff)`).
- **Decisions are derived, never stored as truth.** `mlDecide` walks the play order (from
  the 1st or 10th) and stops at the deciding hole. A group match level after 18 is
  halved. A level playoff goes to sudden death: holes 19+ replay from the start hole
  (`tmHoleIdx`). `status`/`result`/`extra_holes`/`played_on` are a cache written by
  `mlSyncFields`. Group tables come from `mlStandings`: points, then head-to-head /
  mini-table, then holes won, then average playing handicap, then seed pot. Places and
  the champion come from `mlPlaces`/`mlChampion` and are never stored.
- **Every write to a league match goes through `mlChange`.** Never PATCH one directly.
  `mlChange` tries the change on copies, then `mlGate` applies the edit rules:
  - A group change is refused once any playoff match has started (a score or an outcome).
  - A semi change is refused once its final or 3rd/4th has started.
  - A final or 3rd/4th change only moves places.
  - Otherwise the affected playoff slots are re-filled or emptied **in place** (same rows).
  - A correction that leaves a closed match undecided re-opens it.
  - Admin outcomes (walkover, halve by decision [group only], double forfeit; in a
    playoff the admin names who goes through) are edits too.
  - `mlHealAll` (on `init`) fills any slot a failed write left empty.
- **Permissions:**
  - Trigger `protect_league_match`: only a match's two players (or an admin in admin
    mode) change its status, result, tee or start hole. Only an admin changes a finished
    match or an outcome. Any member may fill an empty, unstarted playoff slot, but never
    overwrite one.
  - Restrictive score policies: players score only their own unfinished league matches.
  - Members enter and withdraw themselves before the draw, unpaid (`entered_at` forced
    to now).
  - League tournament rows are admin-only. Team day is unchanged.
  - Audit: `league_*`, `match_outcome`, `match_edited`, `match_players_changed`.
- **Entries** use the shared views: `entryBoxHtml` for the member box and
  `entriesPanelHtml` for the admin panel, the same ones season entries use. The first
  16 by `entered_at` are in and the rest wait. Admin "Move in" puts a waiting player
  just ahead of the 16th.
```

- [ ] **Step 4: Run every suite**

Run each and check the counts:
- `powershell -NoProfile -File tests/run.ps1 -Test tests/matchplay.test.js`: 0 failed
- `powershell -NoProfile -File tests/run.ps1 -Test tests/winter.test.js`: `66 passed, 0 failed`
- `powershell -NoProfile -File tests/run.ps1 -Test tests/phase0.test.js`: `27 passed, 0 failed`
- `powershell -NoProfile -File tests/run.ps1 -Test tests/phase1.test.js`: `37 passed, 0 failed`
- `powershell -NoProfile -File tests/run.ps1 -Test tests/phase2a.test.js`: `76 passed, 0 failed`
- `powershell -NoProfile -File tests/run.ps1 -Test tests/leaderboards.render.js -Data "$env:TEMP\rgc-phase1\snapshot-live-2026-09-24.json"`: 0 failed
- `Push-Location tests/sql; node --test; Pop-Location`: 108 + the matchplay tests, 0 failed

Then check reachability in the real page (UI convention). Run `Invoke-Item index.html`. As an admin on the PIN route, go to Admin → 🏆 Tournament: **New matchplay league** is there, and after Create the **🏆 Tournament** tab appears in the nav and shows the league's entry list.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/matchplay.test.js CLAUDE.md
git commit -F- <<'EOF'
feat: matchplay league — Hall of Fame champion; docs

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01N6cfxP9mcgmYjbs4UMRCnG
EOF
```

---

## Rollout (for the user, after merge — not a task)

1. Run `supabase/matchplay_league.sql` in the SQL Editor with the switch `true` (the rehearsal). The report should end `ALL CHECKS PASSED`.
2. Set the switch to `false` and run it for real.
3. Push `main` (GitHub Pages).

No version-gate change. To roll back, run `supabase/matchplay_league_rollback.sql`, then redeploy the previous app.
