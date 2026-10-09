import { z } from 'zod';
export const roles = [
  'Administrator',
  'Yield Engineer',
  'QA Engineer',
  'Production Engineer',
  'Process Engineer',
  'Manager',
  'Executive',
] as const;
const entraRoles = new Map(roles.map((role) => [role.replace(/ /g, ''), role]));
export function normalizeEntraRoles(claims: unknown) {
  if (!Array.isArray(claims)) return [];
  return [
    ...new Set(
      claims
        .filter((v): v is string => typeof v === 'string')
        .map((v) => entraRoles.get(v))
        .filter((v): v is (typeof roles)[number] => v !== undefined),
    ),
  ];
}
export const schedules = ['15m', '30m', 'hourly', 'daily'] as const;
export const scheduleMs = { '15m': 900000, '30m': 1800000, hourly: 3600000, daily: 86400000 };
export const querySchema = z.object({
  queryName: z.string().min(3).max(120),
  oracleSource: z.enum(['1', '2']),
  targetTable: z.enum([
    'FACT_YIELD',
    'FACT_DEFECT',
    'FACT_SCRAP',
    'FACT_SPC',
    'FACT_LOT_PROCESS',
    'FACT_LOT_DEFECT',
    'FACT_LOT_MATERIAL',
  ]),
  sqlText: z.string().min(10).max(20000),
  schedule: z.enum(schedules),
  enabled: z.boolean(),
  loadMode: z.enum(['incremental', 'delta', 'full']).default('incremental'),
  lotScope: z.enum(['all', 'assembly_lots']).default('all'),
  anchorSource: z.enum(['1', '2']).default('1'),
  lotBatchSize: z.number().int().min(1).max(500).default(100),
  dependsOnQueryId: z.string().uuid().nullable().default(null),
});
export function validateQueryConfiguration(query: z.infer<typeof querySchema>) {
  validateSql(query.sqlText, query.loadMode);
  if (query.targetTable.startsWith('FACT_LOT_') && query.lotScope !== 'assembly_lots')
    throw new Error('Lot process, defect and material imports must use the assembly lot cohort.');
  if (query.lotScope === 'assembly_lots' && !/:LOT_LIST\b/i.test(query.sqlText))
    throw new Error('Assembly lot enrichment SQL requires WHERE ... IN (:LOT_LIST).');
}
export function validateDependency(
  query: z.infer<typeof querySchema>,
  parent: { id: string; targetTable: string; oracleSource: string } | null,
  id?: string,
) {
  if (!query.dependsOnQueryId) return;
  if (query.dependsOnQueryId === id) throw new Error('A query cannot follow itself.');
  if (!parent || parent.targetTable !== 'FACT_YIELD')
    throw new Error('Choose an assembly FACT_YIELD job as the parent.');
  if (query.lotScope !== 'assembly_lots' || !query.targetTable.startsWith('FACT_LOT_'))
    throw new Error('Only lot process, defect or material jobs can follow an assembly job.');
  if (query.anchorSource !== parent.oracleSource)
    throw new Error('Assembly lot source must match the parent job source.');
}
export function validateSql(sql: string, mode = 'incremental') {
  const cleaned = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim();
  if (
    !/^select\b/i.test(cleaned) ||
    /;|\b(insert|update|delete|merge|drop|alter|create|grant|revoke|execute|begin|commit|rollback|for\s+update)\b/i.test(
      cleaned,
    )
  )
    throw new Error('Only a single read-only SELECT is allowed.');
  if (mode !== 'full' && (!/:LAST_SYNC_TIME\b/i.test(cleaned) || !/:SYNC_END_TIME\b/i.test(cleaned)))
    throw new Error('Incremental and delta SQL require :LAST_SYNC_TIME and :SYNC_END_TIME bounds.');
  return cleaned;
}
export const identifierSchema = z.preprocess(
  (v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : v),
  z.string().trim().min(1).max(256),
);
export const sourceNumberSchema = z.preprocess(
  (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN),
  z.number().finite(),
);
export const quantitySchema = sourceNumberSchema.refine(
  (v) => Number.isInteger(v) && v >= 0 && v <= 2147483647,
  'Expected a non-negative 32-bit integer',
);
export const sourceDateSchema = z.preprocess(
  (v) => (v === null || v === '' ? undefined : v),
  z.coerce.date(),
);
const optionalText = (fallback = 'Unknown') =>
  z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string().trim().min(1).default(fallback));
