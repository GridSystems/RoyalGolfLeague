# Phase 2 Release A — Real Login, Permissions, Audit Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship release A of Phase 2 — Supabase Auth email+password login with forgot-password, admin two-factor "admin mode" (12 h), a database-written audit log with money trail, row-level permission rules for logged-in users, a validated draw function, the self-service move-over, and the "appears once, already as you" load fix — while the old PIN route keeps working until release B.

**Architecture:** `supabase/phase2a_auth.sql` (one transaction with a rehearsal switch, as Phase 1) adds `players.user_id`, private helper functions, triggers on `auth.users`, `auth.mfa_factors`, `players`, `fines`, `fine_payments`, the `audit_log`, RLS policies `TO authenticated` (anon keeps `anon_all` until B), `run_draw()`, `admin_member_emails()`, `log_admin_mode()`, and raises the version gate to 3. `index.html` loads supabase-js 2.117.1 from jsDelivr for auth only; the existing `sb*` helpers send the session token, retry once through admin mode on a permission refusal, and the boot sequence renders only after the player is resolved.

**Tech Stack:** Single-file `index.html` (vanilla JS), Supabase Auth + PostgREST, `@supabase/supabase-js` 2.117.1 (UMD, jsDelivr, SRI-pinned), PGlite 0.2 testbed with an `auth` stand-in, headless Chrome app tests.

**Spec:** `docs/superpowers/specs/2026-09-24-phase2-auth-design.md`

## Global Constraints

- **Never push to `main` before `phase2a_auth.sql` has run for real** — the new app sends `x-app-version: 3` and needs the new functions. Work on branch `phase2a-auth`; merge and push only in Task 13.
- **Claude never runs SQL against production**; the user runs every script. Claude reads production only with the public key (and the version header).
- **Snapshots contain personal data** — `%TEMP%\rgc-phase1\` only, never committed.
- **Version gate:** `APP_VERSION=3` in `index.html`, `'x-app-version':'3'` in `course-mapper.html` and `tests/sql/snapshot.mjs`, gate minimum 3 in the SQL — all in the same release.
- **Auth triggers must never block a login:** every function fired by a trigger on `auth.*` ends with `EXCEPTION WHEN OTHERS THEN RAISE WARNING …; RETURN NEW;` and uses `SECURITY DEFINER SET search_path = ''` (Supabase guidance).
- **No IP addresses, device details, passwords, tokens or email addresses** are ever written to `audit_log.details`.
- Admin mode = `aal2` **and** a `totp` entry in `amr` with `timestamp` ≥ now − 43 200 s. One definition: `private.is_admin()` in SQL, `adminModeActive()` in the app — both use 12 h.
- Password minimum **8** characters (client check + dashboard setting). Reset/confirmation links are PKCE: they must be opened on the device that requested them — every "check your email" screen says so.
- Site / redirect URL: `https://gridsystems.github.io/RoyalGolfLeague/`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Rulings made while planning (spec is silent or ambiguous)

1. **Rules apply to new-login users from release A.** `anon_all` is narrowed to `TO anon` (the PIN route) and the new policies are `TO authenticated`. B then only removes `anon_all`. Cost if wrong: a policy bug blocks moved-over users at A — the RLS matrix tests (Task 4) exist to prevent that.
2. **Members may update `tournaments` and `tournament_matches`** (match status, tee, result during play); insert/delete stay admin. `tournament_players` stays admin-only.
3. **Admins may delete `players`** — `rejectPlayer` deletes pending applicants. Approved members are still only archived by the app.
4. **`admin_mode_unlocked` is logged by `public.log_admin_mode()`**, which checks the caller's own JWT (`private.is_admin()`) before writing — not by a trigger on the undocumented `auth.mfa_challenges`. `mfa_enrolled` uses a trigger on the documented `auth.mfa_factors`.
5. **Release B gets its own short plan** when the move-over list is empty.

## Review Focus

1. **A member who opens a confirmation/reset link on a different device** — PKCE fails. Expected: a clear "open this link on the phone you used" message, not a blank app. Owned by Task 8 (`handleAuthRedirectError`), tested there.
2. **An auth trigger error during sign-up or sign-in** (e.g. audit insert fails). Expected: the login still succeeds. Owned by Tasks 2–3 (exception-safe triggers), tested by forcing an audit failure.
3. **A member tries to promote themself** by PATCHing `is_admin` with their own token. Expected: refused (42501) and nothing logged as granted. Owned by Task 3 (protected-field trigger), tested there.
4. **An admin's 13-hour-old phone session** taps Approve. Expected: prompted for the code, then it works — never a silent failure. Owned by Task 9 (retry through admin mode) and Task 4 (stale-aal2 matrix row).
5. **Two phones open the app on Friday afternoon at once.** Expected: exactly one draw. Owned by Task 4 (`run_draw` refuses a date already drawn), tested there.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/phase2a_auth.sql` (create) | Release A migration with rehearsal switch and checks |
| `supabase/phase2a_rollback.sql` (create) | Emergency undo of release A |
| `tests/sql/auth_stub.sql` (create) | Stand-in for Supabase's `auth` schema (users, mfa_factors, `auth.uid()`, `auth.jwt()`) |
| `tests/sql/testbed.mjs` (modify) | `productionDb()` (snapshot + enable_rls + Phase 0b + Phase 1 + auth stub), `as(db, persona)` |
| `tests/sql/phase2a.test.mjs` (create) | Identity, triggers, audit, draw, gate tests |
| `tests/sql/rls.test.mjs` (create) | The permission matrix |
| `index.html` (modify) | Auth client, token helpers, boot/load fix, login panels, admin mode, audit panel, move-over list, `run_draw` call, `APP_VERSION=3` |
| `course-mapper.html`, `tests/sql/snapshot.mjs` (modify) | Version header 3 |
| `tests/phase2a.test.js` (create) | App behaviour with supabase-js stubbed |
| `supabase/grants.sql`, `CLAUDE.md` (modify) | Grants for new objects; auth/permissions/audit notes |

---

### Task 1: Testbed — production-shaped database with an auth stand-in

**Files:** Create `tests/sql/auth_stub.sql`; modify `tests/sql/testbed.mjs`; test `tests/sql/phase2a.test.mjs`.

**Interfaces — Produces:** `productionDb()` → PGlite at production's current state (Phase 0 grants, `anon_all` RLS, Phase 1 applied, auth stand-in). `as(db, claims|null)` → switches to `anon` (null) or `authenticated` with those JWT claims. `persona(db, {playerId, admin, aal, totpAgeSec})` → creates a confirmed auth user, links it to the player, returns claims. `SITE='https://gridsystems.github.io/RoyalGolfLeague/'`.

- [ ] **Step 1: Write the failing test** — `tests/sql/phase2a.test.mjs`

```js
import test from 'node:test'; import assert from 'node:assert/strict';
import { productionDb, as, persona, run, sqlFile } from './testbed.mjs';
const REAL = () => sqlFile('phase2a_auth.sql').replace('SELECT true AS rehearsal', 'SELECT false AS rehearsal');
const one = async (db, q, p) => (await db.query(q, p)).rows[0];

test('productionDb is at the post-Phase-1 state with an auth stand-in', async () => {
  const db = await productionDb();
  assert.equal((await one(db, `SELECT count(*)::int n FROM public.players WHERE legacy_id IS NOT NULL`)).n, 29);
  assert.equal((await one(db, `SELECT count(*)::int n FROM pg_policies WHERE policyname='anon_all'`)).n > 10, true);
  await as(db, { sub: '00000000-0000-0000-0000-000000000001', role: 'authenticated' });
  assert.equal((await one(db, `SELECT auth.uid()::text u`)).u, '00000000-0000-0000-0000-000000000001');
  await as(db, null);
  assert.equal((await one(db, `SELECT current_user u`)).u, 'anon');
});
```

- [ ] **Step 2: Run to verify it fails** — `cd tests/sql; node --test phase2a.test.mjs` → FAIL: `productionDb is not a function` (import error).

- [ ] **Step 3: Create `tests/sql/auth_stub.sql`**

```sql
-- Stand-in for the parts of Supabase's auth schema that Phase 2 touches. Column names follow
-- Supabase (auth.users, auth.mfa_factors); auth.uid()/auth.jwt() read request.jwt.claims as
-- PostgREST sets it.
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, email_confirmed_at timestamptz,
  recovery_sent_at timestamptz, last_sign_in_at timestamptz, encrypted_password text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}', created_at timestamptz DEFAULT now());
CREATE TABLE auth.mfa_factors (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  factor_type text, status text, created_at timestamptz DEFAULT now());
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
  $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt() ->> 'sub', '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT auth.jwt() ->> 'role' $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated;
```

- [ ] **Step 4: Extend `tests/sql/testbed.mjs`** (append)

```js
export const SITE = 'https://gridsystems.github.io/RoyalGolfLeague/';
// The database as production has it today: snapshot → RLS allow-all → Phase 0 column grants → Phase 1.
export async function productionDb() {
  const db = await freshDb();
  await db.exec(sqlFile('enable_rls.sql'));
  await db.exec(sqlFile('phase0b_hide_credentials.sql'));
  const err = await run(db, sqlFile('phase1_ids.sql').replace('SELECT true AS rehearsal', 'SELECT false AS rehearsal'));
  if (err) throw new Error('phase 1 failed in testbed: ' + err);
  await db.exec(fs.readFileSync(path.join(import.meta.dirname, 'auth_stub.sql'), 'utf8'));
  return db;
}
// Act as a visitor: null → anon (logged out / old PIN route); claims → authenticated with that JWT.
export async function as(db, claims) {
  await db.exec('RESET ROLE');
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims || { role: 'anon' })]);
  await db.exec(claims ? 'SET ROLE authenticated' : 'SET ROLE anon');
}
// A confirmed login linked to an existing player; returns JWT claims for that visitor.
export async function persona(db, { playerId, admin = false, aal = 'aal1', totpAgeSec = null }) {
  await db.exec('RESET ROLE');
  const email = `p${playerId}@test.invalid`;
  const u = (await db.query(`INSERT INTO auth.users (email) VALUES ($1) RETURNING id`, [email])).rows[0].id;
  await db.query(`UPDATE public.players SET email=$1, is_admin=$2 WHERE id=$3`, [email, admin, playerId]);
  await db.query(`UPDATE auth.users SET email_confirmed_at = now() WHERE id=$1`, [u]); // link trigger fires here
  const now = Math.floor(Date.now() / 1000);
  const amr = [{ method: 'password', timestamp: now }];
  if (totpAgeSec !== null) amr.unshift({ method: 'totp', timestamp: now - totpAgeSec });
  return { sub: u, role: 'authenticated', aal, amr };
}
```

(`productionDb` depends on `phase2a` only in later tasks; `persona`'s link relies on Task 2's trigger — Task 1's test does not call it.)

- [ ] **Step 5: Run** — `cd tests/sql; node --test` → all pass (Phase 1 suites 15 + this 1).

- [ ] **Step 6: Commit** — `git add tests/sql/auth_stub.sql tests/sql/testbed.mjs tests/sql/phase2a.test.mjs && git commit -m "test: production-shaped testbed with an auth stand-in"`

---

### Task 2: SQL — identity, linking, helpers, rehearsal skeleton

**Files:** Create `supabase/phase2a_auth.sql`; test `tests/sql/phase2a.test.mjs` (append).

**Interfaces — Produces:** `players.user_id`; `private.current_player() → bigint`, `private.acting_player() → bigint` (incl. archived, for audit), `private.is_member() → boolean`, `private.is_admin() → boolean`; trigger `link_login` on `auth.users`; temp tables `p2_mode`, `p2_report`; section markers `-- ===== SECTION n` so later tasks insert above `-- ===== CHECKS`.

- [ ] **Step 1: Write the failing tests** (append)

```js
test('rehearsal changes nothing; real run adds user_id', async () => {
  const db = await productionDb();
  assert.match(await run(db, sqlFile('phase2a_auth.sql')), /REHEARSAL OK/);
  assert.equal((await one(db, `SELECT count(*)::int n FROM information_schema.columns WHERE table_name='players' AND column_name='user_id'`)).n, 0);
  assert.equal(await run(db, REAL()), null);
  assert.equal((await one(db, `SELECT count(*)::int n FROM information_schema.columns WHERE table_name='players' AND column_name='user_id'`)).n, 1);
  assert.match(await run(db, REAL()), /already been applied/);
});

