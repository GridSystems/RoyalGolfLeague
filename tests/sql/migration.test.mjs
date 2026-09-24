import test from 'node:test'; import assert from 'node:assert/strict';
import { freshDb, dump, run, sqlFile, SNAPSHOT } from './testbed.mjs';
const MIGRATION = () => sqlFile('phase1_ids.sql');
const REAL = () => MIGRATION().replace('SELECT true AS rehearsal', 'SELECT false AS rehearsal');
const one = async (db, q, p) => (await db.query(q, p)).rows[0];
const RENUMBERED = ['players','rounds','fine_types','fines','fine_payments','saturday_events','saturday_signups',
  'tournaments','tournament_players','tournament_matches','tournament_scores'];

test('rehearsal reports and changes nothing', async () => {
  const db = await freshDb(); const before = await dump(db, 'players');
  const err = await run(db, MIGRATION());
  assert.match(err, /REHEARSAL OK/); assert.match(err, /ALL CHECKS PASSED/);
  assert.deepEqual(await dump(db, 'players'), before);
  assert.equal((await one(db, `SELECT count(*)::int n FROM information_schema.schemata WHERE schema_name='phase1_backup'`)).n, 0);
});

test('real run: ids are 1..N and the report says all checks passed', async () => {
  const db = await freshDb(); assert.equal(await run(db, REAL()), null);
  for (const t of RENUMBERED) {
    const r = await one(db, `SELECT count(*)::int n, coalesce(min(id),0)::int mn, coalesce(max(id),0)::int mx FROM public.${t}`);
    if (r.n) assert.deepEqual([r.mn, r.mx], [1, r.n], t);
  }
  const last = (await db.query(`SELECT line FROM phase1_backup.report ORDER BY ord DESC LIMIT 1`)).rows[0].line;
  assert.equal(last, 'ALL CHECKS PASSED');
});

test('real run: orphans resolved as decided, money unchanged', async () => {
  const db = await freshDb();
  const dkk = async () => (await one(db, `SELECT sum(amount)::numeric s, count(*)::int n FROM public.fines`));
  const before = await dkk(); await run(db, REAL()); const after = await dkk();
  assert.equal(String(after.s), String(before.s)); assert.equal(after.n, before.n);
  const fm = await one(db, `SELECT id, archived_at IS NOT NULL AS archived, legacy_id FROM public.players WHERE name='Former member'`);
  assert.ok(fm && fm.archived && fm.legacy_id === null);
  assert.equal((await one(db, `SELECT count(*)::int n FROM public.fines WHERE player_id=$1`, [fm.id])).n, 5);
  assert.equal((await one(db, `SELECT count(*)::int n FROM public.fines f WHERE round_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.rounds r WHERE r.id=f.round_id)`)).n, 0);
  assert.equal((await one(db, `SELECT count(*)::int n FROM public.saturday_signups`)).n, SNAPSHOT.saturday_signups.length - 3);
  assert.equal((await one(db, `SELECT count(*)::int n FROM public.tournament_players`)).n, SNAPSHOT.tournament_players.length - 2);
});

test('real run: every player keeps their rounds (matched by legacy_id)', async () => {
  const db = await freshDb(); await run(db, REAL());
  const want = {}; for (const r of SNAPSHOT.rounds) want[r.player_id] = (want[r.player_id] || 0) + 1;
  const got = (await db.query(`SELECT p.legacy_id::text k, count(*)::int n FROM public.rounds r JOIN public.players p ON p.id=r.player_id GROUP BY 1`)).rows;
  assert.deepEqual(Object.fromEntries(got.map(r => [r.k, r.n])), Object.fromEntries(Object.entries(want).map(([k, n]) => [String(k), n])));
});

test('real run: database assigns ids and refuses invented ones', async () => {
  const db = await freshDb(); await run(db, REAL());
  const n = (await one(db, `SELECT count(*)::int n FROM public.fine_types`)).n;
  assert.equal((await one(db, `INSERT INTO public.fine_types(name, amount) VALUES ('t', 10) RETURNING id::int id`)).id, n + 1);
  await assert.rejects(db.query(`INSERT INTO public.fine_types(id, name, amount) VALUES (1790000000000, 'x', 10)`));
  const g = (await one(db, `SELECT coalesce(max(id),0)::int m FROM public.gps_shots`)).m;
  assert.equal((await one(db, `INSERT INTO public.gps_shots(player_id, hole) VALUES (1, 1) RETURNING id::int id`)).id, g + 1);
});

