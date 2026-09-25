import test from 'node:test'; import assert from 'node:assert/strict';
import { productionDb, as, persona, run, sqlFile } from './testbed.mjs';
const REAL = f => sqlFile(f).replace('SELECT true AS rehearsal', 'SELECT false AS rehearsal');
const one = async (db, q, p) => (await db.query(q, p)).rows[0];
// 'denied' = refused by RLS or a trigger (42501); any other error shows its own SQLSTATE.
const tryQ = async (db, sql) => { try { const r = await db.query(sql); return r.rows.length || r.affectedRows; } catch (e) { return e.code === '42501' ? 'denied' : (e.code || e.message); } };
// Back to the superuser with no login claims — as() leaves claims set, and the league triggers read auth.uid().
const su = async db => { await db.exec('RESET ROLE'); await db.query(`SELECT set_config('request.jwt.claims', '{}', false)`); };

async function world() {
  const db = await productionDb();
  assert.equal(await run(db, REAL('phase2a_auth.sql')), null);
  assert.equal(await run(db, REAL('matchplay_league.sql')), null);
  await su(db);
  await db.query(`UPDATE public.players SET approved=false WHERE id=5`);
  const id = async (q, p) => (await one(db, q + ' RETURNING id', p)).id;
  const L = await id(`INSERT INTO public.tournaments(name,date,tee_id,format,status,buy_in,deadlines) VALUES ('Matchplay 2027','2027-04-01','57','league','drawn',200,'{"group_1":"2027-05-15"}')`);
  const E = await id(`INSERT INTO public.tournaments(name,date,tee_id,format,status,buy_in) VALUES ('Next league','2028-04-01','57','league','entry',200)`);
  const TD = (await one(db, `SELECT min(id) AS id FROM public.tournaments WHERE format='team_day'`)).id;
  const M = (round, num, stage, bracket, a, b, status = 'pending', result = null) => id(
    `INSERT INTO public.tournament_matches(tournament_id,round,match_num,stage,bracket,team_a_p1_id,team_b_p1_id,status,result) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [L, round, num, stage, bracket, a, b, status, result]);
  const m = {
    own: await M(1, 1, 'group', null, 2, 3, 'in_progress'),     // the member (player 2) plays in this one
    other: await M(1, 2, 'group', null, 3, 4, 'in_progress'),   // … and not in this one
    done: await M(2, 1, 'group', null, 2, 4, 'complete', 'a'),  // finished; the member won
    semiEmpty: await M(4, 1, 'semi', 1, null, null),
    semiFilled: await M(4, 2, 'semi', 1, 6, 7),
    semiStarted: await M(4, 3, 'semi', 2, 6, null),                 // one slot filled, has a score: started
    semiStaleStatus: await M(4, 4, 'semi', 3, null, null, 'in_progress'), // stale status cache, never actually started
    td: await id(`INSERT INTO public.tournament_matches(tournament_id,round,match_num) VALUES ($1,2,1)`, [TD]),
  };
  await db.query(`INSERT INTO public.tournament_scores(match_id,hole,player_id,gross) VALUES ($1,1,3,5)`, [m.other]);
  await db.query(`INSERT INTO public.tournament_scores(match_id,hole,player_id,gross) VALUES ($1,1,6,4)`, [m.semiStarted]);
  await db.query(`INSERT INTO public.tournament_scores(match_id,hole,player_id,gross) VALUES ($1,1,9,4)`, [m.td]);
  await db.query(`INSERT INTO public.tournament_players(tournament_id,player_id,team,group_num,seed_pot) VALUES ($1,3,'league',1,2),($1,4,'league',1,3)`, [L]);
  await db.query(`INSERT INTO public.tournament_players(tournament_id,player_id,team) VALUES ($1,3,'league')`, [E]);
  const P = { anon: null, pending: await persona(db, { playerId: 5 }), member: await persona(db, { playerId: 2 }),
    adminNo2fa: await persona(db, { playerId: 1, admin: true }) };
  P.admin = { ...P.adminNo2fa, aal: 'aal2', amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) - 60 }] };
  return { db, P, L, E, TD, m };
}

const SCORE = (mid, hole, pid) => `INSERT INTO public.tournament_scores(match_id,hole,player_id,gross) VALUES (${mid},${hole},${pid},4)`;
const MATCH = (mid, set) => `UPDATE public.tournament_matches SET ${set} WHERE id=${mid}`;
const ENTER = (tid, pid, extra = '', vals = '') => `INSERT INTO public.tournament_players(tournament_id,player_id,team${extra}) VALUES (${tid},${pid},'league'${vals})`;
const MATRIX = [
  // scores: members score only matches they play in (for either player), and only until finished
  ['member', 'score own match (either player)',        w => SCORE(w.m.own, 1, 3), 1],
  ['member', 'score a match they are not in',          w => SCORE(w.m.other, 2, 3), 'denied'],
  ['member', 'score for someone outside the match',    w => SCORE(w.m.own, 1, 9), 'denied'],
  ['member', 'delete a score in a match they are not in', w => `DELETE FROM public.tournament_scores WHERE match_id=${w.m.other}`, 0],
  ['member', 'score own finished match',               w => SCORE(w.m.done, 1, 2), 'denied'],
  ['admin',  'score any match, finished too',          w => SCORE(w.m.done, 1, 2), 1],
  ['anon',   'score any match (PIN route)',            w => SCORE(w.m.other, 2, 3), 1],
  ['member', 'team-day score, not in the match (unchanged)', w => SCORE(w.m.td, 2, 9), 1],
  ['member', 'update any team-day score (unchanged)',  w => `UPDATE public.tournament_scores SET gross=5 WHERE match_id=${w.m.td}`, 1],
  ['member', 'delete any team-day score (unchanged)',  w => `DELETE FROM public.tournament_scores WHERE match_id=${w.m.td}`, 1],
  // match status / result / outcome / players
  ['member', 'close own match',                        w => MATCH(w.m.own, `status='complete', result='a'`), 1],
  ['member', 'change own match tee and start hole',    w => MATCH(w.m.own, `tee_id='54', start_hole=10`), 1],
  ['member', 'close a match they are not in',          w => MATCH(w.m.other, `status='complete', result='a'`), 'denied'],
  ['member', 're-open own finished match',             w => MATCH(w.m.done, `status='in_progress', result=NULL`), 'denied'],
  ['member', 'record an outcome on own match',         w => MATCH(w.m.own, `outcome='walkover', result='a'`), 'denied'],
  ['member', 'change who plays a group match',         w => MATCH(w.m.own, `team_b_p1_id=9`), 'denied'],
  ['member', 'fill an empty playoff slot',             w => MATCH(w.m.semiEmpty, `team_a_p1_id=2, team_b_p1_id=9`), 1],
  ['member', 'overwrite a filled playoff slot',        w => MATCH(w.m.semiFilled, `team_a_p1_id=2`), 'denied'],
  ['member', 'empty a filled playoff slot',            w => MATCH(w.m.semiFilled, `team_a_p1_id=NULL`), 'denied'],
  // a started match's players are fixed for everyone (P0001, not 42501: no admin-mode prompt can help)
  ['member', 'fill a slot on a playoff match that has already started (a score exists)', w => MATCH(w.m.semiStarted, `team_b_p1_id=9`), 'P0001'],
  ['admin',  'change who plays in a started playoff match (a score exists)', w => MATCH(w.m.semiStarted, `team_b_p1_id=9`), 'P0001'],
  ['admin',  'change who plays in a started group match',  w => MATCH(w.m.other, `team_b_p1_id=9`), 'P0001'],
  ['anon',   'change who plays in a started match (PIN route)', w => MATCH(w.m.semiStarted, `team_b_p1_id=9`), 'P0001'],
  ['admin',  'fill an empty, unstarted playoff slot',      w => MATCH(w.m.semiEmpty, `team_a_p1_id=2, team_b_p1_id=9`), 1],
  ['admin',  'empty a filled, unstarted playoff slot',     w => MATCH(w.m.semiFilled, `team_a_p1_id=NULL, team_b_p1_id=NULL`), 1],
  ['member', 'team-day match players (unchanged)',         w => MATCH(w.m.td, `team_a_p1_id=2`), 1],
  ['member', 'fill an empty slot despite a stale in_progress status cache (never actually started)', w => MATCH(w.m.semiStaleStatus, `team_a_p1_id=2, team_b_p1_id=9`), 1],
  ['member', 'move a team-day match into a league',    w => MATCH(w.m.td, `tournament_id=${w.L}, stage='group', round=1, match_num=9`), 'denied'],
  ['adminNo2fa', 'record an outcome',                  w => MATCH(w.m.other, `outcome='walkover', result='a'`), 'denied'],
  ['admin',  'record an outcome',                      w => MATCH(w.m.other, `outcome='walkover', result='a'`), 1],
  ['admin',  're-open a finished match',               w => MATCH(w.m.done, `status='in_progress', result=NULL`), 1],
  ['admin',  'rebuild a filled playoff slot',          w => MATCH(w.m.semiFilled, `team_a_p1_id=2`), 1],
  ['anon',   'record an outcome (PIN route)',          w => MATCH(w.m.other, `outcome='walkover', result='a'`), 1],
  // the league row itself
  ['member', 'move a league deadline',                 w => `UPDATE public.tournaments SET deadlines='{}' WHERE id=${w.L}`, 'denied'],
  ['member', 'rename a team-day tournament (unchanged)', w => `UPDATE public.tournaments SET name='Cup' WHERE id=${w.TD}`, 1],
  ['admin',  'move a league deadline',                 w => `UPDATE public.tournaments SET deadlines='{}' WHERE id=${w.L}`, 1],
  // entries
  ['member', 'enter self in an open league',           w => ENTER(w.E, 2), 1],
  ['member', 'enter someone else',                     w => ENTER(w.E, 6), 'denied'],
  ['member', 'enter self as paid',                     w => ENTER(w.E, 2, ',paid_at,amount', ',now(),200'), 'denied'],
  ['member', 'enter self with an earlier sign-up time', w => ENTER(w.E, 2, ',entered_at', `,now()-interval '1 day'`), 'denied'],
  ['member', 'enter self already placed in a group',   w => ENTER(w.E, 2, ',group_num,seed_pot', ',1,1'), 'denied'],
  ['member', 'enter self into a drawn league',         w => ENTER(w.L, 2), 'denied'],
  ['member', 'mark someone paid',                      w => `UPDATE public.tournament_players SET paid_at=now(), amount=200 WHERE tournament_id=${w.E}`, 0],
  ['pending', 'enter self',                            w => ENTER(w.E, 5), 'denied'],
  ['admin',  'mark an entry paid',                     w => `UPDATE public.tournament_players SET paid_at=now(), amount=200 WHERE tournament_id=${w.E} AND player_id=3`, 1],
  ['admin',  'enter a player',                         w => ENTER(w.E, 6), 1],
];
for (const [who, what, sql, want] of MATRIX) test(`${who}: ${what}`, async () => {
  const w = await world(); await as(w.db, w.P[who]);
  assert.equal(await tryQ(w.db, sql(w)), want);
});

test('a member withdraws their own league entry only while unpaid and before the draw', async () => {
  const { db, P, E } = await world();
  const del = `DELETE FROM public.tournament_players WHERE tournament_id=${E} AND player_id=2`;
  await as(db, P.member);
  await db.query(ENTER(E, 2));
  assert.equal(await tryQ(db, `UPDATE public.tournament_players SET paid_at=now(), amount=200 WHERE tournament_id=${E} AND player_id=2`), 0);
  assert.equal(await tryQ(db, del), 1);
  await db.query(ENTER(E, 2));
  await su(db); await db.query(`UPDATE public.tournament_players SET paid_at=now(), amount=200 WHERE tournament_id=${E} AND player_id=2`);
  await as(db, P.member); assert.equal(await tryQ(db, del), 0);                 // paid: stays
  await su(db); await db.query(`UPDATE public.tournament_players SET paid_at=NULL, amount=NULL WHERE tournament_id=${E} AND player_id=2`);
  await db.query(`UPDATE public.tournaments SET status='drawn' WHERE id=${E}`);
  await as(db, P.member); assert.equal(await tryQ(db, del), 0);                 // drawn: stays
});

test('an admin outcome starts a match too: its players are fixed until the outcome is cleared', async () => {
  const { db, P, m } = await world(); await as(db, P.admin);
  assert.equal(await tryQ(db, MATCH(m.semiFilled, `outcome='double_forfeit', result='b'`)), 1);
  assert.equal(await tryQ(db, MATCH(m.semiFilled, `team_a_p1_id=8`)), 'P0001');
  assert.equal(await tryQ(db, MATCH(m.semiFilled, `outcome='played', result=NULL, team_a_p1_id=8`)), 'P0001');   // not in one go either
  assert.equal(await tryQ(db, MATCH(m.semiFilled, `outcome='played', result=NULL`)), 1);
  assert.equal(await tryQ(db, MATCH(m.semiFilled, `team_a_p1_id=8`)), 1);
});

test('clearing a league match (all its scores deleted) is audited once; team day is not', async () => {
  const { db, P, L, m } = await world(); await as(db, P.admin);
  await db.query(SCORE(m.other, 2, 4));
  assert.equal(await tryQ(db, `DELETE FROM public.tournament_scores WHERE match_id=${m.other}`), 2);
  assert.equal(await tryQ(db, `DELETE FROM public.tournament_scores WHERE match_id=${m.td}`), 1);
  await su(db);
  const rows = (await db.query(`SELECT action, actor_player_id, details FROM public.audit_log WHERE action='match_scores_cleared'`)).rows;
  assert.deepEqual(rows.map(r => [r.actor_player_id, r.details]), [[1, { tournament_id: L, match_id: m.other, scores: 2 }]]);
});

test('one score per player per hole: a duplicate is refused, re-entry is an upsert (league and team day)', async () => {
  const { db, P, m } = await world();
  const UPSERT = (mid, hole, pid, g) => `INSERT INTO public.tournament_scores(match_id,hole,player_id,gross) VALUES (${mid},${hole},${pid},${g})
    ON CONFLICT (match_id,hole,player_id) DO UPDATE SET gross=EXCLUDED.gross`;
  await as(db, P.member);
  assert.equal(await tryQ(db, SCORE(m.own, 1, 3)), 1);
  assert.equal(await tryQ(db, SCORE(m.own, 1, 3)), '23505');
  assert.equal(await tryQ(db, UPSERT(m.own, 1, 3, 6)), 1);
  assert.equal(await tryQ(db, UPSERT(m.td, 1, 9, 7)), 1);        // team day: any member, as before
  assert.equal(await tryQ(db, UPSERT(m.other, 1, 3, 2)), 'denied'); // not their match
  await as(db, null);
  assert.equal(await tryQ(db, UPSERT(m.own, 1, 3, 5)), 1);        // PIN route
  await su(db);
  assert.equal((await one(db, `SELECT gross FROM public.tournament_scores WHERE match_id=${m.own} AND hole=1 AND player_id=3`)).gross, 5);
  assert.equal((await one(db, `SELECT gross FROM public.tournament_scores WHERE match_id=${m.td} AND hole=1 AND player_id=9`)).gross, 7);
});

test('the migration refuses to run over duplicate scores, changing nothing', async () => {
  const db = await productionDb();
  assert.equal(await run(db, REAL('phase2a_auth.sql')), null);
  const TD = (await one(db, `SELECT min(id) AS id FROM public.tournaments`)).id;
  const mid = (await one(db, `INSERT INTO public.tournament_matches(tournament_id,round,match_num) VALUES ($1,2,1) RETURNING id`, [TD])).id;
  await db.query(`INSERT INTO public.tournament_scores(match_id,hole,player_id,gross) VALUES ($1,1,9,4),($1,1,9,5)`, [mid]);
  assert.match(await run(db, REAL('matchplay_league.sql')), /duplicate score/);
  assert.equal((await one(db, `SELECT count(*)::int n FROM information_schema.columns WHERE table_name='tournaments' AND column_name='format'`)).n, 0);
});

test('a member cannot withdraw once placed in a group (a draw part-done)', async () => {
  const { db, P, E } = await world();
  await db.query(`INSERT INTO public.tournament_players(tournament_id,player_id,team,group_num,seed_pot) VALUES ($1,2,'league',1,1)`, [E]);
  await as(db, P.member);
  assert.equal(await tryQ(db, `DELETE FROM public.tournament_players WHERE tournament_id=${E} AND player_id=2`), 0);
});

test('team CHECK: production\'s (a, b) is replaced by (a, b, league) whatever its name; rollback restores (a, b)', async () => {
  const db = await productionDb();
  assert.equal(await run(db, REAL('phase2a_auth.sql')), null);
  const TD = (await one(db, `SELECT min(id) AS id FROM public.tournaments`)).id;
  const JOIN = (tid, team) => `INSERT INTO public.tournament_players(tournament_id,player_id,team) VALUES (${tid},9,'${team}')`;
  assert.equal(await tryQ(db, JOIN(TD, 'league')), '23514');   // the testbed carries production's CHECK
  await db.exec(`ALTER TABLE public.tournament_players RENAME CONSTRAINT tournament_players_team_check TO some_other_name`);
  assert.equal(await run(db, REAL('matchplay_league.sql')), null);
  const teamChecks = async () => (await db.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint
    WHERE conrelid='public.tournament_players'::regclass AND contype='c' AND pg_get_constraintdef(oid) ~ '\\mteam\\M'`)).rows.map(r => r.d);
  assert.equal((await teamChecks()).length, 1);
  const L = (await one(db, `INSERT INTO public.tournaments(name,date,tee_id,format,status) VALUES ('L','2027-04-01','57','league','entry') RETURNING id`)).id;
  assert.equal(await tryQ(db, JOIN(L, 'league')), 1);
  assert.equal(await tryQ(db, `UPDATE public.tournament_players SET team='x' WHERE tournament_id=${L}`), '23514');
  assert.equal(await run(db, sqlFile('matchplay_league_rollback.sql')), null);
  assert.equal((await teamChecks()).length, 1);
  assert.equal(await tryQ(db, JOIN(TD, 'league')), '23514');
  assert.equal(await tryQ(db, JOIN(TD, 'a')), 1);
  assert.equal(await run(db, sqlFile('matchplay_league_rollback.sql')), null);   // still safe to re-run
  assert.equal((await teamChecks()).length, 1);
});

