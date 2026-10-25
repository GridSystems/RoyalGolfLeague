# Phase 2 Release B — Switch Off the PIN Route — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the public-key hole (anyone can read and edit every table): remove the old PIN login and every anonymous grant, so only signed-in members reach the data.

**Architecture:** Two SQL releases plus one app release. **B1** (`phase2b_enforce.sql`, reversible by `phase2b_rollback.sql`) drops every `anon_all` policy and every anonymous privilege, revokes the PIN functions and raises the gate to 4. **B2** (`phase2b_cleanup.sql`, a week later, no rollback) deletes the PIN functions and columns plus `legacy_id`. The app (version 4) removes the PIN route. It ships **first**, because it works against today's database (gate ≥ 3).

**Tech Stack:** single-file `index.html`, Supabase (Postgres/PostgREST/Auth), supabase-js 2.117.1 (already pinned), PGlite SQL tests (`tests/sql`, `node --test`), headless-Chrome browser tests (`tests/run.ps1`).

**Spec:** `docs/superpowers/specs/2026-09-24-phase2-auth-design.md` → "Release B — switch-off". Deviations from it (agreed 2026-10-25):
1. **`players.email` stays.** "Set it up" matches a new login to its player by `players.email` (`private.link_login`). Members not yet moved over still need that. It is already hidden from both API roles. It gets dropped in a later change, once the move-over list is empty.
2. **Release B is split** into B1 (enforce, reversible) and B2 (destructive cleanup a week later), as Phase 1 did with `phase1_cleanup.sql`.
3. **App first, then SQL.** v4 works on a gate-3 database, so there's no reload loop while the CDN still serves the old file (`max-age=600`).
4. **Not in the spec but needed:** `course-mapper.html` and `tests/sql/snapshot.mjs` use the public key and would break. Both move to a member's login.

## Global Constraints

