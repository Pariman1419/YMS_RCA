import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lotFromQuestion, lotRcaEvidence } from '../apps/api/src/lot-rca';
import { db, redis } from '../apps/api/src/analytics';
test('Lot identifiers resolve exactly; generic lot questions remain unbound', () => {
  assert.equal(lotFromQuestion('Why low yield for lot no IS3PT2317.8?'), 'IS3PT2317.8');
  assert.equal(lotFromQuestion('Review lot A0TPT0098.1'), 'A0TPT0098.1');
  assert.equal(lotFromQuestion('What process has low lot yield?'), undefined);
});
test(
  'Lot RCA warehouse evidence separates assembly, process, rejects, materials and peers',
  { skip: process.env.RUN_INTEGRATION !== 'true' },
  async () => {
    try {
      const e = await lotRcaEvidence('IS3PT2317.8', '1', 98);
      assert.equal(e.lot.lotNo, 'IS3PT2317.8');
      assert.equal(e.summary.lots, 1);
      assert.equal(e.lot.belowTarget, true);
      assert(e.lot.processCounts.total > 0 && e.lot.defectTotals.total > 0 && e.lot.materialCounts.total > 0);
      assert.equal(e.summary.yield, (100 * e.summary.output) / e.summary.input);
      assert(e.processes.every((p) => p.yield === null || Number.isFinite(p.yield)));
      assert(
        e.lot.processHistory.length <= 120 &&
          e.lot.rejectHistory.length <= 100 &&
          e.lot.materials.length <= 100,
      );
      assert(e.lot.peer.lots > 0);
      assert.equal(e.filters.lot, 'IS3PT2317.8');
      await assert.rejects(() => lotRcaEvidence('UNKNOWN-NOT-A-LOT', '1', 98), /Lot not found/);
    } finally {
      await db.$disconnect();
      await redis.quit();
    }
  },
);
