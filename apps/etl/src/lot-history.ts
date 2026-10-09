import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { identifierSchema } from '../../../packages/core/src';
import { db } from './loader';
const identity = z.object({
  SOURCE_KEY: identifierSchema,
  LOT_NO: z.string().trim().min(1),
  PROCESS_NAME: z.string().trim().min(1),
});
export function processQuality(raw: Record<string, unknown>) {
  const errors: { path: string; message: string }[] = [];
  const quantity = (field: string) => {
    const value = raw[field];
    if (value === null || value === undefined || value === '') return null;
    const n = typeof value === 'boolean' ? NaN : Number(value);
    if (!Number.isSafeInteger(n) || n < 0) {
      errors.push({ path: field, message: 'Expected a non-negative safe integer' });
      return null;
    }
    return n;
  };
  const input = quantity('INPUT_QTY'),
    output = quantity('OUTPUT_QTY'),
    reject = quantity('REJECT_QTY'),
    rework = quantity('REWORK_QTY');
  if (input !== null && input === 0 && output !== null && output > 0)
    errors.push({ path: 'INPUT_QTY', message: 'Nonzero output with zero input' });
  if (input !== null && output !== null && (output > input || (reject !== null && output + reject > input)))
    errors.push({ path: 'quantity balance', message: 'Output and rejects exceed input' });
  if (input !== null && rework !== null && rework > input)
    errors.push({ path: 'REWORK_QTY', message: 'Rework exceeds input' });
  return {
    input,
    output,
    reject,
    rework,
    errors,
    quality: errors.length
      ? 'invalid'
      : input !== null && input > 0 && output !== null
        ? 'valid'
        : 'incomplete',
    yield: !errors.length && input !== null && input > 0 && output !== null ? (100 * output) / input : null,
  };
}
function date(value: unknown, field: string, errors: { path: string; message: string }[]) {
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(value as string);
  if (!Number.isFinite(+d)) {
    errors.push({ path: field, message: 'Invalid timestamp' });
    return null;
  }
  return d.toISOString();
}
export async function syncLotRegistry(source?: string) {
  await db.$executeRaw(Prisma.sql`INSERT INTO lot_registry(assembly_source,lot_no,customer_id,product_id,bom_id,factory,assembly_date)
 SELECT DISTINCT ON(source,lot_no) source,lot_no,customer_id,product_id,bom_id,factory,transaction_date
 FROM fact_yield WHERE source <> 'sample' ${source ? Prisma.sql`AND source=${source}` : Prisma.empty}
 ORDER BY source,lot_no,transaction_date DESC
 ON CONFLICT(assembly_source,lot_no) DO UPDATE SET customer_id=EXCLUDED.customer_id,product_id=EXCLUDED.product_id,bom_id=EXCLUDED.bom_id,factory=EXCLUDED.factory,assembly_date=EXCLUDED.assembly_date,updated_at=now()
 WHERE lot_registry.customer_id IS DISTINCT FROM EXCLUDED.customer_id OR lot_registry.product_id IS DISTINCT FROM EXCLUDED.product_id OR lot_registry.bom_id IS DISTINCT FROM EXCLUDED.bom_id OR lot_registry.factory IS DISTINCT FROM EXCLUDED.factory OR lot_registry.assembly_date IS DISTINCT FROM EXCLUDED.assembly_date`);
}
export async function loadLotHistory(
  source: string,
  anchorSource: string,
  target: string,
  rawRows: Record<string, unknown>[],
  mode: string,
  allowedLots: Set<string>,
  test = false,
) {
  if (target === 'FACT_LOT_MATERIAL')
    return loadLotMaterials(source, anchorSource, rawRows, mode, allowedLots, test);
  const rows = rawRows.map((raw) => {
    const ids = identity.parse(raw);
    if (!allowedLots.has(ids.LOT_NO))
      throw new Error(
        'Source returned a lot outside the requested assembly cohort. Check LOT_NO mapping and :LOT_LIST filter.',
      );
    const quality = processQuality(raw);
    const started = date(raw.STARTED_AT, 'STARTED_AT', quality.errors);
    const completed = date(raw.COMPLETED_AT ?? raw.TRANSACTION_DATE, 'COMPLETED_AT', quality.errors);
    const sequence =
      raw.OPERATION_SEQUENCE === null || raw.OPERATION_SEQUENCE === undefined
        ? null
        : Number(raw.OPERATION_SEQUENCE);
    if (sequence !== null && !Number.isFinite(sequence))
      quality.errors.push({ path: 'OPERATION_SEQUENCE', message: 'Invalid sequence' });
    const machine =
      raw.MACHINE_ID === null || raw.MACHINE_ID === undefined || raw.MACHINE_ID === ''
        ? 'UNASSIGNED'
        : String(raw.MACHINE_ID);
    const qty = raw.QTY === null || raw.QTY === undefined ? null : Number(raw.QTY);
    if (target === 'FACT_LOT_DEFECT' && (!Number.isSafeInteger(qty) || (qty !== null && qty < 0)))
      quality.errors.push({ path: 'QTY', message: 'Missing or invalid defect quantity' });
    if (target === 'FACT_LOT_DEFECT' && (!raw.DEFECT_CODE || !raw.DEFECT_DESCRIPTION))
      throw new Error('Defect code and description aliases are required');
    const occurred = date(raw.TRANSACTION_DATE ?? raw.COMPLETED_AT, 'TRANSACTION_DATE', quality.errors);
    return {
      id: randomUUID(),
      source,
      source_key: ids.SOURCE_KEY,
      assembly_source: anchorSource,
      lot_no: ids.LOT_NO,
      source_lot_no: raw.SOURCE_LOT_NO ? String(raw.SOURCE_LOT_NO) : null,
      process_name: ids.PROCESS_NAME,
      machine_name: machine,
      operation_sequence: Number.isFinite(sequence) ? sequence : null,
      process_code: raw.PROCESS_CODE ? String(raw.PROCESS_CODE) : null,
      started_at: started,
      completed_at: completed,
      input_qty: quality.input,
      output_qty: quality.output,
      reject_qty: quality.reject,
      rework_qty: quality.rework,
      yield_percentage: quality.errors.length ? null : quality.yield,
      status: raw.STATUS ? String(raw.STATUS) : completed ? 'completed' : 'pending',
      quality_status: quality.errors.length
        ? 'invalid'
        : target === 'FACT_LOT_DEFECT'
          ? 'valid'
          : quality.quality,
      quality_errors: quality.errors,
      operator_name: raw.OPERATOR ? String(raw.OPERATOR) : null,
      shift: raw.SHIFT ? String(raw.SHIFT) : null,
      defect_code: raw.DEFECT_CODE ? String(raw.DEFECT_CODE) : null,
      defect_description: raw.DEFECT_DESCRIPTION ? String(raw.DEFECT_DESCRIPTION) : null,
      qty,
      occurred_at: occurred,
      process_source_key: raw.PROCESS_SOURCE_KEY ? String(raw.PROCESS_SOURCE_KEY) : null,
      raw_payload: JSON.parse(JSON.stringify(raw)),
    };
  });
  const unique = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const previous = unique.get(row.source_key);
    if (previous && JSON.stringify(previous.raw_payload) !== JSON.stringify(row.raw_payload))
      throw new Error(
        'SOURCE_KEY identifies different rows in the same batch. Use a stable unique process/defect event key.',
      );
    unique.set(row.source_key, row);
  }
  const values = [...unique.values()];
  if (!values.length) return { stored: 0, invalid: 0, invalidLots: [] as string[] };
  if (test)
    return {
      stored: values.length,
      invalid: values.filter((r) => r.quality_status === 'invalid').length,
      invalidLots: [...new Set(values.filter((r) => r.quality_status === 'invalid').map((r) => r.lot_no))],
    };
  await db.$transaction(
    async (tx) => {
      const processNames = [...new Set(values.map((r) => r.process_name))],
        machines = [...new Map(values.map((r) => [r.machine_name, r])).values()];
      await tx.process.createMany({
        data: processNames.map((name) => ({ name, operation: name, sequence: 0 })),
        skipDuplicates: true,
      });
      await tx.machine.createMany({
        data: machines.map((r) => ({ name: r.machine_name, type: r.process_name, line: 'Unknown' })),
        skipDuplicates: true,
      });
      const [processes, equipment] = await Promise.all([
        tx.process.findMany({ where: { name: { in: processNames } } }),
        tx.machine.findMany({ where: { name: { in: machines.map((r) => r.machine_name) } } }),
      ]);
      const payload = values.map((r) => ({
        ...r,
        process_id: processes.find((p) => p.name === r.process_name)!.id,
        machine_id: equipment.find((m) => m.name === r.machine_name)!.id,
      }));
      const json = JSON.stringify(payload);
      if (target === 'FACT_LOT_PROCESS')
        await tx.$executeRaw(Prisma.sql`INSERT INTO fact_lot_process(id,source,source_key,assembly_source,lot_no,source_lot_no,process_id,machine_id,operation_sequence,process_code,started_at,completed_at,input_qty,output_qty,reject_qty,rework_qty,yield_percentage,status,quality_status,quality_errors,operator_name,shift,raw_payload)
   SELECT id,source,source_key,assembly_source,lot_no,source_lot_no,process_id,machine_id,operation_sequence,process_code,started_at,completed_at,input_qty,output_qty,reject_qty,rework_qty,yield_percentage,status,quality_status,quality_errors,operator_name,shift,raw_payload
   FROM jsonb_to_recordset(${json}::jsonb) AS r(id uuid,source text,source_key text,assembly_source text,lot_no text,source_lot_no text,process_id int,machine_id int,operation_sequence numeric,process_code text,started_at timestamptz,completed_at timestamptz,input_qty bigint,output_qty bigint,reject_qty bigint,rework_qty bigint,yield_percentage numeric,status text,quality_status text,quality_errors jsonb,operator_name text,shift text,raw_payload jsonb)
   ON CONFLICT(source,source_key) ${mode === 'delta' ? Prisma.sql`DO NOTHING` : Prisma.sql`DO UPDATE SET assembly_source=EXCLUDED.assembly_source,lot_no=EXCLUDED.lot_no,source_lot_no=EXCLUDED.source_lot_no,process_id=EXCLUDED.process_id,machine_id=EXCLUDED.machine_id,operation_sequence=EXCLUDED.operation_sequence,process_code=EXCLUDED.process_code,started_at=EXCLUDED.started_at,completed_at=EXCLUDED.completed_at,input_qty=EXCLUDED.input_qty,output_qty=EXCLUDED.output_qty,reject_qty=EXCLUDED.reject_qty,rework_qty=EXCLUDED.rework_qty,yield_percentage=EXCLUDED.yield_percentage,status=EXCLUDED.status,quality_status=EXCLUDED.quality_status,quality_errors=EXCLUDED.quality_errors,operator_name=EXCLUDED.operator_name,shift=EXCLUDED.shift,raw_payload=EXCLUDED.raw_payload,imported_at=now() WHERE fact_lot_process.raw_payload IS DISTINCT FROM EXCLUDED.raw_payload OR fact_lot_process.assembly_source IS DISTINCT FROM EXCLUDED.assembly_source`}`);
      else if (target === 'FACT_LOT_DEFECT')
        await tx.$executeRaw(Prisma.sql`INSERT INTO fact_lot_defect(id,source,source_key,assembly_source,lot_no,source_lot_no,process_id,machine_id,operation_sequence,process_source_key,defect_code,defect_description,qty,rework_qty,occurred_at,quality_status,quality_errors,raw_payload)
   SELECT id,source,source_key,assembly_source,lot_no,source_lot_no,process_id,machine_id,operation_sequence,process_source_key,defect_code,defect_description,qty,rework_qty,occurred_at,quality_status,quality_errors,raw_payload
   FROM jsonb_to_recordset(${json}::jsonb) AS r(id uuid,source text,source_key text,assembly_source text,lot_no text,source_lot_no text,process_id int,machine_id int,operation_sequence numeric,process_source_key text,defect_code text,defect_description text,qty bigint,rework_qty bigint,occurred_at timestamptz,quality_status text,quality_errors jsonb,raw_payload jsonb)
   ON CONFLICT(source,source_key) ${mode === 'delta' ? Prisma.sql`DO NOTHING` : Prisma.sql`DO UPDATE SET assembly_source=EXCLUDED.assembly_source,lot_no=EXCLUDED.lot_no,source_lot_no=EXCLUDED.source_lot_no,process_id=EXCLUDED.process_id,machine_id=EXCLUDED.machine_id,operation_sequence=EXCLUDED.operation_sequence,process_source_key=EXCLUDED.process_source_key,defect_code=EXCLUDED.defect_code,defect_description=EXCLUDED.defect_description,qty=EXCLUDED.qty,rework_qty=EXCLUDED.rework_qty,occurred_at=EXCLUDED.occurred_at,quality_status=EXCLUDED.quality_status,quality_errors=EXCLUDED.quality_errors,raw_payload=EXCLUDED.raw_payload,imported_at=now() WHERE fact_lot_defect.raw_payload IS DISTINCT FROM EXCLUDED.raw_payload OR fact_lot_defect.assembly_source IS DISTINCT FROM EXCLUDED.assembly_source`}`);
      else throw new Error('Unsupported lot history target');
    },
    { timeout: 30000, maxWait: 30000 },
  );
  return {
    stored: values.length,
    invalid: values.filter((r) => r.quality_status === 'invalid').length,
    invalidLots: [...new Set(values.filter((r) => r.quality_status === 'invalid').map((r) => r.lot_no))],
  };
}

