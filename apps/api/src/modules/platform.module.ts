import { Controller, Get, Inject, Module, Req, SetMetadata } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import 'reflect-metadata';
import { roles } from '../../../../packages/core/src';
import '../../../../packages/core/src/env';
import { AnalyticsService, db, redis } from '../analytics';
import { Roles } from '../auth';
@ApiTags('Platform')
@ApiBearerAuth()
@Controller()
export class PlatformController {
  constructor(@Inject(AnalyticsService) private analytics: AnalyticsService) {}
  @Get('health/live') @SetMetadata('public', true) live() {
    return { status: 'ok' };
  }
  @Get('health/ready') @SetMetadata('public', true) async ready() {
    await db.$queryRaw`SELECT 1`;
    await redis.ping();
    return { status: 'ready' };
  }
  @Get('me') me(@Req() req: any) {
    return req.user;
  }
  @Get('roles') @Roles('Administrator') roleList() {
    return roles;
  }
  @Get('audit') @Roles('Administrator') audits() {
    return db.audit.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  }
}
@Module({ controllers: [PlatformController] })
export class PlatformModule {}
