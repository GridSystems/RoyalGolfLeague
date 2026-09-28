import test from 'node:test'; import assert from 'node:assert/strict';
import { productionDb, as, run, sqlFile } from './testbed.mjs';
const REAL = () => sqlFile('phase2a_auth.sql').replace('SELECT true AS rehearsal', 'SELECT false AS rehearsal');
const one = async (db, q, p) => (await db.query(q, p)).rows[0];
const finish = `SELECT public.complete_signup($1, $2, $3, $4) AS id`;

// Release A as live, then the patch — the live database gets complete_signup from the patch file.
async function patched() {
  const db = await productionDb();
  assert.equal(await run(db, REAL()), null);
  assert.equal(await run(db, sqlFile('complete_signup.sql')), null);
  return db;
}
// A confirmed login with no player — someone who used "Set it up" instead of "Sign up".
async function unlinked(db, email, confirmed = true) {
  await db.exec('RESET ROLE');
  await db.query(`SELECT set_config('request.jwt.claims', '{}', false)`);
  const u = (await one(db, `INSERT INTO auth.users(email, email_confirmed_at) VALUES ($1, ${confirmed ? 'now()' : 'NULL'}) RETURNING id`, [email])).id;
  return { sub: u, role: 'authenticated' };
}

test('an unlinked login finishes signing up: a pending player, audited as signed_up', async () => {
  const db = await patched();
  const c = await unlinked(db, 'late@x.dk');
  await as(db, c);
  const id = (await one(db, finish, ['Late Starter', '900-1234', 18.4, 5])).id;
  await as(db, null); await db.exec('RESET ROLE');
  const p = await one(db, `SELECT name, email, dgu_number, color, handicap::float h, hcp_history, approved, user_id::text u FROM public.players WHERE id=$1`, [id]);
  assert.deepEqual([p.name, p.email, p.dgu_number, p.color, p.h, p.approved, p.u], ['Late Starter', 'late@x.dk', '900-1234', 5, 18.4, false, c.sub]);
  assert.equal(p.hcp_history.length, 1);
  assert.equal((await one(db, `SELECT count(*)::int n FROM public.audit_log WHERE action='signed_up' AND target_player_id=$1`, [id])).n, 1);
});

test('no handicap gives an empty history; calling again returns the same player', async () => {
  const db = await patched();
  await as(db, await unlinked(db, 'nohcp@x.dk'));
  const id = (await one(db, finish, ['No Hcp', '1-1', null, 0])).id;
  assert.equal((await one(db, finish, ['No Hcp', '1-1', null, 0])).id, id);
  await db.exec('RESET ROLE');
  const p = await one(db, `SELECT handicap, hcp_history FROM public.players WHERE id=$1`, [id]);
  assert.deepEqual([p.handicap, p.hcp_history], [null, []]);
  assert.equal((await one(db, `SELECT count(*)::int n FROM public.players WHERE lower(email)='nohcp@x.dk'`)).n, 1);
});

test('an email already on an active player creates nothing; signing in again links it', async () => {
  const db = await patched();
  const c = await unlinked(db, 'stranger@x.dk');
  await db.query(`UPDATE public.players SET email='stranger@x.dk' WHERE id=4`);   // admin fixed the email after confirmation
  const before = (await one(db, `SELECT count(*)::int n FROM public.players`)).n;
  await as(db, c);
  await assert.rejects(db.query(finish, ['Ignored', '900-1', null, 0]), /sign in again/i);
  await as(db, null); await db.exec('RESET ROLE');   // sign-in is Supabase Auth's write, not the user's
  assert.equal((await one(db, `SELECT count(*)::int n FROM public.players`)).n, before);
  await db.query(`SELECT set_config('request.jwt.claims', '{}', false)`);
  await db.query(`UPDATE auth.users SET last_sign_in_at=now() WHERE id=$1`, [c.sub]);   // link_login's retry
  assert.equal((await one(db, `SELECT user_id::text u FROM public.players WHERE id=4`)).u, c.sub);
});

test('an email on an archived player is refused — no duplicate person', async () => {
  const db = await patched();
  const c = await unlinked(db, 'gone@x.dk');
  await db.query(`UPDATE public.players SET email='gone@x.dk' WHERE name='Former member'`);
  await as(db, c);
  await assert.rejects(db.query(finish, ['Back Again', '900-1', null, 0]), /ask an admin/i);
});

test('refused: an unconfirmed login, a blank name, the public key', async () => {
  const db = await patched();
  await as(db, await unlinked(db, 'unconf@x.dk', false));
  await assert.rejects(db.query(finish, ['Un Confirmed', '900-1', null, 0]), /confirm/i);
  await as(db, await unlinked(db, 'blank@x.dk'));
  await assert.rejects(db.query(finish, ['   ', '900-1', null, 0]), /name/i);
  await as(db, null);
  await assert.rejects(db.query(finish, ['Anon', '900-1', null, 0]), /permission denied/i);
});

test('complete_signup.sql needs release A, and is safe to re-run', async () => {
  const db = await productionDb();
  assert.match(await run(db, sqlFile('complete_signup.sql')), /phase2a_auth\.sql must be applied first/);
  assert.equal(await run(db, REAL()), null);
  assert.equal(await run(db, sqlFile('complete_signup.sql')), null);
  assert.equal(await run(db, sqlFile('complete_signup.sql')), null);
});

test('the release A rollback removes complete_signup too', async () => {
  const db = await patched();
  assert.equal(await run(db, sqlFile('phase2a_rollback.sql')), null);
  assert.equal((await one(db, `SELECT to_regprocedure('public.complete_signup(text,text,numeric,integer)') IS NULL AS gone`)).gone, true);
});