test('rollback reports what it deletes', async () => {
  const { db, L, E } = await world();
  await db.query(`UPDATE public.tournament_players SET paid_at=now(), amount=200 WHERE tournament_id=$1 AND player_id=3`, [L]);
  const notes = [];
  await db.exec(sqlFile('matchplay_league_rollback.sql'), { onNotice: n => notes.push(n.message) });
  assert.ok(notes.some(n => /2 league tournament\(s\), 3 entries \(1 paid\), 7 matches/.test(n)), notes.join(' | '));
  assert.ok(E);
});

test('the league CHECKs hold', async () => {
  const { db, m, L, E } = await world();
  const bad = [
    MATCH(m.semiFilled, `outcome='halve_decision', result='half'`),  // halve by decision: group only
    MATCH(m.other, `outcome='walkover'`),                             // a walkover needs a winner
    MATCH(m.semiFilled, `outcome='double_forfeit'`),                  // playoff: name who goes through
    MATCH(m.td, `outcome='walkover', result='a'`),                    // outcomes are league-only
    MATCH(m.own, `start_hole=5`),
    MATCH(m.own, `stage='quarter'`),
    MATCH(m.own, `bracket=1`),                                        // group matches have no bracket
    `UPDATE public.tournaments SET format='cup' WHERE id=${L}`,
    `UPDATE public.tournaments SET buy_in=-1 WHERE id=${L}`,
    `UPDATE public.tournament_players SET paid_at=now() WHERE tournament_id=${E}`,   // paid_at without amount
    `UPDATE public.tournament_players SET seed_pot=5 WHERE tournament_id=${E}`,
  ];
  for (const sql of bad) assert.equal(await tryQ(db, sql), '23514', sql);
  assert.equal(await tryQ(db, MATCH(m.own, `played_on='not-a-date'`)), '22007');   // a date column
  assert.equal(await tryQ(db, MATCH(m.semiFilled, `outcome='double_forfeit', result='b'`)), 1);
  assert.equal(await tryQ(db, MATCH(m.other, `outcome='double_forfeit', result=NULL`)), 1);
  assert.equal(await tryQ(db, MATCH(m.own, `outcome='halve_decision', result='half'`)), 1);
});

