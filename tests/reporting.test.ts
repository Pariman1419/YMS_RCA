import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderReport } from '../apps/api/src/reporting';
test('CSV escapes quotes and neutralizes spreadsheet formulas', async () => {
  const result = await renderReport([{ name: '=HYPERLINK("bad")', yield: 97 }], 'csv');
  assert.ok(result.buffer.toString().includes("'=HYPERLINK"));
  assert.ok(result.buffer.toString().includes('""bad""'));
  assert.ok(result.buffer.toString().includes('\r\n'));
});
test('Office and PDF exports are real binary documents', async () => {
  for (const format of ['xlsx', 'pptx', 'pdf']) {
    const result = await renderReport([{ name: 'Wire Bond', input: 1000, output: 970, yield: 97 }], format);
    assert.ok(result.buffer.length > 500);
    assert.equal(result.buffer.subarray(0, 2).toString(), format === 'pdf' ? '%P' : 'PK');
  }
});
