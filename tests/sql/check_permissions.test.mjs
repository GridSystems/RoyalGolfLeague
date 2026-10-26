import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
import { productionDb, run, sqlFile } from './testbed.mjs';
const REAL = f => sqlFile(f).replace('SELECT true AS rehearsal', 'SELECT false AS rehearsal');
const CHECK = sqlFile('check_permissions.sql');
const OLD_SETUP = fs.readFileSync(path.join(import.meta.dirname, 'history', 'enable_rls.sql'), 'utf8');

// Production as of release B + round_rules.sql, in the order the migrations ran.
async function production() {
  const db = await productionDb();
  for (const f of ['phase2a_auth.sql', 'complete_signup.sql', 'season_entries.sql', 'matchplay_league.sql',
                   'noshow_round_delete.sql', 'phase2b_enforce.sql', 'phase2b_cleanup.sql', 'grants.sql', 'round_rules.sql'])
    assert.equal(await run(db, REAL(f)), null, f);
  await db.exec('RESET ROLE');
  return db;
}
const check = async db => { const err = await run(db, CHECK); await db.exec('RESET ROLE'); return err; };

test('production passes, and the check changes nothing', async () => {
  const db = await production();
  const before = (await db.query(`SELECT count(*)::int n FROM pg_policies`)).rows[0].n;
  assert.equal(await check(db), null);
  assert.equal((await db.query(`SELECT count(*)::int n FROM pg_policies`)).rows[0].n, before);
});

test('the old enable_rls.sql setup script is caught', async () => {
  const db = await production();
  await db.exec(OLD_SETUP);
  const err = await check(db);
  assert.match(err, /PERMISSION CHECK FAILED/);
  assert.match(err, /open to anon\/public: .*rounds\.anon_all/);
  assert.match(err, /allow-all \(true\) rules: .*rounds\.anon_all/);
  assert.match(err, /other write rules on rounds: anon_all/);
});

const BREAKS = [
  ['a table without row level security', `ALTER TABLE public.fines DISABLE ROW LEVEL SECURITY`, /row level security off: fines/],
  ['an allow-all rule for members only', `CREATE POLICY open ON public.fines FOR ALL TO authenticated USING (true) WITH CHECK (true)`, /allow-all \(true\) rules: fines\.open/],
  ['anon granted a table', `GRANT SELECT ON public.rounds TO anon`, /anon can use table\(s\): rounds/],
  ['anon granted a column', `GRANT SELECT (name) ON public.players TO anon`, /anon can use table\(s\): players/],
  ['anon granted a function', `GRANT EXECUTE ON FUNCTION public.complete_signup(text, text, numeric, int) TO anon`, /anon can call: complete_signup\(/],
  ['anon given schema private', `GRANT USAGE ON SCHEMA private TO anon`, /anon has USAGE on schema private/],
  ['emails readable', `GRANT SELECT (email) ON public.players TO authenticated`, /players\.email readable by: authenticated/],
  ['the audit writer callable', `GRANT EXECUTE ON FUNCTION private.audit(text, bigint, jsonb, bigint) TO authenticated`, /private\.audit callable by: authenticated/],
  ['members granted audit_log writes', `GRANT INSERT ON public.audit_log TO authenticated`, /members can write audit_log/],
  ['a round trigger dropped', `DROP TRIGGER audit_rounds ON public.rounds`, /missing on rounds: audit_rounds/],
  ['a round rule widened', `CREATE POLICY p2_extra ON public.rounds FOR UPDATE TO authenticated USING (private.is_member())`, /other write rules on rounds: p2_extra/],
];
for (const [what, sql, want] of BREAKS) test(`caught: ${what}`, async () => {
  const db = await production();
  await db.exec(sql);
  assert.match(await check(db), want);
});

test('lists every problem at once, not just the first', async () => {
  const db = await production();
  await db.exec(`ALTER TABLE public.fines DISABLE ROW LEVEL SECURITY; GRANT SELECT ON public.rounds TO anon`);
  const err = await check(db);
  assert.match(err, /row level security off: fines/);
  assert.match(err, /anon can use table\(s\): rounds/);
});
