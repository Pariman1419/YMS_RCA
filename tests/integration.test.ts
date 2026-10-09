import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { storageDirectory } from '../packages/core/src/storage';
import { test } from 'node:test';
import { db, loadYieldBatch } from '../apps/etl/src/loader';
const nativeFetch = globalThis.fetch;
let loginPromise: Promise<string> | undefined;
async function fetch(input: string, options: RequestInit = {}) {
  if ((process.env.AUTH_MODE || 'local') !== 'local') return nativeFetch(input, options);
  loginPromise ||= (async () => {
    const res = await nativeFetch((process.env.TEST_API_URL || 'http://localhost:4000/api') + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: process.env.BOOTSTRAP_ADMIN_PASSWORD || 'admin' }),
    });
    assert.equal(res.status, 201);
    return res.headers.get('set-cookie')!.split(';')[0];
  })();
  return nativeFetch(input, { ...options, headers: { ...options.headers, Cookie: await loginPromise } });
}
const enabled = process.env.RUN_INTEGRATION === 'true';
test(
  'PostgreSQL bulk loader is idempotent, updates corrections and keeps delta immutable',
  { skip: !enabled },
  async () => {
    const sourceKey = 'integration-' + randomUUID();
    const source = 'integration';
    const transactionDate = new Date();
    const row = {
      SOURCE_KEY: sourceKey,
      LOT_NO: 'TEST-' + sourceKey,
      CUSTOMER: 'C1',
      PRODUCT: 'NX-4100',
      PACKAGE: 'QFN-48',
      DEVICE: 'Power IC',
      TECHNOLOGY: '90nm',
      BOM: 'BOM-NX-4100',
      BOM_REVISION: 'C',
      PROCESS_NAME: 'Wire Bond',
      MACHINE_ID: 'WB-001',
      INPUT_QTY: 100,
      OUTPUT_QTY: 98,
      REJECT_QTY: 2,
      TRANSACTION_DATE: transactionDate,
      FACTORY: 'ACTL Fab 01',
      LINE: 'Line A',
    };
    try {
      await loadYieldBatch(source, [row], 'incremental');
      await loadYieldBatch(source, [{ ...row, OUTPUT_QTY: 96, REJECT_QTY: 4 }], 'incremental');
      await loadYieldBatch(source, [{ ...row, OUTPUT_QTY: 95, REJECT_QTY: 5 }], 'delta');
      const records = await db.yield.findMany({ where: { source, sourceKey } });
      assert.equal(records.length, 1);
      assert.equal(records[0].outputQty, 96);
      assert.equal(Number(records[0].yieldPercentage), 96);
    } finally {
      await db.yield.deleteMany({ where: { source, sourceKey } });
      await db.$disconnect();
    }
  },
);
test(
  'Live API analytics, filters, SPC and exports read the seeded warehouse',
  { skip: !enabled },
  async () => {
    const base = process.env.TEST_API_URL || 'http://localhost:4000/api';
    for (const path of [
      '/health/ready',
      '/analytics/summary',
      '/analytics/trend',
      '/analytics/breakdown?dimension=process',
      '/analytics/defects',
      '/analytics/scraps',
      '/analytics/equipment',
      '/filters',
      '/lots',
      '/spc',
      '/alerts',
      '/etl/queries',
      '/etl/jobs',
      '/reports/schedules',
    ]) {
      const result = await fetch(base + path);
      assert.equal(result.status, 200, path);
      const body = await result.json();
      assert.ok(body !== null, path);
    }
    for (const format of ['csv', 'xlsx', 'pdf', 'pptx']) {
      const result = await fetch(base + '/reports/export?dimension=customer&grain=assembly&format=' + format);
      assert.equal(result.status, 200);
      assert.ok((await result.arrayBuffer()).byteLength > 100);
    }
    const invalid = await fetch(base + '/analytics/breakdown?dimension=invalid');
    assert.equal(invalid.status, 400);
  },
);
test('Lot comments and attachments survive authenticated round-trip', { skip: !enabled }, async () => {
  const base = process.env.TEST_API_URL || 'http://localhost:4000/api';
  const list: any = await (await fetch(base + '/lots')).json();
  const lot = list.rows[0].lotNo;
  const comment: any = await (
    await fetch(base + '/lots/' + lot + '/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Integration verification ' + randomUUID() }),
    })
  ).json();
  let fileId: string | undefined;
  try {
    assert.ok(comment.id);
    const form = new FormData();
    form.append(
      'file',
      new Blob(['Engineering test observation'], { type: 'text/plain' }),
      'observation.txt',
    );
    const result = await fetch(base + '/lots/' + lot + '/attachments', { method: 'POST', body: form });
    assert.equal(result.status, 201);
    const item: any = await result.json();
    fileId = item.id;
    const content = await fetch(base + '/attachments/' + item.id);
    assert.equal(content.status, 200);
    assert.equal(await content.text(), 'Engineering test observation');
    const detail: any = await (await fetch(base + '/lots/' + lot)).json();
    assert.ok(detail.comments.some((c: any) => c.id === comment.id));
    assert.ok(detail.attachments.some((f: any) => f.id === fileId));
  } finally {
    if (comment.id) await db.lotComment.delete({ where: { id: comment.id } });
    if (fileId) {
      const file = await db.attachment.delete({ where: { id: fileId } });
      await unlink(join(storageDirectory('uploads'), file.storageKey));
    }
    await db.$disconnect();
  }
});
test(
  'Worker generates a scheduled report and API downloads the shared artifact',
  { skip: !enabled || process.env.RUN_WORKER_INTEGRATION !== 'true', timeout: 60000 },
  async () => {
    const base = process.env.TEST_API_URL || 'http://localhost:4000/api';
    const schedule = await db.reportSchedule.create({
      data: {
        name: 'integration-' + randomUUID(),
        format: 'xlsx',
        schedule: 'daily',
        filters: { dimension: 'process' },
        createdBy: 'integration',
        nextRunAt: new Date(),
      },
    });
    try {
      const deadline = Date.now() + 45000;
      let run: any;
      while (Date.now() < deadline) {
        run = await db.reportRun.findFirst({ where: { scheduleId: schedule.id, status: 'success' } });
        if (run) break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      assert.ok(run, 'Worker must complete report within 45s');
      const response = await fetch(base + '/reports/runs/' + run.id);
      assert.equal(response.status, 200);
      assert.equal(
        Buffer.from(await response.arrayBuffer())
          .subarray(0, 2)
          .toString(),
        'PK',
      );
      await unlink(join(storageDirectory('reports'), run.storageKey));
    } finally {
      await db.reportRun.deleteMany({ where: { scheduleId: schedule.id } });
      await db.reportSchedule.delete({ where: { id: schedule.id } });
      await db.$disconnect();
    }
  },
);
