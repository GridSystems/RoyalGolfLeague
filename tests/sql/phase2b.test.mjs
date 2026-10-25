import test from 'node:test'; import assert from 'node:assert/strict';
import { productionDb, as, persona, run, sqlFile } from './testbed.mjs';
const real = f => sqlFile(f).replace(/SELECT true AS rehearsal/, 'SELECT false AS rehearsal');
const one = async (db, q, p) => (await db.query(q, p)).rows[0];
const fails = async (db, sql, p) => { try { await db.query(sql, p); return false; } catch { return true; } };
const anonAll = async db => (await one(db, `SELECT count(*)::int n FROM pg_policies WHERE policyname='anon_all'`)).n;
const headers = async (db, v) => db.query(`SELECT set_config('request.headers', $1, false)`, [JSON.stringify({ 'x-app-version': v })]);

// Production after release A, plus the default privileges Supabase gives objects created later
// in the SQL editor (the testbed has none of its own, so B1's revoke would otherwise prove nothing).
async function releaseA() {
  const db = await productionDb(); assert.equal(await run(db, real('phase2a_auth.sql')), null);
  await db.exec(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
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
});

test('anon can read and write nothing', async () => {
  const db = await world();
  const tables = (await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1`)).rows.map(r => r.tablename);
  assert.ok(tables.length > 10);
  await as(db, null);
  for (const t of tables) assert.ok(await fails(db, `SELECT 1 FROM public.${t} LIMIT 1`), t);
  assert.ok(await fails(db, `SELECT id, name FROM public.players`));
  assert.ok(await fails(db, `UPDATE public.players SET name='x' WHERE id=2`));
  assert.ok(await fails(db, `INSERT INTO public.saturday_signups(player_id,date) VALUES (2,'2026-10-10')`));
});

test('anon cannot call any public function except the gate', async () => {
  const db = await world();
  await as(db, null);
  for (const sql of [`SELECT public.run_draw('2026-11-14', '[]', '[]')`, `SELECT public.login('a','1')`,
    `SELECT public.check_pin(1,'1')`, `SELECT public.has_pin(1)`]) assert.ok(await fails(db, sql), sql);
  await headers(db, '4');
  await db.query(`SELECT public.require_current_app()`);
});

test('members cannot call the PIN functions either', async () => {
  const db = await world();
  await as(db, await persona(db, { playerId: 2 }));
  assert.ok(await fails(db, `SELECT public.check_pin(1,'1')`));
  assert.ok(await fails(db, `SELECT public.login('a','1')`));
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

test('link by email still works after B1', async () => {
  const db = await world();
  const p = (await one(db, `SELECT id FROM public.players WHERE approved AND archived_at IS NULL AND user_id IS NULL ORDER BY id LIMIT 1`)).id;
  await db.query(`UPDATE public.players SET email='late@x.dk' WHERE id=$1`, [p]);
  const u = (await one(db, `INSERT INTO auth.users(email) VALUES ('late@x.dk') RETURNING id::text`)).id;
  await db.query(`UPDATE auth.users SET email_confirmed_at = now() WHERE id=$1`, [u]);
  assert.equal((await one(db, `SELECT user_id::text u FROM public.players WHERE id=$1`, [p])).u, u);
});
