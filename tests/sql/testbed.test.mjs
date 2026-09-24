import test from 'node:test'; import assert from 'node:assert/strict';
import { freshDb, SNAPSHOT, TABLES } from './testbed.mjs';
test('testbed loads the snapshot', async () => {
  const db = await freshDb();
  for (const t of TABLES) {
    const n = (await db.query(`SELECT count(*)::int n FROM public.${t}`)).rows[0].n;
    assert.equal(n, SNAPSHOT[t].length, t);
  }
});
