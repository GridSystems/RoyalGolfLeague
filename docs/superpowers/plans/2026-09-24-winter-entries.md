# Winter 2027 Entries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-season rules (best N, buy-in) and opt-in paid entry for Winter 2027, plus a header Sign out button.

**Architecture:** Season rules move into the existing `SEASONS` array in `index.html`. A new
`season_entries` table (own SQL script, rehearsal switch, RLS in the Phase 2 release A pattern) records
who entered and who paid. One helper, `inPrizes(p, season)`, replaces the `!p.is_social` prize checks,
so a non-entrant gets no prize place; in an opt-in season they appear only on Today (not in the Season or Eclectic tables).

**Tech Stack:** single-file `index.html` (vanilla JS), Supabase Postgres + PostgREST, PGlite tests
(`tests/sql`, `node --test`), headless Chrome tests (`tests/run.ps1`).

**Spec:** `docs/superpowers/specs/2026-09-24-winter-entries-design.md`

## Global Constraints

- Summer 2026: `best:4, buyIn:250, entry:false`. Winter 2027: `from:'2026-10-04', best:3, buyIn:175, entry:true`. Eclectic stays 0.95 / 0.60.
- `index.html` keeps CRLF line endings; edit with the Edit tool, never rewrite whole lines by regex.
- Every player name put into HTML goes through `escHtml()`.
- The app never sends an `id` on insert (identity columns). `recorded_by` = `activeId` (as the fines ledger does).
- No version-gate change (`APP_VERSION` stays 3). SQL runs before the push.
- Claude never runs SQL against production; the user runs `season_entries.sql` in the Supabase SQL Editor.
- MobilePay link: `https://qr.mobilepay.dk/box/53592791-c6e9-4588-976f-8b187c98c76d/pay-in`.
- Test commands: SQL `cd tests/sql; node --test`; app `powershell -NoProfile -File tests/run.ps1 -Test tests/<file>.js` from the repo root.

## Review Focus

1. Looking back at **Summer 2026** after Winter starts — best 4, everyone non-social in, pot 250 × players, unchanged by any entry rows (Task 3 test "Summer ignores entries").
2. **`season_entries` fails to load** (network, or app pushed before the SQL) — the app must still start; `seasonEntries=[]` (Task 3 test "load failure").
3. **No season taking entries** (after Winter with no next season defined) — banner and admin section say so instead of crashing (Task 2 `entrySeason()` null test; Task 4/5 tests).
4. **Admin undoes a payment** — the pot drops and the "unpaid" tag returns (Task 5 test).
5. **Social or pending member** — never sees Enter (Task 4 test).

---

### Task 1: `season_entries` table, permissions, audit (SQL)

**Files:**
- Create: `supabase/season_entries.sql`, `supabase/season_entries_rollback.sql`
- Test: `tests/sql/entries.test.mjs`

**Interfaces:**
- Produces: table `public.season_entries(id, season text, player_id bigint, entered_at timestamptz, paid_at timestamptz, amount numeric, recorded_by bigint)`, unique `(season, player_id)`; audit actions `season_entered`, `season_withdrawn`, `entry_paid`, `entry_unpaid`.
- Consumes: `private.is_member()`, `private.is_admin()`, `private.current_player()`, `private.audit(text,bigint,jsonb,bigint)` from `phase2a_auth.sql`.

- [ ] **Step 1: Write the failing tests** — `tests/sql/entries.test.mjs`:

