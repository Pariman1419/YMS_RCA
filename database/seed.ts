import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
const db = new PrismaClient();
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Sample seed is disabled in production');
  const customers = await Promise.all(
    ['NXP Semiconductors', 'Infineon', 'Texas Instruments', 'STMicroelectronics'].map((name, i) =>
      db.customer.upsert({
        where: { code: `C${i + 1}` },
        create: { code: `C${i + 1}`, name, region: 'APAC' },
        update: {},
      }),
    ),
  );
  const products = await Promise.all(
    [
      ['NX-4100', 'QFN-48', 'Power IC', '90nm'],
      ['IF-2200', 'BGA-128', 'Automotive MCU', '65nm'],
      ['TI-7800', 'SOIC-16', 'Analog IC', '130nm'],
      ['ST-3500', 'LQFP-64', 'Mixed signal', '40nm'],
    ].map(([name, packageName, device, technology]) =>
      db.product.upsert({
        where: { name_package_device_technology: { name, package: packageName, device, technology } },
        create: { name, package: packageName, device, technology },
        update: {},
      }),
    ),
  );
  const boms = await Promise.all(
    products.map((p, i) =>
      db.bom.upsert({
        where: { name_revision: { name: `BOM-${p.name}`, revision: 'C' } },
        create: { name: `BOM-${p.name}`, revision: 'C' },
        update: {},
      }),
    ),
  );
  const names = ['Wafer Saw', 'Die Attach', 'Wire Bond', 'Mold', 'Trim Form', 'Inspection', 'Packing'];
  const processes = await Promise.all(
    names.map((name, i) =>
      db.process.upsert({ where: { name }, create: { name, operation: name, sequence: i + 1 }, update: {} }),
    ),
  );
  const machines = await Promise.all(
    names.flatMap((name, i) =>
      [0, 1].map((j) =>
        db.machine.upsert({
          where: {
            name: `${['WS', 'DA', 'WB', 'MD', 'TF', 'IN', 'PK'][i]}-${String(j + 1).padStart(3, '0')}`,
          },
          create: {
            name: `${['WS', 'DA', 'WB', 'MD', 'TF', 'IN', 'PK'][i]}-${String(j + 1).padStart(3, '0')}`,
            type: name,
            line: j ? 'Line B' : 'Line A',
          },
          update: {},
        }),
      ),
    ),
  );
  const rows: any[] = [],
    defects: any[] = [],
    scraps: any[] = [],
    measurements: any[] = [];
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  for (let d = 29; d >= 0; d--) {
    const day = new Date(+now - d * 86400000),
      id = Number(day.toISOString().slice(0, 10).replace(/-/g, ''));
    await db.calendarDate.upsert({
      where: { id },
      create: {
        id,
        date: day,
        year: day.getUTCFullYear(),
        quarter: Math.ceil((day.getUTCMonth() + 1) / 3),
        month: day.getUTCMonth() + 1,
        week: Math.ceil((Number(day.toISOString().slice(8, 10)) + d) / 7),
        day: day.getUTCDate(),
      },
      update: {},
    });
    for (let l = 0; l < 12; l++) {
      let input = 10000 + l * 200;
      const index = l % 4;
      const lotNo = `${['ACT', 'BSM'][l % 2]}-${day.toISOString().slice(2, 10).replace(/-/g, '')}-${String(l + 1).padStart(3, '0')}`;
      for (let p = 0; p < 7; p++) {
        const m = machines[p * 2 + (l % 2)];
        const loss =
          [0.007, 0.011, 0.016, 0.009, 0.005, 0.012, 0.003][p] +
          (p === 2 && d < 7 && l % 2 === 0 ? 0.043 : 0) +
          ((l + d) % 5) * 0.0008;
        const reject = Math.round(input * loss),
          output = input - reject,
          rework = Math.round(input * 0.002);
        const timestamp = new Date(+day + (p + 6) * 3600000);
        const sourceKey = `${lotNo}-${p}`;
        rows.push({
          source: 'sample',
          sourceKey,
          lotNo,
          customerId: customers[index].id,
          productId: products[index].id,
          bomId: boms[index].id,
          processId: processes[p].id,
          machineId: m.id,
          dateId: id,
          transactionDate: timestamp,
          factory: l % 2 ? 'BSM Fab 02' : 'ACTL Fab 01',
          shift: l % 3 ? 'Day' : 'Night',
          operator: `OP-${(l % 5) + 1}`,
          inputQty: input,
          outputQty: output,
          rejectQty: reject,
          reworkQty: rework,
          unitCost: 0.82 + index * 0.24,
          yieldPercentage: (output / input) * 100,
        });
        if (reject) {
          defects.push({
            source: 'sample',
            sourceKey,
            lotNo,
            processId: processes[p].id,
            machineId: m.id,
            code: ['SAW-01', 'DA-02', 'WB-01', 'MD-03', 'TF-01', 'IN-04', 'PK-02'][p],
            description: [
              'Chipping',
              'Die placement',
              'Non-stick on pad',
              'Mold void',
              'Lead deformation',
              'Visual reject',
              'Packing damage',
            ][p],
            qty: reject,
            occurredAt: timestamp,
          });
          scraps.push({
            source: 'sample',
            sourceKey,
            lotNo,
            processId: processes[p].id,
            qty: reject,
            reason: [
              'Edge crack',
              'Misalignment',
              'Bond lift',
              'Void',
              'Bent lead',
              'Surface defect',
              'Seal failure',
            ][p],
            occurredAt: timestamp,
          });
        }
        input = output;
      }
    }
    for (let m = 0; m < 2; m++)
      for (let j = 0; j < 5; j++) {
        const value = 6.2 + Math.sin(d * 1.7 + j) * 0.12 + (m === 0 && d < 4 ? 0.65 : 0);
        measurements.push({
          source: 'sample',
          sourceKey: `bond-${id}-${m}-${j}`,
          processId: processes[2].id,
          machineId: machines[4 + m].id,
          measurementName: 'Wire pull strength (gf)',
          value,
          ucl: 6.8,
          lcl: 5.6,
          target: 6.2,
          sampleSize: 5,
          subgroup: `${id}-${m}`,
          measuredAt: new Date(+day + (10 + j) * 3600000),
        });
      }
  }
  await db.yield.createMany({ data: rows, skipDuplicates: true });
  await db.defect.createMany({ data: defects, skipDuplicates: true });
  await db.scrap.createMany({ data: scraps, skipDuplicates: true });
  await db.spc.createMany({ data: measurements, skipDuplicates: true });
  for (const [name, type, threshold] of [
    ['Yield below target', 'yield', 98],
    ['High scrap', 'scrap', 3],
    ['Machine abnormality', 'machine', 5],
    ['SPC violation', 'spc', 1],
    ['Defect spike', 'defect', 2],
  ] as const)
    await db.alertRule.upsert({ where: { name }, create: { name, type, threshold }, update: {} });
  for (const source of ['1', '2'])
    for (const [table, sourceTable, cols] of [
      [
        'FACT_YIELD',
        'LOT_HISTORY',
        'TRANSACTION_ID AS SOURCE_KEY, LOT_NO, CUSTOMER, PRODUCT, PACKAGE, PROCESS_NAME, MACHINE_ID, INPUT_QTY, OUTPUT_QTY, REJECT_QTY, TRANSACTION_DATE',
      ],
      [
        'FACT_DEFECT',
        'DEFECT_HISTORY',
        'DEFECT_TRANSACTION_ID AS SOURCE_KEY, LOT_NO, PROCESS_NAME, MACHINE_ID, DEFECT_CODE, DEFECT_DESCRIPTION, QTY, TRANSACTION_DATE',
      ],
      [
        'FACT_SCRAP',
        'SCRAP_HISTORY',
        'SCRAP_TRANSACTION_ID AS SOURCE_KEY, LOT_NO, PROCESS_NAME, SCRAP_QTY, SCRAP_REASON, TRANSACTION_DATE',
      ],
      [
        'FACT_SPC',
        'SPC_HISTORY',
        'MEASUREMENT_ID AS SOURCE_KEY, PROCESS_NAME, MACHINE_ID, MEASUREMENT_NAME, MEASUREMENT_VALUE, UCL, LCL, TARGET, SAMPLE_SIZE, SUBGROUP, TRANSACTION_DATE',
      ],
    ]) {
      const queryName = `${source === '1' ? 'ACTL' : 'BSM'} / ${table}`;
      await db.etlQuery.upsert({
        where: { queryName },
        create: {
          queryName,
          oracleSource: source,
          targetTable: table,
          sqlText: `SELECT ${cols} FROM ${sourceTable} WHERE LAST_UPDATE_DATE >= :LAST_SYNC_TIME AND LAST_UPDATE_DATE < :SYNC_END_TIME`,
          schedule: '15m',
          enabled: false,
          loadMode: 'incremental',
        },
        update: {},
      });
    }
  await db.alert.upsert({
    where: { fingerprint: 'sample-wirebond' },
    create: {
      fingerprint: 'sample-wirebond',
      type: 'yield',
      severity: 'warning',
      title: 'Wire Bond yield below target on WB-001 · review recent bond lift defects',
      details: { source: 'sample', process: 'Wire Bond', machine: 'WB-001', target: 98 },
    },
    update: {},
  });
  for (const machine of machines) {
    const eventId = `sample-event-${machine.id}`;
    await db.equipmentEvent.upsert({
      where: { id: eventId },
      create: {
        id: eventId,
        machineId: machine.id,
        startedAt: new Date(+now - 3 * 86400000),
        endedAt: new Date(+now - 3 * 86400000 + 27 * 60000),
        operatingMinutes: machine.id % 2 ? 1420 : 1870,
      },
      update: {},
    });
  }
  await db.$executeRawUnsafe('REFRESH MATERIALIZED VIEW mv_yield_daily');
  console.log(
    `Sample warehouse ready: ${rows.length} operation records, 360 lots, ${measurements.length} SPC measurements. Extraction queries are disabled.`,
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
