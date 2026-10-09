import { Body, Controller, Get, Inject, Module, Param, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import 'reflect-metadata';
import { z } from 'zod';
import '../../../../packages/core/src/env';
import { AnalyticsService, db } from '../analytics';
import { Roles } from '../auth';
import { audit, engineers, parse } from '../module-support';
@ApiTags('Alerts')
@ApiBearerAuth()
@Controller()
export class AlertsController {
  constructor(@Inject(AnalyticsService) private analytics: AnalyticsService) {}
  @Get('alerts') alerts() {
    return db.alert.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  }
  @Post('alerts/:id/acknowledge') @Roles(...engineers, 'Manager') async acknowledge(
    @Param('id') id: string,
    @Req() req: any,
  ) {
    const result = await db.alert.update({
      where: { id },
      data: { status: 'acknowledged', acknowledgedBy: req.user.id },
    });
    await audit(req, 'alert.acknowledge', id);
    return result;
  }
  @Get('alerts/rules') @Roles('Administrator') rules() {
    return db.alertRule.findMany();
  }
  @Put('alerts/rules/:id') @Roles('Administrator') async rule(
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const data = parse(
      z.object({ threshold: z.number().finite().nonnegative(), enabled: z.boolean() }),
      body,
    );
    const result = await db.alertRule.update({ where: { id }, data });
    await audit(req, 'alert.rule.update', id, data);
    return result;
  }
}
@Module({ controllers: [AlertsController] })
export class AlertsModule {}
