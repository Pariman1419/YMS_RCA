import { z } from 'zod';

export const responseSchema = z.object({
  summary: z.string().min(1).max(3000),
  findings: z.array(z.string().max(1500)).max(8),
  hypotheses: z
    .array(z.object({ candidate: z.string().max(500), verification: z.string().max(1000) }))
    .max(6),
  actions: z
    .array(
      z.object({
        action: z.string().max(1000),
        owner: z.string().max(100),
        priority: z.enum(['High', 'Medium', 'Low']),
      }),
    )
    .max(6),
  limitations: z.array(z.string().max(1000)).max(6),
});

export function parseAssistanceResponse(content: string) {
  try {
    const clean = content
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    const raw = JSON.parse(clean);
    if (
      typeof raw?.summary !== 'string' ||
      !['findings', 'hypotheses', 'actions', 'limitations'].every((k) => Array.isArray(raw[k]))
    )
      return null;
    const strings = (rows: unknown[], limit: number, length: number) =>
      rows
        .filter((v): v is string => typeof v === 'string')
        .slice(0, limit)
        .map((v) => v.slice(0, length));
    const parsed = responseSchema.safeParse({
      summary: raw.summary.slice(0, 3000),
      findings: strings(raw.findings, 8, 1500),
      hypotheses: raw.hypotheses
        .filter((h: any) => typeof h?.candidate === 'string' && typeof h?.verification === 'string')
        .slice(0, 6)
        .map((h: any) => ({
          candidate: h.candidate.slice(0, 500),
          verification: h.verification.slice(0, 1000),
        })),
      actions: raw.actions
        .filter(
          (a: any) =>
            typeof a?.action === 'string' &&
            typeof a?.owner === 'string' &&
            ['high', 'medium', 'low'].includes(String(a.priority).toLowerCase()),
        )
        .slice(0, 6)
        .map((a: any) => ({
          action: a.action.slice(0, 1000),
          owner: a.owner.slice(0, 100),
          priority: a.priority[0].toUpperCase() + a.priority.slice(1).toLowerCase(),
        })),
      limitations: strings(raw.limitations, 6, 1000),
    });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// Numerical conclusions are computed from warehouse evidence, never from model arithmetic.
export function evidenceFindings(e: any): string[] {
  const n = (v: number) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const facts: string[] = [];
  if (e.lot) {
    const lot = e.lot;
    if (Number(e.summary?.input) > 0) {
      facts.push(
        `Lot ${lot.lotNo} assembly yield is ${n(e.summary.yield)}% (${n(e.summary.output)} / ${n(e.summary.input)} units), with ${n(e.summary.reject)} assembly rejects.`,
      );
      facts.push(
        `This lot is ${lot.belowTarget ? 'below' : 'at or above'} the user-selected investigation target of ${n(lot.targetYield)}%. The target is not a confirmed product specification.`,
      );
    } else facts.push(`Lot ${lot.lotNo} has no measured assembly input; yield is unavailable.`);
    if (Number(lot.peer?.input) > 0)
      facts.push(
        `The same-product, same-factory cohort has ${n(lot.peer.yield)}% weighted assembly yield across ${n(lot.peer.lots)} other lots in the preceding 30 days. This is a comparison, not causal evidence.`,
      );
    const top = e.processes?.[0];
    if (top)
      facts.push(
        `Process ${top.name} has the largest measured process reject quantity: ${n(top.reject)} units. Process and assembly losses may overlap.`,
      );
    const defect = e.defects?.[0];
    if (defect)
      facts.push(
        `Top recorded reject code ${defect.code} (${defect.description}): ${n(defect.qty)} units across its recorded operations. Reject-code disposition must be confirmed before classifying these units as manufacturing defects.`,
      );
    facts.push(
      `Warehouse coverage: ${n(lot.processCounts.total)} process records, ${n(lot.defectTotals.total)} reject records and ${n(lot.materialCounts.total)} material records; ${n(lot.processCounts.invalid + lot.defectTotals.invalid)} records need quality review.`,
    );
    return facts;
  }
  if (Number(e.summary?.input) > 0) {
    facts.push(
      `${e.filters?.grain === 'process' ? 'Measured process' : 'Assembly completion'} yield is ${n(e.summary.yield)}%, with ${n(e.summary.reject)} rejects across ${n(e.summary.lots)} lots in the selected period.`,
    );
    if (Number(e.previousSummary?.input) > 0) {
      const change = e.summary.yield - e.previousSummary.yield;
      facts.push(
        `Yield ${Math.abs(change) < 0.005 ? 'is unchanged' : change > 0 ? 'increased' : 'decreased'}${Math.abs(change) < 0.005 ? '' : ` by ${n(Math.abs(change))} percentage points`} versus the previous period (${n(e.previousSummary.yield)}%).`,
      );
    } else facts.push('The previous period has no measured input; a yield comparison is unavailable.');
  } else facts.push('There is no measured input in the selected scope; yield is unavailable.');
  for (const [key, label] of [
    ['processes', 'Process'],
    ['machines', 'Machine'],
    ['customers', 'Customer'],
  ]) {
    const top = e[key]?.[0];
    if (top && Number(top.input) > 0)
      facts.push(
        `${label} ${top.name} has the highest reject quantity in the returned ${label.toLowerCase()} ranking: ${n(top.reject)} units, with ${n(top.yield)}% yield. ${key === 'customers' ? 'Customer measurements follow the selected grain.' : 'This ranking uses process measurements.'}${key === 'machines' && /^(manual|unknown|unmapped)$/i.test(top.name) ? ' This is a source grouping label; physical equipment identity is unconfirmed.' : ''}`,
      );
  }
  return facts;
}

export function lotInvestigationChecks(e: any) {
  if (
    !e.lot ||
    (e.lot.processCounts.valid === 0 && e.lot.defectTotals.total - e.lot.defectTotals.invalid === 0)
  )
    return [];
  const checks: { candidate: string; verification: string }[] = [];
  const reject = e.defects?.[0];
  if (reject)
    checks.push({
      candidate: `Reject classification or disposition for ${reject.code} may contribute to reported lot yield loss`,
      verification: `Review ${reject.code} (${reject.description}) dispositions against physical samples and approved sampling/reliability plans. Determine whether the recorded units are defective, planned removals or another disposition before assigning a failure mechanism.`,
    });
  const process = e.processes?.[0];
  if (process)
    checks.push({
      candidate: `Upstream process variation may explain rejects recorded at ${process.name}`,
      verification: `Trace affected units in lot ${e.lot.lotNo} through the ordered route, confirmed equipment IDs and recipe records. Compare with same-product peers and physical defect evidence. A rejection or inspection step alone does not prove the origin.`,
    });
  return checks;
}

export const responseFormat = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'findings', 'hypotheses', 'actions', 'limitations'],
  properties: {
    summary: { type: 'string', maxLength: 400 },
    findings: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 400 } },
    hypotheses: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['candidate', 'verification'],
        properties: {
          candidate: { type: 'string', maxLength: 300 },
          verification: { type: 'string', maxLength: 500 },
        },
      },
    },
    actions: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['action', 'owner', 'priority'],
        properties: {
          action: { type: 'string', maxLength: 300 },
          owner: { type: 'string', maxLength: 100 },
          priority: { type: 'string', enum: ['High', 'Medium', 'Low'] },
        },
      },
    },
    limitations: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 400 } },
  },
};
