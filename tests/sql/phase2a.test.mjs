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