export const yieldRowSchema = z
  .object({
    SOURCE_KEY: identifierSchema,
    LOT_NO: z.string().trim().min(1),
    CUSTOMER: z.string().trim().min(1),
    PRODUCT: z.string().trim().min(1),
    PROCESS_NAME: z.string().trim().min(1),
    MACHINE_ID: identifierSchema,
    INPUT_QTY: quantitySchema.refine((v) => v > 0, 'Input must be positive'),
    OUTPUT_QTY: quantitySchema,
    REJECT_QTY: quantitySchema,
    REWORK_QTY: quantitySchema.default(0),
    TRANSACTION_DATE: sourceDateSchema,
    PACKAGE: optionalText(),
    DEVICE: optionalText(),
    TECHNOLOGY: optionalText(),
    BOM: optionalText(),
    BOM_REVISION: optionalText('A'),
    FACTORY: optionalText(),
    LINE: optionalText(),
    SHIFT: optionalText(),
    OPERATOR: optionalText(),
    UNIT_COST: sourceNumberSchema.refine((v) => v >= 0, 'Unit cost must be non-negative').default(0),
  })
  .refine(
    (r) => r.OUTPUT_QTY + r.REJECT_QTY <= r.INPUT_QTY && r.REWORK_QTY <= r.INPUT_QTY,
    'Quantities exceed input',
  );
export function kpis(input: number, output: number, reject: number, rework: number) {
  return {
    yield: input ? (output / input) * 100 : 0,
    scrapRate: input ? (reject / input) * 100 : 0,
    reworkRate: input ? (rework / input) * 100 : 0,
  };
}
export function spc(values: number[], target: number, sigma: number) {
  if (!(sigma > 0)) return values.map((value, index) => ({ index, value, rules: [] as string[] }));
  return values.map((value, index) => {
    const z = (value - target) / sigma;
    const rules: string[] = [];
    if (Math.abs(z) > 3) rules.push('WE1: beyond 3 sigma');
    const last = (n: number) =>
      values.slice(Math.max(0, index - n + 1), index + 1).map((v) => (v - target) / sigma);
    const a = last(3);
    if (a.length === 3 && [-1, 1].some((s) => a.filter((v) => v * s > 2).length >= 2))
      rules.push('WE2: 2 of 3 beyond 2 sigma');
    const b = last(5);
    if (b.length === 5 && [-1, 1].some((s) => b.filter((v) => v * s > 1).length >= 4))
      rules.push('WE3: 4 of 5 beyond 1 sigma');
    const c = last(8);
    if (c.length === 8 && [-1, 1].some((s) => c.every((v) => v * s > 0))) rules.push('WE4: 8 on one side');
    const t = values.slice(Math.max(0, index - 5), index + 1);
    if (t.length === 6 && [-1, 1].some((s) => t.slice(1).every((v, i) => (v - t[i]) * s > 0)))
      rules.push('Trend: 6 increasing/decreasing');
    return { index, value, rules };
  });
}
export function controlChart(kind: string, samples: { value: number; n: number; range: number }[]) {
  const mean = samples.reduce((s, x) => s + x.value, 0) / (samples.length || 1);
  const n = samples[0]?.n || 1;
  const r = samples.reduce((s, x) => s + x.range, 0) / (samples.length || 1);
  if (kind === 'p') {
    const p =
      samples.reduce((s, x) => s + x.value, 0) /
      Math.max(
        1,
        samples.reduce((s, x) => s + x.n, 0),
      );
    return samples.map((x) => ({
      value: x.value / x.n,
      target: p,
      ucl: Math.min(1, p + 3 * Math.sqrt((p * (1 - p)) / x.n)),
      lcl: Math.max(0, p - 3 * Math.sqrt((p * (1 - p)) / x.n)),
    }));
  }
  if (kind === 'np') {
    if (samples.some((x) => x.n !== n)) throw new Error('NP requires constant sample size');
    const p = mean / n;
    return samples.map((x) => ({
      value: x.value,
      target: mean,
      ucl: mean + 3 * Math.sqrt(n * p * (1 - p)),
      lcl: Math.max(0, mean - 3 * Math.sqrt(n * p * (1 - p))),
    }));
  }
  if (kind === 'u') {
    const u =
      samples.reduce((s, x) => s + x.value, 0) /
      Math.max(
        1,
        samples.reduce((s, x) => s + x.n, 0),
      );
    return samples.map((x) => ({
      value: x.value / x.n,
      target: u,
      ucl: u + 3 * Math.sqrt(u / x.n),
      lcl: Math.max(0, u - 3 * Math.sqrt(u / x.n)),
    }));
  }
  const constants: Record<number, [number, number, number]> = {
    2: [1.88, 0, 3.267],
    3: [1.023, 0, 2.574],
    4: [0.729, 0, 2.282],
    5: [0.577, 0, 2.114],
    6: [0.483, 0, 2.004],
    7: [0.419, 0.076, 1.924],
    8: [0.373, 0.136, 1.864],
    9: [0.337, 0.184, 1.816],
    10: [0.308, 0.223, 1.777],
  };
  if (!constants[n] || samples.some((x) => x.n !== n))
    throw new Error('X-bar/R require fixed subgroups of size 2–10');
  const [a, d3, d4] = constants[n];
  return samples.map((x) =>
    kind === 'r'
      ? { value: x.range, target: r, ucl: d4 * r, lcl: d3 * r }
      : { value: x.value, target: mean, ucl: mean + a * r, lcl: mean - a * r },
  );
}