```js
import test from 'node:test'; import assert from 'node:assert/strict';
import { productionDb, as, persona, run, sqlFile } from './testbed.mjs';
const REAL = f => sqlFile(f).replace('SELECT true AS rehearsal', 'SELECT false AS rehearsal');
const one = async (db, q, p) => (await db.query(q, p)).rows[0];
const tryQ = async (db, sql) => { try { const r = await db.query(sql); return r.rows.length || r.affectedRows; } catch (e) { return 'denied'; } };
const W = `'Winter 2027'`;

async function world() {
  const db = await productionDb();
  assert.equal(await run(db, REAL('phase2a_auth.sql')), null);
  assert.equal(await run(db, REAL('season_entries.sql')), null);
  await db.exec('RESET ROLE');
  await db.query(`UPDATE public.players SET approved=false WHERE id=5`);
  await db.query(`INSERT INTO public.season_entries(season, player_id) VALUES (${W}, 3)`);                               // unpaid
  await db.query(`INSERT INTO public.season_entries(season, player_id, paid_at, amount) VALUES (${W}, 4, now(), 175)`); // paid
  const P = { anon: null, pending: await persona(db, { playerId: 5 }), member: await persona(db, { playerId: 2 }),
    adminNo2fa: await persona(db, { playerId: 1, admin: true }) };
  P.admin = { ...P.adminNo2fa, aal: 'aal2', amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) - 60 }] };
  return { db, P };
}

const MATRIX = [
  ['anon',       'read entries (PIN route)',  `SELECT id FROM public.season_entries`, 2],
  ['anon',       'enter (PIN route)',         `INSERT INTO public.season_entries(season,player_id) VALUES (${W},6)`, 1],
  ['pending',    'read entries',              `SELECT id FROM public.season_entries`, 0],
  ['pending',    'enter self',                `INSERT INTO public.season_entries(season,player_id) VALUES (${W},5)`, 'denied'],
  ['member',     'read entries',              `SELECT id FROM public.season_entries`, 2],
  ['member',     'enter self',                `INSERT INTO public.season_entries(season,player_id) VALUES (${W},2)`, 1],
  ['member',     'enter someone else',        `INSERT INTO public.season_entries(season,player_id) VALUES (${W},6)`, 'denied'],
  ['member',     'enter self as paid',        `INSERT INTO public.season_entries(season,player_id,paid_at,amount) VALUES (${W},2,now(),175)`, 'denied'],
  ['member',     'mark someone paid',         `UPDATE public.season_entries SET paid_at=now(), amount=175 WHERE player_id=3`, 0],
  ['member',     'withdraw someone else',     `DELETE FROM public.season_entries WHERE player_id=3`, 0],
  ['adminNo2fa', 'mark paid',                 `UPDATE public.season_entries SET paid_at=now(), amount=175 WHERE player_id=3`, 0],
  ['admin',      'mark paid',                 `UPDATE public.season_entries SET paid_at=now(), amount=175 WHERE player_id=3`, 1],
  ['admin',      'enter a player',            `INSERT INTO public.season_entries(season,player_id) VALUES (${W},6)`, 1],
  ['admin',      'remove an entry',           `DELETE FROM public.season_entries WHERE player_id=4`, 1],
];
for (const [who, what, sql, want] of MATRIX) test(`${who}: ${what}`, async () => {
  const { db, P } = await world(); await as(db, P[who]);
  assert.equal(await tryQ(db, sql), want);
});

test('a member withdraws their own entry only while it is unpaid', async () => {
  const { db, P } = await world(); await as(db, P.member);
  await db.query(`INSERT INTO public.season_entries(season,player_id) VALUES (${W},2)`);
  assert.equal(await tryQ(db, `DELETE FROM public.season_entries WHERE player_id=2`), 1);
  await db.query(`INSERT INTO public.season_entries(season,player_id) VALUES (${W},2)`);
  await db.exec('RESET ROLE'); await db.query(`UPDATE public.season_entries SET paid_at=now(), amount=175 WHERE player_id=2`);
  await as(db, P.member);
  assert.equal(await tryQ(db, `DELETE FROM public.season_entries WHERE player_id=2`), 0);
});

test('one entry per player per season', async () => {
  const { db } = await world();
  assert.equal(await tryQ(db, `INSERT INTO public.season_entries(season,player_id) VALUES (${W},3)`), 'denied');
  assert.equal(await tryQ(db, `INSERT INTO public.season_entries(season,player_id) VALUES ('Summer 2027',3)`), 1);
});

test('entered, paid, unpaid and withdrawn are audited, with season and amount only', async () => {
  const { db, P } = await world(); await as(db, P.admin);
  await db.query(`INSERT INTO public.season_entries(season,player_id) VALUES (${W},6)`);
  await db.query(`UPDATE public.season_entries SET paid_at=now(), amount=175 WHERE player_id=6`);
  await db.query(`UPDATE public.season_entries SET paid_at=NULL, amount=NULL WHERE player_id=6`);
  await db.query(`DELETE FROM public.season_entries WHERE player_id=6`);
  await db.exec('RESET ROLE');
  const rows = (await db.query(`SELECT action, actor_player_id, details FROM public.audit_log WHERE target_player_id=6 ORDER BY id`)).rows;
  assert.deepEqual(rows.map(r => r.action), ['season_entered', 'entry_paid', 'entry_unpaid', 'season_withdrawn']);
  assert.equal(rows[0].actor_player_id, 1);
  assert.deepEqual(rows[1].details, { season: 'Winter 2027', amount: 175 });
  assert.deepEqual(Object.keys(rows[3].details), ['season']);
});

test('rehearsal changes nothing; a second real run refuses; rollback removes it all', async () => {
  const db = await productionDb();
  assert.equal(await run(db, REAL('phase2a_auth.sql')), null);
  assert.match(await run(db, sqlFile('season_entries.sql')), /REHEARSAL OK/);
  assert.equal((await one(db, `SELECT to_regclass('public.season_entries') AS t`)).t, null);
  assert.equal(await run(db, REAL('season_entries.sql')), null);
  assert.match(await run(db, REAL('season_entries.sql')), /already exists/);
  assert.equal(await run(db, sqlFile('season_entries_rollback.sql')), null);
  assert.equal((await one(db, `SELECT to_regclass('public.season_entries') AS t`)).t, null);
  assert.equal((await one(db, `SELECT count(*)::int n FROM pg_proc WHERE proname='audit_entries'`)).n, 0);
  assert.equal(await run(db, REAL('season_entries.sql')), null);
});

test('refuses to run before Phase 2 release A', async () => {
  const db = await productionDb();
  assert.match(await run(db, REAL('season_entries.sql')), /phase2a_auth\.sql must be applied first/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests/sql; node --test entries.test.mjs`
Expected: FAIL — `ENOENT … season_entries.sql`.

- [ ] **Step 3: Write `supabase/season_entries.sql`**

```sql
-- Royal Golf Club — season entries (opt-in paid entry, Winter 2027 onwards).
-- Run in the Supabase SQL Editor (project qvjybtcbymexheqrjkai). REHEARSAL FIRST: with the switch on
-- (true) it runs everything, reports, then rolls back. Set it to false for the real run.
-- Needs phase2a_auth.sql (Phase 2 release A). Undo: season_entries_rollback.sql.
BEGIN;
CREATE TEMP TABLE se_mode ON COMMIT DROP AS SELECT true AS rehearsal;   -- ◀◀ THE SWITCH
CREATE TEMP TABLE se_report (ord serial, line text) ON COMMIT DROP;

DO $$ BEGIN
  IF to_regclass('public.season_entries') IS NOT NULL THEN
    RAISE EXCEPTION 'season_entries already exists. Nothing was changed.';
  END IF;
  IF to_regprocedure('private.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'phase2a_auth.sql must be applied first. Nothing was changed.';
  END IF;
END $$;

-- One row per player per season. paid_at null = entered, awaiting payment.
CREATE TABLE public.season_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  season text NOT NULL,
  player_id bigint NOT NULL REFERENCES public.players(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  entered_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  amount numeric,
  recorded_by bigint REFERENCES public.players(id) ON UPDATE CASCADE ON DELETE SET NULL,
  UNIQUE (season, player_id)
);
ALTER TABLE public.season_entries ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.season_entries TO anon, authenticated;

-- The old PIN route keeps allow-all until release B, as on every table.
CREATE POLICY anon_all ON public.season_entries FOR ALL TO anon USING (true) WITH CHECK (true);
-- Members: read all; enter themselves (unpaid); withdraw while unpaid. Admin mode: everything.
CREATE POLICY p2_entry_read ON public.season_entries FOR SELECT TO authenticated USING (private.is_member());
CREATE POLICY p2_entry_ins ON public.season_entries FOR INSERT TO authenticated
  WITH CHECK (private.is_member() AND player_id = private.current_player()
              AND paid_at IS NULL AND amount IS NULL AND recorded_by IS NULL);
CREATE POLICY p2_entry_del ON public.season_entries FOR DELETE TO authenticated
  USING (private.is_member() AND player_id = private.current_player() AND paid_at IS NULL);
CREATE POLICY p2_admin ON public.season_entries FOR ALL TO authenticated
  USING (private.is_admin()) WITH CHECK (private.is_admin());

-- Money trail, like fines and payments: who entered, paid, was un-marked, withdrew.
CREATE FUNCTION private.audit_entries() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM private.audit('season_entered', NEW.player_id, jsonb_build_object('season', NEW.season));
    IF NEW.paid_at IS NOT NULL THEN
      PERFORM private.audit('entry_paid', NEW.player_id, jsonb_build_object('season', NEW.season, 'amount', NEW.amount));
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM private.audit('season_withdrawn', OLD.player_id, jsonb_build_object('season', OLD.season));
    RETURN OLD;
  ELSIF OLD.paid_at IS NULL AND NEW.paid_at IS NOT NULL THEN
    PERFORM private.audit('entry_paid', NEW.player_id, jsonb_build_object('season', NEW.season, 'amount', NEW.amount));
  ELSIF OLD.paid_at IS NOT NULL AND NEW.paid_at IS NULL THEN
    PERFORM private.audit('entry_unpaid', NEW.player_id, jsonb_build_object('season', NEW.season, 'amount', OLD.amount));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.audit_entries() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER audit_entries AFTER INSERT OR UPDATE OR DELETE ON public.season_entries
  FOR EACH ROW EXECUTE FUNCTION private.audit_entries();

-- ===== CHECKS =====
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'season_entries';
  INSERT INTO se_report(line) VALUES ('season_entries policies: ' || n);
  IF n <> 5 THEN RAISE EXCEPTION 'Expected 5 policies on season_entries, found %', n; END IF;
  IF NOT has_table_privilege('anon', 'public.season_entries', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.season_entries', 'SELECT') THEN
    RAISE EXCEPTION 'season_entries grants missing';
  END IF;
  INSERT INTO se_report(line) VALUES ('grants: anon + authenticated');
  SELECT count(DISTINCT trigger_name) INTO n FROM information_schema.triggers WHERE event_object_table = 'season_entries';
  IF n <> 1 THEN RAISE EXCEPTION 'Expected 1 trigger on season_entries, found %', n; END IF;
  INSERT INTO se_report(line) VALUES ('audit trigger: 1');
END $$;

NOTIFY pgrst, 'reload schema';
DO $$ BEGIN
  INSERT INTO se_report(line) VALUES ('ALL CHECKS PASSED');
  IF (SELECT rehearsal FROM se_mode) THEN
    RAISE EXCEPTION 'REHEARSAL OK — everything was rolled back. Report:%',
      E'\n' || (SELECT string_agg(line, E'\n' ORDER BY ord) FROM se_report);
  END IF;
END $$;
SELECT line FROM se_report ORDER BY ord;
COMMIT;
```

