import test from 'node:test'; import assert from 'node:assert/strict';
import { freshDb, dump, run, sqlFile, TABLES } from './testbed.mjs';
test('rollback restores every row and the old app can insert its own ids again', async () => {
  const db = await freshDb();
  const before = {}; for (const t of TABLES) before[t] = await dump(db, t);
  assert.equal(await run(db, sqlFile('phase1_ids.sql').replace('SELECT true AS rehearsal', 'SELECT false AS rehearsal')), null);
  assert.equal(await run(db, sqlFile('phase1_rollback.sql')), null);
  for (const t of TABLES) assert.deepEqual(await dump(db, t), before[t], t);
  await db.query(`INSERT INTO public.fine_types(id, name, amount) VALUES (1790000000001, 'old app', 10)`);
  const pid = (await db.query(`SELECT id FROM public.players ORDER BY id LIMIT 1`)).rows[0].id;
  const gmax = Number((await db.query(`SELECT max(id) m FROM public.gps_shots`)).rows[0].m);
  const g = (await db.query(`INSERT INTO public.gps_shots(player_id, round_date, hole, shot_num) VALUES ($1, '2026-10-01', 1, 1) RETURNING id`, [pid])).rows[0].id;
  assert.equal(Number(g), gmax + 1, 'gps_shots continues after its highest id');
  const r = (await db.query(`SELECT public.login('nobody@x', '0000') r`)).rows[0].r;
  assert.equal(r.ok, false);
  const gate = (await db.query(`SELECT count(*)::int n FROM pg_db_role_setting WHERE setrole = 'authenticator'::regrole AND array_to_string(setconfig, ',') LIKE '%db_pre_request%'`)).rows[0].n;
  assert.equal(gate, 0, 'rollback switches the version gate off');
});
test('cleanup drops the backup schema', async () => {
  const db = await freshDb();
  await run(db, sqlFile('phase1_ids.sql').replace('SELECT true AS rehearsal', 'SELECT false AS rehearsal'));
  assert.equal(await run(db, sqlFile('phase1_cleanup.sql')), null);
  assert.equal((await db.query(`SELECT count(*)::int n FROM information_schema.schemata WHERE schema_name='phase1_backup'`)).rows[0].n, 0);
});
test('fk_ constraints outside public are left alone by the migration check and the rollback', async () => {
  const db = await freshDb();
  await db.exec(`CREATE SCHEMA other; CREATE TABLE other.parent (id int PRIMARY KEY);
                 CREATE TABLE other.child (id int PRIMARY KEY, p int CONSTRAINT fk_other REFERENCES other.parent(id));`);
  assert.equal(await run(db, sqlFile('phase1_ids.sql').replace('SELECT true AS rehearsal', 'SELECT false AS rehearsal')), null);
  assert.equal(await run(db, sqlFile('phase1_rollback.sql')), null);
  const n = (await db.query(`SELECT count(*)::int n FROM pg_constraint WHERE conname = 'fk_other'`)).rows[0].n;
  assert.equal(n, 1, 'rollback must not drop another schema’s fk_ constraint');
});
