import test from 'node:test'; import assert from 'node:assert/strict';
import { productionDb, as, persona, run, sqlFile } from './testbed.mjs';
const real = f => sqlFile(f).replace(/SELECT true AS rehearsal/, 'SELECT false AS rehearsal');
const one = async (db, q, p) => (await db.query(q, p)).rows[0];
// The SQLSTATE a statement fails with. Refused for lack of a privilege is 42501; any other error
// (e.g. run_draw's own validation) shows its own code and fails the test.
const code = async (db, sql) => { try { await db.query(sql); return 'no error'; } catch (e) { return e.code || e.message; } };
const DENIED = '42501';
const anonAll = async db => (await one(db, `SELECT count(*)::int n FROM pg_policies WHERE policyname='anon_all'`)).n;
const headers = async (db, v) => db.query(`SELECT set_config('request.headers', $1, false)`, [JSON.stringify({ 'x-app-version': v })]);

// Production after release A, plus what Supabase grants that the testbed doesn't: ALL on sequences
// (the testbed has USAGE only), and the default privileges for objects created later in the SQL
// editor (without them B1's revoke would prove nothing).
async function releaseA() {
  const db = await productionDb(); assert.equal(await run(db, real('phase2a_auth.sql')), null);
  await db.exec(`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
                 ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
                 ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
                 ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;`);
  return db;
}
async function world() {
  const db = await releaseA(); assert.equal(await run(db, real('phase2b_enforce.sql')), null);
  await db.exec('RESET ROLE');
  return db;
}

test('rehearsal changes nothing; real run applies; second run refuses', async () => {
  const db = await releaseA();
  const before = await anonAll(db);
  assert.ok(before > 10);
  assert.match(await run(db, sqlFile('phase2b_enforce.sql')), /REHEARSAL OK/);
  assert.equal(await anonAll(db), before);
  assert.equal(await run(db, real('phase2b_enforce.sql')), null);
  assert.equal(await anonAll(db), 0);
  assert.match(await run(db, real('phase2b_enforce.sql')), /already been applied/);
  const report = (await db.query(`SELECT line FROM private.phase2b_report ORDER BY ord`)).rows.map(r => r.line);
  assert.equal(report.at(-1), 'ALL CHECKS PASSED');
  assert.ok(report.includes('version gate: requests need x-app-version >= 4'));
  // Everything B1 removes is kept for the rollback. All of these hold rows in this world.
  for (const t of ['anon_policies', 'anon_table_grants', 'anon_column_grants', 'anon_function_grants',
    'anon_sequence_grants', 'default_acl', 'private_schema_acl'])
    assert.ok((await one(db, `SELECT count(*)::int n FROM phase2b_backup.${t}`)).n > 0, t);
  const seq = (await db.query(`SELECT DISTINCT privilege_type p FROM phase2b_backup.anon_sequence_grants ORDER BY 1`)).rows.map(r => r.p);
  assert.ok(seq.includes('SELECT') && seq.includes('UPDATE') && seq.includes('USAGE'), seq.join());
  assert.ok((await one(db, `SELECT bool_or(aclitem::text LIKE 'anon=U%') ok FROM phase2b_backup.private_schema_acl, unnest(nspacl) aclitem`)).ok, 'private ACL had anon USAGE');
});

