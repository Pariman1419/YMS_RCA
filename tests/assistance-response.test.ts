import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAssistanceResponse } from '../apps/api/src/assistance-response';
const valid = {
  summary: 'Yield is stable.',
  findings: ['Measured yield is 99%.'],
  hypotheses: [{ candidate: 'Tool wear', verification: 'Inspect tool maintenance records.' }],
  actions: [{ action: 'Review lot history.', owner: 'Yield Engineer', priority: 'High' }],
  limitations: ['No maintenance records provided.'],
};
test('AI structured response preserves evidence sections and fenced JSON', () => {
  assert.deepEqual(parseAssistanceResponse(JSON.stringify(valid)), valid);
  assert.deepEqual(parseAssistanceResponse('```json\n' + JSON.stringify(valid) + '\n```'), valid);
});
test('AI malformed or incomplete responses fall back safely without trusting model output', () => {
  assert.equal(parseAssistanceResponse('Plain text answer'), null);
  assert.deepEqual(
    parseAssistanceResponse(
      JSON.stringify({ ...valid, actions: [{ action: 'x', owner: 'y', priority: 'Critical' }] }),
    )?.actions,
    [],
  );
  assert.equal(parseAssistanceResponse(JSON.stringify({ summary: 'Missing sections' })), null);
});
import { evidenceFindings } from '../apps/api/src/assistance-response';
test('Verified findings use warehouse ranking and percentage-point differences', () => {
  const facts = evidenceFindings({
    filters: { grain: 'assembly' },
    summary: { input: 1000, yield: 98, reject: 20, lots: 2 },
    previousSummary: { input: 1000, yield: 99 },
    processes: [{ name: 'Wire Bond', input: 500, reject: 15, yield: 97 }],
    machines: [],
    customers: [],
  });
  assert(facts.some((f) => f.includes('decreased by 1 percentage points')));
  assert(facts.some((f) => f.includes('Wire Bond') && f.includes('15 units')));
  assert.equal(
    evidenceFindings({ summary: { input: 0 }, filters: {} })[0],
    'There is no measured input in the selected scope; yield is unavailable.',
  );
});
test('AI response reader bounds long sections and accepts lowercase priorities', () => {
  const parsed = parseAssistanceResponse(
    JSON.stringify({
      ...valid,
      findings: Array(20).fill('Observation'),
      hypotheses: Array(10).fill(valid.hypotheses[0]),
      actions: [{ action: 'Review', owner: 'Engineer', priority: 'high' }],
    }),
  );
  assert.equal(parsed?.findings.length, 8);
  assert.equal(parsed?.hypotheses.length, 6);
  assert.equal(parsed?.actions[0].priority, 'High');
});