test('confirming an email links the login to the matching active player, once', async () => {
  const db = await productionDb(); await run(db, REAL());
  await db.query(`UPDATE public.players SET email='ann@x.dk' WHERE id=3`);
  const u = (await one(db, `INSERT INTO auth.users(email) VALUES ('ANN@x.dk') RETURNING id`)).id;
  assert.equal((await one(db, `SELECT user_id FROM public.players WHERE id=3`)).user_id, null, 'not before confirmation');
  await db.query(`UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1`, [u]);
  assert.equal((await one(db, `SELECT user_id::text u FROM public.players WHERE id=3`)).u, u);
  const u2 = (await one(db, `INSERT INTO auth.users(email, email_confirmed_at) VALUES ('ann@x.dk', now()) RETURNING id`)).id;
  assert.equal((await one(db, `SELECT user_id::text u FROM public.players WHERE id=3`)).u, u, 'second login does not steal the player');
});

test('an archived player is never linked', async () => {
  const db = await productionDb(); await run(db, REAL());
  const fm = (await one(db, `SELECT id FROM public.players WHERE name='Former member'`)).id;
  await db.query(`UPDATE public.players SET email='gone@x.dk' WHERE id=$1`, [fm]);
  await db.query(`INSERT INTO auth.users(email, email_confirmed_at) VALUES ('gone@x.dk', now())`);
  assert.equal((await one(db, `SELECT user_id FROM public.players WHERE id=$1`, [fm])).user_id, null);
});

test('a confirmed sign-up with no matching player creates a pending player from its metadata', async () => {
  const db = await productionDb(); await run(db, REAL());
  const before = (await one(db, `SELECT count(*)::int n FROM public.players`)).n;
  const u = (await one(db, `INSERT INTO auth.users(email, raw_user_meta_data) VALUES ('new@x.dk',
    '{"name":"New Guy","dgu_number":"900-1","handicap":14.2,"color":3}') RETURNING id`)).id;
  await db.query(`UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1`, [u]);
  const p = await one(db, `SELECT name, dgu_number, approved, color, handicap::float h, hcp_history, user_id::text u FROM public.players WHERE user_id=$1`, [u]);
  assert.deepEqual([p.name, p.dgu_number, p.approved, p.color, p.h, p.u], ['New Guy', '900-1', false, 3, 14.2, u]);
  assert.equal(p.hcp_history.length, 1);
  assert.equal((await one(db, `SELECT count(*)::int n FROM public.players`)).n, before + 1);
});

test('a confirmed set-up login with no match and no metadata creates nothing', async () => {
  const db = await productionDb(); await run(db, REAL());
  const before = (await one(db, `SELECT count(*)::int n FROM public.players`)).n;
  await db.query(`INSERT INTO auth.users(email, email_confirmed_at) VALUES ('stranger@x.dk', now())`);
  assert.equal((await one(db, `SELECT count(*)::int n FROM public.players`)).n, before);
});

test('helpers: member, admin needs fresh aal2+totp', async () => {
  const db = await productionDb(); await run(db, REAL());
  const q = async c => { await as(db, c); const r = await one(db, `SELECT private.current_player() p, private.is_member() m, private.is_admin() a`); await as(db, null); return r; };
  const m = await persona(db, { playerId: 2 });
  assert.deepEqual(Object.values(await q(m)).map(String), ['2', 'true', 'false']);
  const aFresh = await persona(db, { playerId: 1, admin: true, aal: 'aal2', totpAgeSec: 60 });
  assert.equal((await q(aFresh)).a, true);
  assert.equal((await q({ ...aFresh, aal: 'aal1' })).a, false, 'no second factor');
  assert.equal((await q({ ...aFresh, amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) - 13 * 3600 }] })).a, false, 'older than 12 h');
  assert.equal((await q(null)).m, false);
});
```

- [ ] **Step 2: Run** — `node --test phase2a.test.mjs` → FAIL: ENOENT `phase2a_auth.sql`.

- [ ] **Step 3: Create `supabase/phase2a_auth.sql`**

```sql
-- Royal Golf Club — Phase 2 release A: real login, permissions for logged-in users, audit log
-- Spec: docs/superpowers/specs/2026-09-24-phase2-auth-design.md
-- Run in the Supabase SQL Editor (project qvjybtcbymexheqrjkai). REHEARSAL FIRST: with the switch on
-- `true` the script does everything, then fails on purpose with the report — which undoes it all.
-- Real run: `false`, then push the app at once (the gate refuses version 2 from here).
-- The old PIN route (public key) keeps working until release B.

BEGIN;
CREATE TEMP TABLE p2_mode ON COMMIT DROP AS SELECT true AS rehearsal;   -- ◀◀ THE SWITCH
CREATE TEMP TABLE p2_report (ord serial, line text) ON COMMIT DROP;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='players' AND column_name='user_id') THEN
    RAISE EXCEPTION 'Phase 2 release A has already been applied (players.user_id exists). Nothing was changed.';
  END IF;
END $$;

-- ===== SECTION 1: identity ================================================================
ALTER TABLE public.players ADD COLUMN user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;
GRANT SELECT (user_id) ON public.players TO anon, authenticated;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;

-- The signed-in player (active only), and the same including archived (for audit attribution).
CREATE FUNCTION private.current_player() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
  $$ SELECT id FROM public.players WHERE user_id = auth.uid() AND archived_at IS NULL $$;
CREATE FUNCTION private.acting_player() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
  $$ SELECT id FROM public.players WHERE user_id = auth.uid() $$;
CREATE FUNCTION private.is_member() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
  $$ SELECT EXISTS (SELECT 1 FROM public.players WHERE user_id = auth.uid() AND approved IS NOT FALSE AND archived_at IS NULL) $$;
-- Admin mode: an admin who has entered their authenticator code in the last 12 hours.
CREATE FUNCTION private.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.players WHERE user_id = auth.uid() AND is_admin AND approved IS NOT FALSE AND archived_at IS NULL)
     AND coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) e
                 WHERE e ->> 'method' = 'totp' AND (e ->> 'timestamp')::numeric >= extract(epoch FROM now()) - 43200) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO authenticated;

-- Link a confirmed login to its player (existing member, matched by email), or create the pending
-- player for a new sign-up. Never blocks a login: any error becomes a warning.
CREATE FUNCTION private.link_login() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pid bigint; m jsonb := coalesce(NEW.raw_user_meta_data, '{}'::jsonb);
BEGIN
  IF NEW.email_confirmed_at IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.email_confirmed_at IS NOT NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.players WHERE user_id = NEW.id) THEN RETURN NEW; END IF;
  SELECT id INTO pid FROM public.players
   WHERE lower(email) = lower(NEW.email) AND user_id IS NULL AND archived_at IS NULL ORDER BY id LIMIT 1;
  IF pid IS NOT NULL THEN
    UPDATE public.players SET user_id = NEW.id WHERE id = pid;
    PERFORM private.audit('login_set_up', pid, NULL, pid);
  ELSIF m ? 'name' AND NOT EXISTS (SELECT 1 FROM public.players WHERE lower(email) = lower(NEW.email)) THEN
    INSERT INTO public.players (name, email, dgu_number, color, handicap, hcp_history, approved, user_id)
    VALUES (left(m ->> 'name', 60), NEW.email, left(m ->> 'dgu_number', 20), coalesce((m ->> 'color')::int, 0),
            nullif(m ->> 'handicap', '')::numeric,
            CASE WHEN nullif(m ->> 'handicap', '') IS NULL THEN '[]'::jsonb
                 ELSE jsonb_build_array(jsonb_build_object('date', to_char(now() AT TIME ZONE 'Europe/Copenhagen', 'YYYY-MM-DD'),
                                        'value', (m ->> 'handicap')::numeric, 'note', 'Sign-up entry')) END,
            false, NEW.id)
    RETURNING id INTO pid;
    PERFORM private.audit('signed_up', pid, NULL, pid);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'link_login: %', SQLERRM; RETURN NEW;
END $$;
CREATE TRIGGER link_login AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.link_login();

-- ===== CHECKS =============================================================================
DO $$ BEGIN
  INSERT INTO p2_report(line) VALUES ('players.user_id added; linked so far: ' || (SELECT count(*) FROM public.players WHERE user_id IS NOT NULL));
  INSERT INTO p2_report(line) VALUES ('ALL CHECKS PASSED');
END $$;

DO $$ BEGIN
  IF (SELECT rehearsal FROM p2_mode) THEN
    RAISE EXCEPTION E'REHEARSAL OK — everything was rolled back. Report:\n%', (SELECT string_agg(line, E'\n' ORDER BY ord) FROM p2_report);
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS private.phase2a_report AS SELECT ord, line FROM p2_report;
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
COMMIT;
SELECT line FROM private.phase2a_report ORDER BY ord;
```

`private.audit` is created in Task 3; until then add this placeholder **inside SECTION 1, before `link_login`** so the file runs, and Task 3 replaces it:

```sql
CREATE FUNCTION private.audit(p_action text, p_target bigint, p_details jsonb, p_actor bigint DEFAULT NULL) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$ SELECT NULL::void $$;
```

- [ ] **Step 4: Run** — `node --test` → all pass.
- [ ] **Step 5: Commit** — `git add supabase/phase2a_auth.sql tests/sql/phase2a.test.mjs && git commit -m "feat(db): Phase 2A identity — link logins to players, helpers, rehearsal"`

---

### Task 3: SQL — protected fields, audit log, money trail

**Files:** Modify `supabase/phase2a_auth.sql` (new SECTION 2 above `-- ===== CHECKS`; replace the `private.audit` placeholder); test append.

**Interfaces — Produces:** `public.audit_log`; `private.audit(action, target, details, actor)`; `public.log_admin_mode() → boolean`; triggers `protect_player_fields` (BEFORE UPDATE players), `audit_players`, `audit_payments`, `audit_fines`, `audit_auth_users` (AFTER UPDATE auth.users), `audit_mfa` (AFTER INSERT OR UPDATE auth.mfa_factors).

- [ ] **Step 1: Write the failing tests** (append)

```js
const audits = async db => (await db.query(`SELECT action, actor_player_id a, target_player_id t, details d FROM public.audit_log ORDER BY id`)).rows;

test('a member cannot change protected fields; an admin in admin mode can, and it is logged', async () => {
  const db = await productionDb(); await run(db, REAL());
  const m = await persona(db, { playerId: 2 });
  await as(db, m);
  await assert.rejects(db.query(`UPDATE public.players SET is_admin=true WHERE id=2`), /admin/i);
  await db.query(`UPDATE public.players SET name='Renamed' WHERE id=2`);           // own profile field: fine
  const a = await persona(db, { playerId: 1, admin: true, aal: 'aal2', totpAgeSec: 60 });
  await as(db, a);
  await db.query(`UPDATE public.players SET is_admin=true WHERE id=2`);
  await as(db, null); await db.exec('RESET ROLE');
  assert.deepEqual((await audits(db)).filter(x => x.action === 'admin_granted').map(x => [Number(x.a), Number(x.t)]), [[1, 2]]);
});

test('the old PIN route (public key) is unchanged at release A', async () => {
  const db = await productionDb(); await run(db, REAL());
  await as(db, null);
  await db.query(`UPDATE public.players SET approved=true WHERE id=2`);           // no token: passes, as today
});

test('money trail: payments recorded/deleted and fines deleted are logged', async () => {
  const db = await productionDb(); await run(db, REAL());
  const a = await persona(db, { playerId: 1, admin: true, aal: 'aal2', totpAgeSec: 60 });
  await as(db, a);
  const pay = (await one(db, `INSERT INTO public.fine_payments(player_id, amount, date, recorded_by) VALUES (2, 50, '2026-10-01', 1) RETURNING id`)).id;
  await db.query(`DELETE FROM public.fine_payments WHERE id=$1`, [pay]);
  const f = (await one(db, `SELECT id FROM public.fines ORDER BY id LIMIT 1`)).id;
  await db.query(`DELETE FROM public.fines WHERE id=$1`, [f]);
  await as(db, null); await db.exec('RESET ROLE');
  const acts = (await audits(db)).map(x => x.action);
  assert.deepEqual(acts.filter(x => /payment|fine/.test(x)), ['payment_recorded', 'payment_deleted', 'fine_deleted']);
  assert.equal((await audits(db)).find(x => x.action === 'payment_recorded').d.amount, 50);
});

test('auth events are logged without email addresses or IPs', async () => {
  const db = await productionDb(); await run(db, REAL());
  const m = await persona(db, { playerId: 2 });
  await db.query(`UPDATE auth.users SET recovery_sent_at=now() WHERE id=$1`, [m.sub]);
  await db.query(`UPDATE auth.users SET encrypted_password='x' WHERE id=$1`, [m.sub]);
  await db.query(`UPDATE auth.users SET last_sign_in_at=now() WHERE id=$1`, [m.sub]);
  await db.query(`UPDATE auth.users SET email='new@x.dk' WHERE id=$1`, [m.sub]);
  await db.query(`INSERT INTO auth.mfa_factors(user_id, factor_type, status) VALUES ($1,'totp','verified')`, [m.sub]);
  const rows = await audits(db);
  for (const act of ['login_set_up', 'reset_requested', 'password_changed', 'login', 'email_changed', 'mfa_enrolled'])
    assert.ok(rows.some(r => r.action === act && Number(r.t) === 2), act);
  assert.ok(!JSON.stringify(rows).includes('@'), 'no email addresses in the log');
});