test('real run: foreign keys behave per the spec', async () => {
  const db = await freshDb(); await run(db, REAL());
  assert.equal((await one(db, `SELECT count(*)::int n FROM pg_constraint WHERE contype='f' AND conname LIKE 'fk\\_%'`)).n, 21);
  const pid = (await one(db, `SELECT player_id FROM public.rounds LIMIT 1`)).player_id;
  await assert.rejects(db.query(`DELETE FROM public.players WHERE id=$1`, [pid]), /foreign key/);
  const f = await one(db, `SELECT id, round_id FROM public.fines WHERE round_id IS NOT NULL LIMIT 1`);
  await db.query(`DELETE FROM public.fines WHERE round_id=$1 AND id<>$2`, [f.round_id, f.id]);
  await db.query(`DELETE FROM public.rounds WHERE id=$1`, [f.round_id]);
  assert.equal((await one(db, `SELECT round_id FROM public.fines WHERE id=$1`, [f.id])).round_id, null);
});

test('real run: archived players cannot log in', async () => {
  const db = await freshDb(); await run(db, REAL());
  await db.query(`UPDATE public.players SET email='a@b.c', pin='1234', archived_at=now() WHERE id=1`);
  assert.equal((await one(db, `SELECT public.login('a@b.c','1234') r`)).r.ok, false);
  await db.query(`UPDATE public.players SET archived_at=NULL WHERE id=1`);
  assert.equal((await one(db, `SELECT public.login('a@b.c','1234') r`)).r.ok, true);
});

test('rehearsal report lists triggers and views on the migrated tables', async () => {
  const db = await freshDb();
  assert.match(await run(db, MIGRATION()), /triggers: 0, views: 0/);
  await db.exec(`CREATE FUNCTION public.noop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
                 CREATE TRIGGER hook AFTER UPDATE ON public.rounds FOR EACH ROW EXECUTE FUNCTION public.noop();
                 CREATE VIEW public.v_rounds AS SELECT id FROM public.rounds;`);
  const msg = await run(db, MIGRATION());
  assert.match(msg, /TRIGGER on rounds: hook \(AFTER UPDATE\)/);
  assert.match(msg, /VIEW public\.v_rounds reads rounds/);
  assert.match(msg, /triggers: 1, views: 1/);
});

test('version gate refuses requests without a current x-app-version', async () => {
  const db = await freshDb(); await run(db, REAL());
  const gate = async headers => {
    await db.query(`SELECT set_config('request.headers', $1, false)`, [JSON.stringify(headers)]);
    try { await db.query(`SELECT public.require_current_app()`); return 'allowed'; } catch (e) { return e.message; }
  };
  assert.match(await gate({}), /out of date/);
  assert.match(await gate({ 'x-app-version': '1' }), /out of date/);
  assert.match(await gate({ 'x-app-version': 'abc' }), /out of date/);
  assert.equal(await gate({ 'x-app-version': '2' }), 'allowed');
  assert.equal(await gate({ 'x-app-version': '3' }), 'allowed');
  const setting = (await db.query(`SELECT array_to_string(setconfig, ',') s FROM pg_db_role_setting WHERE setrole = 'authenticator'::regrole`)).rows[0]?.s || '';
  assert.match(setting, /pgrst\.db_pre_request=public\.require_current_app/);
});

test('guard: a second run changes nothing', async () => {
  const db = await freshDb(); await run(db, REAL()); const before = await dump(db, 'players');
  assert.match(await run(db, REAL()), /already been applied/);
  assert.deepEqual(await dump(db, 'players'), before);
});

test('guard: refuses while a round started today is unfinished', async () => {
  const db = await freshDb();
  const today = (await one(db, `SELECT to_char(now() AT TIME ZONE 'Europe/Copenhagen','YYYY-MM-DD') d`)).d;
  const pid = SNAPSHOT.players[0].id;
  await db.query(`INSERT INTO public.rounds(id, player_id, date, holes) VALUES (1799999999999, $1, $2, '[{"hole":1,"score":null}]')`, [pid, today]);
  assert.match(await run(db, REAL()), /being scored/);
  assert.equal((await one(db, `SELECT count(*)::int n FROM information_schema.columns WHERE table_name='players' AND column_name='legacy_id'`)).n, 0);
});
