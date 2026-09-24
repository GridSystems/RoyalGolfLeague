// PGlite testbed: a real Postgres in-process, shaped like production and loaded with the
// read-only snapshot from snapshot.mjs. Every test gets a fresh database.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { PGlite } from '@electric-sql/pglite';
export const repo = path.resolve(import.meta.dirname, '../..');
export const TABLES = ['players', 'rounds', 'fine_types', 'fines', 'fine_payments', 'saturday_events', 'saturday_signups',
  'gps_shots', 'tournaments', 'tournament_players', 'tournament_matches', 'tournament_scores'];
export const SNAPSHOT = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'rgc-phase1', 'snapshot.json'), 'utf8'));
export const sqlFile = f => fs.readFileSync(path.join(repo, 'supabase', f), 'utf8');

export async function freshDb() {
  const db = new PGlite();
  await db.exec(fs.readFileSync(path.join(import.meta.dirname, 'schema.sql'), 'utf8'));
  await db.exec(sqlFile('phase0a_pin_functions.sql'));
  for (const t of TABLES) {
    const rows = SNAPSHOT[t]; if (!rows.length) continue;
    // Only the snapshot's own columns, so hidden ones (pin, pin_failures, …) take their defaults.
    const cols = Object.keys(rows[0]).map(c => `"${c}"`).join(', ');
    await db.query(`INSERT INTO public.${t} (${cols}) SELECT ${cols} FROM jsonb_populate_recordset(null::public.${t}, $1)`, [JSON.stringify(rows)]);
  }
  // tees isn't in TABLES: Phase 1 tests iterate TABLES and assert id renumbering, and tees'
  // ids are text codes (not renumbered), so it's loaded separately here.
  const tees = SNAPSHOT.tees;
  if (tees && tees.length) {
    const cols = Object.keys(tees[0]).map(c => `"${c}"`).join(', ');
    await db.query(`INSERT INTO public.tees (${cols}) SELECT ${cols} FROM jsonb_populate_recordset(null::public.tees, $1)`, [JSON.stringify(tees)]);
  }
  return db;
}
// Rows of a table as JSON strings, ordered by id — for before/after equality.
export async function dump(db, t) {
  return (await db.query(`SELECT to_jsonb(x) AS j FROM public.${t} x ORDER BY id`)).rows.map(r => JSON.stringify(r.j));
}
// Run a script that may raise; returns the error message or null, and leaves no open transaction.
export async function run(db, sql) {
  try { await db.exec(sql); return null; }
  catch (e) { try { await db.exec('ROLLBACK'); } catch { /* no open transaction */ } return e.message; }
}

export const SITE = 'https://gridsystems.github.io/RoyalGolfLeague/';
// The database as production has it today: snapshot → RLS allow-all → Phase 0 column grants → Phase 1.
export async function productionDb() {
  const db = await freshDb();
  await db.exec(sqlFile('enable_rls.sql'));
  await db.exec(sqlFile('phase0b_hide_credentials.sql'));
  const err = await run(db, sqlFile('phase1_ids.sql').replace('SELECT true AS rehearsal', 'SELECT false AS rehearsal'));
  if (err) throw new Error('phase 1 failed in testbed: ' + err);
  await db.exec(fs.readFileSync(path.join(import.meta.dirname, 'auth_stub.sql'), 'utf8'));
  return db;
}
// Act as a visitor: null → anon (logged out / old PIN route); claims → authenticated with that JWT.
export async function as(db, claims) {
  await db.exec('RESET ROLE');
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims || { role: 'anon' })]);
  await db.exec(claims ? 'SET ROLE authenticated' : 'SET ROLE anon');
}
// A confirmed login linked to an existing player; returns JWT claims for that visitor.
export async function persona(db, { playerId, admin = false, aal = 'aal1', totpAgeSec = null }) {
  await db.exec('RESET ROLE');
  const email = `p${playerId}@test.invalid`;
  const u = (await db.query(`INSERT INTO auth.users (email) VALUES ($1) RETURNING id`, [email])).rows[0].id;
  await db.query(`UPDATE public.players SET email=$1, is_admin=$2 WHERE id=$3`, [email, admin, playerId]);
  await db.query(`UPDATE auth.users SET email_confirmed_at = now() WHERE id=$1`, [u]); // link trigger fires here
  const now = Math.floor(Date.now() / 1000);
  const amr = [{ method: 'password', timestamp: now }];
  if (totpAgeSec !== null) amr.unshift({ method: 'totp', timestamp: now - totpAgeSec });
  return { sub: u, role: 'authenticated', aal, amr };
}