test('an audit failure never blocks a login', async () => {
  const db = await productionDb(); await run(db, REAL());
  await db.exec(`ALTER TABLE public.audit_log ADD CONSTRAINT boom CHECK (false)`);
  const u = (await one(db, `INSERT INTO auth.users(email) VALUES ('x@x.dk') RETURNING id`)).id;
  await db.query(`UPDATE auth.users SET email_confirmed_at=now(), last_sign_in_at=now() WHERE id=$1`, [u]);   // must not throw
});

test('log_admin_mode logs only for a real admin in admin mode', async () => {
  const db = await productionDb(); await run(db, REAL());
  const m = await persona(db, { playerId: 2 });
  const a = await persona(db, { playerId: 1, admin: true, aal: 'aal2', totpAgeSec: 60 });
  await as(db, m); assert.equal((await one(db, `SELECT public.log_admin_mode() r`)).r, false);
  await as(db, a); assert.equal((await one(db, `SELECT public.log_admin_mode() r`)).r, true);
  await as(db, null); await db.exec('RESET ROLE');
  assert.equal((await audits(db)).filter(x => x.action === 'admin_mode_unlocked').length, 1);
});

test('entries older than 12 months are trimmed on the next insert', async () => {
  const db = await productionDb(); await run(db, REAL());
  await db.query(`INSERT INTO public.audit_log(at, action) VALUES (now() - interval '13 months', 'old')`);
  await db.query(`SELECT private.audit('new', NULL, NULL)`);
  assert.deepEqual((await audits(db)).map(x => x.action).filter(x => x === 'old' || x === 'new'), ['new']);
});

test('members cannot read or write the audit log', async () => {
  const db = await productionDb(); await run(db, REAL());
  const m = await persona(db, { playerId: 2 });
  await as(db, m);
  assert.equal((await db.query(`SELECT * FROM public.audit_log`)).rows.length, 0);
  await assert.rejects(db.query(`INSERT INTO public.audit_log(action) VALUES ('forged')`));
});
```

- [ ] **Step 2: Run** → FAIL (no `audit_log`).

- [ ] **Step 3: Implement.** Delete the `private.audit` placeholder from SECTION 1 and insert **SECTION 2** directly **after the `CREATE SCHEMA … GRANT USAGE ON SCHEMA private` lines** (the audit function must exist before `link_login`):

```sql
-- ===== SECTION 2: audit log ================================================================
CREATE TABLE public.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor_player_id bigint REFERENCES public.players(id) ON UPDATE CASCADE ON DELETE SET NULL,
  action text NOT NULL,
  target_player_id bigint REFERENCES public.players(id) ON UPDATE CASCADE ON DELETE SET NULL,
  details jsonb);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_log FROM anon, authenticated;
GRANT SELECT ON public.audit_log TO authenticated;

-- The only writer. Also trims entries older than 12 months (no scheduler to fail quietly).
-- Never raises: a failure to log must not break what is being logged.
CREATE FUNCTION private.audit(p_action text, p_target bigint, p_details jsonb, p_actor bigint DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.audit_log (actor_player_id, action, target_player_id, details)
  VALUES (coalesce(p_actor, private.acting_player()), p_action, p_target, p_details);
  DELETE FROM public.audit_log WHERE at < now() - interval '12 months';
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'audit(%): %', p_action, SQLERRM;
END $$;

-- Members change only their own profile fields; status fields need admin mode. Requests without a
-- login token (the old PIN route) pass unchanged until release B.
CREATE FUNCTION private.protect_player_fields() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR private.is_admin() THEN RETURN NEW; END IF;
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin OR NEW.approved IS DISTINCT FROM OLD.approved
     OR NEW.is_social IS DISTINCT FROM OLD.is_social OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
     OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.legacy_id IS DISTINCT FROM OLD.legacy_id THEN
    RAISE EXCEPTION 'Only an admin in admin mode can change that.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_player_fields BEFORE UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION private.protect_player_fields();

CREATE FUNCTION private.audit_players() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    PERFORM private.audit(CASE WHEN NEW.is_admin THEN 'admin_granted' ELSE 'admin_removed' END, NEW.id, NULL); END IF;
  IF NEW.approved IS TRUE AND OLD.approved IS FALSE THEN PERFORM private.audit('approved', NEW.id, NULL); END IF;
  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    PERFORM private.audit(CASE WHEN NEW.archived_at IS NULL THEN 'restored' ELSE 'archived' END, NEW.id, NULL); END IF;
  IF NEW.is_social IS DISTINCT FROM OLD.is_social THEN
    PERFORM private.audit('social_changed', NEW.id, jsonb_build_object('is_social', NEW.is_social)); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER audit_players AFTER UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION private.audit_players();

CREATE FUNCTION private.audit_money() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'fine_payments' AND TG_OP = 'INSERT' THEN
    PERFORM private.audit('payment_recorded', NEW.player_id, jsonb_build_object('amount', NEW.amount, 'date', NEW.date)); RETURN NEW;
  ELSIF TG_TABLE_NAME = 'fine_payments' THEN
    PERFORM private.audit('payment_deleted', OLD.player_id, jsonb_build_object('amount', OLD.amount, 'date', OLD.date)); RETURN OLD;
  ELSE
    PERFORM private.audit('fine_deleted', OLD.player_id, jsonb_build_object('amount', OLD.amount, 'date', OLD.date, 'fine_type_id', OLD.fine_type_id)); RETURN OLD;
  END IF;
END $$;
CREATE TRIGGER audit_payments AFTER INSERT OR DELETE ON public.fine_payments FOR EACH ROW EXECUTE FUNCTION private.audit_money();
CREATE TRIGGER audit_fines AFTER DELETE ON public.fines FOR EACH ROW EXECUTE FUNCTION private.audit_money();

-- Login events, from Supabase Auth's own table. Exception-safe: never blocks a login.
CREATE FUNCTION private.audit_auth_users() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pid bigint;
BEGIN
  SELECT id INTO pid FROM public.players WHERE user_id = NEW.id;
  IF NEW.recovery_sent_at IS DISTINCT FROM OLD.recovery_sent_at AND NEW.recovery_sent_at IS NOT NULL THEN PERFORM private.audit('reset_requested', pid, NULL, pid); END IF;
  IF NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password AND OLD.encrypted_password IS NOT NULL THEN PERFORM private.audit('password_changed', pid, NULL, pid); END IF;
  IF NEW.last_sign_in_at IS DISTINCT FROM OLD.last_sign_in_at AND NEW.last_sign_in_at IS NOT NULL THEN PERFORM private.audit('login', pid, NULL, pid); END IF;
  IF NEW.email IS DISTINCT FROM OLD.email THEN PERFORM private.audit('email_changed', pid, NULL, pid); END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'audit_auth_users: %', SQLERRM; RETURN NEW;
END $$;
CREATE TRIGGER audit_auth_users AFTER UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION private.audit_auth_users();

CREATE FUNCTION private.audit_mfa() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pid bigint;
BEGIN
  IF NEW.status = 'verified' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'verified') THEN
    SELECT id INTO pid FROM public.players WHERE user_id = NEW.user_id;
    PERFORM private.audit('mfa_enrolled', pid, NULL, pid);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'audit_mfa: %', SQLERRM; RETURN NEW;
END $$;
CREATE TRIGGER audit_mfa AFTER INSERT OR UPDATE OF status ON auth.mfa_factors FOR EACH ROW EXECUTE FUNCTION private.audit_mfa();

-- Called by the app right after the authenticator code is accepted; logs only if the caller's own
-- token really is in admin mode.
CREATE FUNCTION public.log_admin_mode() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_admin() THEN RETURN false; END IF;
  PERFORM private.audit('admin_mode_unlocked', private.current_player(), NULL);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.log_admin_mode() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_admin_mode() TO authenticated;
```

Add the audit_log read policy in Task 4 (`audit_admin_read`). Append to CHECKS: `INSERT INTO p2_report(line) SELECT 'audit triggers: ' || count(*) FROM information_schema.triggers WHERE trigger_name IN ('protect_player_fields','audit_players','audit_payments','audit_fines','audit_auth_users','audit_mfa','link_login');` and raise if it is not 7.

- [ ] **Step 4: Run** → all pass. (The members-cannot-read test passes only after Task 4's policy exists — until then RLS is on with no policy, so it already returns 0 rows: correct.)
- [ ] **Step 5: Commit** — `git commit -am "feat(db): Phase 2A audit log, money trail, protected player fields"`

---

### Task 4: SQL — permission rules, draw function, admin emails, gate 3

**Files:** Modify `supabase/phase2a_auth.sql` (SECTION 3 above `-- ===== CHECKS`); create `tests/sql/rls.test.mjs`.

**Interfaces — Produces:** policies `p2_*` `TO authenticated`; `anon_all` narrowed to `TO anon`; `public.run_draw(p_date text, p_tee_times jsonb, p_alloc jsonb) → jsonb`; `public.admin_member_emails() → table(player_id bigint, name text, email text, linked boolean)`; gate minimum 3.

- [ ] **Step 1: Write the failing test** — `tests/sql/rls.test.mjs`

```js
import test from 'node:test'; import assert from 'node:assert/strict';
import { productionDb, as, persona, run, sqlFile } from './testbed.mjs';
const REAL = () => sqlFile('phase2a_auth.sql').replace('SELECT true AS rehearsal', 'SELECT false AS rehearsal');

async function world() {
  const db = await productionDb(); assert.equal(await run(db, REAL()), null);
  await db.exec('RESET ROLE');
  await db.query(`UPDATE public.players SET approved=false WHERE id=5`);                      // a pending player
  const P = {
    anon: null,
    pending: await persona(db, { playerId: 5 }),
    member: await persona(db, { playerId: 2 }),
    adminNo2fa: await persona(db, { playerId: 1, admin: true }),
    admin: null, adminStale: null,
  };
  P.admin = { ...P.adminNo2fa, aal: 'aal2', amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) - 60 }] };
  P.adminStale = { ...P.admin, amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) - 13 * 3600 }] };
  return { db, P };
}
const tryQ = async (db, sql, p) => { try { const r = await db.query(sql, p); return r.affectedRows ?? r.rows.length; } catch (e) { return 'denied'; } };
const rows = async (db, sql) => (await db.query(sql)).rows.length;

// [who, what, sql, expectation]: a number = rows seen/affected; 'denied' = refused; '>0' = some rows.
const MATRIX = [
  ['anon',       'read players (PIN route, A)',  `SELECT id FROM public.players`, '>0'],
  ['pending',    'read players',                 `SELECT id FROM public.players`, 1],
  ['member',     'read players',                 `SELECT id FROM public.players`, '>0'],
  ['member',     'update another player',        `UPDATE public.players SET name='x' WHERE id=3`, 0],
  ['member',     'update own profile',           `UPDATE public.players SET name='Me' WHERE id=2`, 1],
  ['member',     'insert a round for group mate', `INSERT INTO public.rounds(player_id,date,holes) VALUES (3,'2026-10-10','[]')`, 1],
  ['pending',    'insert round for someone else', `INSERT INTO public.rounds(player_id,date,holes) VALUES (3,'2026-10-10','[]')`, 'denied'],
  ['pending',    'insert own round',             `INSERT INTO public.rounds(player_id,date,holes) VALUES (5,'2026-10-10','[]')`, 1],
  ['member',     'delete someone else round',    `DELETE FROM public.rounds WHERE player_id=3`, 0],
  ['admin',      'delete someone else round',    `DELETE FROM public.rounds WHERE id=(SELECT min(id) FROM public.rounds WHERE player_id=3)`, 1],
  ['member',     'issue a fine',                 `INSERT INTO public.fines(player_id,fine_type_id,date,issued_by,amount) VALUES (3,1,'2026-10-10',2,10)`, 1],
  ['member',     'delete a fine',                `DELETE FROM public.fines WHERE id=1`, 0],
  ['member',     'record a payment',             `INSERT INTO public.fine_payments(player_id,amount,date,recorded_by) VALUES (3,10,'2026-10-10',2)`, 'denied'],
  ['adminNo2fa', 'record a payment',             `INSERT INTO public.fine_payments(player_id,amount,date,recorded_by) VALUES (3,10,'2026-10-10',1)`, 'denied'],
  ['adminStale', 'record a payment',             `INSERT INTO public.fine_payments(player_id,amount,date,recorded_by) VALUES (3,10,'2026-10-10',1)`, 'denied'],
  ['admin',      'record a payment',             `INSERT INTO public.fine_payments(player_id,amount,date,recorded_by) VALUES (3,10,'2026-10-10',1)`, 1],
  ['member',     'add a fine type',              `INSERT INTO public.fine_types(name,amount) VALUES ('x',10)`, 'denied'],
  ['member',     'sign self up',                 `INSERT INTO public.saturday_signups(player_id,date) VALUES (2,'2026-10-10')`, 1],
  ['member',     'sign someone else up',         `INSERT INTO public.saturday_signups(player_id,date) VALUES (3,'2026-10-10')`, 'denied'],
  ['member',     'write saturday_events directly', `INSERT INTO public.saturday_events(date,locked) VALUES ('2026-10-10',true)`, 'denied'],
  ['member',     'read GPS shots',               `SELECT id FROM public.gps_shots WHERE player_id<>2`, 0],
  ['admin',      'read GPS shots',               `SELECT id FROM public.gps_shots`, '>0'],
  ['member',     'update a tournament match',    `UPDATE public.tournaments SET status=status`, '>0'],
  ['member',     'assign tournament players',    `INSERT INTO public.tournament_players(tournament_id,player_id,team) VALUES (1,2,'a')`, 'denied'],
  ['member',     'edit tees',                    `UPDATE public.tees SET name=name`, 0],
  ['member',     'read audit log',               `SELECT id FROM public.audit_log`, 0],
  ['admin',      'read audit log',               `SELECT id FROM public.audit_log`, '>0'],
  ['member',     'delete a player',              `DELETE FROM public.players WHERE id=5`, 0],
  ['admin',      'delete a pending player',      `DELETE FROM public.players WHERE id=5 AND approved=false`, 'denied-or-1'],
];

