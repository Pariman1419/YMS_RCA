import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLotSankey } from '../apps/web/src/lib/lot-sankey';
test('Sankey preserves quantities without combining machine paths across operations', () => {
  const g = buildLotSankey('LOT1', [
    { sequence: 1, operation: 'DIE ATTACH', machine: 'M1', code: 'A', description: 'Reject A', qty: 4 },
    { sequence: 1, operation: 'DIE ATTACH', machine: 'M1', code: 'B', description: 'Reject B', qty: 6 },
    { sequence: 2, operation: 'WIRE BOND', machine: 'M1', code: 'A', description: 'Reject A', qty: 3 },
  ]);
  assert.equal(g.total, 13);
  assert.equal(g.nodes.filter((n) => n.kind === 'machine').length, 2);
  assert.equal(g.nodes.filter((n) => n.kind === 'reject').length, 2);
  assert.equal(
    g.links.filter((e) => e.source === 0).reduce((s, e) => s + e.value, 0),
    13,
  );
  for (let i = 1; i < g.nodes.length; i++)
    if (g.nodes[i].kind !== 'reject') {
      assert.equal(
        g.links.filter((e) => e.target === i).reduce((s, e) => s + e.value, 0),
        g.links.filter((e) => e.source === i).reduce((s, e) => s + e.value, 0),
      );
    }
  assert(g.records[0].nodeKeys.includes(g.nodes.find((n) => n.kind === 'lot')!.key));
});
test('Sankey omits nonpositive and invalid weights and does not invent missing machine identity', () => {
  const base = {
    sequence: null,
    operation: 'Unknown operation',
    machine: 'UNKNOWN',
    code: 'X',
    description: 'Unknown reject',
  };
  const g = buildLotSankey('LOT2', [
    { ...base, qty: 0 },
    { ...base, qty: -1 },
    { ...base, qty: NaN },
    { ...base, qty: 2 },
  ]);
  assert.equal(g.total, 2);
  assert.equal(g.records.length, 1);
  assert.equal(g.nodes.find((n) => n.kind === 'machine')?.name, 'UNKNOWN');
  assert.equal(buildLotSankey('LOT2', []).links.length, 0);
});