- [ ] **Step 4: Write `supabase/season_entries_rollback.sql`**

```sql
-- Royal Golf Club — undo season_entries.sql. Entries (and who paid) are lost; the audit log keeps
-- its entry_paid rows. Redeploy the previous app straight after. Safe to re-run.
BEGIN;
DROP TABLE IF EXISTS public.season_entries;
DROP FUNCTION IF EXISTS private.audit_entries();
NOTIFY pgrst, 'reload schema';
COMMIT;
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd tests/sql; node --test entries.test.mjs` → all pass. Then `node --test` (whole SQL suite) → all pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/season_entries.sql supabase/season_entries_rollback.sql tests/sql/entries.test.mjs
git commit -m "feat(db): season_entries — opt-in paid entry with permissions and audit"
```

---

### Task 2: Season rules in `SEASONS` (best N, buy-in, entry season)

**Files:**
- Modify: `index.html` — `SEASONS` (~line 5284), `seasonStandings` (~5308), `renderSeasonLb` (~5312), Season subtitle markup (~line 301), `renderHallOfFame` IPS label (~5386), Rules page text (~lines 468, 475, 477) and `renderRules` (~1551), `SEASON_PAY_HTML` (~1433-1435), `applyPendingUI` (~1302)
- Create: `tests/winter.test.js`

**Interfaces:**
- Produces: `SEASONS` rows with `best`, `buyIn`, `entry`; `entrySeason()` → season object or `null`; `seasonStandings()` rows carry `counted` (renamed from `best4`); `payHtml()` → HTML string; `const MOBILEPAY_URL`.

- [ ] **Step 1: Write the failing test** — create `tests/winter.test.js`:

```js
// Winter 2027 — season rules, entries, sign out. Run: tests/run.ps1 -Test tests/winter.test.js
setTimeout(async function(){
  const out=[];const T=(n,c,d='')=>out.push((c?'PASS ':'FAIL ')+n+(c?'':' :: '+d));
  const calls=[];let respond=()=>[];
  window.fetch=async(url,opts={})=>{url=String(url);const body=opts.body?JSON.parse(opts.body):null;calls.push({url,method:opts.method||'GET',body});
    const b=respond(url,body,opts.method||'GET');const st=b&&b.__status||200;return{ok:st<400,status:st,json:async()=>b,text:async()=>JSON.stringify(b)};};
  const reset=fn=>{calls.length=0;respond=fn||(()=>[]);};
  window.toast=()=>{};window.setLoading=()=>{};window.confirm=()=>true;window.alert=()=>{};
  // 18-hole round on the platinum tee; `score` for every hole.
  const round=(id,pid,date,score)=>({id,player_id:pid,date,tee_id:'platinum',holes:HOLE_PARS.map((par,i)=>({hole:i+1,par,hcp:HOLE_HCP[i],score:score}))});
  const P=(id,name,x={})=>({id,name,color:id,hcp_history:[{date:'2026-01-01',value:18,note:''}],approved:true,is_social:false,...x});
  try{
    // ── Task 2: season rules ──
    T('Summer keeps best 4 and DKK 250',seasonInfo('Summer 2026').best===4&&seasonInfo('Summer 2026').buyIn===250&&seasonInfo('Summer 2026').entry===false);
    T('Winter is best 3, DKK 175, entry',seasonInfo('Winter 2027').best===3&&seasonInfo('Winter 2027').buyIn===175&&seasonInfo('Winter 2027').entry===true);
    today=()=>'2026-09-28';
    T('entries open for Winter during Summer\'s last week',entrySeason()?.name==='Winter 2027');
    today=()=>'2026-11-01';
    T('entry season is Winter during Winter',entrySeason()?.name==='Winter 2027');
    const saved=SEASONS.splice(1,1);today=()=>'2026-09-28';
    T('no entry season when none needs entry',entrySeason()===null);
    SEASONS.push(...saved);
    players=[P(1,'Ann'),P(2,'Bo')];seasonEntries=[];
    allRounds=[1,2,3,4,5].map(i=>round(i,1,`2026-10-${10+i}`,4+(i%3)));
    today=()=>'2026-11-01';
    const w=seasonStandings('Winter 2027');   // (Task 3 adds the entry rule; enter Ann so she counts)
    T('Winter counts the best 3 rounds',!w.length||w[0].counted.length===3);
    allRounds=[1,2,3,4,5].map(i=>round(i,1,`2026-05-${10+i}`,5));
    T('Summer counts the best 4 rounds',seasonStandings('Summer 2026')[0].counted.length===4);
    document.getElementById('seasonYear').innerHTML='<option>Winter 2027</option>';document.getElementById('seasonYear').value='Winter 2027';
    allRounds=[1,2,3,4].map(i=>round(i,1,`2026-10-${10+i}`,5));seasonEntries=[{id:1,season:'Winter 2027',player_id:1,paid_at:'2026-10-01T10:00:00Z',amount:175}];
    renderSeasonLb();
    T('Season heading reads Best 3',/Best 3 Rounds/.test(document.getElementById('seasonTable').innerHTML)&&document.getElementById('seasonBestN').textContent==='3');
    T('pay screen shows the entry season buy-in',/DKK 175/.test(payHtml())&&/Winter 2027/.test(payHtml())&&!/DKK 250/.test(payHtml()));
    today=()=>'2026-11-01';renderRules();
    T('Rules page names best 3 for Winter',[...document.querySelectorAll('.rulesBestN')].every(e=>e.textContent==='3'));
    // ── end ──
  }catch(e){out.push('FAIL EXCEPTION :: '+e.stack);}
  await new Promise(r=>setTimeout(r,150));
  const pre=document.createElement('pre');pre.id='RESULT';pre.textContent=out.join('\n');document.body.innerHTML='';document.body.appendChild(pre);
},400);
```

- [ ] **Step 2: Run to verify it fails**

Run: `powershell -NoProfile -File tests/run.ps1 -Test tests/winter.test.js`
Expected: FAIL (`seasonInfo('Summer 2026').best` undefined; then EXCEPTION `entrySeason is not defined` or `seasonEntries is not defined`).

- [ ] **Step 3: Implement**

`SEASONS` becomes:
```js
const SEASONS=[
  {name:'Summer 2026',from:'0000-01-01',eclectic:0.95,best:4,buyIn:250,entry:false},
  {name:'Winter 2027',from:'2026-10-04',eclectic:0.60,best:3,buyIn:175,entry:true}, // day after the Summer 2026 final (3 Oct)
];
```
and directly after `seasonDone`:
```js
// The season taking entries: the current one if it needs entry, else the next one if that does
// (so Winter entries open during Summer's last week). null when none does.
function entrySeason(){const cur=seasonInfo(seasonOf(today()));if(cur.entry)return cur;const next=SEASONS[SEASONS.indexOf(cur)+1];return next&&next.entry?next:null;}
```
Declare `let seasonEntries=[];` next to `let fineTypes=[],allFines=[],finePayments=[];` (~line 1061) — Task 3 loads it.

`seasonStandings`: `const best4=rpts.slice(0,4);const total=best4.reduce(…)` → `const counted=rpts.slice(0,seasonInfo(season).best);const total=counted.reduce(…)`, returning `counted` instead of `best4`. Update the comment to `// Best-N IPS standings (N from SEASONS), highest first. Social members excluded.` In `renderSeasonLb` rename `s.best4` → `s.counted`, heading `<th>Best 4 Rounds</th>` → `<th>Best ${seasonInfo(season).best} Rounds</th>`, and add as its first line after `const season=…`: `const bn=document.getElementById('seasonBestN');if(bn)bn.textContent=seasonInfo(season).best;`. Grep for any other `best4` and rename.

