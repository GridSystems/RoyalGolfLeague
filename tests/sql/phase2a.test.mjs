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
