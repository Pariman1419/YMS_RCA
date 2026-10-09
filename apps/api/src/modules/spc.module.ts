import { BadRequestException, Body, Controller, Get, Inject, Module, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import 'reflect-metadata';
import { z } from 'zod';
import { controlChart, spc } from '../../../../packages/core/src';
import '../../../../packages/core/src/env';
import { AnalyticsService, db } from '../analytics';
import { Roles } from '../auth';
import { engineers, parse } from '../module-support';
@ApiTags('Spc')
@ApiBearerAuth()
@Controller()
export class SpcController {
  constructor(@Inject(AnalyticsService) private analytics: AnalyticsService) {}
  @Get('spc') async measurements(@Query() q: any) {
    const take = Math.min(500, Math.max(1, Number(q.limit) || 200));
    const rows = await db.spc.findMany({
      where: {
        ...(q.machine ? { machine: { name: q.machine } } : {}),
        ...(q.process ? { process: { name: q.process } } : {}),
        ...(q.measurement ? { measurementName: q.measurement } : {}),
        measuredAt: {
          gte: q.from ? new Date(q.from) : new Date(Date.now() - 30 * 86400000),
          lte: q.to ? new Date(new Date(q.to).getTime() + 86400000) : new Date(),
        },
      },
      include: { machine: true, process: true },
      orderBy: { measuredAt: 'desc' },
      take,
    });
    const ordered = rows.reverse();
    const streams = new Map<string, typeof ordered>();
    for (const r of ordered) {
      const key = [r.machineId, r.processId, r.measurementName].join(':');
      streams.set(key, [...(streams.get(key) || []), r]);
    }
    return [...streams.entries()].map(([key, points]) => ({
      key,
      label: `${points[0].machine.name} / ${points[0].measurementName}`,
      points: points.map((p, i) => ({
        ...p,
        rules: spc(
          points.slice(0, i + 1).map((x) => x.value),
          p.target,
          (p.ucl - p.lcl) / 6,
        )[i].rules,
      })),
    }));
  }
  @Post('spc/calculate') @Roles(...engineers) calculate(@Body() body: any) {
    const data = parse(
      z.object({
        kind: z.enum(['xbar', 'r', 'p', 'np', 'u', 'cusum']),
        samples: z
          .array(
            z.object({
              value: z.number().finite(),
              n: z.number().int().positive(),
              range: z.number().nonnegative(),
            }),
          )
          .min(2)
          .max(1000),
        target: z.number().optional(),
        sigma: z.number().positive().optional(),
        k: z.number().positive().default(0.5),
        h: z.number().positive().default(5),
      }),
      body,
    );
    if (['p', 'np'].includes(data.kind) && data.samples.some((x) => x.value < 0 || x.value > x.n))
      throw new BadRequestException('Counts must be between 0 and sample size');
    if (data.kind === 'u' && data.samples.some((x) => x.value < 0))
      throw new BadRequestException('Defects cannot be negative');
    if (data.kind === 'cusum') {
      if (data.target === undefined || !data.sigma)
        throw new BadRequestException('CUSUM needs a baseline target and sigma');
      let pos = 0,
        neg = 0;
      return data.samples.map((x) => {
        const v = (x.value - data.target!) / data.sigma!;
        pos = Math.max(0, pos + v - data.k);
        neg = Math.min(0, neg + v + data.k);
        return {
          value: x.value,
          positive: pos,
          negative: neg,
          target: 0,
          ucl: data.h,
          lcl: -data.h,
          violation: pos > data.h || neg < -data.h,
        };
      });
    }
    try {
      return controlChart(data.kind, data.samples);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }
}
@Module({ controllers: [SpcController] })
export class SpcModule {}
