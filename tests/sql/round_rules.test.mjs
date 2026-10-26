import test from 'node:test'; import assert from 'node:assert/strict';
import { productionDb, as, persona, run, sqlFile } from './testbed.mjs';
const REAL = f => sqlFile(f).replace('SELECT true AS rehearsal', 'SELECT false AS rehearsal');
const TODAY = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Copenhagen' });   // YYYY-MM-DD, the club's day
const day = n => new Date(Date.parse(TODAY + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const D3 = day(-3), D7 = day(-7), D8 = day(-8), OLD = '2026-05-02', TOMORROW = day(1);
const card = scores => JSON.stringify(scores.map((s, i) => ({ hole: i + 1, score: s, par: 4, hcp: i + 1 })));
const SCORED = card(Array(18).fill(5)), EMPTY = card(Array(18).fill(null));
const tryQ = async (db, sql) => { try { const r = await db.query(sql); return r.rows.length || r.affectedRows; } catch (e) { return e.code === '42501' ? 'denied' : (e.code || e.message); } };
const audit = async db => { await db.exec('RESET ROLE');
  return (await db.query(`SELECT action, actor_player_id, target_player_id, details FROM public.audit_log WHERE action LIKE 'round_%' ORDER BY id`)).rows; };

// Player 2 is the member; player 3 someone else; player 1 the admin.
async function world() {
  const db = await productionDb();
  assert.equal(await run(db, REAL('phase2a_auth.sql')), null);
  assert.equal(await run(db, sqlFile('noshow_round_delete.sql')), null);
  assert.equal(await run(db, REAL('phase2b_enforce.sql')), null);   // production: release B has run
  assert.equal(await run(db, sqlFile('round_rules.sql')), null);
  const P = { member: await persona(db, { playerId: 2 }), adminNo2fa: await persona(db, { playerId: 1, admin: true }) };
  P.admin = { ...P.adminNo2fa, aal: 'aal2', amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) - 60 }] };
  await db.exec('RESET ROLE');
  const ins = async (pid, date, holes) => (await db.query(
    `INSERT INTO public.rounds (player_id, date, holes) VALUES ($1, $2, $3) RETURNING id`, [pid, date, holes])).rows[0].id;
  const R = { otherToday: await ins(3, TODAY, EMPTY), otherTodayScored: await ins(3, TODAY, SCORED),
    other3: await ins(3, D3, SCORED), other3Empty: await ins(3, D3, EMPTY), own3: await ins(2, D3, SCORED),
    own7: await ins(2, D7, SCORED), own8: await ins(2, D8, SCORED), old: await ins(3, OLD, SCORED) };
  await db.query(`DELETE FROM public.audit_log`);   // setup's own backdated inserts
  return { db, P, R };
}
const insert = (pid, date) => `INSERT INTO public.rounds (player_id, date, holes) VALUES (${pid}, '${date}', '${EMPTY}')`;
const notes = id => R => `UPDATE public.rounds SET notes = 'x' WHERE id = ${R[id]}`;
const del = id => R => `DELETE FROM public.rounds WHERE id = ${R[id]}`;

const MATRIX = [
  // today: any member, for the whole group
  ['member', 'insert someone else\'s round today',     () => insert(3, TODAY), 1],
  ['member', 'score someone else\'s round today',      notes('otherToday'), 1],
  ['member', 'remove a no-show today',                 del('otherToday'), 1],
  ['member', 'delete someone else\'s scored round today', del('otherTodayScored'), 0],
  // an earlier day: their own only, up to 7 days back
  ['member', 'insert own round 3 days ago',            () => insert(2, D3), 1],
  ['member', 'insert own round 7 days ago',            () => insert(2, D7), 1],
  ['member', 'insert own round 8 days ago',            () => insert(2, D8), 'denied'],
  ['member', 'insert someone else\'s round 3 days ago', () => insert(3, D3), 'denied'],
  ['member', 'insert a round for tomorrow',            () => insert(2, TOMORROW), 'denied'],
  ['member', 'edit own round 3 days ago',              notes('own3'), 1],
  ['member', 'edit own round 7 days ago',              notes('own7'), 1],
  ['member', 'edit own round 8 days ago',              notes('own8'), 0],
  ['member', 'edit someone else\'s round 3 days ago',  notes('other3'), 0],
  ['member', 'edit someone else\'s old round',         notes('old'), 0],
  ['member', 'delete own scored round 3 days ago',     del('own3'), 1],
  ['member', 'delete own scored round 8 days ago',     del('own8'), 0],
  ['member', 'delete someone else\'s scored round 3 days ago', del('other3'), 0],
  ['member', 'remove someone else\'s unscored round 3 days ago', del('other3Empty'), 1],
  // who and when: admin only
  ['member', 'move today\'s round to another player',  R => `UPDATE public.rounds SET player_id = 4 WHERE id = ${R.otherToday}`, 'denied'],
  ['member', 'move own round to another player',       R => `UPDATE public.rounds SET player_id = 4 WHERE id = ${R.own3}`, 'denied'],
  ['member', 'take someone else\'s round today',       R => `UPDATE public.rounds SET player_id = 2 WHERE id = ${R.otherToday}`, 'denied'],
  ['member', 'redate own round to today',              R => `UPDATE public.rounds SET date = '${TODAY}' WHERE id = ${R.own3}`, 'denied'],
  ['member', 'redate own old round into the window',   R => `UPDATE public.rounds SET date = '${D3}' WHERE id = ${R.own8}`, 0],
  // admin mode needed for everything else
  ['adminNo2fa', 'edit someone else\'s old round',     notes('old'), 0],
  ['adminNo2fa', 'insert someone else\'s round 3 days ago', () => insert(3, D3), 'denied'],
  ['admin', 'edit someone else\'s old round',          notes('old'), 1],
  ['admin', 'insert someone else\'s old round',        () => insert(3, OLD), 1],
  ['admin', 'move a round to another player',          R => `UPDATE public.rounds SET player_id = 4 WHERE id = ${R.old}`, 1],
  ['admin', 'redate a round',                          R => `UPDATE public.rounds SET date = '${D3}' WHERE id = ${R.old}`, 1],
  ['admin', 'delete someone else\'s old scored round', del('old'), 1],
];
for (const [who, what, sql, want] of MATRIX) test(`${who}: ${what}`, async () => {
  const { db, P, R } = await world(); await as(db, P[who]);
  assert.equal(await tryQ(db, sql(R)), want);
});