Season subtitle markup: `<strong style="color:var(--gold-l)">4 best</strong>` → `<strong style="color:var(--gold-l)"><span id="seasonBestN">4</span> best</strong>`.

Hall of Fame: `${rows('🏆 Best 4 IPS',iW)}` → `${rows(`🏆 Best ${seasonInfo(season).best} IPS`,iW)}`.

Rules page: in the three static places ("Best 4 IPS competitions", "Best 4 IPS — Individual Points Score", "your <strong>4 best rounds</strong>") replace the digit with `<span class="rulesBestN">4</span>`. In `renderRules` first line add:
`const cur=seasonInfo(seasonOf(today()));document.querySelectorAll('.rulesBestN').forEach(e=>e.textContent=cur.best);`

Pay text — replace the `SEASON_PAY_HTML` const and the `pendingPay` line (~1433-1435) with:
```js
const MOBILEPAY_URL='https://qr.mobilepay.dk/box/53592791-c6e9-4588-976f-8b187c98c76d/pay-in';
// The buy-in to pay: the season taking entries, else the current one. A function, not a const:
// SEASONS is declared further down the script.
function payHtml(){const s=entrySeason()||seasonInfo(seasonOf(today()));
  return `Please pay <strong style="color:var(--gold-l)">DKK ${s.buyIn}</strong> to enter ${s.name} at the link below. The pot is split 50/50 between the Eclectic tournament and the best ${s.best} IPS Scores at end of Season.`
    +`<a href="${MOBILEPAY_URL}" target="_blank" rel="noopener" style="display:block;background:rgba(201,168,76,0.12);border:1px solid rgba(201,168,76,0.35);border-radius:12px;padding:1rem;text-align:center;text-decoration:none;color:var(--gold-l);font-size:0.9rem;font-weight:500;margin-top:0.75rem">Pay DKK ${s.buyIn} via MobilePay →</a>`;}
```
In `applyPendingUI`, add at its start: `document.getElementById('pendingPay').innerHTML=payHtml();`. Grep for any remaining `SEASON_PAY_HTML` and replace with `payHtml()`.

- [ ] **Step 4: Run to verify it passes** — `tests/run.ps1 -Test tests/winter.test.js` → all PASS; then phase0, phase1, phase2a suites → all PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/winter.test.js
git commit -m "feat: season rules in SEASONS — Winter 2027 best 3, DKK 175, entry season"
```

---

### Task 3: Entries in the standings, Hall of Fame and pot

**Files:**
- Modify: `index.html` — `loadData` (~1284-1290), helpers after `entrySeason`, `seasonStandings`, `renderSeasonLb`, `renderTodayLb` (`_prizeRanks`, ~5303), `renderDreamCard` eclectic row (~5339), `renderHallOfFame` (~5359), `renderRules` (~1551)
- Test: `tests/winter.test.js`

**Interfaces:**
- Consumes: `seasonEntries`, `entrySeason()`, `SEASONS` fields (Task 2); `season_entries` rows `{id,season,player_id,entered_at,paid_at,amount,recorded_by}` (Task 1).
- Produces: `entryOf(pid,season)` → row or `undefined`; `inPrizes(p,season)` → boolean; `unpaidTag(p,season)` → HTML string (`''` when not applicable).

- [ ] **Step 1: Write the failing tests** — insert before `// ── end ──` in `tests/winter.test.js`:

