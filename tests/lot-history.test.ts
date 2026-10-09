import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processQuality, loadLotHistory } from '../apps/etl/src/lot-history';
import { jdbcStatement } from '../apps/etl/src/jdbc';
test('Process quality keeps unknown quantities distinct from zero and rejects invalid balances', () => {
  assert.equal(processQuality({ INPUT_QTY: 100, OUTPUT_QTY: 98, REJECT_QTY: 2 }).yield, 98);
  assert.equal(processQuality({ INPUT_QTY: 100, OUTPUT_QTY: null }).quality, 'incomplete');
  assert.equal(processQuality({ INPUT_QTY: 100, OUTPUT_QTY: 0 }).yield, 0);
  assert.equal(processQuality({ INPUT_QTY: 100, OUTPUT_QTY: 98, REJECT_QTY: 5 }).quality, 'invalid');
  assert.equal(processQuality({ INPUT_QTY: true, OUTPUT_QTY: 10 }).quality, 'invalid');
});
test('Lot binds preserve SQL text literals and bind lot values as strings', () => {
  const result = jdbcStatement(
    "SELECT ':LOT_LIST' FROM T WHERE LOT IN (:LOT_LIST)",
    new Date(0),
    new Date(),
    ["LOT'1", 'LOT2'],
  );
  assert.deepEqual(result.binds, [
    { type: 'string', value: "LOT'1" },
    { type: 'string', value: 'LOT2' },
  ]);
  assert.equal(result.sql, "SELECT ':LOT_LIST' FROM T WHERE LOT IN (?,?)");
  assert.throws(() => jdbcStatement('SELECT * FROM T WHERE LOT IN (:LOT_LIST)', new Date(), new Date(), []));
});
test('Source data cannot escape its assembly lot cohort or overwrite colliding events', async () => {
  const row = {
    SOURCE_KEY: 'LOT1:1',
    LOT_NO: 'LOT1',
    PROCESS_NAME: 'Wire Bond',
    INPUT_QTY: 100,
    OUTPUT_QTY: 98,
    REJECT_QTY: 2,
  };
  await assert.rejects(
    loadLotHistory('2', '1', 'FACT_LOT_PROCESS', [row], 'full', new Set(['LOT2']), true),
    /outside/,
  );
  await assert.rejects(
    loadLotHistory(
      '2',
      '1',
      'FACT_LOT_PROCESS',
      [row, { ...row, OUTPUT_QTY: 90 }],
      'full',
      new Set(['LOT1']),
      true,
    ),
    /different rows/,
  );
  const result = await loadLotHistory(
    '2',
    '1',
    'FACT_LOT_PROCESS',
    [row, { ...row, SOURCE_KEY: 'LOT1:2', OUTPUT_QTY: 101 }],
    'full',
    new Set(['LOT1']),
    true,
  );
  assert.equal(result.stored, 2);
  assert.equal(result.invalid, 1);
  assert.deepEqual(result.invalidLots, ['LOT1']);
});
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { db } from '../apps/etl/src/loader';
test(
  'Process storage preserves raw fields, updates corrections, and keeps delta immutable',
  { skip: process.env.RUN_INTEGRATION !== 'true' },
  async () => {
    const parent = await db.lotRegistry.findFirst({ where: { assemblySource: '1' } });
    assert.ok(parent);
    const suffix = randomUUID(),
      key = 'integration-process-' + suffix,
      processName = 'integration-process-' + suffix;
    const row = {
      SOURCE_KEY: key,
      LOT_NO: parent.lotNo,
      PROCESS_NAME: processName,
      MACHINE_ID: 'UNASSIGNED',
      OPERATION_SEQUENCE: 17,
      INPUT_QTY: 100,
      OUTPUT_QTY: 98,
      REJECT_QTY: 2,
      COMPLETED_AT: '2026-10-01T00:00:00Z',
      AREA_CODE: 'PASSY',
      EXTRA_OPTIONAL_FIELD: 'retained',
    };
    const allowed = new Set([parent.lotNo]);
    try {
      await loadLotHistory('integration', '1', 'FACT_LOT_PROCESS', [row], 'full', allowed);
      let stored = await db.lotProcess.findFirstOrThrow({ where: { source: 'integration', sourceKey: key } });
      assert.equal(stored.outputQty, 98n);
      assert.equal((stored.rawPayload as any).EXTRA_OPTIONAL_FIELD, 'retained');
      await loadLotHistory(
        'integration',
        '1',
        'FACT_LOT_PROCESS',
        [{ ...row, OUTPUT_QTY: 90 }],
        'delta',
        allowed,
      );
      assert.equal(
        (await db.lotProcess.findFirstOrThrow({ where: { source: 'integration', sourceKey: key } }))
          .outputQty,
        98n,
      );
      await loadLotHistory(
        'integration',
        '1',
        'FACT_LOT_PROCESS',
        [{ ...row, OUTPUT_QTY: 101 }],
        'full',
        allowed,
      );
      stored = await db.lotProcess.findFirstOrThrow({ where: { source: 'integration', sourceKey: key } });
      assert.equal(stored.qualityStatus, 'invalid');
      assert.equal(stored.yieldPercentage, null);
      assert.equal(stored.outputQty, 101n);
      assert.equal(await db.lotProcess.count({ where: { source: 'integration', sourceKey: key } }), 1);
    } finally {
      await db.lotProcess.deleteMany({ where: { source: 'integration', sourceKey: key } });
      await db.process.deleteMany({ where: { name: processName } });
      await db.$disconnect();
    }
  },
);