for (const [who, what, sql, want] of MATRIX) {
  test(`${who}: ${what} → ${want}`, async () => {
    const { db, P } = await world();
    await as(db, P[who]);
    const got = await tryQ(db, sql);
    if (want === '>0') assert.ok(typeof got === 'number' && got > 0, `got ${got}`);
    else if (want === 'denied-or-1') assert.ok(got === 1 || got === 'denied', `got ${got}`); // pending player 5 has rounds from the snapshot → RESTRICT
    else assert.equal(got, want);
  });
}

test('run_draw: a member can draw once; a second call and a partial allocation are refused', async () => {
  const { db, P } = await world();
  await db.exec('RESET ROLE');
  await db.query(`INSERT INTO public.saturday_signups(player_id,date) VALUES (2,'2026-10-10'),(3,'2026-10-10')`);
  const ids = (await db.query(`SELECT id FROM public.saturday_signups WHERE date='2026-10-10' ORDER BY id`)).rows.map(r => Number(r.id));
  const alloc = ids.map((id, i) => ({ id, tee_time: '08:30', group_num: 1 }));
  await as(db, P.member);
  const bad = (await db.query(`SELECT public.run_draw('2026-10-10', '["08:30"]', $1) r`, [JSON.stringify(alloc.slice(0, 1))])).rows[0].r;
  assert.equal(bad.ok, false);
  const ok = (await db.query(`SELECT public.run_draw('2026-10-10', '["08:30"]', $1) r`, [JSON.stringify(alloc)])).rows[0].r;
  assert.equal(ok.ok, true);
  const again = (await db.query(`SELECT public.run_draw('2026-10-10', '["08:30"]', $1) r`, [JSON.stringify(alloc)])).rows[0].r;
  assert.equal(again.ok, false);
});

test('admin_member_emails: admin mode only, flags who has not moved over', async () => {
  const { db, P } = await world();
  await as(db, P.member);
  await assert.rejects(db.query(`SELECT * FROM public.admin_member_emails()`));
  await as(db, P.admin);
  const r = (await db.query(`SELECT * FROM public.admin_member_emails()`)).rows;
  assert.ok(r.some(x => Number(x.player_id) === 2 && x.linked === true));
  assert.ok(r.some(x => x.linked === false));
});

test('version gate minimum is 3', async () => {
  const { db } = await world();
  await db.exec('RESET ROLE');
  await db.query(`SELECT set_config('request.headers', '{"x-app-version":"2"}', false)`);
  await assert.rejects(db.query(`SELECT public.require_current_app()`), /out of date/);
  await db.query(`SELECT set_config('request.headers', '{"x-app-version":"3"}', false)`);
  await db.query(`SELECT public.require_current_app()`);
});
```

- [ ] **Step 2: Run** — `node --test rls.test.mjs` → most rows FAIL (no policies yet; `run_draw` missing).

- [ ] **Step 3: Implement SECTION 3** (above `-- ===== CHECKS`)

```sql
-- ===== SECTION 3: permission rules for logged-in users ======================================
-- The old PIN route (anon) keeps its allow-all policy until release B; everything below applies to
-- the new login (authenticated). Also covers tables created after enable_rls.sql ran.
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'audit_log' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS anon_all ON public.%I', t);
    EXECUTE format('CREATE POLICY anon_all ON public.%I FOR ALL TO anon USING (true) WITH CHECK (true)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;
-- players keeps Phase 0's column-level SELECT/UPDATE for authenticated as well
REVOKE SELECT, UPDATE ON public.players FROM authenticated;
GRANT SELECT (id, name, color, handicap, hcp_history, created_at, is_admin, approved, is_social, bag,
              dgu_number, archived_at, legacy_id, user_id) ON public.players TO authenticated;
GRANT UPDATE (name, color, handicap, hcp_history, is_admin, approved, is_social, bag, dgu_number,
              email, archived_at) ON public.players TO authenticated;

-- players
CREATE POLICY p2_players_read   ON public.players FOR SELECT TO authenticated USING (private.is_member() OR user_id = auth.uid());
CREATE POLICY p2_players_update ON public.players FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR private.is_admin()) WITH CHECK (user_id = auth.uid() OR private.is_admin());
CREATE POLICY p2_players_insert ON public.players FOR INSERT TO authenticated WITH CHECK (private.is_admin());
CREATE POLICY p2_players_delete ON public.players FOR DELETE TO authenticated USING (private.is_admin() AND approved IS FALSE);
-- rounds: members score for their group; pending players only their own
CREATE POLICY p2_rounds_read  ON public.rounds FOR SELECT TO authenticated USING (private.is_member() OR player_id = private.current_player());
CREATE POLICY p2_rounds_write ON public.rounds FOR INSERT TO authenticated WITH CHECK (private.is_member() OR player_id = private.current_player());
CREATE POLICY p2_rounds_upd   ON public.rounds FOR UPDATE TO authenticated USING (private.is_member() OR player_id = private.current_player()) WITH CHECK (private.is_member() OR player_id = private.current_player());
CREATE POLICY p2_rounds_del   ON public.rounds FOR DELETE TO authenticated USING (player_id = private.current_player() OR private.is_admin());
-- fines
CREATE POLICY p2_fines_read ON public.fines FOR SELECT TO authenticated USING (private.is_member());
CREATE POLICY p2_fines_ins  ON public.fines FOR INSERT TO authenticated WITH CHECK (private.is_member());
CREATE POLICY p2_fines_upd  ON public.fines FOR UPDATE TO authenticated USING (private.is_admin()) WITH CHECK (private.is_admin());
CREATE POLICY p2_fines_del  ON public.fines FOR DELETE TO authenticated USING (private.is_admin());
-- saturday_signups: your own; admins anyone's
CREATE POLICY p2_signups_read  ON public.saturday_signups FOR SELECT TO authenticated USING (private.is_member());
CREATE POLICY p2_signups_write ON public.saturday_signups FOR ALL TO authenticated
  USING (player_id = private.current_player() OR private.is_admin()) WITH CHECK (player_id = private.current_player() OR private.is_admin());
-- gps_shots: location data — own only; admins
CREATE POLICY p2_gps ON public.gps_shots FOR ALL TO authenticated
  USING (player_id = private.current_player() OR private.is_admin()) WITH CHECK (player_id = private.current_player() OR private.is_admin());