```js
    // ── Task 3: entries decide the prizes ──
    today=()=>'2026-11-01';
    players=[P(1,'Ann'),P(2,'Bo'),P(3,'Cy',{is_social:true}),P(4,'Di')];
    allRounds=[round(1,1,'2026-10-10',5),round(2,2,'2026-10-10',4),round(3,3,'2026-10-10',3),round(4,4,'2026-10-10',6)];
    seasonEntries=[{id:1,season:'Winter 2027',player_id:1,paid_at:'2026-10-01T10:00:00Z',amount:175},{id:2,season:'Winter 2027',player_id:4,paid_at:null,amount:null}];
    T('inPrizes: entered and not social',inPrizes(players[0],'Winter 2027')&&inPrizes(players[3],'Winter 2027')&&!inPrizes(players[1],'Winter 2027')&&!inPrizes(players[2],'Winter 2027'));
    T('Winter eclectic lists entrants only',JSON.stringify(eclecticStandings('Winter 2027').map(e=>e.p.id).sort())==='[1,4]');
    T('Winter standings list entrants only',JSON.stringify(seasonStandings('Winter 2027').map(s=>s.p.id).sort())==='[1,4]');
    allRounds.push(round(5,2,'2026-10-05',4));seasonEntries.push({id:3,season:'Winter 2027',player_id:2,paid_at:null,amount:null,entered_at:'2026-11-01T09:00:00Z'});
    T('a late entry counts rounds from before entering',seasonStandings('Winter 2027').find(s=>s.p.id===2)?.rounds===2);
    document.getElementById('seasonYear').innerHTML='<option>Winter 2027</option>';document.getElementById('seasonYear').value='Winter 2027';renderSeasonLb();
    T('unpaid entrants are tagged unpaid in the Season table',(document.getElementById('seasonTable').innerHTML.match(/>unpaid</g)||[]).length===2);
    allRounds=[round(1,1,'2026-05-10',5),round(2,2,'2026-05-10',4)];
    T('Summer ignores entries: every non-social member is in',seasonStandings('Summer 2026').length===2&&inPrizes(players[1],'Summer 2026'));
    T('Summer eclectic still lists everyone, social included',eclecticStandings('Summer 2026').length===2);
    today=()=>'2026-11-01';renderRules();
    T('Winter pot counts paid entries only',/DKK 175/.test(document.getElementById('rulesPot').innerHTML)&&/1 paid entry/.test(document.getElementById('rulesPot').innerHTML));
    today=()=>'2026-09-20';renderRules();
    T('Summer pot is still players × DKK 250',/DKK 250 × 3 players = DKK 750/.test(document.getElementById('rulesPot').innerHTML));
    // Bo (2) has not entered; Ann (1) has.
    seasonEntries=[{id:1,season:'Winter 2027',player_id:1,paid_at:'2026-10-01T10:00:00Z',amount:175}];
    allRounds=[round(1,2,'2026-11-01',4),round(2,1,'2026-11-01',5)];today=()=>'2026-11-01';renderTodayLb();
    T('Today: a non-entrant gets no prize place',/1st/.test(document.getElementById('todayTable').innerHTML)&&!/2nd/.test(document.getElementById('todayTable').innerHTML));
    // tees non-empty so loadData doesn't try to seed them; everything else empty; season_entries fails.
    reset(u=>u.includes('/season_entries')?{__status:500,message:'boom'}:u.includes('/tees')?[{id:'platinum',name:'Royal Platinum',color:'#b0a0c0',rating:77.6,slope:153,dist:[]}]:[]);
    seasonEntries=[{id:9}];
    try{await loadData();}catch(e){out.push('FAIL loadData threw :: '+e.message);}
    T('load failure: season_entries failing leaves an empty list, not a crash',Array.isArray(seasonEntries)&&seasonEntries.length===0);
```

- [ ] **Step 2: Run to verify they fail** — `tests/run.ps1 -Test tests/winter.test.js` → FAIL (`inPrizes is not defined`).

- [ ] **Step 3: Implement**

`loadData`: immediately before `try{tournaments=await sbGet('tournaments',…` add
`try{seasonEntries=await sbGet('season_entries','order=entered_at.asc');}catch(e){seasonEntries=[];}   // missing until season_entries.sql runs`

After `entrySeason()`:
```js
function entryOf(pid,season){return seasonEntries.find(e=>e.player_id===pid&&e.season===season);}
// In the prizes: not social, and entered when the season needs entry. A non-entrant is treated
// exactly like a social member. Entering later counts the whole season's rounds.
function inPrizes(p,season){if(!p||p.is_social)return false;return !seasonInfo(season).entry||!!entryOf(p.id,season);}
function unpaidTag(p,season){const e=seasonInfo(season).entry&&entryOf(p.id,season);
  return e&&!e.paid_at?'<span class="tag" style="font-size:0.6rem;padding:1px 5px;margin-left:4px;background:rgba(240,160,48,0.15);color:#f0a030">unpaid</span>':'';}
```

- `seasonStandings`: `players.filter(p=>!p.is_social)` → `players.filter(p=>inPrizes(p,season))`.
- `renderSeasonLb`: after `${s.p.name}` in the player cell append `${unpaidTag(s.p,season)}`.
- `renderTodayLb`: `rows.map(row=>row.p?.is_social?null:++_prizeRank)` → `rows.map(row=>row.p&&!inPrizes(row.p,seasonOf(td))?null:++_prizeRank)`.
- `renderDreamCard` eclectic row: after the `${e.p.is_social?'<span class="tag tag-social"…>Social</span>':''}` add `${unpaidTag(e.p,season)}`.
- `eclecticStandings`: `players.map(p=>{…})` → `players.filter(p=>!seasonInfo(season).entry||inPrizes(p,season)).map(p=>{…})` — an opt-in season lists entrants only; Summer (entry:false) is unchanged, social members included.
- `renderHallOfFame`: `eclecticStandings(season).filter(e=>!e.p.is_social&&e.filled===18)` → `.filter(e=>inPrizes(e.p,season)&&e.filled===18)`.
- `renderRules` (replace the first two lines of the body and the footer text):
```js
  const cur=seasonInfo(seasonOf(today()));document.querySelectorAll('.rulesBestN').forEach(e=>e.textContent=cur.best);
  // Opt-in seasons: the pot is the money actually received. Otherwise every non-social member × buy-in.
  const paid=cur.entry?seasonEntries.filter(e=>e.season===cur.name&&e.paid_at):[];
  const approved=players.filter(p=>p.approved!==false&&!p.is_social).length;
  const gross=cur.entry?paid.reduce((s,e)=>s+Number(e.amount||0),0):approved*cur.buyIn;
  const basis=cur.entry?`${paid.length} paid entr${paid.length===1?'y':'ies'} (DKK ${cur.buyIn})`:`DKK ${cur.buyIn} × ${approved} player${approved!==1?'s':''}`;
```
and the footer line `DKK 250 × ${approved} player${approved!==1?'s':''} = DKK ${gross}` → `${basis} = DKK ${gross}`. (The `.rulesBestN` line from Task 2 is the same line — keep one copy.)

