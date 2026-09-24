// Read-only snapshot of live data for the PGlite testbed and the before/after renders.
// It contains personal data, so it is written to %TEMP%\rgc-phase1 and must never be committed.
// Usage: node tests/sql/snapshot.mjs [file name, default snapshot.json]
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const repo = path.resolve(import.meta.dirname, '../..');
const key = fs.readFileSync(path.join(repo, 'CLAUDE.md'), 'utf8').match(/Key:\s+(\S+)/)[1];
// x-app-version: the version gate (Phase 1) refuses requests without it.
const H = { apikey: key, Authorization: 'Bearer ' + key, 'x-app-version': '2' };
// players.email and .pin are not readable with the public key; ask for the rest.
const PLAYER_COLS = 'id,name,color,handicap,hcp_history,created_at,is_admin,approved,is_social,bag,dgu_number';
const TABLES = ['players', 'rounds', 'fine_types', 'fines', 'fine_payments', 'saturday_events', 'saturday_signups',
  'gps_shots', 'tournaments', 'tournament_players', 'tournament_matches', 'tournament_scores', 'tees'];
const out = {};
for (const t of TABLES) {
  let sel = t === 'players' ? PLAYER_COLS : '*';
  let r = await fetch(`https://qvjybtcbymexheqrjkai.supabase.co/rest/v1/${t}?select=${sel}&order=id.asc`, { headers: H });
  // After Phase 1 the player columns include archived_at and legacy_id.
  if (t === 'players' && r.ok) {
    const more = await fetch(`https://qvjybtcbymexheqrjkai.supabase.co/rest/v1/players?select=${PLAYER_COLS},archived_at,legacy_id&order=id.asc`, { headers: H });
    if (more.ok) r = more;
  }
  if (!r.ok) throw new Error(`${t}: ${r.status} ${await r.text()}`);
  out[t] = await r.json();
}
const dir = path.join(os.tmpdir(), 'rgc-phase1'); fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, process.argv[2] || 'snapshot.json');
fs.writeFileSync(file, JSON.stringify(out));
console.log(file, Object.entries(out).map(([t, rows]) => `${t}=${rows.length}`).join(' '));
