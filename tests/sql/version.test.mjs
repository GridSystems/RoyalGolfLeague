// The version gate (Task 6/9) needs every piece that sends or checks x-app-version to agree.
// Plain filesystem reads — no DB needed, these are just string checks against the checked-in files.
import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
const repo = path.resolve(import.meta.dirname, '../..');
const read = f => fs.readFileSync(path.join(repo, f), 'utf8');

test('index.html sends x-app-version 3', () => {
  assert.match(read('index.html'), /APP_VERSION=3/);
});

test('course-mapper.html sends x-app-version 3', () => {
  assert.match(read('course-mapper.html'), /'x-app-version':'3'/);
});

test('tests/sql/snapshot.mjs sends x-app-version 3', () => {
  assert.match(read('tests/sql/snapshot.mjs'), /'x-app-version': '3'/);
});

test('the database gate refuses anything below version 3', () => {
  assert.match(read('supabase/phase2a_auth.sql'), /v::int < 3/);
});
