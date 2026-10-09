import { test } from 'node:test';
import assert from 'node:assert/strict';
import { externalKnowledge, knowledgeText, selectKnowledgeSources } from '../apps/api/src/external-knowledge';
import { evidenceFindings } from '../apps/api/src/assistance-response';
test('External references are optional and never send lot or question data', async () => {
  let calls: any[] = [];
  const fake = async (url: any, opts: any) => {
    calls.push({ url, opts });
    return new Response(
      '<main>Failure analysis process ' +
        'Confirm defects and review physical evidence. '.repeat(40) +
        '</main>',
      { headers: { 'content-type': 'text/html' } },
    );
  };
  assert.equal((await externalKnowledge(false, 'IS3PT2317.8', fake as any)).status, 'disabled');
  assert.equal(calls.length, 0);
  const r = await externalKnowledge(true, 'IS3PT2317.8 wire bond', fake as any);
  assert.equal(r.status, 'available');
  assert.equal(r.sources.length, 2);
  assert(calls.every((c) => !c.url.includes('IS3PT2317') && c.opts.redirect === 'manual' && !c.opts.body));
  assert.deepEqual(
    selectKnowledgeSources('Wire Bond loop').map((s) => s.id),
    ['ti-fa', 'amkor-interconnect'],
  );
});
test('External failure or redirects do not block local analysis or follow other hosts', async () => {
  let calls = 0;
  const r = await externalKnowledge(true, 'mold', (async () => {
    calls++;
    return new Response('', { status: 302, headers: { location: 'http://127.0.0.1:4000' } });
  }) as any);
  assert.equal(calls, 2);
  assert.equal(r.status, 'unavailable');
  assert.equal(r.sources.length, 0);
  assert.equal(knowledgeText('<main><script>bad()</script><p>Wire &amp; bond</p></main>'), 'Wire & bond');
});
test('Lot findings compare actual target and cohort without claiming a proven cause', () => {
  const e = {
    summary: { input: 100, output: 90, reject: 10, yield: 90 },
    lot: {
      lotNo: 'LOT123',
      targetYield: 98,
      belowTarget: true,
      peer: { input: 500, yield: 99, lots: 5 },
      processCounts: { total: 8, invalid: 1 },
      defectTotals: { total: 3, invalid: 0 },
      materialCounts: { total: 2 },
    },
    processes: [{ name: 'Wire Bond', reject: 8 }],
    defects: [{ code: 'NSOP', description: 'Non stick', qty: 8 }],
  };
  const facts = evidenceFindings(e);
  assert(facts.some((f) => f.includes('below')));
  assert(facts.some((f) => f.includes('NSOP')));
  assert(facts.some((f) => f.includes('not causal evidence')));
  e.lot.belowTarget = false;
  e.summary.yield = 99;
  assert(evidenceFindings(e).some((f) => f.includes('at or above')));
});
import { lotInvestigationChecks } from '../apps/api/src/assistance-response';
test('Lot investigation fallback uses recorded rejects and upstream checks without claiming origin', () => {
  const e = {
    lot: { lotNo: 'LOT123', processCounts: { valid: 1 }, defectTotals: { total: 1, invalid: 0 } },
    processes: [{ name: 'FVI' }],
    defects: [{ code: 'TW', description: 'Reliability test' }],
  };
  const checks = lotInvestigationChecks(e);
  assert.equal(checks.length, 2);
  assert(checks[0].verification.includes('planned removals'));
  assert(checks[1].verification.includes('does not prove the origin'));
  assert.deepEqual(
    lotInvestigationChecks({
      ...e,
      lot: { ...e.lot, processCounts: { valid: 0 }, defectTotals: { total: 1, invalid: 1 } },
    }),
    [],
  );
});
