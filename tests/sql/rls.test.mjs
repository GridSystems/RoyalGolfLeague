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
// PGlite always sets affectedRows (0 for a plain SELECT, never undefined), so `affectedRows ?? rows.length`
// never falls through to rows.length and every SELECT-count row reads as 0. rows.length is the right count
// whenever it's nonzero (a SELECT that returned data); otherwise (a SELECT with 0 rows, or a write with no
// RETURNING) affectedRows is the right count, and the two already agree when a write affects 0 rows.
const tryQ = async (db, sql, p) => { try { const r = await db.query(sql, p); return r.rows.length || r.affectedRows; } catch (e) { return 'denied'; } };
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
