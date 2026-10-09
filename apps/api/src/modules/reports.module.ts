import {
  Body,
  Controller,
  Get,
  Inject,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import 'reflect-metadata';
import { z } from 'zod';
import '../../../../packages/core/src/env';
import { storageDirectory } from '../../../../packages/core/src/storage';
import { AnalyticsService, db } from '../analytics';
import { Roles } from '../auth';
import { audit, parse } from '../module-support';
import { renderReport } from '../reporting';
@ApiTags('Reports')
@ApiBearerAuth()
@Controller()
export class ReportsController {
  constructor(@Inject(AnalyticsService) private analytics: AnalyticsService) {}
  @Get('reports/export') async report(@Query() q: any, @Res() res: Response, @Req() req: any) {
    const format = ['csv', 'xlsx', 'pdf', 'pptx'].includes(q.format) ? q.format : 'csv';
    const result = await renderReport(
      await this.analytics.breakdown({ ...q, dimension: q.dimension || 'process' }),
      format,
    );
    await audit(req, 'report.export', format, { filters: q });
    res.setHeader('Content-Type', result.type);
    res.setHeader('Content-Disposition', `attachment; filename="yms-yield.${result.extension}"`);
    res.send(result.buffer);
  }
  @Get('reports/schedules') reportSchedules() {
    return db.reportSchedule.findMany({ include: { runs: { take: 5, orderBy: { createdAt: 'desc' } } } });
  }
  @Post('reports/schedules') @Roles('Administrator', 'Manager') async scheduleReport(
    @Body() body: any,
    @Req() req: any,
  ) {
    const data = parse(
      z.object({
        name: z.string().min(1).max(100),
        format: z.enum(['csv', 'xlsx', 'pdf', 'pptx']),
        schedule: z.enum(['15m', '30m', 'hourly', 'daily']),
        filters: z.record(z.string()).default({}),
      }),
      body,
    );
    await audit(req, 'report.schedule', data.name);
    return db.reportSchedule.create({ data: { ...data, createdBy: req.user.id } });
  }
  @Get('reports/runs/:id') async reportDownload(@Param('id') id: string, @Res() res: Response) {
    const run = await db.reportRun.findUnique({ where: { id }, include: { schedule: true } });
    if (!run?.storageKey) throw new NotFoundException();
    const buffer = await readFile(join(storageDirectory('reports'), run.storageKey));
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="yms-report.${run.schedule.format}"`);
    res.send(buffer);
  }
}
@Module({ controllers: [ReportsController] })
export class ReportsModule {}