export async function loadLotMaterials(
  source: string,
  anchorSource: string,
  rawRows: Record<string, unknown>[],
  mode: string,
  allowedLots: Set<string>,
  test = false,
) {
  const schema = z.object({
    SOURCE_KEY: identifierSchema,
    LOT_NO: z.string().trim().min(1),
    SEQ_NO: z.preprocess(
      (v) => (v === null || v === '' ? NaN : Number(v)),
      z.number().finite().nonnegative(),
    ),
  });
  const unique = new Map<string, any>();
  for (const raw of rawRows) {
    const ids = schema.parse(raw);
    if (!allowedLots.has(ids.LOT_NO))
      throw new Error('Source returned a lot outside the requested assembly cohort.');
    const text = (key: string) => (raw[key] == null ? null : String(raw[key]));
    const row = {
      id: randomUUID(),
      source,
      source_key: ids.SOURCE_KEY,
      assembly_source: anchorSource,
      lot_no: ids.LOT_NO,
      sequence_no: ids.SEQ_NO,
      item_group: text('ITEM_GROUP'),
      size_type: text('SIZE_TYPE'),
      item_no: text('ITEM_NO'),
      item_lot_no: text('ITEM_LOT_NO'),
      raw_payload: JSON.parse(JSON.stringify(raw)),
    };
    const prior = unique.get(row.source_key);
    if (prior && JSON.stringify(prior.raw_payload) !== JSON.stringify(row.raw_payload))
      throw new Error('SOURCE_KEY identifies different material records.');
    unique.set(row.source_key, row);
  }
  const values = [...unique.values()];
  if (values.length && !test)
    await db.$executeRaw(Prisma.sql`INSERT INTO fact_lot_material(id,source,source_key,assembly_source,lot_no,sequence_no,item_group,size_type,item_no,item_lot_no,raw_payload)
SELECT id,source,source_key,assembly_source,lot_no,sequence_no,item_group,size_type,item_no,item_lot_no,raw_payload FROM jsonb_to_recordset(${JSON.stringify(values)}::jsonb) AS r(id uuid,source text,source_key text,assembly_source text,lot_no text,sequence_no numeric,item_group text,size_type text,item_no text,item_lot_no text,raw_payload jsonb)
ON CONFLICT(source,source_key) ${mode === 'delta' ? Prisma.sql`DO NOTHING` : Prisma.sql`DO UPDATE SET assembly_source=EXCLUDED.assembly_source,lot_no=EXCLUDED.lot_no,sequence_no=EXCLUDED.sequence_no,item_group=EXCLUDED.item_group,size_type=EXCLUDED.size_type,item_no=EXCLUDED.item_no,item_lot_no=EXCLUDED.item_lot_no,raw_payload=EXCLUDED.raw_payload,imported_at=now() WHERE fact_lot_material.raw_payload IS DISTINCT FROM EXCLUDED.raw_payload OR fact_lot_material.assembly_source IS DISTINCT FROM EXCLUDED.assembly_source`}`);
  return { stored: values.length, invalid: 0, invalidLots: [] as string[] };
}
