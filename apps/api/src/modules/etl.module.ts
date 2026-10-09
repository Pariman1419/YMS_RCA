import {
  BadRequestException,
  Body,
  Controller,
  ConflictException,
  Get,
  Inject,
  Module,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import 'reflect-metadata';
import { querySchema, validateQueryConfiguration, validateDependency } from '../../../../packages/core/src';
import { z } from 'zod';
import '../../../../packages/core/src/env';
import { AnalyticsService, db } from '../analytics';
import { Roles } from '../auth';
import { audit, parse } from '../module-support';
export const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
connection.on('error', () => {});
export const queue = new Queue('etl', { connection });
@ApiTags('Etl')
@ApiBearerAuth()
@Controller()
export class EtlController {
  constructor(@Inject(AnalyticsService) private analytics: AnalyticsService) {}
  @Get('etl/queries') @Roles('Administrator', 'Yield Engineer') queries() {
    return db.etlQuery.findMany({ orderBy: { queryName: 'asc' } });
  }
  @Post('etl/queries') @Roles('Administrator') async createQuery(@Body() body: any, @Req() req: any) {
    const data = parse(querySchema, body);
    try {
      validateQueryConfiguration(data);
      validateDependency(
        data,
        data.dependsOnQueryId ? await db.etlQuery.findUnique({ where: { id: data.dependsOnQueryId } }) : null,
      );
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const item = await db.etlQuery.create({ data });
    await audit(req, 'etl.query.create', item.id, { version: item.version });
    return item;
  }
  @Put('etl/queries/:id') @Roles('Administrator') async editQuery(
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const data = parse(querySchema, body);
    try {
      validateQueryConfiguration(data);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    try {
      validateDependency(
        data,
        data.dependsOnQueryId ? await db.etlQuery.findUnique({ where: { id: data.dependsOnQueryId } }) : null,
        id,
      );
      const children = await db.etlQuery.findMany({ where: { dependsOnQueryId: id } });
      if (
        children.some(
          (child) => data.targetTable !== 'FACT_YIELD' || child.anchorSource !== data.oracleSource,
        )
      )
        throw new Error('Update or unlink following jobs before changing this parent source or target.');
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const expectedVersion = parse(z.number().int().positive().optional(), body.version);
    const item = await db.$transaction(async (tx) => {
      const changed = await tx.etlQuery.updateMany({
        where: { id, ...(expectedVersion ? { version: expectedVersion } : {}) },
        data: { ...data, version: { increment: 1 } },
      });
      if (!changed.count)
        throw new ConflictException(
          'This query changed while you were editing. Close the editor, refresh, and edit again.',
        );
      return tx.etlQuery.findUniqueOrThrow({ where: { id } });
    });
    await audit(req, 'etl.query.update', id, { version: item.version });
    return item;
  }
  @Post('etl/queries/:id/run') @Roles('Administrator', 'Yield Engineer') async run(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: any,
  ) {
    const query = await db.etlQuery.findUnique({ where: { id } });
    if (!query) throw new NotFoundException();
    const test = body?.test === true;
    const job = await queue.add(
      test ? 'test' : 'run',
      { queryId: id, actor: req.user.id, test, configuration: query },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );
    await audit(req, test ? 'etl.test.request' : 'etl.run.request', id, { queueJobId: job.id });
    return { jobId: job.id, status: 'queued', loadMode: query.loadMode, queryVersion: query.version };
  }
  @Get('etl/dependencies') @Roles('Administrator', 'Yield Engineer') dependencies() {
    return db.$queryRaw`SELECT d.dispatch_id AS id,d.parent_job_id AS "parentJobId",p.job_name AS "parentJobName",p.status AS "parentStatus",c.query_name AS "childQueryName",d.status,d.created_at AS "createdAt",d.queued_at AS "queuedAt",h.status AS "executionStatus",h.phase,h.progress_percent AS "progressPercent" FROM etl_dependency_dispatch d JOIN etl_job p ON p.id=d.parent_job_id JOIN etl_query_master c ON c.query_id=d.child_query_id LEFT JOIN LATERAL(SELECT status,phase,progress_percent FROM etl_job WHERE parent_job_id=d.parent_job_id AND query_id=d.child_query_id ORDER BY start_time DESC LIMIT 1) h ON true ORDER BY d.created_at DESC LIMIT 100`;
  }
  @Get('etl/jobs') @Roles('Administrator', 'Yield Engineer') async jobs() {
    const [history, pending] = await Promise.all([
      db.etlJob.findMany({ orderBy: { startTime: 'desc' }, take: 100, omit: { configuration: true } }),
      queue.getJobs(['waiting', 'delayed'], 0, 49),
    ]);
    return [
      ...pending.map((j) => ({
        id: 'queue-' + j.id,
        jobName: j.data.configuration?.queryName || 'Queued extraction',
        startTime: new Date(j.timestamp),
        status: 'queued',
        phase: 'queued',
        loadMode: j.data.configuration?.loadMode,
        queryVersion: j.data.configuration?.version,
        rowsProcessed: 0,
        failedRecords: 0,
        rowsRead: 0,
        batchesProcessed: 0,
        processedLots: 0,
        parentJobId: j.data.parentJobId || null,
        errors: [],
        progressPercent: 0,
      })),
      ...history,
    ];
  }
}
@Module({ controllers: [EtlController] })
export class EtlModule {}
