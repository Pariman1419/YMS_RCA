import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  yieldRowSchema,
  identifierSchema,
  quantitySchema,
  sourceNumberSchema,
  sourceDateSchema,
} from '../../../packages/core/src';
export const db = new PrismaClient();
const processOrder = ['Wafer Saw', 'Die Attach', 'Wire Bond', 'Mold', 'Trim Form', 'Inspection', 'Packing'];
export async function loadYieldBatch(source: string, raw: unknown[], mode: string) {
  const rows = raw.map((r) => yieldRowSchema.parse(r));
  const unique = <T>(values: T[], key: (x: T) => string) => [
    ...new Map(values.map((v) => [key(v), v])).values(),
  ];
  return db.$transaction(
    async (tx) => {
      await tx.customer.createMany({
        data: unique(
          rows.map((r) => ({ code: r.CUSTOMER, name: r.CUSTOMER, region: 'APAC' })),
          (r) => r.code,
        ),
        skipDuplicates: true,
      });
      await tx.product.createMany({
        data: unique(
          rows.map((r) => ({
            name: r.PRODUCT,
            package: r.PACKAGE,
            device: r.DEVICE,
            technology: r.TECHNOLOGY,
          })),
          (r) => JSON.stringify(r),
        ),
        skipDuplicates: true,
      });
      await tx.bom.createMany({
        data: unique(
          rows.map((r) => ({ name: r.BOM, revision: r.BOM_REVISION })),
          (r) => JSON.stringify(r),
        ),
        skipDuplicates: true,
      });
      await tx.process.createMany({
        data: unique(
          rows.map((r) => ({
            name: r.PROCESS_NAME,
            operation: r.PROCESS_NAME,
            sequence: Math.max(0, processOrder.indexOf(r.PROCESS_NAME)) + 1,
          })),
          (r) => r.name,
        ),
        skipDuplicates: true,
      });
      await tx.machine.createMany({
        data: unique(
          rows.map((r) => ({ name: r.MACHINE_ID, type: r.PROCESS_NAME, line: r.LINE })),
          (r) => r.name,
        ),
        skipDuplicates: true,
      });
      const calendar = unique(
        rows.map((r) => {
          const d = new Date(r.TRANSACTION_DATE);
          d.setUTCHours(0, 0, 0, 0);
          const iso = new Date(d);
          iso.setUTCDate(iso.getUTCDate() + 4 - (iso.getUTCDay() || 7));
          const start = new Date(Date.UTC(iso.getUTCFullYear(), 0, 1));
          return {
            id: Number(d.toISOString().slice(0, 10).replace(/-/g, '')),
            date: d,
            year: d.getUTCFullYear(),
            quarter: Math.ceil((d.getUTCMonth() + 1) / 3),
            month: d.getUTCMonth() + 1,
            week: Math.ceil(((+iso - +start) / 86400000 + 1) / 7),
            day: d.getUTCDate(),
          };
        }),
        (r) => String(r.id),
      );
      await tx.calendarDate.createMany({ data: calendar, skipDuplicates: true });
      const [customers, products, boms, processes, machines] = await Promise.all([
        tx.customer.findMany({ where: { code: { in: rows.map((r) => r.CUSTOMER) } } }),
        tx.product.findMany({ where: { name: { in: rows.map((r) => r.PRODUCT) } } }),
        tx.bom.findMany({ where: { name: { in: rows.map((r) => r.BOM) } } }),
        tx.process.findMany({ where: { name: { in: rows.map((r) => r.PROCESS_NAME) } } }),
        tx.machine.findMany({ where: { name: { in: rows.map((r) => r.MACHINE_ID) } } }),
      ]);
      const c = new Map(customers.map((x) => [x.code, x.id])),
        p = new Map(products.map((x) => [JSON.stringify([x.name, x.package, x.device, x.technology]), x.id])),
        b = new Map(boms.map((x) => [JSON.stringify([x.name, x.revision]), x.id])),
        pr = new Map(processes.map((x) => [x.name, x.id])),
        m = new Map(machines.map((x) => [x.name, x.id]));
      const records = rows.map((r) => ({
        yield_id: randomUUID(),
        source,
        source_key: r.SOURCE_KEY,
        lot_no: r.LOT_NO,
        customer_id: c.get(r.CUSTOMER),
        product_id: p.get(JSON.stringify([r.PRODUCT, r.PACKAGE, r.DEVICE, r.TECHNOLOGY])),
        bom_id: b.get(JSON.stringify([r.BOM, r.BOM_REVISION])),
        process_id: pr.get(r.PROCESS_NAME),
        machine_id: m.get(r.MACHINE_ID),
        date_id: Number(r.TRANSACTION_DATE.toISOString().slice(0, 10).replace(/-/g, '')),
        transaction_date: r.TRANSACTION_DATE.toISOString(),
        factory: r.FACTORY,
        shift: r.SHIFT,
        operator: r.OPERATOR,
        input_qty: r.INPUT_QTY,
        output_qty: r.OUTPUT_QTY,
        reject_qty: r.REJECT_QTY,
        rework_qty: r.REWORK_QTY,
        unit_cost: r.UNIT_COST,
        yield_percentage: (r.OUTPUT_QTY / r.INPUT_QTY) * 100,
      }));
      const conflict =
        mode === 'delta'
          ? Prisma.sql`DO NOTHING`
          : Prisma.sql`DO UPDATE SET lot_no=excluded.lot_no,customer_id=excluded.customer_id,product_id=excluded.product_id,bom_id=excluded.bom_id,process_id=excluded.process_id,machine_id=excluded.machine_id,date_id=excluded.date_id,factory=excluded.factory,shift=excluded.shift,operator=excluded.operator,input_qty=excluded.input_qty,output_qty=excluded.output_qty,reject_qty=excluded.reject_qty,rework_qty=excluded.rework_qty,unit_cost=excluded.unit_cost,yield_percentage=excluded.yield_percentage`;
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO fact_yield SELECT * FROM jsonb_to_recordset(${JSON.stringify(records)}::jsonb) AS x(yield_id text,source text,source_key text,lot_no text,customer_id int,product_id int,bom_id int,process_id int,machine_id int,date_id int,transaction_date timestamptz,factory text,shift text,operator text,input_qty int,output_qty int,reject_qty int,rework_qty int,unit_cost numeric,yield_percentage numeric) ON CONFLICT(source,source_key,transaction_date) ${conflict}`,
      );
    },
    { timeout: 60000 },
  );
}
type Tx = Prisma.TransactionClient;
export async function dimensions(tx: Tx, row: any) {
  const process = await tx.process.upsert({
    where: { name: row.PROCESS_NAME },
    create: {
      name: row.PROCESS_NAME,
      operation: row.PROCESS_NAME,
      sequence: Math.max(0, processOrder.indexOf(row.PROCESS_NAME)) + 1,
    },
    update: {},
  });
  const machine = await tx.machine.upsert({
    where: { name: String(row.MACHINE_ID) },
    create: {
      name: String(row.MACHINE_ID),
      type: row.MACHINE_TYPE || row.PROCESS_NAME,
      line: row.LINE || 'Unknown',
    },
    update: {},
  });
  return { processId: process.id, machineId: machine.id };
}
export async function loadYield(tx: Tx, source: string, raw: unknown, mode = 'incremental') {
  const row = yieldRowSchema.parse(raw);
  const { processId, machineId } = await dimensions(tx, row);
  const customer = await tx.customer.upsert({
    where: { code: row.CUSTOMER },
    create: { code: row.CUSTOMER, name: row.CUSTOMER, region: 'APAC' },
    update: {},
  });
  const productKey = {
    name: row.PRODUCT,
    package: row.PACKAGE,
    device: row.DEVICE,
    technology: row.TECHNOLOGY,
  };
  const product = await tx.product.upsert({
    where: { name_package_device_technology: productKey },
    create: productKey,
    update: {},
  });
  const bom = await tx.bom.upsert({
    where: { name_revision: { name: row.BOM, revision: row.BOM_REVISION } },
    create: { name: row.BOM, revision: row.BOM_REVISION },
    update: {},
  });
  const date = new Date(row.TRANSACTION_DATE);
  date.setUTCHours(0, 0, 0, 0);
  const dateId = Number(date.toISOString().slice(0, 10).replace(/-/g, ''));
  const iso = new Date(date);
  iso.setUTCDate(iso.getUTCDate() + 4 - (iso.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(iso.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((+iso - +yearStart) / 86400000 + 1) / 7);
  await tx.calendarDate.upsert({
    where: { id: dateId },
    create: {
      id: dateId,
      date,
      year: date.getUTCFullYear(),
      quarter: Math.ceil((date.getUTCMonth() + 1) / 3),
      month: date.getUTCMonth() + 1,
      week,
      day: date.getUTCDate(),
    },
    update: {},
  });
  const data = {
    source,
    sourceKey: row.SOURCE_KEY,
    lotNo: row.LOT_NO,
    customerId: customer.id,
    productId: product.id,
    bomId: bom.id,
    processId,
    machineId,
    dateId,
    transactionDate: row.TRANSACTION_DATE,
    factory: row.FACTORY,
    shift: row.SHIFT,
    operator: row.OPERATOR,
    inputQty: row.INPUT_QTY,
    outputQty: row.OUTPUT_QTY,
    rejectQty: row.REJECT_QTY,
    reworkQty: row.REWORK_QTY,
    unitCost: row.UNIT_COST,
    yieldPercentage: (row.OUTPUT_QTY / row.INPUT_QTY) * 100,
  };
  await tx.yield.upsert({
    where: {
      source_sourceKey_transactionDate: {
        source,
        sourceKey: row.SOURCE_KEY,
        transactionDate: row.TRANSACTION_DATE,
      },
    },
    create: data,
    update: mode === 'delta' ? {} : data,
  });
}
const common = z.object({
  SOURCE_KEY: identifierSchema,
  LOT_NO: z.string().trim().min(1).optional(),
  PROCESS_NAME: z.string().trim().min(1),
  MACHINE_ID: identifierSchema.optional(),
  TRANSACTION_DATE: sourceDateSchema,
  LINE: z.string().default('Unknown'),
});
const defectSchema = common.extend({
  LOT_NO: z.string().trim().min(1),
  MACHINE_ID: identifierSchema,
  DEFECT_CODE: z.string().trim().min(1),
  DEFECT_DESCRIPTION: z.string().trim().min(1),
  QTY: quantitySchema,
});
const scrapSchema = common.extend({
  LOT_NO: z.string().trim().min(1),
  SCRAP_QTY: quantitySchema,
  SCRAP_REASON: z.string().trim().min(1),
});
const spcSchema = common
  .extend({
    MACHINE_ID: identifierSchema,
    MEASUREMENT_NAME: z.string().trim().min(1),
    MEASUREMENT_VALUE: sourceNumberSchema,
    UCL: sourceNumberSchema,
    LCL: sourceNumberSchema,
    TARGET: sourceNumberSchema,
    SAMPLE_SIZE: quantitySchema.refine((v) => v > 0, 'Sample size must be positive').default(5),
    SUBGROUP: z.string().default('individual'),
  })
  .refine((r) => r.LCL <= r.TARGET && r.TARGET <= r.UCL, 'Control limits must surround target');
export function validateRecord(target: string, raw: unknown) {
  return (
    target === 'FACT_YIELD'
      ? yieldRowSchema
      : target === 'FACT_DEFECT'
        ? defectSchema
        : target === 'FACT_SCRAP'
          ? scrapSchema
          : spcSchema
  ).parse(raw);
}
export async function loadRow(tx: Tx, source: string, target: string, raw: unknown, mode: string) {
  if (target === 'FACT_YIELD') return loadYield(tx, source, raw, mode);
  const parsed = (
    target === 'FACT_DEFECT' ? defectSchema : target === 'FACT_SCRAP' ? scrapSchema : spcSchema
  ).parse(raw);
  const row = parsed as any;
  const { processId, machineId } = await dimensions(tx, {
    ...row,
    MACHINE_ID: row.MACHINE_ID || 'Unassigned',
  });
  const key = { source, sourceKey: row.SOURCE_KEY };
  if (target === 'FACT_DEFECT') {
    const data = {
      ...key,
      lotNo: row.LOT_NO,
      processId,
      machineId,
      code: row.DEFECT_CODE,
      description: row.DEFECT_DESCRIPTION,
      qty: row.QTY,
      occurredAt: row.TRANSACTION_DATE,
    };
    await tx.defect.upsert({
      where: { source_sourceKey: key },
      create: data,
      update: mode === 'delta' ? {} : data,
    });
  } else if (target === 'FACT_SCRAP') {
    const data = {
      ...key,
      lotNo: row.LOT_NO,
      processId,
      qty: row.SCRAP_QTY,
      reason: row.SCRAP_REASON,
      occurredAt: row.TRANSACTION_DATE,
    };
    await tx.scrap.upsert({
      where: { source_sourceKey: key },
      create: data,
      update: mode === 'delta' ? {} : data,
    });
  } else if (target === 'FACT_SPC') {
    const data = {
      ...key,
      processId,
      machineId,
      measurementName: row.MEASUREMENT_NAME,
      value: row.MEASUREMENT_VALUE,
      ucl: row.UCL,
      lcl: row.LCL,
      target: row.TARGET,
      sampleSize: row.SAMPLE_SIZE,
      subgroup: row.SUBGROUP,
      measuredAt: row.TRANSACTION_DATE,
    };
    await tx.spc.upsert({
      where: { source_sourceKey: key },
      create: data,
      update: mode === 'delta' ? {} : data,
    });
  } else throw new Error('Unknown target');
}
