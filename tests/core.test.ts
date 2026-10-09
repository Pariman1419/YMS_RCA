import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlChart, kpis, spc, validateSql, yieldRowSchema } from '../packages/core/src';
test('SQL accepts bounded SELECT and blocks mutating / multi-statement queries', () => {
  assert.match(
    validateSql('SELECT * FROM LOT_HISTORY WHERE UPDATED >= :LAST_SYNC_TIME AND UPDATED < :SYNC_END_TIME'),
    /^SELECT/,
  );
  for (const sql of [
    'DELETE FROM LOT_HISTORY',
    'SELECT 1 FROM DUAL; DROP TABLE X',
    'SELECT * FROM X FOR UPDATE',
    'SELECT * FROM X',
  ])
    assert.throws(() => validateSql(sql));
  assert.equal(validateSql('SELECT 1 FROM DUAL', 'full'), 'SELECT 1 FROM DUAL');
});
test('Source record validation prevents impossible or incomplete quantities', () => {
  const base = {
    SOURCE_KEY: '123',
    LOT_NO: 'L001',
    CUSTOMER: 'NXP',
    PRODUCT: 'IC',
    PROCESS_NAME: 'Wire Bond',
    MACHINE_ID: 'WB-01',
    INPUT_QTY: 100,
    OUTPUT_QTY: 98,
    REJECT_QTY: 2,
    TRANSACTION_DATE: '2026-10-01',
  };
  assert.equal(yieldRowSchema.parse(base).REWORK_QTY, 0);
  assert.equal(yieldRowSchema.safeParse({ ...base, OUTPUT_QTY: 110 }).success, false);
  assert.equal(yieldRowSchema.safeParse({ ...base, INPUT_QTY: 0 }).success, false);
  assert.equal(yieldRowSchema.safeParse({ ...base, TRANSACTION_DATE: 'bad' }).success, false);
  for (const missing of [null, undefined, '']) {
    assert.equal(yieldRowSchema.safeParse({ ...base, SOURCE_KEY: missing }).success, false);
    assert.equal(yieldRowSchema.safeParse({ ...base, MACHINE_ID: missing }).success, false);
    assert.equal(yieldRowSchema.safeParse({ ...base, OUTPUT_QTY: missing }).success, false);
    assert.equal(yieldRowSchema.safeParse({ ...base, TRANSACTION_DATE: missing }).success, false);
  }
  assert.equal(yieldRowSchema.parse({ ...base, CUSTOMER: '  NXP  ', PACKAGE: null }).CUSTOMER, 'NXP');
  assert.equal(yieldRowSchema.parse({ ...base, PACKAGE: null }).PACKAGE, 'Unknown');
});
test('Yield is weighted by quantity and handles no input', () => {
  assert.equal(kpis(1000, 970, 30, 10).yield, 97);
  assert.equal(kpis(0, 0, 0, 0).yield, 0);
});
test('Western Electric rules and sustained trend are detected', () => {
  assert.ok(
    spc([0, 0, 3.2], 0, 1)
      .at(-1)
      ?.rules.some((r) => r.startsWith('WE1')),
  );
  assert.ok(
    spc([2.2, 0, 2.4], 0, 1)
      .at(-1)
      ?.rules.some((r) => r.startsWith('WE2')),
  );
  assert.ok(
    spc([1, 1, 1, 1, 1, 1, 1, 1], 0, 1)
      .at(-1)
      ?.rules.some((r) => r.startsWith('WE4')),
  );
  assert.ok(
    spc([0, 1, 2, 3, 4, 5], 0, 1)
      .at(-1)
      ?.rules.some((r) => r.startsWith('Trend')),
  );
});
test('P chart accounts for sample size; NP rejects varying denominators', () => {
  const samples = [
    { value: 10, n: 100, range: 0 },
    { value: 20, n: 200, range: 0 },
  ];
  const p = controlChart('p', samples);
  assert.equal(p[0].target, 0.1);
  assert.ok(p[0].ucl > p[1].ucl);
  assert.throws(() => controlChart('np', samples));
});
test('X-bar and R use subgroup constants and validate subgroup size', () => {
  const samples = [
    { value: 10, n: 5, range: 2 },
    { value: 12, n: 5, range: 4 },
  ];
  const x = controlChart('xbar', samples),
    r = controlChart('r', samples);
  assert.equal(x[0].target, 11);
  assert.equal(x[0].ucl, 11 + 0.577 * 3);
  assert.equal(r[0].ucl, 2.114 * 3);
  assert.throws(() => controlChart('xbar', [{ value: 1, n: 1, range: 0 }]));
});