- [ ] **Step 4: Run to verify they pass** — winter, phase0, phase1, phase2a suites → all PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/winter.test.js
git commit -m "feat: season entries decide the prizes — standings, Hall of Fame, Today, pot"
```

---

### Task 4: Member entry banner and profile status

**Files:**
- Modify: `index.html` — Season tab markup (add `#entryBanner` above `#seasonTable`, ~line 305), new functions after `unpaidTag`, `renderSeasonLb` (call the banner), `renderProfile` (~5695)
- Test: `tests/winter.test.js`

**Interfaces:**
- Consumes: `entrySeason()`, `entryOf()`, `MOBILEPAY_URL`, `sbInsert`, `sbDelete`.
- Produces: `renderEntryBanner()`, `entryStatusHtml(p,s)` → HTML, `enterSeason()`, `withdrawEntry()`.

- [ ] **Step 1: Write the failing tests** — before `// ── end ──`:

```js
    // ── Task 4: member banner ──
    today=()=>'2026-09-28';players=[P(1,'Ann'),P(2,'Bo',{is_social:true}),P(3,'Cy',{approved:false})];seasonEntries=[];activeId=1;
    renderEntryBanner();const ban=()=>document.getElementById('entryBanner').innerHTML;
    T('not entered: Enter Winter 2027 for DKK 175, best 3',/Enter Winter 2027/.test(ban())&&/DKK 175/.test(ban())&&/best 3/.test(ban())&&/enterSeason\(\)/.test(ban()));
    reset((u,b,m)=>u.includes('/season_entries')&&m==='POST'?[{id:11,season:b.season,player_id:b.player_id,paid_at:null,amount:null}]:[]);
    await enterSeason();
    const post=calls.find(c=>c.method==='POST'&&c.url.includes('/season_entries'));
    T('Enter posts season and own player only',post&&post.body.season==='Winter 2027'&&post.body.player_id===1&&!('id' in post.body)&&!('paid_at' in post.body));
    T('entered, unpaid: payment not recorded, MobilePay link, Withdraw',/payment not yet recorded/.test(ban())&&ban().includes(MOBILEPAY_URL)&&/withdrawEntry\(\)/.test(ban()));
    reset((u,b,m)=>u.includes('/season_entries')&&m==='DELETE'?[{id:11}]:[]);
    await withdrawEntry();
    T('Withdraw deletes the entry and shows Enter again',calls.some(c=>c.method==='DELETE'&&c.url.includes('season_entries?id=eq.11'))&&/enterSeason\(\)/.test(ban())&&!entryOf(1,'Winter 2027'));
    seasonEntries=[{id:12,season:'Winter 2027',player_id:1,paid_at:'2026-09-29T10:00:00Z',amount:175}];renderEntryBanner();
    T('paid: entered and paid, no Withdraw',/entered in Winter 2027 and paid/.test(ban())&&!/withdrawEntry/.test(ban()));
    activeId=2;renderEntryBanner();T('social members see no banner',ban()==='');
    activeId=3;renderEntryBanner();T('pending members see no banner',ban()==='');
    const saved2=SEASONS.splice(1,1);activeId=1;renderEntryBanner();T('no banner when no season takes entries',ban()==='');SEASONS.push(...saved2);
    activeId=1;seasonEntries=[];renderProfile();
    T('My Profile shows the entry status',/Enter Winter 2027/.test(document.getElementById('profileBody').innerHTML));
```

- [ ] **Step 2: Run to verify they fail** — FAIL (`renderEntryBanner is not defined`).

- [ ] **Step 3: Implement**

Markup: directly above `<div id="seasonTable"></div>` add `<div id="entryBanner"></div>`.

After `unpaidTag`:
```js
// Enter / pay / withdraw for the season taking entries. Social and pending members see nothing.
function entryStatusHtml(p,s){
  const e=entryOf(p.id,s.name),box=c=>`<div class="info-box" style="margin-bottom:1rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">${c}</div>`;
  if(!e)return box(`<span><strong>Enter ${s.name}</strong> — DKK ${s.buyIn}, best ${s.best} rounds count.</span><button class="btn btn-warn btn-sm" onclick="enterSeason()">Enter</button>`);
  if(!e.paid_at)return box(`<span>You're entered in ${s.name} — payment not yet recorded. <a href="${MOBILEPAY_URL}" target="_blank" rel="noopener" style="color:var(--gold-l)">Pay DKK ${s.buyIn} via MobilePay →</a></span><button class="btn btn-ghost btn-sm" onclick="withdrawEntry()">Withdraw</button>`);
  return box(`<span>You're entered in ${s.name} and paid ✓</span>`);
}
function entryFor(p){const s=entrySeason();return s&&p&&!p.is_social&&p.approved!==false?s:null;}
function renderEntryBanner(){
  const el=document.getElementById('entryBanner');if(!el)return;
  const p=players.find(x=>x.id===activeId)||pendingPlayers.find(x=>x.id===activeId),s=entryFor(p);
  el.innerHTML=s?entryStatusHtml(p,s):'';
}
function refreshEntryViews(){renderEntryBanner();renderSeasonLb();renderProfile();}
async function enterSeason(){
  const s=entrySeason();if(!s||entryOf(activeId,s.name))return;
  try{const [row]=await sbInsert('season_entries',{season:s.name,player_id:activeId});seasonEntries.push(row);toast(`Entered ${s.name}`);}
  catch(e){toast('Couldn\'t enter — '+e.message);}
  refreshEntryViews();
}
async function withdrawEntry(){
  const s=entrySeason(),e=s&&entryOf(activeId,s.name);if(!e||e.paid_at)return;
  if(!confirm(`Withdraw from ${s.name}?`))return;
  try{await sbDelete('season_entries',e.id);seasonEntries=seasonEntries.filter(x=>x.id!==e.id);toast('Entry withdrawn');}
  catch(err){toast('Couldn\'t withdraw — '+err.message);}
  refreshEntryViews();
}
```
`renderSeasonLb`: first line `renderEntryBanner();`.
`renderProfile`: after the `row('Units',…)` block (before the `_session` block) add
`{const s=entryFor(p);if(s)body.innerHTML+=`<div style="margin-top:1rem">${entryStatusHtml(p,s)}</div>`;}`
(`pendingPlayers` must be defined in the test page — it is a global set by `loadData`; if the test throws `pendingPlayers is not defined`, set `pendingPlayers=[]` at the top of the Task 4 test block.)

- [ ] **Step 4: Run to verify they pass** — winter, phase0, phase1, phase2a → all PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/winter.test.js
git commit -m "feat: enter / pay / withdraw banner for the season taking entries"
```

---

### Task 5: Admin entries section

**Files:**
- Modify: `index.html` — admin markup (new panel after the "New login — not set up yet" panel, ~line 582), new functions after `withdrawEntry`, `showView` admin line (~1514)
- Test: `tests/winter.test.js`

