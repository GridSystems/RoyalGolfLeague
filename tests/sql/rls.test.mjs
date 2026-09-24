import test from 'node:test'; import assert from 'node:assert/strict';
import { productionDb, as, persona, run, sqlFile } from './testbed.mjs';
const REAL = () => sqlFile('phase2a_auth.sql').replace('SELECT true AS rehearsal', 'SELECT false AS rehearsal');

async function world() {
  const db = await productionDb(); assert.equal(await run(db, REAL()), null);
  await db.exec('RESET ROLE');
  await db.query(`UPDATE public.players SET approved=false WHERE id=5`);                      // a pending player
  await db.query(`INSERT INTO public.saturday_signups(player_id, date) VALUES (2, '2026-11-07'), (3, '2026-11-07')`); // pre-existing signups to probe draw-field protection
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
  ['member',     'set own group_num',            `UPDATE public.saturday_signups SET group_num=9 WHERE player_id=2 AND date='2026-11-07'`, 'denied'],
  ['member',     'edit own early_tee_reason',    `UPDATE public.saturday_signups SET early_tee_reason='home early' WHERE player_id=2 AND date='2026-11-07'`, 1],
  ['admin',      "move a player's group",        `UPDATE public.saturday_signups SET group_num=2 WHERE player_id=3 AND date='2026-11-07'`, 1],
  ['pending',    'sign self up',                 `INSERT INTO public.saturday_signups(player_id,date) VALUES (5,'2026-10-10')`, 'denied'],
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

// The upcoming Saturday (Europe/Copenhagen), computed in the DB so it always agrees with run_draw's
// own date check — run_draw now refuses anything outside the next 8 days or that isn't a Saturday.
const upcomingSaturday = async db => (await db.query(
  `SELECT to_char((now() AT TIME ZONE 'Europe/Copenhagen')::date
     + (((6 - extract(dow FROM (now() AT TIME ZONE 'Europe/Copenhagen')::date)::int) + 7) % 7), 'YYYY-MM-DD') d`
)).rows[0].d;
// A date within the next 8 days that is NOT a Saturday: today, unless today is Saturday (then tomorrow).
const nonSaturdayInRange = async db => (await db.query(
  `SELECT to_char(CASE WHEN extract(dow FROM (now() AT TIME ZONE 'Europe/Copenhagen')::date) = 6
                       THEN (now() AT TIME ZONE 'Europe/Copenhagen')::date + 1
                       ELSE (now() AT TIME ZONE 'Europe/Copenhagen')::date END, 'YYYY-MM-DD') d`
)).rows[0].d;

test('run_draw: a member can draw once; a second call and a partial allocation are refused; the draw is actually written', async () => {
  const { db, P } = await world();
  await db.exec('RESET ROLE');
  const SAT = await upcomingSaturday(db);
  await db.query(`DELETE FROM public.saturday_events WHERE date=$1`, [SAT]);   // the snapshot may already have a cancelled/locked event for this date
  await db.query(`INSERT INTO public.saturday_signups(player_id,date) VALUES (2,$1),(3,$1)`, [SAT]);
  const ids = (await db.query(`SELECT id FROM public.saturday_signups WHERE date=$1 ORDER BY id`, [SAT])).rows.map(r => Number(r.id));
  const alloc = ids.map((id, i) => ({ id, tee_time: '08:30', group_num: 1 }));
  await as(db, P.member);
  const bad = (await db.query(`SELECT public.run_draw($1, '["08:30"]', $2) r`, [SAT, JSON.stringify(alloc.slice(0, 1))])).rows[0].r;
  assert.equal(bad.ok, false);
  const ok = (await db.query(`SELECT public.run_draw($1, '["08:30"]', $2) r`, [SAT, JSON.stringify(alloc)])).rows[0].r;
  assert.equal(ok.ok, true);
  const again = (await db.query(`SELECT public.run_draw($1, '["08:30"]', $2) r`, [SAT, JSON.stringify(alloc)])).rows[0].r;
  assert.equal(again.ok, false);
  await db.exec('RESET ROLE');
  const written = (await db.query(`SELECT tee_time, group_num FROM public.saturday_signups WHERE date=$1 ORDER BY id`, [SAT])).rows;
  assert.deepEqual(written.map(r => [r.tee_time, Number(r.group_num)]), [['08:30', 1], ['08:30', 1]]);
  assert.equal((await db.query(`SELECT locked FROM public.saturday_events WHERE date=$1`, [SAT])).rows[0].locked, true);
});

test('run_draw: refuses a bad tee_time, a non-positive group_num, and a date that is out of range or not a Saturday', async () => {
  const { db, P } = await world();
  await db.exec('RESET ROLE');
  const SAT = await upcomingSaturday(db);
  const notSat = await nonSaturdayInRange(db);
  await db.query(`DELETE FROM public.saturday_events WHERE date IN ($1,$2,'2027-06-05')`, [SAT, notSat]);   // clean slate for every probed date
  await db.query(`INSERT INTO public.saturday_signups(player_id,date) VALUES (2,$1),(3,$1)`, [SAT]);
  const ids = (await db.query(`SELECT id FROM public.saturday_signups WHERE date=$1 ORDER BY id`, [SAT])).rows.map(r => Number(r.id));
  await as(db, P.member);

  const badTee = (await db.query(`SELECT public.run_draw($1, '["08:30"]', $2) r`,
    [SAT, JSON.stringify(ids.map(id => ({ id, tee_time: 'lol', group_num: 1 })))])).rows[0].r;
  assert.equal(badTee.ok, false);

  const badGroup = (await db.query(`SELECT public.run_draw($1, '["08:30"]', $2) r`,
    [SAT, JSON.stringify(ids.map(id => ({ id, tee_time: '08:30', group_num: -7 })))])).rows[0].r;
  assert.equal(badGroup.ok, false);

  const tooFar = (await db.query(`SELECT public.run_draw('2027-06-05', '["08:30"]', '[]') r`)).rows[0].r;
  assert.equal(tooFar.ok, false);

  const notSaturday = (await db.query(`SELECT public.run_draw($1, '["08:30"]', '[]') r`, [notSat])).rows[0].r;
  assert.equal(notSaturday.ok, false);

  await db.exec('RESET ROLE');
  assert.equal((await db.query(`SELECT count(*)::int n FROM public.saturday_events WHERE date IN ($1,'2027-06-05',$2)`, [SAT, notSat])).rows[0].n, 0, 'nothing written for any rejected call');
  assert.equal((await db.query(`SELECT count(*)::int n FROM public.saturday_signups WHERE date=$1 AND group_num IS NOT NULL`, [SAT])).rows[0].n, 0, 'nothing written for the rejected date');
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

test('CHECKS: a stray permissive policy left behind (e.g. a dashboard "enable read for all") fails the run, naming it', async () => {
  const db = await productionDb();
  await db.exec(`CREATE POLICY dashboard_stray ON public.players FOR SELECT TO public USING (true)`);
  const err = await run(db, REAL());
  assert.match(err, /dashboard_stray/);
  assert.match(err, /players/);
  await db.exec('RESET ROLE');
  // nothing committed: SECTION 3's policies must not have been created either
  assert.equal((await db.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='players' AND column_name='user_id'`)).rows[0].n, 0);
});
