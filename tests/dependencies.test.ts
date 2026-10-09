import 'dotenv/config';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { querySchema, validateDependency } from '../packages/core/src';
import { recordDependentRuns, dispatchDependentRuns } from '../apps/etl/src/dependencies';
import { db } from '../apps/etl/src/loader';
const parentId = randomUUID();
const childConfig = querySchema.parse({
  queryName: 'Follow assembly',
  oracleSource: '2',
  targetTable: 'FACT_LOT_PROCESS',
  sqlText: 'SELECT 1 FROM DUAL WHERE LOT IN (:LOT_LIST)',
  schedule: 'daily',
  enabled: true,
  loadMode: 'full',
  lotScope: 'assembly_lots',
  anchorSource: '1',
  dependsOnQueryId: parentId,
});
test('Follow-up configuration requires a compatible assembly source and target', () => {
  assert.doesNotThrow(() =>
    validateDependency(childConfig, { id: parentId, targetTable: 'FACT_YIELD', oracleSource: '1' }),
  );
  assert.throws(
    () => validateDependency(childConfig, { id: parentId, targetTable: 'FACT_YIELD', oracleSource: '2' }),
    /match/,
  );
  assert.throws(() => validateDependency(childConfig, null), /assembly/);
  assert.throws(
    () =>
      validateDependency(
        { ...childConfig, targetTable: 'FACT_YIELD' },
        { id: parentId, targetTable: 'FACT_YIELD', oracleSource: '1' },
      ),
    /Only lot/,
  );
  assert.throws(
    () =>
      validateDependency(
        childConfig,
        { id: parentId, targetTable: 'FACT_YIELD', oracleSource: '1' },
        parentId,
      ),
    /itself/,
  );
});
test(
  'Durable follow-ups ignore tests, deduplicate completion and wait for an active child',
  { skip: process.env.RUN_INTEGRATION !== 'true' },
  async () => {
    const lockPool = new Pool({ connectionString: process.env.DATABASE_URL });
    const schedulerLock = await lockPool.connect();
    await schedulerLock.query('SELECT pg_advisory_lock(121212)');
    const parent = await db.etlQuery.create({
      data: {
        queryName: 'integration-parent-' + randomUUID(),
        oracleSource: '1',
        targetTable: 'FACT_YIELD',
        sqlText: 'SELECT 1 FROM DUAL',
        schedule: 'daily',
        enabled: false,
        loadMode: 'full',
      },
    });
    const child = await db.etlQuery.create({
      data: { ...childConfig, queryName: 'integration-child-' + randomUUID(), dependsOnQueryId: parent.id },
    });
    const run = await db.etlJob.create({
      data: { queryId: parent.id, jobName: parent.queryName, status: 'tested' },
    });
    const queued: any[] = [];
    const fakeQueue: any = {
      getJobs: async () => [],
      add: async (name: string, data: any, options: any) => {
        queued.push({ name, data, options });
        return { id: options.jobId };
      },
    };
    try {
      await db.$transaction((tx) => recordDependentRuns(tx, parent, run.id));
      const count = () =>
        db.$queryRaw<
          any[]
        >`SELECT count(*)::int n FROM etl_dependency_dispatch WHERE parent_job_id=${run.id}`;
      assert.equal((await count())[0].n, 0);
      await db.etlJob.update({
        where: { id: run.id },
        data: { status: 'partial', rowsProcessed: 5, endTime: new Date() },
      });
      await db.$transaction((tx) => recordDependentRuns(tx, parent, run.id));
      await db.$transaction((tx) => recordDependentRuns(tx, parent, run.id));
      assert.equal((await count())[0].n, 1);
      fakeQueue.getJobs = async () => [{ data: { queryId: child.id } }];
      await dispatchDependentRuns(fakeQueue, run.id);
      assert.equal(queued.length, 0);
      fakeQueue.getJobs = async () => [];
      await dispatchDependentRuns(fakeQueue, run.id);
      await dispatchDependentRuns(fakeQueue, run.id);
      assert.equal(queued.length, 1);
      assert.equal(queued[0].data.parentJobId, run.id);
      assert.equal(queued[0].data.configuration.loadMode, 'full');
      assert.equal(queued[0].options.jobId, `follow-${run.id}-${child.id}`);
    } finally {
      await db.$executeRaw`DELETE FROM etl_dependency_dispatch WHERE parent_job_id=${run.id}`;
      await db.etlJob.delete({ where: { id: run.id } });
      await db.etlQuery.delete({ where: { id: child.id } });
      await db.etlQuery.delete({ where: { id: parent.id } });
      await schedulerLock.query('SELECT pg_advisory_unlock(121212)');
      schedulerLock.release();
      await lockPool.end();
      await db.$disconnect();
    }
  },
);
