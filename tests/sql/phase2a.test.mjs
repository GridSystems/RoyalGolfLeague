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

test('an unlinked login is linked on its next sign-in once an admin fixes the player email', async () => {
  const db = await productionDb(); await run(db, REAL());
  const u = (await one(db, `INSERT INTO auth.users(email, email_confirmed_at) VALUES ('typo@x.dk', now()) RETURNING id`)).id;
  assert.equal((await one(db, `SELECT count(*)::int n FROM public.players WHERE user_id=$1`, [u])).n, 0, 'unlinked at confirmation');
  await db.query(`UPDATE public.players SET email='typo@x.dk' WHERE id=4`);         // the admin corrects the email on file
  await db.query(`UPDATE auth.users SET last_sign_in_at=now() WHERE id=$1`, [u]);
  assert.equal((await one(db, `SELECT user_id::text u FROM public.players WHERE id=4`)).u, u);
});

test('a later sign-in never recreates a rejected applicant', async () => {
  const db = await productionDb(); await run(db, REAL());
  const u = (await one(db, `INSERT INTO auth.users(email, raw_user_meta_data) VALUES ('nope@x.dk', '{"name":"Nope","dgu_number":"900-9"}') RETURNING id`)).id;
  await db.query(`UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1`, [u]);
  assert.equal((await one(db, `SELECT count(*)::int n FROM public.players WHERE user_id=$1`, [u])).n, 1, 'pending player created at confirmation');
  await db.query(`DELETE FROM public.players WHERE user_id=$1`, [u]);             // the admin rejects the sign-up
  await db.query(`UPDATE auth.users SET last_sign_in_at=now() WHERE id=$1`, [u]);
  assert.equal((await one(db, `SELECT count(*)::int n FROM public.players WHERE lower(email)='nope@x.dk'`)).n, 0);
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

const audits = async db => (await db.query(`SELECT action, actor_player_id a, target_player_id t, details d FROM public.audit_log ORDER BY id`)).rows;

test('a member cannot change protected fields; an admin in admin mode can, and it is logged', async () => {
  const db = await productionDb(); await run(db, REAL());
  const m = await persona(db, { playerId: 2 });
  await as(db, m);
  await assert.rejects(db.query(`UPDATE public.players SET is_admin=true WHERE id=2`), /admin/i);
  await db.query(`UPDATE public.players SET name='Renamed' WHERE id=2`);           // own profile field: fine
  const a = await persona(db, { playerId: 1, admin: true, aal: 'aal2', totpAgeSec: 60 });
  await as(db, a);
  await db.query(`UPDATE public.players SET is_admin=true WHERE id=2`);
  await as(db, null); await db.exec('RESET ROLE');
  assert.deepEqual((await audits(db)).filter(x => x.action === 'admin_granted').map(x => [Number(x.a), Number(x.t)]), [[1, 2]]);
});

test('the old PIN route (public key) is unchanged at release A', async () => {
  const db = await productionDb(); await run(db, REAL());
  await as(db, null);
  await db.query(`UPDATE public.players SET approved=true WHERE id=2`);           // no token: passes, as today
});

test('money trail: payments recorded/deleted and fines deleted are logged', async () => {
  const db = await productionDb(); await run(db, REAL());
  const a = await persona(db, { playerId: 1, admin: true, aal: 'aal2', totpAgeSec: 60 });
  await as(db, a);
  const pay = (await one(db, `INSERT INTO public.fine_payments(player_id, amount, date, recorded_by) VALUES (2, 50, '2026-10-01', 1) RETURNING id`)).id;
  await db.query(`DELETE FROM public.fine_payments WHERE id=$1`, [pay]);
  const f = (await one(db, `SELECT id FROM public.fines ORDER BY id LIMIT 1`)).id;
  await db.query(`DELETE FROM public.fines WHERE id=$1`, [f]);
  await as(db, null); await db.exec('RESET ROLE');
  const acts = (await audits(db)).map(x => x.action);
  assert.deepEqual(acts.filter(x => /payment|fine/.test(x)), ['payment_recorded', 'payment_deleted', 'fine_deleted']);
  assert.equal((await audits(db)).find(x => x.action === 'payment_recorded').d.amount, 50);
});

test('auth events are logged without email addresses or IPs', async () => {
  const db = await productionDb(); await run(db, REAL());
  const m = await persona(db, { playerId: 2 });
  await db.query(`UPDATE auth.users SET recovery_sent_at=now() WHERE id=$1`, [m.sub]);
  await db.query(`UPDATE auth.users SET encrypted_password='x' WHERE id=$1`, [m.sub]);
  await db.query(`UPDATE auth.users SET last_sign_in_at=now() WHERE id=$1`, [m.sub]);
  await db.query(`UPDATE auth.users SET email='new@x.dk' WHERE id=$1`, [m.sub]);
  await db.query(`INSERT INTO auth.mfa_factors(user_id, factor_type, status) VALUES ($1,'totp','verified')`, [m.sub]);
  const rows = await audits(db);
  for (const act of ['login_set_up', 'reset_requested', 'password_changed', 'login', 'email_changed', 'mfa_enrolled'])
    assert.ok(rows.some(r => r.action === act && Number(r.t) === 2), act);
  assert.ok(!JSON.stringify(rows).includes('@'), 'no email addresses in the log');
});

test('an audit failure never blocks a login', async () => {
  const db = await productionDb(); await run(db, REAL());
  await db.exec(`ALTER TABLE public.audit_log ADD CONSTRAINT boom CHECK (false)`);
  const u = (await one(db, `INSERT INTO auth.users(email) VALUES ('x@x.dk') RETURNING id`)).id;
  await db.query(`UPDATE auth.users SET email_confirmed_at=now(), last_sign_in_at=now() WHERE id=$1`, [u]);   // must not throw
});

test('log_admin_mode logs only for a real admin in admin mode', async () => {
  const db = await productionDb(); await run(db, REAL());
  const m = await persona(db, { playerId: 2 });
  const a = await persona(db, { playerId: 1, admin: true, aal: 'aal2', totpAgeSec: 60 });
  await as(db, m); assert.equal((await one(db, `SELECT public.log_admin_mode() r`)).r, false);
  await as(db, a); assert.equal((await one(db, `SELECT public.log_admin_mode() r`)).r, true);
  await as(db, null); await db.exec('RESET ROLE');
  assert.equal((await audits(db)).filter(x => x.action === 'admin_mode_unlocked').length, 1);
});

test('entries older than 12 months are trimmed on the next insert', async () => {
  const db = await productionDb(); await run(db, REAL());
  await db.query(`INSERT INTO public.audit_log(at, action) VALUES (now() - interval '13 months', 'old')`);
  await db.query(`SELECT private.audit('new', NULL, NULL)`);
  assert.deepEqual((await audits(db)).map(x => x.action).filter(x => x === 'old' || x === 'new'), ['new']);
});

test('members cannot read or write the audit log', async () => {
  const db = await productionDb(); await run(db, REAL());
  const m = await persona(db, { playerId: 2 });
  await as(db, m);
  assert.equal((await db.query(`SELECT * FROM public.audit_log`)).rows.length, 0);
  await assert.rejects(db.query(`INSERT INTO public.audit_log(action) VALUES ('forged')`));
});

test('private.audit() cannot be called directly by a member or anon — no forging audit rows', async () => {
  const db = await productionDb(); await run(db, REAL());
  const m = await persona(db, { playerId: 2 });
  await as(db, m);
  await assert.rejects(db.query(`SELECT private.audit('forged', NULL, NULL)`), /permission denied/i);
  await as(db, null);
  await assert.rejects(db.query(`SELECT private.audit('forged', NULL, NULL)`), /permission denied/i);
  await db.exec('RESET ROLE');
  assert.equal((await db.query(`SELECT * FROM public.audit_log WHERE action = 'forged'`)).rows.length, 0);
});

test('rollback restores release-A-free state and gate 2', async () => {
  const db = await productionDb();
  const before = (await db.query(`SELECT policyname, roles::text FROM pg_policies WHERE schemaname='public' ORDER BY 1,2`)).rows;
  await run(db, REAL());
  assert.equal(await run(db, sqlFile('phase2a_rollback.sql')), null);
  assert.equal((await one(db, `SELECT count(*)::int n FROM information_schema.columns WHERE table_name='players' AND column_name='user_id'`)).n, 0);
  assert.equal((await one(db, `SELECT count(*)::int n FROM pg_policies WHERE policyname LIKE 'p2%'`)).n, 0);
  assert.equal((await one(db, `SELECT count(*)::int n FROM information_schema.triggers WHERE event_object_schema IN ('auth','public') AND trigger_name IN ('link_login','audit_auth_users','audit_mfa')`)).n, 0);
  await db.query(`SELECT set_config('request.headers', '{"x-app-version":"2"}', false)`);
  await db.query(`SELECT public.require_current_app()`);
  // The restored policy set is exactly what it was before release A (anon_all TO anon,
  // authenticated on every table, no p2_*), not just "no p2_* left".
  const after = (await db.query(`SELECT policyname, roles::text FROM pg_policies WHERE schemaname='public' ORDER BY 1,2`)).rows;
  assert.deepEqual(after, before);
});

test('rollback removes every release-A object: private schema, audit_log, saturday_signups draw-field trigger, version-3 gate', async () => {
  const db = await productionDb();
  await run(db, REAL());
  assert.equal(await run(db, sqlFile('phase2a_rollback.sql')), null);
  assert.equal((await one(db, `SELECT count(*)::int n FROM information_schema.schemata WHERE schema_name='private'`)).n, 0);
  assert.equal((await one(db, `SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_name='audit_log'`)).n, 0);
  assert.equal((await one(db, `SELECT count(*)::int n FROM information_schema.triggers WHERE event_object_schema='public' AND event_object_table='saturday_signups' AND trigger_name='protect_signup_fields'`)).n, 0);
  assert.equal((await one(db, `SELECT count(*)::int n FROM information_schema.routines WHERE routine_schema='public' AND routine_name IN ('run_draw','admin_member_emails','log_admin_mode')`)).n, 0);
  await db.query(`SELECT set_config('request.headers', '{"x-app-version":"2"}', false)`);
  await db.query(`SELECT public.require_current_app()`);   // version 2 still accepted
  await db.query(`SELECT set_config('request.headers', '{"x-app-version":"3"}', false)`);
  await db.query(`SELECT public.require_current_app()`);   // version 3 also accepted (gate only has a floor)
});

test('rollback restores Phase 1 column-level grants on players for authenticated', async () => {
  const db = await productionDb();
  await run(db, REAL());
  assert.equal(await run(db, sqlFile('phase2a_rollback.sql')), null);
  const cols = async priv => (await db.query(
    `SELECT column_name FROM information_schema.column_privileges
      WHERE table_name = 'players' AND grantee = 'authenticated' AND privilege_type = $1 ORDER BY column_name`, [priv]
  )).rows.map(r => r.column_name);
  assert.deepEqual(await cols('SELECT'),
    ['approved', 'archived_at', 'bag', 'color', 'created_at', 'dgu_number', 'handicap', 'hcp_history', 'id', 'is_admin', 'is_social', 'legacy_id', 'name']);
  assert.deepEqual(await cols('UPDATE'),
    ['approved', 'archived_at', 'bag', 'color', 'dgu_number', 'email', 'handicap', 'hcp_history', 'is_admin', 'is_social', 'name']);
  // Behavioural check, not just catalog: an authenticated visitor (old PIN-route shape, no login
  // linked) can still read and update the Phase 1 columns, and user_id no longer exists to query.
  await db.exec('RESET ROLE');
  await db.query(`SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', false)`);
  await db.exec('SET ROLE authenticated');
  const row = await one(db, `SELECT id, name, color, handicap, hcp_history, created_at, is_admin, approved,
    is_social, bag, dgu_number, archived_at, legacy_id FROM public.players WHERE id = 2`);
  assert.equal(row.id, 2);
  await db.query(`UPDATE public.players SET name = 'Still Works' WHERE id = 2`);
  await assert.rejects(db.query(`SELECT user_id FROM public.players WHERE id = 2`), /column .*user_id.* does not exist/i);
  await db.exec('RESET ROLE');
});

test('rollback is re-applicable: REAL, rollback, REAL again succeeds', async () => {
  const db = await productionDb();
  assert.equal(await run(db, REAL()), null);
  assert.equal(await run(db, sqlFile('phase2a_rollback.sql')), null);
  assert.equal(await run(db, REAL()), null);
  assert.equal((await one(db, `SELECT count(*)::int n FROM information_schema.columns WHERE table_name='players' AND column_name='user_id'`)).n, 1);
});