**Interfaces:**
- Consumes: `entrySeason()`, `entryOf()`, `requireAdminMode()`, `sbUpdate`, `sbInsert`, `sbDelete`, `escHtml`, `activePlayers()`, `toggleAdminSection`.
- Produces: `renderAdminEntries()`, `markEntryPaid(id)`, `undoEntryPaid(id)`, `removeEntry(id)`, `enterPlayerFor()`.

- [ ] **Step 1: Write the failing tests** — before `// ── end ──`:

```js
    // ── Task 5: admin entries ──
    today=()=>'2026-10-10';_session=null;activeId=1;
    players=[P(1,'Ann',{is_admin:true}),P(2,'<b>Bo</b>'),P(3,'Cy'),P(4,'Di',{is_social:true})];
    seasonEntries=[{id:21,season:'Winter 2027',player_id:2,paid_at:null,amount:null},{id:22,season:'Winter 2027',player_id:1,paid_at:'2026-10-05T10:00:00Z',amount:175}];
    renderAdminEntries();const adm=()=>document.getElementById('adminEntriesBody').innerHTML;
    T('title names the entry season',document.getElementById('adminEntriesTitle').textContent==='Winter 2027 entries');
    T('summary: 2 entered · 1 paid · DKK 175 received',/2 entered · 1 paid · DKK 175 received/.test(adm()));
    T('names are escaped',!document.getElementById('adminEntriesBody').querySelector('b')&&/&lt;b&gt;Bo/.test(adm()));
    T('enter-for lists non-social members without an entry',/value="3"/.test(adm())&&!/value="4"/.test(adm())&&!/value="2"/.test(adm()));
    reset((u,b,m)=>m==='PATCH'&&u.includes('season_entries')?[{id:21,season:'Winter 2027',player_id:2,paid_at:b.paid_at,amount:b.amount,recorded_by:b.recorded_by}]:[]);
    await markEntryPaid(21);
    const patch=calls.find(c=>c.method==='PATCH');
    T('Mark paid sets paid_at, the season buy-in and who recorded it',patch&&patch.body.amount===175&&patch.body.recorded_by===1&&!!patch.body.paid_at);
    T('after Mark paid: 2 paid, DKK 350',/2 entered · 2 paid · DKK 350 received/.test(adm()));
    reset((u,b,m)=>m==='PATCH'?[{id:21,season:'Winter 2027',player_id:2,paid_at:null,amount:null,recorded_by:null}]:[]);
    await undoEntryPaid(21);
    T('Undo clears the payment and the pot drops back',calls.some(c=>c.method==='PATCH'&&c.body.paid_at===null&&c.body.amount===null)&&/1 paid · DKK 175/.test(adm()));
    renderSeasonLb();
    reset((u,b,m)=>m==='POST'?[{id:23,season:b.season,player_id:b.player_id,paid_at:null,amount:null}]:[]);
    document.getElementById('entryForPlayer').value='3';await enterPlayerFor();
    T('Enter player posts that player for the entry season',calls.some(c=>c.method==='POST'&&c.body.player_id===3&&c.body.season==='Winter 2027')&&!!entryOf(3,'Winter 2027'));
    reset((u,b,m)=>m==='DELETE'?[{id:23}]:[]);
    await removeEntry(23);
    T('Remove deletes the entry',calls.some(c=>c.method==='DELETE'&&c.url.includes('season_entries?id=eq.23'))&&!entryOf(3,'Winter 2027'));
    const saved3=SEASONS.splice(1,1);today=()=>'2026-09-20';renderAdminEntries();
    T('no season taking entries: says so',/No season is taking entries/.test(adm()));SEASONS.push(...saved3);
```

- [ ] **Step 2: Run to verify they fail** — FAIL (`renderAdminEntries is not defined`).

- [ ] **Step 3: Implement**

Markup, after the `New login — not set up yet` panel:
```html
    <div class="panel" id="adminEntriesPanel">
      <div class="ph" onclick="toggleAdminSection('adminEntriesBody','achev-entries')" style="cursor:pointer;user-select:none">
        <span class="pt" id="adminEntriesTitle">Season entries</span>
        <span id="achev-entries" style="color:rgba(255,255,255,0.35);font-size:1.2rem;transition:transform 0.2s;display:inline-block;line-height:1">›</span>
      </div>
      <div class="pb" id="adminEntriesBody" style="display:none"></div>
    </div>
```
Functions, after `withdrawEntry`:
```js
// Admin: who entered the season taking entries, who has paid, and entering someone on their behalf.
function renderAdminEntries(){
  const body=document.getElementById('adminEntriesBody'),title=document.getElementById('adminEntriesTitle');if(!body||!title)return;
  const s=entrySeason();
  if(!s){title.textContent='Season entries';body.innerHTML='<div class="empty">No season is taking entries.</div>';return;}
  title.textContent=`${s.name} entries`;
  const es=seasonEntries.filter(e=>e.season===s.name),paid=es.filter(e=>e.paid_at),unpaid=es.filter(e=>!e.paid_at);
  const received=paid.reduce((t,e)=>t+Number(e.amount||0),0);
  const nm=id=>escHtml(players.find(p=>p.id===id)?.name||'#'+id);
  const line=(e,right)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0"><span>${nm(e.player_id)}</span><span style="display:flex;gap:6px;align-items:center">${right}</span></div>`;
  const head=t=>`<div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.08em;color:rgba(255,255,255,0.4);margin:0.75rem 0 4px">${t}</div>`;
  const others=activePlayers().filter(p=>!p.is_social&&!entryOf(p.id,s.name));
  body.innerHTML=`<div style="font-size:0.85rem;color:var(--gold-l)">${es.length} entered · ${paid.length} paid · DKK ${received} received</div>`
    +head('Awaiting payment')+(unpaid.length?unpaid.map(e=>line(e,`<button class="btn btn-warn btn-sm" onclick="markEntryPaid(${e.id})">Mark paid</button><button class="btn btn-danger btn-sm" onclick="removeEntry(${e.id})">Remove</button>`)).join(''):'<div class="empty">Nobody.</div>')
    +head('Paid')+(paid.length?paid.map(e=>line(e,`<span style="font-size:0.75rem;color:rgba(255,255,255,0.4)">${fd(e.paid_at.slice(0,10))}</span><button class="btn btn-ghost btn-sm" onclick="undoEntryPaid(${e.id})">Undo</button>`)).join(''):'<div class="empty">Nobody yet.</div>')
    +(others.length?`<div style="display:flex;gap:6px;margin-top:0.9rem"><select id="entryForPlayer">${others.map(p=>`<option value="${p.id}">${escHtml(p.name)}</option>`).join('')}</select><button class="btn btn-ghost btn-sm" onclick="enterPlayerFor()">Enter player</button></div>`:'');
}
// Every admin write: admin mode first, then save, then redraw what depends on entries.
async function adminEntryWrite(save,done){
  if(!await requireAdminMode())return;
  try{await save();toast(done);}catch(e){toast('Couldn\'t save — '+e.message);}
  renderAdminEntries();renderEntryBanner();renderSeasonLb();
}
const replaceEntry=row=>{if(row)seasonEntries=seasonEntries.map(e=>e.id===row.id?row:e);};
function markEntryPaid(id){const s=entrySeason();return adminEntryWrite(async()=>{const [row]=await sbUpdate('season_entries',id,{paid_at:new Date().toISOString(),amount:s.buyIn,recorded_by:activeId});replaceEntry(row);},'Marked paid');}
function undoEntryPaid(id){return adminEntryWrite(async()=>{const [row]=await sbUpdate('season_entries',id,{paid_at:null,amount:null,recorded_by:null});replaceEntry(row);},'Payment undone');}
function removeEntry(id){if(!confirm('Remove this entry?'))return;return adminEntryWrite(async()=>{await sbDelete('season_entries',id);seasonEntries=seasonEntries.filter(e=>e.id!==id);},'Entry removed');}
function enterPlayerFor(){const s=entrySeason(),pid=+document.getElementById('entryForPlayer').value;
  return adminEntryWrite(async()=>{const [row]=await sbInsert('season_entries',{season:s.name,player_id:pid});seasonEntries.push(row);},'Player entered');}