test('a refused write leaves the round as it was', async () => {
  const { db, P, R } = await world();
  const before = (await db.query(`SELECT to_jsonb(r) j FROM public.rounds r WHERE id = $1`, [R.old])).rows[0].j;
  await as(db, P.member);
  await tryQ(db, `UPDATE public.rounds SET holes = '${card(Array(18).fill(3))}' WHERE id = ${R.old}`);
  await db.exec('RESET ROLE');
  assert.deepEqual((await db.query(`SELECT to_jsonb(r) j FROM public.rounds r WHERE id = $1`, [R.old])).rows[0].j, before);
});

test('a member editing their own earlier round is audited: who, whose, which holes', async () => {
  const { db, P, R } = await world(); await as(db, P.member);
  await db.query(`UPDATE public.rounds SET holes = $1 WHERE id = $2`, [card([5, 5, 5, 4, ...Array(14).fill(5)]), R.own3]);
  const rows = await audit(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, 'round_edited');
  assert.equal(rows[0].actor_player_id, 2);
  assert.equal(rows[0].target_player_id, 2);
  assert.deepEqual(rows[0].details, { round: R.own3, date: D3, holes: '4: 5→4' });
});

test('an admin moving a round to another player is audited, today included', async () => {
  const { db, P, R } = await world(); await as(db, P.admin);
  await db.query(`UPDATE public.rounds SET player_id = 4 WHERE id = $1`, [R.otherToday]);
  const rows = await audit(db);
  assert.deepEqual(rows.map(r => [r.action, r.actor_player_id, r.target_player_id, r.details.player]), [['round_edited', 1, 4, '3→4']]);
});

test('live scoring of today\'s round is not audited', async () => {
  const { db, P, R } = await world(); await as(db, P.member);
  await db.query(`UPDATE public.rounds SET holes = $1 WHERE id = $2`, [card([4, ...Array(17).fill(null)]), R.otherToday]);
  await db.query(`UPDATE public.rounds SET marker_holes = $1 WHERE id = $2`, [card([4, ...Array(17).fill(null)]), R.otherToday]);
  assert.deepEqual(await audit(db), []);
});

test('an update that changes nothing is not audited', async () => {
  const { db, P, R } = await world(); await as(db, P.admin);
  await db.query(`UPDATE public.rounds SET holes = holes WHERE id = $1`, [R.old]);
  assert.deepEqual(await audit(db), []);
});

test('a second scorer card changed on an old round is audited', async () => {
  const { db, P, R } = await world(); await as(db, P.admin);
  await db.query(`UPDATE public.rounds SET marker_holes = $1 WHERE id = $2`, [card([6, 5, ...Array(16).fill(null)]), R.old]);
  const [r] = await audit(db);
  assert.equal(r.details.marker_holes, '1: –→6, 2: –→5');
});

test('a backdated round and a deleted scored round are audited; a no-show delete is not', async () => {
  const { db, P, R } = await world(); await as(db, P.admin);
  await db.query(`INSERT INTO public.rounds (player_id, date, holes) VALUES (5, '2026-05-09', $1)`, [SCORED]);
  await db.query(`DELETE FROM public.rounds WHERE id = $1`, [R.old]);
  await db.query(`DELETE FROM public.rounds WHERE id = $1`, [R.otherToday]);   // no scores: the no-show removal
  const rows = await audit(db);
  assert.deepEqual(rows.map(r => [r.action, r.actor_player_id, r.target_player_id, r.details.date]),
    [['round_backdated', 1, 5, '2026-05-09'], ['round_deleted', 1, 3, OLD]]);
});

test('members still cannot write or delete audit rows', async () => {
  const { db, P, R } = await world(); await as(db, P.member);
  await db.query(`UPDATE public.rounds SET notes = 'x' WHERE id = $1`, [R.own3]);
  await as(db, P.member);
  for (const sql of [`DELETE FROM public.audit_log`, `UPDATE public.audit_log SET action = 'x'`,
                     `INSERT INTO public.audit_log (action) VALUES ('x')`]) {
    assert.equal(await tryQ(db, sql), 'denied', sql);
  }
  assert.equal((await audit(db)).length, 1);
});

test('rerunnable', async () => {
  const { db } = await world();
  assert.equal(await run(db, sqlFile('round_rules.sql')), null);
});
