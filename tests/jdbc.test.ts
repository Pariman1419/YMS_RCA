import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jdbcStatement } from '../apps/etl/src/jdbc';
test('JDBC named timestamps are ordered and preserve quoted SQL and comments', () => {
  const start = new Date('2026-01-01Z'),
    end = new Date('2026-02-01Z');
  const result = jdbcStatement(
    "SELECT ':LAST_SYNC_TIME', q'[:SYNC_END_TIME]' FROM T WHERE UPDATED < :SYNC_END_TIME AND UPDATED >= :LAST_SYNC_TIME -- :LAST_SYNC_TIME",
    start,
    end,
  );
  assert.deepEqual(result.binds, [end.toISOString(), start.toISOString()]);
  assert.ok(result.sql.includes("':LAST_SYNC_TIME'"));
  assert.ok(result.sql.includes("q'[:SYNC_END_TIME]'"));
  assert.ok(result.sql.includes('UPDATED < ? AND UPDATED >= ?'));
});