- Version gate becomes **4**: `APP_VERSION=4` (index.html), `'x-app-version':'4'` (course-mapper.html `SB_H`), `'x-app-version': '4'` (snapshot.mjs `H`), `v::int < 4` (phase2b_enforce.sql). `phase2b_rollback.sql` sets it back to `< 3`.
- `public.require_current_app()` stays executable by `anon` (it is PostgREST's pre-request hook and must answer 426, not 42501).
- Migrations follow `phase2a_auth.sql`'s shape: `BEGIN;` · temp `p2b_mode` switch `SELECT true AS rehearsal` (◀◀ THE SWITCH) · `p2b_report` lines · precondition `RAISE EXCEPTION … Nothing was changed.` · checks that raise · rehearsal raises `REHEARSAL OK — everything was rolled back. Report:` · real run stores `private.phase2b_report` · `NOTIFY pgrst, 'reload schema'; NOTIFY pgrst, 'reload config';` · `COMMIT;`.
- The user runs all SQL; Claude has no service-role key. A `git push` to main happens only when the user says "push" in that turn.
- User-visible copy for a PIN-only player (login panel, replacing the "Use my old PIN" link): **"Used a PIN before? PIN sign-in has ended — set up your email login."** "set up your email login" opens `lockSetupPanel`.
- Never grant `SELECT` on `players` table-wide (CLAUDE.md).

## Review Focus

1. **An iOS tab that has been open for weeks**, with `sessionStorage.sl_session_player` set and no Supabase session, gets the login panel with the PIN-ended line. It must not render as nobody or as that player. → Task 3 test `stale PIN session lands on login`.
2. **Course mapper with expired admin mode** saves a polygon. The admin sees "Unlock admin mode in the app (Admin tab), then try again", not raw 42501 JSON. Signed out, they see "Sign in to the Saturday League app on this device first". → Task 4 tests.
3. **Course mapper open longer than the 1-hour token life** must still work: it calls `getSession()` (which refreshes) before every request instead of caching a token. → Task 4 test `fresh token per request`.
4. **A table created after B1 in the SQL editor** must not quietly give `anon` access through default privileges. → Task 1 test `new table after B1 is closed to anon`.
5. **An unlinked member moving over after B1** ("Set it up", email confirmed) must still be linked by `players.email`. → Task 1 test `link by email still works after B1`.

---

### Task 1: `phase2b_enforce.sql` (B1) + SQL tests

**Files:**
- Create: `supabase/phase2b_enforce.sql`
- Create: `tests/sql/phase2b.test.mjs`
- Modify: `tests/sql/rls.test.mjs` (the matrix also runs with B1 applied; its `anon` row expects `'denied'` there)

**Interfaces:**
- Produces: the database state Task 2 rolls back. Report table `private.phase2b_report(ord, line)`. Precondition message text `Phase 2 release B has already been applied` (Task 2's rollback test matches it).

- [ ] **Step 0: Baseline (before anything changes).** Take a fresh snapshot while the public key still works: `node tests/sql/snapshot.mjs` (it writes `%TEMP%\rgc-phase1\snapshot.json`; the folder is empty today). Then `cd tests/sql; node --test`. Expected: all green (178 at last count). Run every browser test with `tests/run.ps1 -Test tests/<name>.test.js`. Expected: all green. Record the counts in the task report. If anything is red, stop and report — don't build on red.

- [ ] **Step 1: Write failing tests** in `tests/sql/phase2b.test.mjs`. World: `productionDb()` → run `phase2a_auth.sql` real (as `rls.test.mjs` `REAL()` does) → apply B1. Tests:
  - `rehearsal changes nothing; real run applies; second run refuses`. The rehearsal error matches `/REHEARSAL OK/`, and `anon_all` count is unchanged afterwards. The real run returns `null`. Then count `pg_policies WHERE policyname='anon_all'` = 0, and a re-run matches `/already been applied/`.
  - `anon can read and write nothing`. `as(db,null)`, then for every table in `pg_tables WHERE schemaname='public'`: `SELECT 1 FROM public.<t> LIMIT 1` → error (permission denied), and `players` column read `SELECT id,name FROM public.players` → error.
  - `anon cannot call any public function except the gate`. As anon, `SELECT public.run_draw(...)`, `public.login('a','1')`, `public.check_pin(1,'1')`, `public.has_pin(1)` → each errors. `SELECT public.require_current_app()` with `request.headers` `{"x-app-version":"4"}` → no error.
  - `members cannot call the PIN functions either`. As a `persona` member, `public.check_pin(1,'1')` and `public.login(...)` → error.
  - `gate is 4`. With `request.headers` `{"x-app-version":"3"}`, `require_current_app()` raises `PT426`; with `"4"` it passes.
  - `member access is unchanged by B1`. As the member persona: read rounds `>0`, sign self up = 1 row, `run_draw` still executable (`has_function_privilege('authenticated','public.run_draw(text,jsonb,jsonb)','EXECUTE')` true), `complete_signup`, `admin_member_emails` and `log_admin_mode` executable by `authenticated`.
  - `new table after B1 is closed to anon`. After B1, `RESET ROLE; CREATE TABLE public.t_new(id int)`, then `has_table_privilege('anon','public.t_new','SELECT')` = false. Also `CREATE FUNCTION public.f_new() RETURNS int LANGUAGE sql AS 'select 1'`, then `has_function_privilege('anon','public.f_new()','EXECUTE')` = false.
  - `link by email still works after B1`. Pick an approved player with no `user_id`, set their `email`, insert into `auth.users` with that email, set `email_confirmed_at` → `players.user_id` equals the new id (copy the pattern from `testbed.mjs` `persona`).

  In `rls.test.mjs`, run the existing `MATRIX` a second time against a world with B1 applied, with the `anon` row's expectation overridden to `'denied'`. Every other row keeps its expectation, and that is the proof that B1 changes nothing for logged-in users.

- [ ] **Step 2: Run** `cd tests/sql; node --test phase2b.test.mjs rls.test.mjs`. Expected: FAIL — `phase2b_enforce.sql` not found.

- [ ] **Step 3: Write `supabase/phase2b_enforce.sql`.** Sections, in order:
  1. Preconditions: release A is applied (`players.user_id` exists, else raise `Run phase2a_auth.sql first. Nothing was changed.`). Not already applied (no `anon_all` policy on `public.players` → raise `Phase 2 release B has already been applied (no anon_all policies left). Nothing was changed.`).
  2. Back up what the rollback restores, into schema `phase2b_backup` (`REVOKE ALL … FROM PUBLIC, anon, authenticated`):
     - `anon_policies`: `tablename` of every table with `anon_all`.
     - `anon_table_grants` / `anon_column_grants`: from `information_schema.role_table_grants` and `role_column_grants`, `grantee='anon'`, table schema `public`.
     - `anon_function_grants`: from `information_schema.routine_privileges`, grantee `anon` or `PUBLIC`, `public` schema, by `specific_name` → store `oid::regprocedure::text`.
     - `anon_sequence_grants`: from `information_schema.usage_privileges`, `object_type='SEQUENCE'`, grantee `anon`.

     Exact column choice is the builder's call. The rollback must be able to re-issue each grant.
  3. Drop `anon_all` on every public table. `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;` (this also removes column grants, such as `players.user_id`). `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;`
  4. Functions: `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;` then `GRANT EXECUTE ON FUNCTION public.require_current_app() TO anon, authenticated;` and `GRANT EXECUTE` to `authenticated` on `run_draw(text,jsonb,jsonb)`, `complete_signup(text,text,numeric,int)`, `admin_member_emails()`, `log_admin_mode()`. The PIN functions (`login`, `has_pin`, `check_pin`, `set_first_pin`, `admin_reset_pin`, `_check_pin`, any signature) get `REVOKE ALL … FROM PUBLIC, anon, authenticated`. Find them with a loop over `pg_proc` by name so signature changes don't matter.
  5. `REVOKE USAGE ON SCHEMA private FROM anon;` The policies reference `private.*` only for `authenticated`. Linking runs as a `SECURITY DEFINER` trigger.
  6. Default privileges for objects created later in the SQL editor: `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;` and the same for `SEQUENCES`, and for `FUNCTIONS FROM PUBLIC, anon`.
  7. Gate: `CREATE OR REPLACE FUNCTION public.require_current_app()`, identical to release A's except `v::int < 4`.
  8. Checks, each `RAISE EXCEPTION` naming the offenders:
     - no policy in `public` whose `roles` contains `anon` or `public`;
     - `has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')` false for every `public` table;
     - `has_function_privilege('anon', p.oid, 'EXECUTE')` false for every `public` function except `require_current_app`.

     Then report lines: tables closed (count), functions closed (count), `version gate: requests need x-app-version >= 4`, `ALL CHECKS PASSED`.
  9. Rehearsal raise / report table / NOTIFY / COMMIT / `SELECT line FROM private.phase2b_report ORDER BY ord;` — as in Global Constraints.

  Header comment: what it does, "REHEARSAL FIRST", "push app version 4 at least 10 minutes BEFORE the real run", rollback = `phase2b_rollback.sql`.

- [ ] **Step 4: Run** `cd tests/sql; node --test`. Expected: all pass, the earlier suites included.

- [ ] **Step 5: Commit** `feat(db): release B — close the public key (phase2b_enforce.sql)`.

### Task 2: `phase2b_rollback.sql` + test

**Files:**
- Create: `supabase/phase2b_rollback.sql`
- Modify: `tests/sql/phase2b.test.mjs`

**Interfaces:**
- Consumes: `phase2b_backup.*` tables from Task 1.

- [ ] **Step 1: Failing test** `rollback restores release A exactly, and B1 re-applies`. Take a policy dump (`pg_policies` rows as JSON, ordered), `has_table_privilege('anon',…)` for every table, and `has_function_privilege('anon',…)` for every function. Do this after release A and again after B1 + rollback; they must be equal. Then: anon `SELECT id FROM public.players` works again, the gate accepts `"3"`, `phase2b_backup` is gone, and running B1 again returns `null`.
- [ ] **Step 2: Run** → FAIL (file missing).
- [ ] **Step 3: Write `supabase/phase2b_rollback.sql`.** In one transaction: refuse if `phase2b_backup` doesn't exist (`Nothing to roll back`). Recreate `anon_all` (`FOR ALL TO anon USING (true) WITH CHECK (true)`) on each backed-up table. Re-issue every backed-up table, column, sequence and function grant. Restore the PIN functions' grants exactly as backed up. `ALTER DEFAULT PRIVILEGES … GRANT` back what step 6 revoked. Gate back to `< 3`. `GRANT USAGE ON SCHEMA private TO anon`. `DROP SCHEMA phase2b_backup CASCADE`. NOTIFY ×2. Header: "Redeploy app version 3 only if the PIN login itself is needed back. Version 4 runs fine on a rolled-back database."

  The default-privilege restore can't be read back from the catalog in a simple way. The rollback re-grants what Supabase grants by default (`ALL ON TABLES/SEQUENCES TO anon`, `EXECUTE ON FUNCTIONS TO PUBLIC`). The test only compares table, function and policy state, so the builder's call is to keep it like this.
- [ ] **Step 4: Run** `cd tests/sql; node --test` → all pass.
- [ ] **Step 5: Commit** `feat(db): release B rollback`.

### Task 3: App version 4 — remove the PIN route

**Files:**
- Modify: `index.html`
- Delete: `tests/phase0.test.js` (it tests only the PIN route)
- Modify: `tests/phase2a.test.js`, `tests/phase1.test.js`, `tests/matchplay.test.js`, `tests/winter.test.js`, `tests/saturday-fixes.test.js` (only where they run on the old route)
- Create: `tests/phase2b.test.js`

**Interfaces:**
- Produces: `APP_VERSION=4`, and `PLAYER_COLS` without `legacy_id` (B2 drops that column).

- [ ] **Step 1: Failing test `tests/phase2b.test.js`** (same harness style as `tests/phase2a.test.js`: stub `fetch` and `window.supabase`, `T(name, cond, detail)`, `RESULT` block). Assertions:
  - `PIN UI is gone`: `document.getElementById(x)===null` for `lockPinPanel`, `lockSetPinPanel`, `pinModal`, `adminPinModal`, `changePinModal`, `loginPin`.
  - `no PIN calls remain`: `document.documentElement.outerHTML` has no `sbRpc('login'`, `has_pin`, `check_pin`, `set_first_pin`, `admin_reset_pin`, `sl_admin_pin`, or `Reset PIN`. Test the inline script's text, not the test's own.
  - `version 4`: `APP_VERSION===4` and `H['x-app-version']==='4'`.
  - `PLAYER_COLS drops legacy_id`: `!PLAYER_COLS.split(',').includes('legacy_id')` and it still includes `user_id`.
  - `stale PIN session lands on login`. Set `sessionStorage.sl_session_player='2'`, `localStorage.sl_active_player='2'` and `sessionStorage.admin_auth='1'`, with `getSession` returning no session, then `await boot()`. Then: `lockLoginPanel` visible, lock screen visible, no render ran (spy on `renderTodayLb` as phase2a does), and `sessionStorage.sl_session_player`, `sessionStorage.admin_auth` and `localStorage.sl_admin_pin` are all `null`.
  - `login panel tells PIN users what to do`: `lockLoginPanel` text contains `PIN sign-in has ended`, and clicking its link shows `lockSetupPanel`.
  - `no session means no admin`: with `_session=null` and `players[0].is_admin=true`, `activeId=players[0].id` → `isAdminAccount()===false`.
  - `move-over copy`: with `admin_member_emails` returning one unlinked row, `#moveOverList` text matches `/1 of \d+ members haven't set up the email login yet/` and doesn't contain `PIN`.
- [ ] **Step 2: Run** `tests/run.ps1 -Test tests/phase2b.test.js` → FAIL.
- [ ] **Step 3: Implement in `index.html`.** What to remove or change (find the call sites with `grep -n -E "!_session|_session\?|_session&&|sl_session_player|admin_auth|PIN"`):
  - Remove the lock panels `lockPinPanel` and `lockSetPinPanel` (and drop them from `LOCK_PANELS`), plus `pinModal`, `adminPinModal`, `changePinModal` and the "Change Admin PIN" button. Remove the functions `submitEmailPin`, `submitLockSetPin`, `loginAs`, `lockLoginPlayer`, the `// ── PIN ──` block (`PIN_KEY`, `getPin`, `requireAdminPin`, `submitAdminPin`, `saveNewPin`, `pendingAdminBtn`), `requirePin`, `submitPin`, `saveFirstPin`, `pendingPinId`, `resetPlayerPin` and its "Reset PIN" button, and `reconcileStoredPlayer` with its call in `init()`. Phase 1 was a month ago, and the session player now comes from `resolveSignedInPlayer`.
  - Collapse the old-route branches to the signed-in path:
    - `isAdminAccount`: false without `_session`.
    - `requireAdminMode`: drop `if(!_session)return true`.
    - `openAdminTab`: drop its PIN line.
    - `mlMe`: `_session ? … : null`.
    - `mlChange` admin test at the `(!_session||adminModeActive()…` line: drop `!_session||`.
    - `showPicker`: always `setPlayer`.
    - `setPlayer`: `sessionId` only from `_session`.
    - `updateSignOutBtn`: `_session` only.
    - `renderAuditPanel` / `renderMoveOverList`: drop the `!_session` lines.
    - `boot()`: drop the `sl_session_player` branch.
  - `boot()`, first line: `sessionStorage.removeItem('sl_session_player');sessionStorage.removeItem('admin_auth');localStorage.removeItem('sl_admin_pin');`, with a one-line comment saying they're leftovers of the PIN login.
  - Login panel: replace the "Use my old PIN" line with the Global Constraints copy. The link calls `showLockPanel('lockSetupPanel')`.
  - Move-over list copy: `${todo.length} of ${rows.length} members haven't set up the email login yet.` Empty state: `Everyone has set up the email login ✓`.
  - `APP_VERSION=4`. `PLAYER_COLS` without `legacy_id`. Update the comment above `PLAYER_COLS`, which mentions `sbRpc('login')`.
  - `signOut()`: drop the `sessionStorage.removeItem('sl_session_player')`, because boot clears it now.
- [ ] **Step 4: Fix the other browser tests.** Delete `tests/phase0.test.js` and the `reconcileStoredPlayer` cases in `phase1.test.js`. Turn the "old PIN route" cases in `phase2a.test.js` into their signed-in equivalents where they test something still true (failed load keeps the lock screen up; happy path renders once). Delete the ones that test only the old route. Where `matchplay`/`winter`/`saturday-fixes` tests act as an admin with `_session=null`, give them a stub session the way `matchplay.test.js:557` already does (`players[0].user_id='u-1'; _session={user:{id:'u-1'},access_token:'x.'+btoa(JSON.stringify({aal:'aal2',amr:[{method:'totp',timestamp:Date.now()/1000}]}))+'.y'}`), and keep their assertions unchanged.
- [ ] **Step 5: Run every browser test** (`tests/run.ps1 -Test` for each file in `tests/*.test.js`) → all pass. Compare the counts with Step 0 of Task 1 and account for every test removed. Also run a before/after render of the leaderboards with `tests/leaderboards.render.js` against the snapshot → identical output.
  `tests/sql/version.test.mjs` now fails on `APP_VERSION=3`. That is expected; Task 4 updates it.
- [ ] **Step 6: Commit** `feat: release B — remove the PIN login (app version 4)`.

### Task 4: Course mapper and snapshot on a member login; version test

**Files:**
- Modify: `course-mapper.html` (the `SB_H` block at ~line 265 and every `fetch` that uses it)
- Modify: `tests/sql/snapshot.mjs`
- Modify: `tests/sql/version.test.mjs`
- Modify: `tests/run.ps1` (optional `-Page` parameter, default `index.html`)
- Create: `tests/course-mapper.test.js`

**Interfaces:**
- Produces: `async function sbHeaders(extra)` in `course-mapper.html`, which returns headers carrying the current access token. All course-mapper fetches use it.

- [ ] **Step 1: Failing tests.**
  - `version.test.mjs`: all four checks say 4: `APP_VERSION=4`, `'x-app-version':'4'`, `'x-app-version': '4'`, and `phase2b_enforce.sql` matches `/v::int < 4/`.
  - `tests/course-mapper.test.js` (stub `window.supabase.createClient` → `auth.getSession` returning a queued session; stub `fetch`). Cases:
    - `fresh token per request`: two `sbSurveyGet()` calls with `getSession` returning tokens `t1` then `t2` → the requests carry `Bearer t1` and `Bearer t2`.
    - `signed out`: `getSession` → null → `sbSurveyGet()` rejects with a message containing `Sign in to the Saturday League app on this device first`, and no fetch happens.
    - `expired admin mode`: fetch answers 401 with `{"code":"42501"}` to an insert → the error shown contains `Unlock admin mode in the app (Admin tab), then try again`.
    - `version`: requests carry `x-app-version: 4`.
- [ ] **Step 2: Run** `cd tests/sql; node --test version.test.mjs` and `tests/run.ps1 -Test tests/course-mapper.test.js -Page course-mapper.html` → FAIL.
- [ ] **Step 3: Implement.**
  - `course-mapper.html`: add the same supabase-js `<script>` tag as `index.html:11` (same version, same integrity hash). Use the same `createClient(SB_URL, SB_KEY, {auth:{flowType:'pkce',persistSession:true,autoRefreshToken:true}})`, which shares the app's stored session (same origin). `sbHeaders(extra)` awaits `getSession()`, throws the signed-out message when there's none, and returns `{...SB_H, Authorization:'Bearer '+access_token, ...extra}`. `SB_H` keeps `apikey`, `Content-Type` and `x-app-version:'4'`, but no Authorization. One `sbFail(r)` helper turns a 42501/401 into the admin-mode message and anything else into the response text. Every existing `if(!r.ok)throw new Error(await r.text())` uses it.
  - `snapshot.mjs`: take the token from `process.env.RGC_TOKEN` when set (otherwise the public key, which only works before B1). Add a usage comment: in the app's browser console run `JSON.parse(localStorage['sb-qvjybtcbymexheqrjkai-auth-token']).access_token`, then `$env:RGC_TOKEN='<token>'; node tests/sql/snapshot.mjs`. Admin mode is needed for `gps_shots` rows other than your own. `x-app-version` becomes `'4'`.
  - `run.ps1`: `[string]$Page='index.html'`, used in place of the hard-coded `index.html`.
- [ ] **Step 4: Run** the full SQL suite and every browser test → all pass.
- [ ] **Step 5: Commit** `feat: course mapper and snapshot use a member login (version 4)`.

### Task 5: `phase2b_cleanup.sql` (B2) + test

**Files:**
- Create: `supabase/phase2b_cleanup.sql`
- Modify: `tests/sql/phase2b.test.mjs`

- [ ] **Step 1: Failing tests:**
  - `cleanup refuses before B1`: on the release-A world it raises `Run phase2b_enforce.sql first` and nothing changes.
  - `cleanup drops the PIN machinery`. After B1 + cleanup: no `pg_proc` named `login`, `has_pin`, `check_pin`, `set_first_pin`, `admin_reset_pin` or `_check_pin` in `public`. No `players` columns `pin`, `pin_failures`, `pin_locked_until` or `legacy_id`. `email` and `user_id` still exist. `phase2b_backup` is gone. The member matrix row "read players" still `>0`.
  - `cleanup re-run is harmless`: a second run returns `null` (all `IF EXISTS`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Write `supabase/phase2b_cleanup.sql`.** Refuse unless `anon_all` is absent everywhere (B1 applied). Drop the PIN functions (loop over `pg_proc` by name, every signature). `ALTER TABLE public.players DROP COLUMN IF EXISTS pin, … pin_failures, … pin_locked_until, … legacy_id;`. `DROP SCHEMA IF EXISTS phase2b_backup CASCADE;`. Header: "Run a week after phase2b_enforce.sql, once nothing looks wrong. After this, phase2b_rollback.sql no longer works and the PIN login can't come back." No rehearsal switch: the script is small, its drops are idempotent, and it's like `phase1_cleanup.sql`.
- [ ] **Step 4: Run** `cd tests/sql; node --test` → all pass.
- [ ] **Step 5: Commit** `feat(db): release B cleanup — drop PIN functions and columns`.

### Task 6: Docs and runbook

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-09-24-phase2-auth-design.md` (Release B section: point to this plan and note the four deviations)

- [ ] **Step 1: Update `CLAUDE.md`:**
  - The **RLS** paragraph: anon now has no access; `anon_all` is gone since release B.
  - **Credentials are hidden**: PIN functions and columns are gone after B2. `email` stays until the move-over list is empty.
  - The **Admin PIN (old route only)** bullet: delete it.
  - **Common tasks → Reset admin PIN**: delete it.
  - **Version gate**: minimum 4, and the gate now lives in `phase2b_enforce.sql`.
  - **Course mapper** (one line): it needs the app signed in on the same device, and admin mode for saving.
  - **Snapshot** (one line): needs `RGC_TOKEN`.
  - `matchplay`: the paragraph "In the database, the old PIN route (anon) bypasses every league rule…" → delete it.
  - The Saturday draw `run_draw`: "Callable by `anon` too, until release B" → delete it.
- [ ] **Step 2: Check the runbook** at the end of this plan against what shipped (file names, messages, version), and correct it if anything differs.
- [ ] **Step 3: Commit** `docs: release B`.

---

## Runbook (user, after merge)

0. **Message the members on the Admin tab's move-over list.** PIN-only members lose sign-in at the v4 push (step 1), not at B1. Tell them to use "Set it up" with their email, check Spam, and open the link on the same phone.
1. **Push app version 4.** PIN-only players now see the "PIN sign-in has ended" line. Old version-3 tabs keep working until step 3. Wait **at least 10 minutes** (Pages `max-age=600`). Check that `https://gridsystems.github.io/RoyalGolfLeague/?v=4` shows no "Use my old PIN".
2. **Rehearse** `supabase/phase2b_enforce.sql` in the SQL Editor as it is (switch `true`). Expected: `REHEARSAL OK` with `ALL CHECKS PASSED`.
   If B1's checks raise about objects in `public` that `postgres` doesn't own, stop and tell Claude. Don't force it.
3. **Real run**: switch to `false`, then run. Then re-run `supabase/grants.sql` (authenticated only; it has no rehearsal switch, but it refuses before granting anything if a table lacks RLS).
4. **Live checks (Claude can do these from outside):**
   - every check sends the headers `apikey`, `Authorization: Bearer <public key>` and `x-app-version: 4` (without the version header the gate answers 426 first, which looks like a pass for the wrong reason);
   - the public key gets 401 on `rounds`, `players?select=id,name` and `rpc/check_pin`;
   - a request with `x-app-version: 3` gets 426;
   - the app signed in loads normally;
   - course mapper loads after signing in to the app;
   - the next Friday-noon draw happens.
5. **A week later, if nothing looks wrong:** run `supabase/phase2b_cleanup.sql`.
   After B2, `phase2b_rollback.sql` and `phase2a_rollback.sql` can no longer be re-applied.
6. **Standing rules afterwards:** create tables in the SQL editor (dashboard-created tables run as `supabase_admin` and still get Supabase's default grants), enable RLS, add `p2_*` policies, re-run `grants.sql`. In `public`, a new function is callable through /rpc by every logged-in user immediately (Supabase's default grant to `authenticated` stays), pending and unlinked logins included; if it isn't for every member, `REVOKE EXECUTE … FROM authenticated` and grant narrower. In `private` or any other schema, nobody can call it until it gets an explicit `GRANT EXECUTE … TO authenticated`.
7. **Later, once the move-over list is empty:** drop `players.email` (separate change).

Rollback before step 5: `supabase/phase2b_rollback.sql`. App v4 can stay.
