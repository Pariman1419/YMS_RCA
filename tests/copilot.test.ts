import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copilotFilters } from '../apps/api/src/copilot-filters';
test('Copilot resolves explicit process/week requests without generating SQL', () => {
  const filters = copilotFilters(
    'Why did Wire Bond yield drop this week?',
    { factory: 'ACTL Fab 01' },
    ['Wire Bond', 'Die Attach'],
    new Date('2026-10-07T10:00:00Z'),
  );
  assert.equal(filters.process, 'Wire Bond');
  assert.equal(filters.from, '2026-10-05');
  assert.equal(filters.to, '2026-10-07');
  assert.equal(filters.factory, 'ACTL Fab 01');
});
test('Copilot preserves an explicit range unless the question requests a relative period', () => {
  const base = { from: '2026-09-01', to: '2026-09-30' };
  assert.deepEqual(copilotFilters('Show top contributors', base, []), base);
  assert.equal(
    copilotFilters('Compare this month versus last month', base, [], new Date('2026-10-05')).from,
    '2026-10-01',
  );
});