test('one row per league match slot and one entry per player', async () => {
  const { db, L, E, TD } = await world();
  assert.equal(await tryQ(db, `INSERT INTO public.tournament_matches(tournament_id,round,match_num,stage) VALUES (${L},1,1,'group')`), '23505');
  assert.equal(await tryQ(db, `INSERT INTO public.tournament_matches(tournament_id,round,match_num) VALUES (${TD},2,1)`), 1);  // team day: unchanged
  assert.equal(await tryQ(db, ENTER(E, 3)), '23505');
});

test('entries, payments and admin match decisions are audited; a player closing their own match is not', async () => {
  const { db, P, L, E, m } = await world();
  await as(db, P.member); await db.query(MATCH(m.own, `status='complete', result='a'`));
  await as(db, P.admin);
  await db.query(ENTER(E, 6));
  await db.query(`UPDATE public.tournament_players SET paid_at=now(), amount=200, recorded_by=1 WHERE tournament_id=${E} AND player_id=6`);
  await db.query(`UPDATE public.tournament_players SET paid_at=NULL, amount=NULL, recorded_by=NULL WHERE tournament_id=${E} AND player_id=6`);
  await db.query(`DELETE FROM public.tournament_players WHERE tournament_id=${E} AND player_id=6`);
  await db.query(MATCH(m.other, `outcome='walkover', result='b'`));
  await db.query(MATCH(m.done, `status='in_progress', result=NULL`));
  await db.query(MATCH(m.semiFilled, `team_a_p1_id=8`));
  await su(db);
  const six = (await db.query(`SELECT action, actor_player_id, details FROM public.audit_log WHERE target_player_id=6 ORDER BY id`)).rows;
  assert.deepEqual(six.map(r => r.action), ['league_entered', 'league_paid', 'league_unpaid', 'league_withdrawn']);
  assert.equal(six[0].actor_player_id, 1);
  assert.deepEqual(six[1].details, { tournament_id: E, amount: 200 });
  const ms = (await db.query(`SELECT action, details FROM public.audit_log WHERE action LIKE 'match_%' ORDER BY id`)).rows;
  assert.deepEqual(ms.map(r => r.action), ['match_outcome', 'match_edited', 'match_players_changed']);
  assert.deepEqual(ms[0].details, { tournament_id: L, match_id: m.other, outcome: 'walkover', result: 'b' });
  assert.deepEqual(ms[1].details, { tournament_id: L, match_id: m.done, from: 'a', to: null, status: 'in_progress' });
  assert.deepEqual(ms[2].details, { tournament_id: L, match_id: m.semiFilled, from: [6, 7], to: [8, 7] });
});

