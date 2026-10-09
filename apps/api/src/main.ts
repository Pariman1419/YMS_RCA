import { Global, Module } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import 'reflect-metadata';
import '../../../packages/core/src/env';
import { AnalyticsService, db, redis } from './analytics';
import { bootstrapAdmin } from './local-auth';
import { UsersModule } from './modules/users.module';
import { AuthGuard } from './auth';
import { ApiErrorFilter } from './errors';
import { AlertsModule } from './modules/alerts.module';
import { AnalyticsModule } from './modules/analytics.module';
import { CopilotModule } from './modules/copilot.module';
import { connection, EtlModule, queue } from './modules/etl.module';
import { LotsModule } from './modules/lots.module';
import { PlatformModule } from './modules/platform.module';
import { ReportsModule } from './modules/reports.module';
import { SpcModule } from './modules/spc.module';
@Global()
@Module({ providers: [AnalyticsService], exports: [AnalyticsService] })
class DataModule {}
@Module({
  imports: [
    DataModule,
    UsersModule,
    PlatformModule,
    AnalyticsModule,
    LotsModule,
    EtlModule,
    AlertsModule,
    SpcModule,
    ReportsModule,
    CopilotModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
class AppModule {}
async function bootstrap() {
  if (
    process.env.NODE_ENV === 'production' &&
    (process.env.AUTH_MODE || 'local') !== 'local' &&
    (process.env.AUTH_DEMO === 'true' || !process.env.ENTRA_TENANT_ID || !process.env.ENTRA_AUDIENCE)
  )
    throw new Error('Production requires Entra tenant/audience and AUTH_DEMO=false');
  if ((process.env.AUTH_MODE || 'local') === 'local') await bootstrapAdmin();
  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  app.useGlobalFilters(new ApiErrorFilter());
  app.enableCors({ origin: process.env.WEB_ORIGIN || 'http://localhost:3000', credentials: true });
  app.setGlobalPrefix('api');
  app.use((req: any, res: any, next: any) => {
    req.id = randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });
  SwaggerModule.setup(
    'api/docs',
    app,
    SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('YMS API')
        .setDescription(
          'PostgreSQL-only analytics; local session authentication or optional Entra bearer authentication. SQL operations enqueue isolated ETL jobs.',
        )
        .setVersion('1.0')
        .addBearerAuth()
        .build(),
    ),
  );
  await app.listen(Number(process.env.API_PORT) || 4000, '0.0.0.0');
  const shutdown = async () => {
    await app.close();
    await queue.close();
    await connection.quit();
    await redis.quit();
    await db.$disconnect();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
