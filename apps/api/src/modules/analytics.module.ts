import {
  Controller,
  Get,
  Inject,
  Module,
  Query,
  Body,
  Put,
  Param,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import 'reflect-metadata';
import '../../../../packages/core/src/env';
import { Roles } from '../auth';
import { audit } from '../module-support';
import { db, redis } from '../analytics';
import { AnalyticsService } from '../analytics';
@ApiTags('Analytics')
@ApiBearerAuth()
@Controller()
export class AnalyticsController {
  constructor(@Inject(AnalyticsService) private analytics: AnalyticsService) {}
  @Get('analytics/summary')
  @ApiOperation({ summary: 'Weighted yield KPIs from PostgreSQL materialized aggregates' })
  summary(@Query() q: any) {
    return this.analytics.summary(q);
  }
  @Get('analytics/trend') trend(@Query() q: any) {
    return this.analytics.trend(q);
  }
  @Get('analytics/breakdown') breakdown(@Query() q: any) {
    return this.analytics.breakdown(q);
  }
  @Get('analytics/defect-filters') defectFilters() {
    return this.analytics.defectFilters();
  }
  @Put('analytics/machines/:id/model') @Roles('Administrator') async machineModel(
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    if (!/^\d+$/.test(id) || typeof body.model !== 'string' || body.model.trim().length > 100)
      throw new BadRequestException('Invalid machine model');
    await db.$executeRaw`UPDATE dim_machine SET machine_model=${body.model.trim() || null} WHERE machine_id=${Number(id)}`;
    await audit(req, 'machine.model', id, { model: body.model.trim() });
    try {
      await redis.incr('analytics:generation');
    } catch {}
    return { saved: true };
  }
  @Get('analytics/defects-by-operation') defectsByOperation(@Query() q: any) { return this.analytics.defectsByOperation(q); }
  @Get('analytics/defects') defects(@Query() q: any) {
    return this.analytics.defects(q);
  }
  @Get('analytics/scraps') scraps(@Query() q: any) {
    return this.analytics.scraps(q);
  }
  @Get('analytics/equipment') equipment(@Query() q: any) {
    return this.analytics.equipment(q);
  }
  @Get('analytics/coverage') coverage(@Query() q: any) {
    return this.analytics.coverage(q);
  }
  @Get('filters') filters() {
    return this.analytics.filters();
  }
}
@Module({ controllers: [AnalyticsController] })
export class AnalyticsModule {}