test('anon can read and write nothing', async () => {
  const db = await world();
  const tables = (await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1`)).rows.map(r => r.tablename);
  assert.ok(tables.length > 10);
  await as(db, null);
  for (const t of tables) assert.equal(await code(db, `SELECT 1 FROM public.${t} LIMIT 1`), DENIED, t);
  assert.equal(await code(db, `SELECT id, name FROM public.players`), DENIED);
  assert.equal(await code(db, `UPDATE public.players SET name='x' WHERE id=2`), DENIED);
  assert.equal(await code(db, `INSERT INTO public.saturday_signups(player_id,date) VALUES (2,'2026-10-10')`), DENIED);
});

test('anon cannot call any public function except the gate', async () => {
  const db = await world();
  await as(db, null);
  for (const sql of [`SELECT public.run_draw('2026-11-14', '[]', '[]')`, `SELECT public.login('a','1')`,
    `SELECT public.check_pin(1,'1')`, `SELECT public.has_pin(1)`]) assert.equal(await code(db, sql), DENIED, sql);
  await headers(db, '4');
  await db.query(`SELECT public.require_current_app()`);
});

test('members cannot call the PIN functions either', async () => {
  const db = await world();
  await as(db, await persona(db, { playerId: 2 }));
  assert.equal(await code(db, `SELECT public.check_pin(1,'1')`), DENIED);
  assert.equal(await code(db, `SELECT public.login('a','1')`), DENIED);
});

test('gate is 4', async () => {
  const db = await world();
  await headers(db, '3');
  await assert.rejects(db.query(`SELECT public.require_current_app()`), e => e.code === 'PT426');
  await headers(db, '4');
  await db.query(`SELECT public.require_current_app()`);
});

test('member access is unchanged by B1', async () => {
  const db = await world();
  await as(db, await persona(db, { playerId: 2 }));
  assert.ok((await db.query(`SELECT id FROM public.rounds`)).rows.length > 0);
  assert.equal((await db.query(`INSERT INTO public.saturday_signups(player_id,date) VALUES (2,'2026-10-10')`)).affectedRows, 1);
  await db.exec('RESET ROLE');
  for (const f of ['public.run_draw(text,jsonb,jsonb)', 'public.complete_signup(text,text,numeric,int)',
    'public.admin_member_emails()', 'public.log_admin_mode()', 'public.require_current_app()'])
    assert.equal((await one(db, `SELECT has_function_privilege('authenticated', $1, 'EXECUTE') ok`, [f])).ok, true, f);
});

test('new table after B1 is closed to anon', async () => {
  const db = await world();
  await db.exec(`CREATE TABLE public.t_new(id int GENERATED ALWAYS AS IDENTITY)`);
  await db.exec(`CREATE FUNCTION public.f_new() RETURNS int LANGUAGE sql AS 'select 1'`);
  const r = await one(db, `SELECT has_table_privilege('anon', 'public.t_new', 'SELECT') t,
    has_sequence_privilege('anon', pg_get_serial_sequence('public.t_new', 'id'), 'USAGE') s,
    has_function_privilege('anon', 'public.f_new()', 'EXECUTE') f,
    has_table_privilege('authenticated', 'public.t_new', 'SELECT') at`);
  assert.deepEqual([r.t, r.s, r.f], [false, false, false]);
  assert.equal(r.at, true, 'logged-in users keep the Supabase default');
});

// Everything B1 touches, as one comparable value: policies, what anon and authenticated may do on
// every table, column, sequence and function in public, schema private's ACL, and postgres's
// default privileges (global and in public). ACL arrays are sorted: their order isn't meaningful.
const sortedAcl = col => `(SELECT array_agg(a::text ORDER BY a::text) FROM unnest(${col}) a)`;
async function accessState(db) {
  await db.exec('RESET ROLE');
  const q = async sql => (await db.query(sql)).rows.map(r => JSON.stringify(r));
  const roles = `(VALUES ('anon'), ('authenticated')) r(role)`;
  return {
    policies: await q(`SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename, policyname`),
    tables: await q(`SELECT r.role, c.relname, p.priv, has_table_privilege(r.role, c.oid, p.priv) ok FROM ${roles}, pg_class c,
      unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
      WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p','v','m','f') ORDER BY 1, 2, 3`),
    columns: await q(`SELECT r.role, a.attrelid::regclass::text t, a.attname, p.priv, has_column_privilege(r.role, a.attrelid, a.attnum, p.priv) ok
      FROM ${roles}, pg_attribute a JOIN pg_class c ON c.oid = a.attrelid, unnest(ARRAY['SELECT','INSERT','UPDATE']) p(priv)
      WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p','v','m','f') AND a.attnum > 0 AND NOT a.attisdropped ORDER BY 1, 2, 3, 4`),
    sequences: await q(`SELECT r.role, c.relname, p.priv, CASE WHEN c.relkind='S' THEN has_sequence_privilege(r.role, c.oid, p.priv) END ok
      FROM ${roles}, pg_class c, unnest(ARRAY['USAGE','SELECT','UPDATE']) p(priv)
      WHERE c.relnamespace='public'::regnamespace AND c.relkind='S' ORDER BY 1, 2, 3`),
    functions: await q(`SELECT r.role, p.oid::regprocedure::text f, has_function_privilege(r.role, p.oid, 'EXECUTE') ok
      FROM ${roles}, pg_proc p WHERE p.pronamespace='public'::regnamespace ORDER BY 1, 2`),
    // The ACLs themselves (NULL = the built-in default), so a grant that only came back through
    // PUBLIC still counts as missing.
    functionAcls: await q(`SELECT p.oid::regprocedure::text f, ${sortedAcl(`coalesce(p.proacl, acldefault('f', p.proowner))`)} acl
      FROM pg_proc p WHERE p.pronamespace='public'::regnamespace ORDER BY 1`),
    privateAcl: await q(`SELECT ${sortedAcl('nspacl')} acl FROM pg_namespace WHERE nspname='private'`),
    defaultAcl: await q(`SELECT n.nspname, d.defaclobjtype, ${sortedAcl('d.defaclacl')} acl FROM pg_default_acl d
      LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace WHERE d.defaclrole='postgres'::regrole ORDER BY 1 NULLS FIRST, 2`),
  };
}

test('rollback restores release A exactly, and B1 re-applies', async () => {
  const db = await releaseA();
  const before = await accessState(db);
  assert.ok(before.defaultAcl.length >= 3, 'the world models Supabase default privileges');
  assert.equal(await run(db, real('phase2b_enforce.sql')), null);
  assert.notDeepEqual(await accessState(db), before, 'B1 changed something');
  assert.equal(await run(db, sqlFile('phase2b_rollback.sql')), null);
  const after = await accessState(db);
  for (const k of Object.keys(before)) assert.deepEqual(after[k], before[k], k);
  assert.equal((await one(db, `SELECT to_regnamespace('phase2b_backup') n`)).n, null, 'backup schema dropped');
  await as(db, null);
  assert.ok((await db.query(`SELECT id FROM public.players`)).rows.length > 10, 'anon reads players again');
  await headers(db, '3');
  await db.query(`SELECT public.require_current_app()`);
  await db.exec('RESET ROLE');
  assert.equal(await run(db, real('phase2b_enforce.sql')), null, 'B1 re-applies');
  assert.equal(await anonAll(db), 0);
});

test('rollback refuses when B1 was never applied', async () => {
  const db = await releaseA();
  assert.match(await run(db, sqlFile('phase2b_rollback.sql')), /Nothing to roll back/);
  assert.ok(await anonAll(db) > 10);
});

test('link by email still works after B1', async () => {
  const db = await world();
  const p = (await one(db, `SELECT id FROM public.players WHERE approved AND archived_at IS NULL AND user_id IS NULL ORDER BY id LIMIT 1`)).id;
  await db.query(`UPDATE public.players SET email='late@x.dk' WHERE id=$1`, [p]);
  const u = (await one(db, `INSERT INTO auth.users(email) VALUES ('late@x.dk') RETURNING id::text`)).id;
  await db.query(`UPDATE auth.users SET email_confirmed_at = now() WHERE id=$1`, [u]);
  assert.equal((await one(db, `SELECT user_id::text u FROM public.players WHERE id=$1`, [p])).u, u);
});

// ---- B2: phase2b_cleanup.sql ---------------------------------------------------------------
const PIN_FNS = `'login','has_pin','check_pin','set_first_pin','admin_reset_pin','_check_pin'`;
const cols = async db => (await db.query(`SELECT column_name c FROM information_schema.columns WHERE table_schema='public' AND table_name='players'`)).rows.map(r => r.c);

test('cleanup refuses before B1', async () => {
  const db = await releaseA();
  assert.match(await run(db, sqlFile('phase2b_cleanup.sql')), /Run phase2b_enforce\.sql first/);
  assert.ok((await cols(db)).includes('pin'));
  assert.ok(await anonAll(db) > 10);
});

test('cleanup drops the PIN machinery and keeps members working', async () => {
  const db = await world();
  assert.equal(await run(db, sqlFile('phase2b_cleanup.sql')), null);
  assert.equal((await one(db, `SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN (${PIN_FNS})`)).n, 0);
  const c = await cols(db);
  for (const gone of ['pin', 'pin_failures', 'pin_locked_until', 'legacy_id']) assert.ok(!c.includes(gone), gone);
  for (const kept of ['email', 'user_id']) assert.ok(c.includes(kept), kept);
  assert.equal((await one(db, `SELECT to_regnamespace('phase2b_backup') n`)).n, null);
  assert.ok(!/legacy_id/.test((await one(db, `SELECT pg_get_functiondef('private.protect_player_fields'::regproc) d`)).d));
  // Members still read players and update their own profile; protected fields stay protected.
  await as(db, await persona(db, { playerId: 2 }));
  assert.ok((await db.query(`SELECT id FROM public.players`)).rows.length > 10);
  assert.equal((await db.query(`UPDATE public.players SET name='Renamed' WHERE id=2`)).affectedRows, 1);
  // Past the column grants, so the trigger itself is what refuses (same claims, owner role).
  await db.exec('RESET ROLE');
  for (const set of ['is_admin = true', `email = 'x@y.dk'`])
    await assert.rejects(db.query(`UPDATE public.players SET ${set} WHERE id=2`),
      e => e.code === '42501' && /Only an admin in admin mode/.test(e.message), set);
});

test('cleanup re-run is harmless', async () => {
  const db = await world();
  assert.equal(await run(db, sqlFile('phase2b_cleanup.sql')), null);
  assert.equal(await run(db, sqlFile('phase2b_cleanup.sql')), null);
});
