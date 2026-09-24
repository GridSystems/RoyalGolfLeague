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