```
`showView`: in the admin line add `renderAdminEntries();` after `renderMoveOverList();`.

- [ ] **Step 4: Run to verify they pass** — winter, phase0, phase1, phase2a → all PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/winter.test.js
git commit -m "feat: admin season entries — mark paid, undo, remove, enter a player"
```

---

### Task 6: Sign out in the header

**Files:**
- Modify: `index.html` — header `.hdr-right` (~line 257), `applyPendingUI` (~1302), `renderProfile` (remove its Sign out button, keep Change email)
- Test: `tests/winter.test.js`

**Interfaces:**
- Consumes: existing `signOut()` (clears Supabase session, `sl_session_player`, `sl_active_player`, reloads).
- Produces: `#signOutBtn`, `updateSignOutBtn()`.

- [ ] **Step 1: Write the failing tests** — before `// ── end ──`:

```js
    // ── Task 6: sign out in the header ──
    const so=()=>document.getElementById('signOutBtn');
    T('header has a Sign out button wired to signOut',!!so()&&so().closest('header')&&/signOut\(\)/.test(so().getAttribute('onclick')));
    _session=null;sessionStorage.removeItem('sl_session_player');updateSignOutBtn();
    T('hidden when nobody is signed in',so().style.display==='none');
    sessionStorage.setItem('sl_session_player','1');updateSignOutBtn();
    T('shown on the old PIN route',so().style.display!=='none');
    sessionStorage.removeItem('sl_session_player');_session={access_token:'h.e30.s',user:{id:'u-9'}};updateSignOutBtn();
    T('shown on the new login',so().style.display!=='none');
    players=[P(1,'Ann',{user_id:'u-1'}),P(2,'Bo')];_session={access_token:'h.e30.s',user:{id:'u-1'}};activeId=2;updateSignOutBtn();
    T('shown while an admin views as someone else',so().style.display!=='none');
    activeId=1;renderProfile();
    T('My Profile keeps Change email but no longer has Sign out',/submitEmailChange/.test(document.getElementById('profileBody').innerHTML)&&!/signOut\(\)/.test(document.getElementById('profileBody').innerHTML));
    _session=null;
```

- [ ] **Step 2: Run to verify they fail** — FAIL (no `#signOutBtn`).

- [ ] **Step 3: Implement**

Header, after the `playerBtn` button inside `.hdr-right`:
`<button class="btn btn-ghost btn-sm" id="signOutBtn" onclick="signOut()" style="display:none">Sign out</button>`

Next to `signOut()`:
```js
// Sign out shows for anyone signed in, either route, including an admin viewing as someone else.
function updateSignOutBtn(){const b=document.getElementById('signOutBtn');if(b)b.style.display=_session||sessionStorage.getItem('sl_session_player')?'':'none';}
```
Call `updateSignOutBtn();` at the start of `applyPendingUI`.
`renderProfile`: the `_session` block's buttons become only `<button class="btn btn-ghost btn-sm" onclick="submitEmailChange()">Change email</button>`.

- [ ] **Step 4: Run to verify they pass** — winter, phase0, phase1, phase2a → all PASS (phase2a has tests on the profile block; if one asserted the profile Sign out, update it to the header button and note it in the report).

- [ ] **Step 5: Commit**

```bash
git add index.html tests/winter.test.js
git commit -m "feat: Sign out in the header for every signed-in user"
```

---

### Task 7: Docs and Summer-unchanged check

**Files:**
- Modify: `CLAUDE.md` (Season section, Supabase tables, Admin system)
- Check: leaderboard render vs `%TEMP%\rgc-phase1\render-winter-before.txt` (captured by the controller before Task 1)

- [ ] **Step 1: Render diff** — run
`powershell -NoProfile -File tests/run.ps1 -Test tests/leaderboards.render.js -Data "$env:TEMP\rgc-phase1\snapshot-live-2026-09-24.json" > "$env:TEMP\rgc-phase1\render-winter-after.txt"`
and compare with `render-winter-before.txt`. Expected: identical (the snapshot has only Summer 2026 rounds, which must not change).

- [ ] **Step 2: CLAUDE.md** — in **Season**, after the eclectic-allowance paragraph add:

```markdown
Each `SEASONS` row also carries `best` (rounds counted in the Season standings), `buyIn` (DKK) and
`entry`. `entry:false` (Summer 2026): every approved non-social member is in. `entry:true` (Winter
2027 onwards): only players with a `season_entries` row are in the prizes — `inPrizes(p, season)`
treats a non-entrant exactly like a social member, and an unpaid entrant carries an "unpaid" tag. The
pot for an opt-in season is the sum of paid `amount`s. `entrySeason()` is the season taking entries:
the current one if it needs entry, else the next — so entries open before a season starts.
```
Under **Supabase tables** add a `season_entries` block (columns as in the spec; "members enter and
withdraw (unpaid) themselves; marking paid needs admin mode; audited as season_entered / entry_paid /
entry_unpaid / season_withdrawn; `supabase/season_entries.sql`, rollback `season_entries_rollback.sql`").
Under **Admin system → Admin can** add "record season entry payments (Admin → <season> entries)".

- [ ] **Step 3: Run every suite** — SQL `node --test`, winter, phase0, phase1, phase2a → all PASS.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: season rules, opt-in entries and the Sign out button"
```