test('rehearsal changes nothing; a second real run refuses; rollback removes the league and keeps team day', async () => {
  const db = await productionDb();
  assert.equal(await run(db, REAL('phase2a_auth.sql')), null);
  const col = async () => (await one(db, `SELECT count(*)::int n FROM information_schema.columns WHERE table_name='tournaments' AND column_name='format'`)).n;
  const rehearsal = await run(db, sqlFile('matchplay_league.sql'));
  assert.match(rehearsal, /REHEARSAL OK/);
  assert.match(rehearsal, /tournament_players team CHECK: a, b, league/);
  assert.match(rehearsal, /tournament_scores: one row per match, hole and player/);
  assert.equal(await col(), 0);
  assert.equal(await run(db, REAL('matchplay_league.sql')), null);
  assert.equal((await one(db, `SELECT count(*)::int n FROM public.tournaments WHERE format <> 'team_day'`)).n, 0);   // existing rows: team day
  assert.equal((await one(db, `SELECT count(*)::int n FROM public.tournament_players WHERE entered_at IS NULL`)).n, 0);
  assert.match(await run(db, REAL('matchplay_league.sql')), /already set up/);
  const teamDay = (await one(db, `SELECT count(*)::int n FROM public.tournaments`)).n;
  await db.query(`INSERT INTO public.tournaments(name,date,tee_id,format,status) VALUES ('L','2027-04-01','57','league','entry')`);
  assert.equal(await run(db, sqlFile('matchplay_league_rollback.sql')), null);
  assert.equal(await col(), 0);
  assert.equal((await one(db, `SELECT count(*)::int n FROM public.tournaments`)).n, teamDay);
  assert.equal((await one(db, `SELECT count(*)::int n FROM pg_proc WHERE proname IN ('is_league','league_open','may_score','protect_league','protect_league_match','audit_league_players','audit_league_match')`)).n, 0);
  assert.equal((await one(db, `SELECT count(*)::int n FROM pg_policies WHERE policyname LIKE 'p2_tplayer_%' OR policyname LIKE 'p2_tscore_league_%'`)).n, 0);
  assert.equal(await run(db, sqlFile('matchplay_league_rollback.sql')), null);   // safe to re-run
  assert.equal(await run(db, REAL('matchplay_league.sql')), null);               // and re-applicable
});

test('refuses to run before Phase 2 release A', async () => {
  const db = await productionDb();
  assert.match(await run(db, REAL('matchplay_league.sql')), /phase2a_auth\.sql must be applied first/);
});