-- tournaments: members play (update status/results, enter scores); admins set up and delete
CREATE POLICY p2_tourn_read ON public.tournaments FOR SELECT TO authenticated USING (private.is_member());
CREATE POLICY p2_tourn_upd  ON public.tournaments FOR UPDATE TO authenticated USING (private.is_member()) WITH CHECK (private.is_member());
CREATE POLICY p2_tourn_adm  ON public.tournaments FOR ALL TO authenticated USING (private.is_admin()) WITH CHECK (private.is_admin());
CREATE POLICY p2_tmatch_read ON public.tournament_matches FOR SELECT TO authenticated USING (private.is_member());
CREATE POLICY p2_tmatch_upd  ON public.tournament_matches FOR UPDATE TO authenticated USING (private.is_member()) WITH CHECK (private.is_member());
CREATE POLICY p2_tmatch_adm  ON public.tournament_matches FOR ALL TO authenticated USING (private.is_admin()) WITH CHECK (private.is_admin());
CREATE POLICY p2_tscore_read ON public.tournament_scores FOR SELECT TO authenticated USING (private.is_member());
CREATE POLICY p2_tscore_ins  ON public.tournament_scores FOR INSERT TO authenticated WITH CHECK (private.is_member());
CREATE POLICY p2_tscore_upd  ON public.tournament_scores FOR UPDATE TO authenticated USING (private.is_member()) WITH CHECK (private.is_member());
CREATE POLICY p2_tscore_adm  ON public.tournament_scores FOR DELETE TO authenticated USING (private.is_admin());
-- read by members, written by admins
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['fine_types','fine_payments','saturday_events','tournament_players','tees','green_polygons',
                           'fairway_polygons','fairway_spines','tee_strips','survey_points'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('CREATE POLICY p2_read ON public.%I FOR SELECT TO authenticated USING (private.is_member())', t);
      EXECUTE format('CREATE POLICY p2_admin ON public.%I FOR ALL TO authenticated USING (private.is_admin()) WITH CHECK (private.is_admin())', t);
    END IF;
  END LOOP;
END $$;
-- audit_log: admins read; only private.audit writes
CREATE POLICY p2_audit_read ON public.audit_log FOR SELECT TO authenticated USING (private.is_admin());

-- The Saturday draw: the app computes the fairest allocation (chooseBestDraw); this checks it covers
-- every sign-up for the date exactly once and that the date is not drawn yet, then writes it.
CREATE FUNCTION public.run_draw(p_date text, p_tee_times jsonb, p_alloc jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE want bigint[]; got bigint[]; ev public.saturday_events%ROWTYPE;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT private.is_member() THEN RETURN jsonb_build_object('ok', false, 'reason', 'not a member'); END IF;
  SELECT array_agg(id ORDER BY id) INTO want FROM public.saturday_signups WHERE date = p_date;
  SELECT array_agg((e ->> 'id')::bigint ORDER BY (e ->> 'id')::bigint) INTO got FROM jsonb_array_elements(p_alloc) e;
  IF want IS NULL OR got IS DISTINCT FROM want THEN RETURN jsonb_build_object('ok', false, 'reason', 'allocation does not match the sign-ups'); END IF;
  IF EXISTS (SELECT 1 FROM public.saturday_signups WHERE date = p_date AND group_num IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already drawn'); END IF;
  SELECT * INTO ev FROM public.saturday_events WHERE date = p_date FOR UPDATE;
  IF FOUND AND (ev.locked OR ev.cancelled) THEN RETURN jsonb_build_object('ok', false, 'reason', 'locked or cancelled'); END IF;
  IF FOUND THEN UPDATE public.saturday_events SET locked = true WHERE id = ev.id;
  ELSE INSERT INTO public.saturday_events (date, locked, tee_times) VALUES (p_date, true, p_tee_times); END IF;
  UPDATE public.saturday_signups s SET tee_time = e ->> 'tee_time', group_num = (e ->> 'group_num')::int
    FROM jsonb_array_elements(p_alloc) e WHERE s.id = (e ->> 'id')::bigint;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.run_draw(text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_draw(text, jsonb, jsonb) TO anon, authenticated;   -- anon until release B

-- Members' emails for admins (the Admin tab's move-over list). Admin mode only.
CREATE FUNCTION public.admin_member_emails() RETURNS TABLE (player_id bigint, name text, email text, linked boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_admin() THEN RAISE EXCEPTION 'Admin mode required.' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT p.id, p.name, coalesce(u.email, p.email), p.user_id IS NOT NULL
    FROM public.players p LEFT JOIN auth.users u ON u.id = p.user_id
   WHERE p.approved IS NOT FALSE AND p.archived_at IS NULL ORDER BY p.user_id IS NOT NULL, p.name;
END $$;
REVOKE ALL ON FUNCTION public.admin_member_emails() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_member_emails() TO authenticated;

-- Version gate: this release is version 3.
CREATE OR REPLACE FUNCTION public.require_current_app() RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v text := current_setting('request.headers', true)::json ->> 'x-app-version';
BEGIN
  IF current_user = 'service_role' THEN RETURN; END IF;
  IF coalesce(v, '') !~ '^\d+$' OR v::int < 3 THEN
    RAISE SQLSTATE 'PT426' USING MESSAGE = 'This version of the app is out of date. Please reload the page.';
  END IF;
END $fn$;
```

Append to CHECKS: count `p2_%` policies (report the number; raise if < 30), report `anon_all` policies still `TO anon` count, `version gate: requests need x-app-version >= 3`.

- [ ] **Step 4: Run** — `node --test` → all pass. If a matrix row fails, fix the policy, not the row — unless the row contradicts the spec or the Rulings above.
- [ ] **Step 5: Commit** — `git add supabase/phase2a_auth.sql tests/sql/rls.test.mjs && git commit -m "feat(db): Phase 2A permission rules, run_draw, admin emails, gate 3"`

---

### Task 5: SQL — rollback

**Files:** Create `supabase/phase2a_rollback.sql`; test append to `tests/sql/phase2a.test.mjs`.

- [ ] **Step 1: Failing test**

```js
test('rollback restores release-A-free state and gate 2', async () => {
  const db = await productionDb();
  const before = (await db.query(`SELECT policyname, roles::text FROM pg_policies WHERE schemaname='public' ORDER BY 1,2`)).rows;
  await run(db, REAL());
  assert.equal(await run(db, sqlFile('phase2a_rollback.sql')), null);
  assert.equal((await one(db, `SELECT count(*)::int n FROM information_schema.columns WHERE table_name='players' AND column_name='user_id'`)).n, 0);
  assert.equal((await one(db, `SELECT count(*)::int n FROM pg_policies WHERE policyname LIKE 'p2%'`)).n, 0);
  assert.equal((await one(db, `SELECT count(*)::int n FROM information_schema.triggers WHERE event_object_schema IN ('auth','public') AND trigger_name IN ('link_login','audit_auth_users','audit_mfa')`)).n, 0);
  await db.query(`SELECT set_config('request.headers', '{"x-app-version":"2"}', false)`);
  await db.query(`SELECT public.require_current_app()`);
});
```

- [ ] **Step 2: Run** → FAIL (ENOENT).
- [ ] **Step 3: Write `supabase/phase2a_rollback.sql`**

```sql
-- Royal Golf Club — Phase 2A EMERGENCY ROLLBACK. Removes release A's database objects and returns
-- the gate to 2. The audit log is dropped with it. Redeploy the previous app (git revert of the
-- Phase 2A merge) straight after. Logins created in Supabase Auth stay (harmless; unlinked).
BEGIN;
DROP TRIGGER IF EXISTS link_login ON auth.users;
DROP TRIGGER IF EXISTS audit_auth_users ON auth.users;
DROP TRIGGER IF EXISTS audit_mfa ON auth.mfa_factors;
DROP TRIGGER IF EXISTS protect_player_fields ON public.players;
DROP TRIGGER IF EXISTS audit_players ON public.players;
DROP TRIGGER IF EXISTS audit_payments ON public.fine_payments;
DROP TRIGGER IF EXISTS audit_fines ON public.fines;
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'p2%' LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY IF EXISTS anon_all ON public.%I', r.tablename);
    EXECUTE format('CREATE POLICY anon_all ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', r.tablename);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS public.run_draw(text, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.admin_member_emails();
DROP FUNCTION IF EXISTS public.log_admin_mode();
DROP TABLE IF EXISTS public.audit_log;
ALTER TABLE public.players DROP COLUMN IF EXISTS user_id;
DROP SCHEMA IF EXISTS private CASCADE;
CREATE OR REPLACE FUNCTION public.require_current_app() RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v text := current_setting('request.headers', true)::json ->> 'x-app-version';
BEGIN
  IF current_user = 'service_role' THEN RETURN; END IF;
  IF coalesce(v, '') !~ '^\d+$' OR v::int < 2 THEN
    RAISE SQLSTATE 'PT426' USING MESSAGE = 'This version of the app is out of date. Please reload the page.';
  END IF;
END $fn$;
NOTIFY pgrst, 'reload schema';
COMMIT;
```

- [ ] **Step 4: Run** → pass. **Step 5: Commit** — `git commit -am "feat(db): Phase 2A rollback"` (add the file).

---

### Task 6: App — auth client, token-carrying helpers, the load fix

**Files:** Modify `index.html` (head script tag; Supabase section; `init`, `loginAs`, boot line); create `tests/phase2a.test.js`.

**Interfaces — Produces:** `authClient()` (lazy `supabase.createClient`, `flowType:'pkce'`, `detectSessionInUrl:true`, `persistSession:true`); `let _session`; `hdr()` → headers with the session token when signed in; `boot()`; `startApp()`; `resolveSignedInPlayer()`; `jwtClaims()`; `APP_VERSION=3`.

- [ ] **Step 1: Get the pinned library and its SRI hash**

Run: `curl -s https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/dist/umd/supabase.min.js | openssl dgst -sha384 -binary | openssl base64 -A` → record `sha384-…`.

- [ ] **Step 2: Write the failing tests** — `tests/phase2a.test.js`

```js
// Phase 2A — Supabase Auth login, admin mode, audit panel. supabase-js is stubbed (the CDN is blocked in tests).
setTimeout(async function(){
  const out=[];const T=(n,c,d='')=>out.push((c?'PASS ':'FAIL ')+n+(c?'':' :: '+d));
  const calls=[];let respond=()=>[];
  window.fetch=async(url,opts={})=>{url=String(url);const body=opts.body?JSON.parse(opts.body):null;calls.push({url,method:opts.method||'GET',body,headers:opts.headers});
    const b=respond(url,body,opts.method||'GET');const st=b&&b.__status||200;return{ok:st<400,status:st,json:async()=>b,text:async()=>JSON.stringify(b)};};
  const reset=fn=>{calls.length=0;respond=fn||(()=>[]);};
  // A tiny supabase-js stand-in: records calls, returns scripted results.
  const authCalls=[];let authState={session:null};
  const fakeClient={auth:{
    getSession:async()=>({data:{session:authState.session},error:null}),
    onAuthStateChange:(cb)=>{authState.cb=cb;return{data:{subscription:{unsubscribe(){}}}};},
    signInWithPassword:async a=>{authCalls.push(['signIn',a]);return authState.signIn||{data:{session:null},error:{message:'Invalid login credentials'}};},
    signUp:async a=>{authCalls.push(['signUp',a]);return{data:{},error:null};},
    resetPasswordForEmail:async(e,o)=>{authCalls.push(['reset',e,o]);return{data:{},error:null};},
    updateUser:async a=>{authCalls.push(['update',a]);return{data:{},error:null};},
    signOut:async()=>{authCalls.push(['signOut']);return{error:null};},
    mfa:{listFactors:async()=>({data:{totp:authState.factors||[]},error:null}),
         enroll:async a=>{authCalls.push(['enroll',a]);return{data:{id:'f1',totp:{qr_code:'<svg/>',secret:'S'}},error:null};},
         challengeAndVerify:async a=>{authCalls.push(['verify',a]);return authState.verify||{data:{},error:null};}}}};
  window.supabase={createClient:()=>fakeClient};
  const now=Math.floor(Date.now()/1000);
  const b64=o=>btoa(JSON.stringify(o)).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
  const token=claims=>'h.'+b64(claims)+'.s';
  const sessionFor=(sub,claims={})=>({access_token:token({sub,aal:'aal1',amr:[{method:'password',timestamp:now}],...claims}),user:{id:sub}});
  window.toast=()=>{};window.setLoading=()=>{};window.alert=m=>{window.__alert=m;};window.confirm=()=>true;
  try{
    // ── Task 6: token, version, load fix ──
    T('APP_VERSION is 3',APP_VERSION===3,String(APP_VERSION));
    _session=sessionFor('u-2');reset(()=>[]);await sbGet('rounds');
    T('signed-in requests send the session token',calls[0].headers.Authorization==='Bearer '+_session.access_token,JSON.stringify(calls[0].headers));
    _session=null;reset(()=>[]);await sbGet('rounds');
    T('signed-out requests send the public key',calls[0].headers.Authorization==='Bearer '+SUPABASE_KEY);
    // boot with a session: render happens once, already as the player
    const rendered=[];const origRenderGrid=renderGrid;window.renderGrid=()=>{rendered.push(document.getElementById('playerName').textContent);};
    authState.session=sessionFor('u-2');
    reset(u=>u.includes('/players?')?[{id:2,name:'Bo',user_id:'u-2',color:0,hcp_history:[],approved:true}]:[]);
    document.getElementById('lockScreen').style.display='flex';
    await boot();
    T('boot with a session resolves the player before the first render',rendered.length>0&&rendered.every(n=>n==='Bo'),JSON.stringify(rendered));
    T('lock screen hidden only after start-up',document.getElementById('lockScreen').style.display==='none');
    T('the active player is the signed-in player',activeId===2,String(activeId));
    window.renderGrid=origRenderGrid;
    // ── end ──
  }catch(e){out.push('FAIL EXCEPTION :: '+e.stack);}
  await new Promise(r=>setTimeout(r,150));
  const pre=document.createElement('pre');pre.id='RESULT';pre.textContent=out.join('\n');document.body.innerHTML='';document.body.appendChild(pre);
},400);
```

- [ ] **Step 3: Run** — `powershell -File tests/run.ps1 -Test tests/phase2a.test.js` → FAIL (`APP_VERSION` is 2).

- [ ] **Step 4: Implement**

In `<head>`, before the app's `<script>`:

```html
<!-- Supabase Auth (login, sessions, resets, two-factor). Pinned; the integrity hash fails closed if the file changes. -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/dist/umd/supabase.min.js" integrity="sha384-<HASH FROM STEP 1>" crossorigin="anonymous"></script>
```

Replace the `APP_VERSION`/`H`/`sbCheck` block (keep `forceReload`, `PLAYER_COLS`, `sbSel`, `activePlayers`) with:

```js
// Version gate: bump together with public.require_current_app() and course-mapper.html.
const APP_VERSION=3;
const SITE_URL='https://gridsystems.github.io/RoyalGolfLeague/';
const H={'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY,'x-app-version':String(APP_VERSION)};
// Supabase Auth, used only for login. The data helpers below stay plain fetch calls; when someone is
// signed in they carry that person's token, so the database's permission rules know who is asking.
let _auth=null,_session=null;
function authClient(){
  if(!_auth){_auth=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{flowType:'pkce',detectSessionInUrl:true,persistSession:true,autoRefreshToken:true}});
    _auth.auth.onAuthStateChange((event,session)=>{_session=session;if(event==='PASSWORD_RECOVERY')showLockPanel('lockNewPwPanel');});}
  return _auth;
}
function hdr(extra){return{...H,...(_session?{Authorization:'Bearer '+_session.access_token}:{}),...(extra||{})};}
// The signed-in token's claims (aal, amr) — used for admin mode; the database checks the same.
function jwtClaims(){try{return JSON.parse(atob(_session.access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}catch(e){return{};}}
```

In all six `sb*` helpers replace `headers:H` with `headers:hdr()` and `headers:{...H,'Prefer':'return=representation'}` with `headers:hdr({'Prefer':'return=representation'})`.

Boot and load fix — replace `loginAs` and the final boot line:

```js
async function loginAs(p){                       // old PIN route (removed in release B)
  localStorage.setItem('sl_active_player',p.id);
  sessionStorage.setItem('sl_session_player',p.id);
  await init();                                   // init reveals the app once the player is resolved
}
// Start-up. Nothing is shown as "nobody": the lock screen (or loading) stays up until the session,
// the data and the player are all resolved, then the app appears once, already as you.
async function boot(){
  let session=null;
  try{session=(await authClient().auth.getSession()).data.session;}catch(e){/* login service unreachable: old route still works */}
  _session=session;
  if(session){await startApp();return;}
  if(sessionStorage.getItem('sl_session_player')){await init();return;}
  setLoading(false);showLockPanel('lockLoginPanel');
}
async function startApp(){
  await init();
}
```

In `init()`: move `document.getElementById('lockScreen').style.display='none';` to the **end** of `init` (after the player is restored and `updateAdminUI()`), and move the block

```js
  // Restore last selected player
  const savedId=…
```

**above** `populateYearSelects();renderTodayLb();renderGrid();`, and before it insert:

```js
  if(_session){const me=players.find(p=>p.user_id===_session.user.id)||pendingPlayers.find(p=>p.user_id===_session.user.id);
    if(!me){setLoading(false);showLockPanel('lockUnlinkedPanel');return;}
    localStorage.setItem('sl_active_player',me.id);}
```

Add `user_id` to `PLAYER_COLS`. Replace the last line of the script (`if(sessionStorage.getItem('sl_session_player')){…}`) with `boot();`.

- [ ] **Step 5: Run** — phase2a, phase1, phase0 suites all pass (phase0/phase1 tests that assumed the old boot may need `window.supabase` absent → `boot()` catches and falls back; fix tests only where they asserted the old boot text).
- [ ] **Step 6: Commit** — `git commit -am "feat: Supabase Auth client, token-carrying helpers, render once as the player"`

---

### Task 7: App — login screens: password login, set-up, sign-up, forgot password, sign out, email change

**Files:** Modify `index.html` (lock screen HTML; login functions; My Profile); test append.

**Interfaces — Produces:** `showLockPanel(id)`; `submitPasswordLogin()`, `submitSetup()`, `submitSignup()` (rewritten), `submitForgot()`, `submitNewPassword()`, `signOut()`, `submitEmailChange()`, `handleAuthRedirectError()`; panels `lockLoginPanel` (password), `lockPinPanel` (old), `lockSetupPanel`, `lockForgotPanel`, `lockNewPwPanel`, `lockCheckEmailPanel`, `lockUnlinkedPanel`, `lockSignupPanel`, `lockPayPanel`.

- [ ] **Step 1: Failing tests** (append before `// ── end ──`)

```js
    // ── Task 7: login flows ──
    const field=(id,v)=>{document.getElementById(id).value=v;};
    const shown=id=>document.getElementById(id).style.display!=='none';
    showLockPanel('lockLoginPanel');
    field('loginEmail','a@b.dk');field('loginPassword','short');authCalls.length=0;await submitPasswordLogin();
    T('login: wrong password shows a neutral error',shown('loginError')&&/email or password/i.test(document.getElementById('loginError').textContent));
    authState.signIn={data:{session:sessionFor('u-2')},error:null};reset(u=>u.includes('/players?')?[{id:2,name:'Bo',user_id:'u-2',color:0,hcp_history:[],approved:true}]:[]);
    field('loginPassword','correct horse');await submitPasswordLogin();
    T('login: success starts the app as the player',activeId===2&&document.getElementById('lockScreen').style.display==='none');
    showLockPanel('lockSetupPanel');field('setupEmail','Bo@X.dk');field('setupPassword','abc');field('setupPassword2','abc');authCalls.length=0;await submitSetup();
    T('set-up: passwords under 8 characters refused',authCalls.length===0&&/8 characters/.test(document.getElementById('setupError').textContent));
    field('setupPassword','longenough1');field('setupPassword2','longenough1');await submitSetup();
    const su=authCalls.find(c=>c[0]==='signUp');
    T('set-up: signs up with the email and redirect, no player metadata',su&&su[1].email==='bo@x.dk'&&su[1].options.emailRedirectTo===SITE_URL&&!(su[1].options.data||{}).name);
    T('set-up: says to open the link on this device',shown('lockCheckEmailPanel')&&/this (phone|device)/i.test(document.getElementById('lockCheckEmailPanel').textContent));
    showLockPanel('lockSignupPanel');['signupName','signupEmail','signupDgu','signupHcp','signupPassword','signupPassword2'].forEach(id=>field(id,''));
    field('signupName','Cy');field('signupEmail','cy@x.dk');field('signupDgu','900-1');field('signupHcp','14.2');field('signupPassword','longenough1');field('signupPassword2','longenough1');
    authCalls.length=0;await submitSignup();
    const sg=authCalls.find(c=>c[0]==='signUp');
    T('sign-up: sends name, DGU, handicap and colour as metadata',sg&&sg[1].options.data.name==='Cy'&&sg[1].options.data.dgu_number==='900-1'&&sg[1].options.data.handicap===14.2&&Number.isInteger(sg[1].options.data.color));
    T('sign-up: never writes to players directly',!calls.some(c=>c.method==='POST'&&c.url.includes('/players')));
    showLockPanel('lockForgotPanel');field('forgotEmail','ghost@x.dk');authCalls.length=0;await submitForgot();
    const rs=authCalls.find(c=>c[0]==='reset');
    T('forgot: sends a reset with the site redirect',rs&&rs[1]==='ghost@x.dk'&&rs[2].redirectTo===SITE_URL);
    T('forgot: neutral message',/if that address belongs to a member/i.test(document.getElementById('lockCheckEmailPanel').textContent));
    showLockPanel('lockNewPwPanel');field('newPassword','longenough2');field('newPassword2','longenough2');authCalls.length=0;await submitNewPassword();
    T('new password: updates the password',authCalls.some(c=>c[0]==='update'&&c[1].password==='longenough2'));
    history.replaceState(null,'','?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid');
    handleAuthRedirectError();
    T('a failed or wrong-device link explains itself',shown('loginError')&&/same (phone|device)|expired/i.test(document.getElementById('loginError').textContent));
    history.replaceState(null,'',location.pathname);
    authCalls.length=0;await signOut();
    T('sign out calls Supabase and clears the session',authCalls.some(c=>c[0]==='signOut')&&_session===null);
```

- [ ] **Step 2: Run** → FAIL (`showLockPanel` missing).

- [ ] **Step 3: Implement.** Replace the lock screen's panels (keep the header lines and `lockPayPanel`):

```html
    <!-- Password login -->
    <div id="lockLoginPanel">
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:1rem;text-align:left">
        <div class="fgi"><label>Email</label><input type="email" id="loginEmail" autocomplete="email" maxlength="100" onkeydown="if(event.key==='Enter')submitPasswordLogin()"></div>
        <div class="fgi"><label>Password</label><input type="password" id="loginPassword" autocomplete="current-password" maxlength="100" onkeydown="if(event.key==='Enter')submitPasswordLogin()"></div>
        <div id="loginError" style="color:#f08080;font-size:0.78rem;display:none"></div>
      </div>
      <button class="btn btn-primary" style="width:100%" onclick="submitPasswordLogin()">Sign in</button>
      <div style="margin-top:0.9rem;font-size:0.8rem"><span class="lock-link" onclick="showLockPanel('lockForgotPanel')">Forgot password?</span></div>
      <div style="margin-top:1rem;font-size:0.8rem;color:rgba(240,213,140,0.5)">First time on the new login? <span class="lock-link" onclick="showLockPanel('lockSetupPanel')">Set it up</span></div>
      <div style="margin-top:0.4rem;font-size:0.8rem;color:rgba(240,213,140,0.5)">New here? <span class="lock-link" onclick="showLockPanel('lockSignupPanel')">Sign up</span></div>
      <div style="margin-top:0.9rem;font-size:0.7rem"><span class="lock-link" style="opacity:0.6" onclick="showLockPanel('lockPinPanel')">Use my old PIN</span></div>
    </div>
    <!-- Old PIN login (removed in release B) -->
    <div id="lockPinPanel" style="display:none">
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:1rem;text-align:left">
        <div class="fgi"><label>Email</label><input type="email" id="pinEmail" placeholder="your@email.com" maxlength="100" onkeydown="if(event.key==='Enter')submitEmailPin()"></div>
        <div class="fgi"><label>PIN</label><input type="password" id="loginPin" placeholder="••••" maxlength="4" inputmode="numeric" pattern="[0-9]*" onkeydown="if(event.key==='Enter')submitEmailPin()"></div>
        <div id="pinLoginError" style="color:#f08080;font-size:0.78rem;display:none"></div>
      </div>
      <button class="btn btn-primary" style="width:100%" onclick="submitEmailPin()">Enter with PIN</button>
      <div style="margin-top:1rem;font-size:0.8rem"><span class="lock-link" onclick="showLockPanel('lockLoginPanel')">← Back</span></div>
    </div>
    <div id="lockSetupPanel" style="display:none">
      <div style="font-size:0.82rem;color:rgba(255,255,255,0.55);margin-bottom:1rem;text-align:left">Use the email the league has on file. Choose a password of at least 8 characters.</div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:1rem;text-align:left">
        <div class="fgi"><label>Email</label><input type="email" id="setupEmail" autocomplete="email" maxlength="100"></div>
        <div class="fgi"><label>New password</label><input type="password" id="setupPassword" autocomplete="new-password" maxlength="100"></div>
        <div class="fgi"><label>Confirm password</label><input type="password" id="setupPassword2" autocomplete="new-password" maxlength="100"></div>
        <div id="setupError" style="color:#f08080;font-size:0.78rem;display:none"></div>
      </div>
      <button class="btn btn-primary" style="width:100%" onclick="submitSetup()">Set up my login</button>
      <div style="margin-top:1rem;font-size:0.8rem"><span class="lock-link" onclick="showLockPanel('lockLoginPanel')">← Back</span></div>
    </div>
    <div id="lockForgotPanel" style="display:none">
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:1rem;text-align:left">
        <div class="fgi"><label>Email</label><input type="email" id="forgotEmail" autocomplete="email" maxlength="100"></div>
      </div>
      <button class="btn btn-primary" style="width:100%" onclick="submitForgot()">Email me a reset link</button>
      <div style="margin-top:1rem;font-size:0.8rem"><span class="lock-link" onclick="showLockPanel('lockLoginPanel')">← Back</span></div>
    </div>
    <div id="lockNewPwPanel" style="display:none">
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:1rem;text-align:left">
        <div class="fgi"><label>New password</label><input type="password" id="newPassword" autocomplete="new-password" maxlength="100"></div>
        <div class="fgi"><label>Confirm password</label><input type="password" id="newPassword2" autocomplete="new-password" maxlength="100"></div>
        <div id="newPwError" style="color:#f08080;font-size:0.78rem;display:none"></div>
      </div>
      <button class="btn btn-primary" style="width:100%" onclick="submitNewPassword()">Save new password</button>
    </div>
    <div id="lockCheckEmailPanel" style="display:none">
      <div id="checkEmailText" style="font-size:0.88rem;color:rgba(255,255,255,0.75);line-height:1.6;margin-bottom:1rem;text-align:left"></div>
      <button class="btn btn-ghost" style="width:100%" onclick="showLockPanel('lockLoginPanel')">Back to sign in</button>
    </div>
    <div id="lockUnlinkedPanel" style="display:none">
      <div style="font-size:0.88rem;color:rgba(255,255,255,0.75);line-height:1.6;margin-bottom:1rem;text-align:left">Your login isn't linked to a player yet. Ask an admin to check the email the league has on file for you, then sign in again.</div>
      <button class="btn btn-ghost" style="width:100%" onclick="signOut()">Sign out</button>
    </div>
```

In `lockSignupPanel` replace the two PIN inputs with `signupPassword` / `signupPassword2` (type password, `autocomplete="new-password"`, label "Password (at least 8 characters)" / "Confirm password"). Add CSS: `.lock-link{color:var(--gold-l);cursor:pointer;text-decoration:underline}`.

Functions (replace `submitSignup`; delete `showLockSignup` duplicate logic by routing through `showLockPanel`; keep `submitEmailPin`/`submitLockSetPin` for the PIN route, pointed at `pinLoginError`):

```js
const LOCK_PANELS=['lockLoginPanel','lockPinPanel','lockSetPinPanel','lockSetupPanel','lockForgotPanel','lockNewPwPanel','lockCheckEmailPanel','lockUnlinkedPanel','lockSignupPanel','lockPayPanel'];
function showLockPanel(id){
  document.getElementById('lockScreen').style.display='flex';
  LOCK_PANELS.forEach(p=>{const el=document.getElementById(p);if(el)el.style.display=p===id?'block':'none';});
  document.querySelectorAll('#lockScreen [id$="Error"]').forEach(e=>e.style.display='none');
}
function lockError(id,msg){const e=document.getElementById(id);e.textContent=msg;e.style.display='block';}
const pwProblem=(a,b)=>!a||a.length<8?'Password must be at least 8 characters.':a!==b?'Passwords do not match.':null;
function checkEmail(text){document.getElementById('checkEmailText').innerHTML=text+'<br><br><strong>Open the link on this phone</strong> (the same device and browser), or it won\'t work.';showLockPanel('lockCheckEmailPanel');}
async function submitPasswordLogin(){
  const email=document.getElementById('loginEmail').value.trim().toLowerCase(),password=document.getElementById('loginPassword').value;
  if(!email||!password){lockError('loginError','Enter your email and password.');return;}
  const {data,error}=await authClient().auth.signInWithPassword({email,password});
  if(error||!data.session){lockError('loginError','Email or password incorrect.');return;}
  _session=data.session;await startApp();
}
async function submitSetup(){
  const email=document.getElementById('setupEmail').value.trim().toLowerCase(),a=document.getElementById('setupPassword').value,b=document.getElementById('setupPassword2').value;
  if(!email.includes('@')){lockError('setupError','Enter a valid email.');return;}
  const p=pwProblem(a,b);if(p){lockError('setupError',p);return;}
  const {error}=await authClient().auth.signUp({email,password:a,options:{emailRedirectTo:SITE_URL}});
  if(error){lockError('setupError',error.message);return;}
  checkEmail('We\'ve sent a confirmation link to <strong>'+email+'</strong>. Click it to finish setting up your login.');
}
async function submitSignup(){
  const v=id=>document.getElementById(id).value.trim();
  const name=v('signupName'),email=v('signupEmail').toLowerCase(),dgu=v('signupDgu'),hcpRaw=v('signupHcp'),a=document.getElementById('signupPassword').value,b=document.getElementById('signupPassword2').value;
  if(!name){lockError('signupError','Please enter your name.');return;}
  if(!email.includes('@')){lockError('signupError','Please enter a valid email.');return;}
  if(!isValidDgu(dgu)){lockError('signupError','Enter your DGU number as digits, a hyphen, then digits — for example 900-1831.');return;}
  const p=pwProblem(a,b);if(p){lockError('signupError',p);return;}
  const handicap=hcpRaw?parseFloat(hcpRaw):null;
  const {error}=await authClient().auth.signUp({email,password:a,options:{emailRedirectTo:SITE_URL,
    data:{name,dgu_number:dgu,handicap,color:Math.floor(Math.random()*COLORS.length)}}});
  if(error){lockError('signupError',error.message);return;}
  checkEmail('Nearly there: we\'ve sent a confirmation link to <strong>'+email+'</strong>. After you click it, your registration waits for admin approval.');
}
async function submitForgot(){
  const email=document.getElementById('forgotEmail').value.trim().toLowerCase();if(!email)return;
  await authClient().auth.resetPasswordForEmail(email,{redirectTo:SITE_URL});
  checkEmail('If that address belongs to a member, a reset link is on its way. It works once and expires in an hour.');
}
async function submitNewPassword(){
  const a=document.getElementById('newPassword').value,b=document.getElementById('newPassword2').value;
  const p=pwProblem(a,b);if(p){lockError('newPwError',p);return;}
  const {error}=await authClient().auth.updateUser({password:a});
  if(error){lockError('newPwError',error.message);return;}
  toast('Password changed ✓');await startApp();
}
// Links that fail (expired, used, or opened on another device — PKCE) come back with ?error=…
function handleAuthRedirectError(){
  const q=new URLSearchParams(location.search+'&'+location.hash.slice(1));
  if(!q.get('error'))return;
  showLockPanel('lockLoginPanel');
  lockError('loginError','That link didn\'t work — it may have expired or been used already, or been opened on a different phone. Request a new one and open it on the same device.');
  history.replaceState(null,'',location.pathname);
}
async function signOut(){
  try{await authClient().auth.signOut();}catch(e){}
  _session=null;sessionStorage.removeItem('sl_session_player');localStorage.removeItem('sl_active_player');
  location.reload();
}
async function submitEmailChange(){
  const email=prompt('New email address');if(!email||!email.includes('@'))return;
  const {error}=await authClient().auth.updateUser({email:email.trim().toLowerCase()});
  if(error){alert('Error: '+error.message);return;}
  toast('Check the new address for a confirmation link');
}
```

In `submitEmailPin` (PIN route) read `pinEmail` instead of `loginEmail` and write errors to `pinLoginError` instead of `loginError`; `showLockLogin()` becomes `showLockPanel('lockPinPanel')`. Update `tests/phase0.test.js` to the same ids (`loginEmail`→`pinEmail`, `loginError`→`pinLoginError`, `showLockLogin()`→`showLockPanel('lockPinPanel')`) — a rename, not a behaviour change; its 27 assertions must still pass.

Call `handleAuthRedirectError();` at the start of `boot()`. In My Profile add, for signed-in users only, buttons **Change email** (`submitEmailChange()`) and **Sign out** (`signOut()`). `signOut`'s `location.reload()` is wrapped as `forceReload()` so tests can stub it: use `forceReload()`.

- [ ] **Step 4: Run** → all pass. **Step 5: Commit** — `git commit -am "feat: password login, set-up, sign-up, forgot password, sign out"`

---

### Task 8: App — admin mode (two-factor, 12 hours), view-as, central retry

**Files:** Modify `index.html` (admin tab button; `isAdmin`; new `adminModeActive`, `requireAdminMode`, MFA modal; `sbCheck` retry; `showPicker`); test append.

**Interfaces — Produces:** `isAdminAccount()` (player flag — shows admin UI); `adminModeActive()`; `requireAdminMode() → Promise<boolean>`; `openAdminTab(btn)`; `withAdminRetry(doFetch)` used inside every `sb*` helper.

- [ ] **Step 1: Failing tests** (append)

```js
    // ── Task 8: admin mode ──
    players=[{id:1,name:'Ann',user_id:'u-1',is_admin:true,color:0,hcp_history:[],approved:true},{id:2,name:'Bo',user_id:'u-2',color:1,hcp_history:[],approved:true}];activeId=1;
    _session=sessionFor('u-1');
    T('password-only admin session is not admin mode',adminModeActive()===false);
    _session=sessionFor('u-1',{aal:'aal2',amr:[{method:'totp',timestamp:now-60}]});
    T('fresh second factor is admin mode',adminModeActive()===true);
    _session=sessionFor('u-1',{aal:'aal2',amr:[{method:'totp',timestamp:now-13*3600}]});
    T('second factor older than 12 hours is not admin mode',adminModeActive()===false);
    // first admin action: enrol + verify, then retry succeeds
    _session=sessionFor('u-1');authState.factors=[];let n=0;
    reset((u,b,m)=>{if(m==='POST'&&u.includes('/fine_types')){n++;return n===1?{__status:403,code:'42501',message:'new row violates row-level security policy'}:[{id:9,name:'x',amount:1}];}if(u.includes('/rpc/log_admin_mode'))return true;return[];});
    const verifyAndUpgrade=async()=>{document.getElementById('mfaCode').value='123456';_session=sessionFor('u-1',{aal:'aal2',amr:[{method:'totp',timestamp:now}]});await submitMfaCode();};
    const p=sbInsert('fine_types',{name:'x',amount:1});
    await new Promise(r=>setTimeout(r,50));
    T('a refused admin action opens the two-factor prompt',document.getElementById('mfaModal').style.display!=='none'&&authCalls.some(c=>c[0]==='enroll'));
    await verifyAndUpgrade();const res=await p;
    T('after the code, the action is retried and succeeds',res&&res[0]&&res[0].id===9&&n===2,`n=${n}`);
    T('admin mode unlock is logged by the database function',calls.some(c=>c.url.includes('/rpc/log_admin_mode')));
    // a member's refused action does not prompt
    activeId=2;_session=sessionFor('u-2');document.getElementById('mfaModal').style.display='none';
    reset(()=>({__status:403,code:'42501',message:'denied'}));let threw=false;try{await sbInsert('fine_types',{name:'y'});}catch(e){threw=true;}
    T('members are refused without a prompt',threw&&document.getElementById('mfaModal').style.display==='none');
    T('admin PIN is gone for signed-in users',typeof openAdminTab==='function'&&!/requireAdminPin/.test(document.getElementById('adminTab').getAttribute('onclick')));
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

MFA modal (next to the other modals):

```html
<div class="modal-bg" id="mfaModal" style="display:none"><div class="modal modal-sm">
  <div class="mt">Admin mode</div>
  <div id="mfaEnroll" style="display:none;font-size:0.82rem;color:rgba(255,255,255,0.6);margin-bottom:0.75rem">Scan this with an authenticator app (Google Authenticator, 1Password…), then enter the 6-digit code.<div id="mfaQr" style="background:#fff;padding:8px;border-radius:8px;margin:0.75rem auto;width:180px"></div></div>
  <div class="fgi"><label>6-digit code</label><input id="mfaCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" onkeydown="if(event.key==='Enter')submitMfaCode()"></div>
  <div id="mfaError" style="color:#f08080;font-size:0.78rem;display:none"></div>
  <div style="display:flex;gap:9px;justify-content:flex-end;margin-top:1rem"><button class="btn btn-ghost btn-sm" onclick="cancelMfa()">Cancel</button><button class="btn btn-primary btn-sm" onclick="submitMfaCode()">Unlock</button></div>
</div></div>
```

Logic:

```js
// Admin mode: an admin's powers need their authenticator code, at most 12 hours old. The database
// enforces this (private.is_admin); this mirrors it so the app can ask before being refused.
const ADMIN_MODE_SECONDS=12*3600;
function isAdminAccount(){return players.find(p=>p.id===activeId)?.is_admin===true;}
function adminModeActive(){
  const c=jwtClaims();if(c.aal!=='aal2')return false;
  return (c.amr||[]).some(m=>m.method==='totp'&&m.timestamp>=Date.now()/1000-ADMIN_MODE_SECONDS);
}
let _mfa=null;   // {factorId, resolve}
async function requireAdminMode(){
  if(!_session)return true;                       // old PIN route: unchanged until release B
  if(adminModeActive())return true;
  const {data}=await authClient().auth.mfa.listFactors();
  let factor=(data.totp||[]).find(f=>f.status==='verified');
  document.getElementById('mfaEnroll').style.display='none';
  if(!factor){const e=await authClient().auth.mfa.enroll({factorType:'totp',friendlyName:'Saturday League'});
    factor={id:e.data.id};document.getElementById('mfaQr').innerHTML=e.data.totp.qr_code;document.getElementById('mfaEnroll').style.display='block';}
  document.getElementById('mfaCode').value='';document.getElementById('mfaError').style.display='none';
  document.getElementById('mfaModal').style.display='flex';
  return new Promise(resolve=>{_mfa={factorId:factor.id,resolve};});
}
async function submitMfaCode(){
  if(!_mfa)return;
  const code=document.getElementById('mfaCode').value.trim();
  const {error}=await authClient().auth.mfa.challengeAndVerify({factorId:_mfa.factorId,code});
  if(error){const e=document.getElementById('mfaError');e.textContent='That code didn\'t work — try the current one.';e.style.display='block';return;}
  _session=(await authClient().auth.getSession()).data.session||_session;
  try{await sbRpc('log_admin_mode',{});}catch(e){}
  document.getElementById('mfaModal').style.display='none';const r=_mfa.resolve;_mfa=null;r(true);
}
function cancelMfa(){document.getElementById('mfaModal').style.display='none';if(_mfa){const r=_mfa.resolve;_mfa=null;r(false);}}
async function openAdminTab(btn){
  if(!_session){requireAdminPin(btn);return;}     // old PIN route (release B removes)
  if(await requireAdminMode())showView('admin',btn);
}
```

Central retry — change `sbCheck` and the helpers so each helper passes a function that re-issues its request:

```js
async function sbCheck(r,retry){
  if(r.status===426){forceReload();throw new Error('Updating to the latest version…');}
  if(r.ok)return r;
  const text=await r.text();
  // Refused by a permission rule: an admin who isn't in admin mode is asked for their code, then we retry once.
  if(retry&&_session&&isAdminAccount()&&!adminModeActive()&&/42501|row-level security|admin mode/i.test(text)){
    if(await requireAdminMode())return sbCheck(await retry(),null);
  }
  throw new Error(text);
}
async function sbGet(t,p=''){const go=()=>fetch(`${SUPABASE_URL}/rest/v1/${t}?${[sbSel(t),p].filter(Boolean).join('&')}`,{headers:hdr()});return (await sbCheck(await go(),go)).json();}
async function sbInsert(t,b){const go=()=>fetch(`${SUPABASE_URL}/rest/v1/${t}?${sbSel(t)}`,{method:'POST',headers:hdr({'Prefer':'return=representation'}),body:JSON.stringify(b)});return (await sbCheck(await go(),go)).json();}
async function sbUpdate(t,id,b){const go=()=>fetch(`${SUPABASE_URL}/rest/v1/${t}?id=eq.${id}&${sbSel(t)}`,{method:'PATCH',headers:hdr({'Prefer':'return=representation'}),body:JSON.stringify(b)});return (await sbCheck(await go(),go)).json();}
async function sbRpc(fn,args){const go=()=>fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`,{method:'POST',headers:hdr(),body:JSON.stringify(args)});const r=await sbCheck(await go(),go);const t=await r.text();return t?JSON.parse(t):null;}
async function sbDelete(t,id){const go=()=>fetch(`${SUPABASE_URL}/rest/v1/${t}?id=eq.${id}`,{method:'DELETE',headers:hdr()});await sbCheck(await go(),go);}
async function sbDeleteWhere(t,filter){const go=()=>fetch(`${SUPABASE_URL}/rest/v1/${t}?${filter}`,{method:'DELETE',headers:hdr()});await sbCheck(await go(),go);}
```

PostgREST returns **zero rows, not an error**, when an UPDATE/DELETE policy's `USING` filters rows out. So `sbUpdate` also retries through admin mode when it gets `[]` back from an admin who isn't in admin mode (`sbDelete` asks for the deleted row with `Prefer: return=representation` to detect the same case):

```js
async function sbUpdate(t,id,b){
  const go=()=>fetch(`${SUPABASE_URL}/rest/v1/${t}?id=eq.${id}&${sbSel(t)}`,{method:'PATCH',headers:hdr({'Prefer':'return=representation'}),body:JSON.stringify(b)});
  let rows=await (await sbCheck(await go(),go)).json();
  if(!rows.length&&_session&&isAdminAccount()&&!adminModeActive()&&await requireAdminMode())rows=await (await sbCheck(await go(),null)).json();
  return rows;
}
async function sbDelete(t,id){
  const go=()=>fetch(`${SUPABASE_URL}/rest/v1/${t}?id=eq.${id}`,{method:'DELETE',headers:hdr({'Prefer':'return=representation'})});
  const rows=await (await sbCheck(await go(),go)).json();
  if(!rows.length&&_session&&isAdminAccount()&&!adminModeActive()&&await requireAdminMode())await sbCheck(await go(),null);
}
```

Test (append to Step 1's block):

```js
    // an admin PATCH that silently matches nothing before admin mode → prompt → retried
    players=[{id:1,name:'Ann',user_id:'u-1',is_admin:true,color:0,hcp_history:[],approved:true}];activeId=1;
    _session=sessionFor('u-1');authState.factors=[{id:'f1',status:'verified'}];let k=0;
    reset((u,b,m)=>{if(m==='PATCH'){k++;return k===1?[]:[{id:5,approved:true}];}return u.includes('/rpc/log_admin_mode')?true:[];});
    const pu=sbUpdate('players',5,{approved:true});await new Promise(r=>setTimeout(r,50));
    T('an empty admin update opens the prompt (existing factor: no QR)',document.getElementById('mfaModal').style.display!=='none'&&document.getElementById('mfaEnroll').style.display==='none');
    await verifyAndUpgrade();const pr=await pu;
    T('…and the retried update returns the row',pr.length===1&&k===2,`k=${k}`);
```

`adminTab` button: `onclick="openAdminTab(this)"`. `isAdmin()` stays as "show admin UI" (= `isAdminAccount()`), so admin buttons are visible; the database decides. `showPicker()`: when `_session`, only admins get the list and picking calls `setPlayer(id)` directly (no `requirePin`); non-admins get "You can only view your own profile." `setPlayer`'s guard uses the signed-in player id when `_session`.

- [ ] **Step 4: Run** → all pass. **Step 5: Commit** — `git commit -am "feat: admin mode with two-factor, 12-hour expiry, and retry through admin mode"`

---

### Task 9: App — audit panel, move-over list, draw via run_draw, version 3 elsewhere

**Files:** Modify `index.html` (Admin tab sections; `autoDrawIfDue`), `course-mapper.html`, `tests/sql/snapshot.mjs`; test append.

- [ ] **Step 1: Failing tests** (append)

```js
    // ── Task 9: audit panel, move-over, draw ──
    _session=sessionFor('u-1',{aal:'aal2',amr:[{method:'totp',timestamp:now}]});activeId=1;
    reset(u=>u.includes('/audit_log')?[{id:1,at:'2026-10-05T10:00:00Z',action:'admin_granted',actor_player_id:1,target_player_id:2,details:null}]
            :u.includes('/rpc/admin_member_emails')?[{player_id:2,name:'Bo',email:'bo@x.dk',linked:false}]:[]);
    await renderAuditPanel();
    T('audit panel lists entries with names',/admin_granted|Admin granted/.test(document.getElementById('auditPanel').textContent)&&/Ann/.test(document.getElementById('auditPanel').textContent)&&/Bo/.test(document.getElementById('auditPanel').textContent));
    await renderMoveOverList();
    T('move-over list shows members not yet on the new login',/Bo/.test(document.getElementById('moveOverList').textContent)&&/bo@x\.dk/.test(document.getElementById('moveOverList').textContent));
    T('course mapper and snapshot use version 3',true); // checked by grep in Step 4
    const src=autoDrawIfDue.toString();
    T('auto-draw goes through run_draw',/sbRpc\('run_draw'/.test(src)&&!/sbUpdate\('saturday_signups'/.test(src)&&!/sbInsert\('saturday_events'/.test(src));
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** In the Admin view add two panels: `<div class="panel"><div class="ph"><span class="pt">New login — not set up yet</span></div><div class="pb" id="moveOverList"></div></div>` and `<div class="panel"><div class="ph"><span class="pt">Audit log</span><select id="auditFilter" onchange="renderAuditPanel()"><option value="">All events</option></select></div><div class="pb" id="auditPanel"></div></div>`. Render them when the admin view opens (in `showView` for `'admin'`).

```js
const AUDIT_LABELS={login:'Signed in',login_set_up:'Set up new login',signed_up:'Signed up',reset_requested:'Password reset requested',password_changed:'Password changed',email_changed:'Email changed',mfa_enrolled:'Two-factor set up',admin_mode_unlocked:'Admin mode unlocked',admin_granted:'Admin granted',admin_removed:'Admin removed',approved:'Approved',archived:'Archived',restored:'Restored',social_changed:'Social status changed',payment_recorded:'Payment recorded',payment_deleted:'Payment deleted',fine_deleted:'Fine deleted'};
async function renderAuditPanel(){
  const el=document.getElementById('auditPanel');if(!el)return;
  const f=document.getElementById('auditFilter');
  if(f&&f.options.length<2)f.innerHTML='<option value="">All events</option>'+Object.entries(AUDIT_LABELS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');
  const q='order=at.desc&limit=200'+(f&&f.value?'&action=eq.'+f.value:'');
  let rows=[];try{rows=await sbGet('audit_log',q);}catch(e){el.innerHTML='<div class="empty">Audit log needs admin mode.</div>';return;}
  const nm=id=>id==null?'—':(players.find(p=>p.id===id)||pendingPlayers.find(p=>p.id===id))?.name||('#'+id);
  el.innerHTML=rows.length?`<div class="rt-wrap"><table class="rt"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Whom</th><th>Detail</th></tr></thead><tbody>${rows.map(r=>`<tr><td style="white-space:nowrap">${new Date(r.at).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</td><td>${nm(r.actor_player_id)}</td><td>${AUDIT_LABELS[r.action]||r.action}</td><td>${nm(r.target_player_id)}</td><td style="font-family:'DM Mono',monospace;font-size:0.75rem">${r.details?Object.entries(r.details).map(([k,v])=>k+': '+v).join(', '):''}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No entries yet.</div>';
}
async function renderMoveOverList(){
  const el=document.getElementById('moveOverList');if(!el)return;
  let rows=[];try{rows=await sbRpc('admin_member_emails',{});}catch(e){el.innerHTML='<div class="empty">Needs admin mode.</div>';return;}
  const todo=rows.filter(r=>!r.linked);
  el.innerHTML=todo.length?`<div style="font-size:0.8rem;color:rgba(255,255,255,0.45);margin-bottom:0.5rem">${todo.length} of ${rows.length} members still on the old PIN login. Release B can go ahead when this list is empty.</div>`+todo.map(r=>`<div style="display:flex;justify-content:space-between;padding:4px 0"><span>${r.name}</span><span style="font-family:'DM Mono',monospace;font-size:0.78rem;color:rgba(255,255,255,0.5)">${r.email||'no email on file'}</span></div>`).join('')
    :'<div class="empty">Everyone has moved to the new login ✓ — release B can go ahead.</div>';
}
```

`autoDrawIfDue` — replace the try-block's claim/lock/allocation writes with:

```js
  try{
    const alloc=chooseBestDraw(signups,teeTimes,date);
    const p_alloc=signups.map(s=>({id:s.id,...alloc.get(s.id)}));
    const res=await sbRpc('run_draw',{p_date:date,p_tee_times:teeTimes,p_alloc});
    if(!res||!res.ok)return;                                  // someone else drew first, or the date is locked
    saturdayEvents=await sbGet('saturday_events','order=date.asc');
    saturdaySignups=await sbGet('saturday_signups','order=created_at.asc');
    renderSaturdayView();renderTeeSheet();renderSaturdayAdmin();
```

(keep the function's existing `catch`/tail). `course-mapper.html`: `'x-app-version':'3'`. `tests/sql/snapshot.mjs`: `'x-app-version': '3'`.

- [ ] **Step 4: Run** → all pass; `grep -c "x-app-version':'3'" course-mapper.html` → 1; all app suites and `node --test` green.
- [ ] **Step 5: Commit** — `git commit -am "feat: audit log panel, move-over list, draw via run_draw, version 3"`

---

### Task 10: Grants and docs

- [ ] `supabase/grants.sql`: add `user_id` to the players column SELECT grant; add `GRANT SELECT ON public.audit_log TO authenticated;` and a comment that RLS decides row access for `authenticated` (Phase 2A). Document `private` schema usage.
- [ ] `CLAUDE.md`: replace **No auth layer** with a **Supabase Auth** paragraph (password login, `players.user_id`, admin mode = aal2 + TOTP ≤ 12 h enforced by `private.is_admin()`, `anon_all` only for the PIN route until release B, `audit_log` written only by `private.audit`, triggers on `auth.*` must never raise); update **Admin PIN** (PIN route only, removed at B); add the **run_draw** note under "The Saturday draw"; version gate now 3.
- [ ] Commit: `git commit -am "docs: Phase 2A — auth, permissions, audit log"`

---

### Task 11: Review

- [ ] `/ponytail-review` on the branch diff; apply cuts that keep all suites green.
- [ ] Fresh whole-branch review (most capable model) with this plan's Review Focus verbatim; fix Critical/Important test-first.
- [ ] All suites green: `cd tests/sql; node --test`; `tests/run.ps1` for phase0, phase1, phase2a.

---

### Task 12: Dashboard settings and rehearsal (user)

- [ ] **User, Supabase dashboard:** Authentication → URL Configuration: Site URL and Redirect URLs = `https://gridsystems.github.io/RoyalGolfLeague/`. Authentication → Providers → Email: confirm email **on**; minimum password length **8**. Authentication → Multi-Factor: **TOTP enabled**. Authentication → Emails → templates: league wording for "Confirm signup" and "Reset password". (Custom SMTP via the league Gmail: already done.) If the plan offers **leaked password protection**, turn it on.
- [ ] Fresh snapshot → all suites green on today's data.
- [ ] User runs `phase2a_auth.sql` unchanged (rehearsal) → paste the message. Expect `REHEARSAL OK`, `audit triggers: 7`, the `p2_` policy count, `anon_all … TO anon`, `version gate … >= 3`, `ALL CHECKS PASSED`. If Supabase refuses a trigger on `auth.*`, stop and redesign that audit source (rehearsal shows it before anything changes).

---

### Task 13: Go live (after the Summer final, 3 October)

- [ ] Pre-flight: weekday evening, nobody scoring, outside Fri 12:00–Sat; before snapshot + render.
- [ ] User switches the rehearsal line to `false` and runs; merge `phase2a-auth` into `main`, push at once; poll until live.
- [ ] Live checks (public key + version header): gate 426 for v2, 200 for v3; `audit_log` not readable with the public key; `run_draw` exists.
- [ ] **User, with Claude watching:** open the site → **Set it up** with their own email → confirmation email arrives from the league Gmail → open on the same phone → signed in as themselves (Chris Nel, player 1), **appearing once**. Open Admin tab → enrol authenticator → admin mode. Admin tab shows the audit log (login_set_up, login, mfa_enrolled, admin_mode_unlocked) and the move-over list (28 others).
- [ ] **Forgot password:** user requests a reset for their own email → email arrives → new password works → audit shows `reset_requested` and `password_changed`.
- [ ] **Throwaway member:** user signs up a test member with a second address → confirms → appears as pending → admin rejects it (deletes) → audit shows `signed_up`.
- [ ] After-render diff: no change for members.
- [ ] Update memory (roadmap: 2A live; B pending the move-over), tell the user how to announce the move-over to members.

---

## Estimate (bottom-up)

| Task | Hours |
|---|---|
| 1 Testbed with auth stand-in | 1 |
| 2 Identity, linking, helpers | 1.5 |
| 3 Audit log, money trail, protected fields | 2 |
| 4 Permission rules, run_draw, admin emails, gate (incl. matrix) | 3 |
| 5 Rollback | 0.75 |
| 6 Auth client, token helpers, load fix | 2 |
| 7 Login screens and flows | 3 |
| 8 Admin mode, two-factor, retry, view-as | 2.5 |
| 9 Audit panel, move-over list, draw, version 3 | 1.5 |
| 10 Grants and docs | 0.5 |
| 11 Review and fixes | 2 |
| 12 Dashboard settings + rehearsal round-trips | 1 |
| 13 Go-live and live tests | 1.5 |
| **Total** | **≈ 22 h (about 3 days)** |
