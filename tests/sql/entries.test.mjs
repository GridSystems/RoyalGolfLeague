import test from 'node:test'; import assert from 'node:assert/strict';
import { productionDb, as, persona, run, sqlFile } from './testbed.mjs';
const REAL = f => sqlFile(f).replace('SELECT true AS rehearsal', 'SELECT false AS rehearsal');
const one = async (db, q, p) => (await db.query(q, p)).rows[0];
const tryQ = async (db, sql) => { try { const r = await db.query(sql); return r.rows.length || r.affectedRows; } catch (e) { return 'denied'; } };
const W = `'Winter 2027'`;

async function world() {
  const db = await productionDb();
  assert.equal(await run(db, REAL('phase2a_auth.sql')), null);
  assert.equal(await run(db, REAL('season_entries.sql')), null);
  await db.exec('RESET ROLE');
  await db.query(`UPDATE public.players SET approved=false WHERE id=5`);
  await db.query(`INSERT INTO public.season_entries(season, player_id) VALUES (${W}, 3)`);                               // unpaid
  await db.query(`INSERT INTO public.season_entries(season, player_id, paid_at, amount) VALUES (${W}, 4, now(), 175)`); // paid
  const P = { anon: null, pending: await persona(db, { playerId: 5 }), member: await persona(db, { playerId: 2 }),
    adminNo2fa: await persona(db, { playerId: 1, admin: true }) };
  P.admin = { ...P.adminNo2fa, aal: 'aal2', amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) - 60 }] };
  return { db, P };
}

const MATRIX = [
  ['anon',       'read entries (PIN route)',  `SELECT id FROM public.season_entries`, 2],
  ['anon',       'enter (PIN route)',         `INSERT INTO public.season_entries(season,player_id) VALUES (${W},6)`, 1],
  ['pending',    'read entries',              `SELECT id FROM public.season_entries`, 0],
  ['pending',    'enter self',                `INSERT INTO public.season_entries(season,player_id) VALUES (${W},5)`, 'denied'],
  ['member',     'read entries',              `SELECT id FROM public.season_entries`, 2],
  ['member',     'enter self',                `INSERT INTO public.season_entries(season,player_id) VALUES (${W},2)`, 1],
  ['member',     'enter someone else',        `INSERT INTO public.season_entries(season,player_id) VALUES (${W},6)`, 'denied'],
  ['member',     'enter self as paid',        `INSERT INTO public.season_entries(season,player_id,paid_at,amount) VALUES (${W},2,now(),175)`, 'denied'],
  ['member',     'mark someone paid',         `UPDATE public.season_entries SET paid_at=now(), amount=175 WHERE player_id=3`, 0],
  ['member',     'withdraw someone else',     `DELETE FROM public.season_entries WHERE player_id=3`, 0],
  ['adminNo2fa', 'mark paid',                 `UPDATE public.season_entries SET paid_at=now(), amount=175 WHERE player_id=3`, 0],
  ['admin',      'mark paid',                 `UPDATE public.season_entries SET paid_at=now(), amount=175 WHERE player_id=3`, 1],
  ['admin',      'enter a player',            `INSERT INTO public.season_entries(season,player_id) VALUES (${W},6)`, 1],
  ['admin',      'remove an entry',           `DELETE FROM public.season_entries WHERE player_id=4`, 1],
];
for (const [who, what, sql, want] of MATRIX) test(`${who}: ${what}`, async () => {
  const { db, P } = await world(); await as(db, P[who]);
  assert.equal(await tryQ(db, sql), want);
});

test('a member withdraws their own entry only while it is unpaid', async () => {
  const { db, P } = await world(); await as(db, P.member);
  await db.query(`INSERT INTO public.season_entries(season,player_id) VALUES (${W},2)`);
  assert.equal(await tryQ(db, `DELETE FROM public.season_entries WHERE player_id=2`), 1);
  await db.query(`INSERT INTO public.season_entries(season,player_id) VALUES (${W},2)`);
  await db.exec('RESET ROLE'); await db.query(`UPDATE public.season_entries SET paid_at=now(), amount=175 WHERE player_id=2`);
  await as(db, P.member);
  assert.equal(await tryQ(db, `DELETE FROM public.season_entries WHERE player_id=2`), 0);
});

test('one entry per player per season', async () => {
  const { db } = await world();
  assert.equal(await tryQ(db, `INSERT INTO public.season_entries(season,player_id) VALUES (${W},3)`), 'denied');
  assert.equal(await tryQ(db, `INSERT INTO public.season_entries(season,player_id) VALUES ('Summer 2027',3)`), 1);
});

test('entered, paid, unpaid and withdrawn are audited, with season and amount only', async () => {
  const { db, P } = await world(); await as(db, P.admin);
  await db.query(`INSERT INTO public.season_entries(season,player_id) VALUES (${W},6)`);
  await db.query(`UPDATE public.season_entries SET paid_at=now(), amount=175 WHERE player_id=6`);
  await db.query(`UPDATE public.season_entries SET paid_at=NULL, amount=NULL WHERE player_id=6`);
  await db.query(`DELETE FROM public.season_entries WHERE player_id=6`);
  await db.exec('RESET ROLE');
  const rows = (await db.query(`SELECT action, actor_player_id, details FROM public.audit_log WHERE target_player_id=6 ORDER BY id`)).rows;
  assert.deepEqual(rows.map(r => r.action), ['season_entered', 'entry_paid', 'entry_unpaid', 'season_withdrawn']);
  assert.equal(rows[0].actor_player_id, 1);
  assert.deepEqual(rows[1].details, { season: 'Winter 2027', amount: 175 });
  assert.deepEqual(Object.keys(rows[3].details), ['season']);
});

test('rehearsal changes nothing; a second real run refuses; rollback removes it all', async () => {
  const db = await productionDb();
  assert.equal(await run(db, REAL('phase2a_auth.sql')), null);
  assert.match(await run(db, sqlFile('season_entries.sql')), /REHEARSAL OK/);
  assert.equal((await one(db, `SELECT to_regclass('public.season_entries') AS t`)).t, null);
  assert.equal(await run(db, REAL('season_entries.sql')), null);
  assert.match(await run(db, REAL('season_entries.sql')), /already exists/);
  assert.equal(await run(db, sqlFile('season_entries_rollback.sql')), null);
  assert.equal((await one(db, `SELECT to_regclass('public.season_entries') AS t`)).t, null);
  assert.equal((await one(db, `SELECT count(*)::int n FROM pg_proc WHERE proname='audit_entries'`)).n, 0);
  assert.equal(await run(db, REAL('season_entries.sql')), null);
});

test('refuses to run before Phase 2 release A', async () => {
  const db = await productionDb();
  assert.match(await run(db, REAL('season_entries.sql')), /phase2a_auth\.sql must be applied first/);
});
