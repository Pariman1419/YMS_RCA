import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  Module,
  Post,
  Req,
  Get,
  Put,
  ConflictException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import 'reflect-metadata';
import { z } from 'zod';
import '../../../../packages/core/src/env';
import { AnalyticsService } from '../analytics';
import { askCopilot, assistanceConfig, installedModels } from '../copilot';
import { copilotFilters } from '../copilot-filters';
import { Roles } from '../auth';
import { db } from '../analytics';
import { audit, parse } from '../module-support';
import { lotFromQuestion, lotRcaEvidence } from '../lot-rca';
import { externalKnowledge } from '../external-knowledge';
@ApiTags('YMS AI Assistance')
@ApiBearerAuth()
@Controller()
export class CopilotController {
  constructor(@Inject(AnalyticsService) private analytics: AnalyticsService) {}
  @Get('ai-assistance/settings') @Roles('Administrator') settings() {
    return assistanceConfig();
  }
  @Get('ai-assistance/models') @Roles('Administrator') models() {
    return installedModels();
  }
  @Get('ai-assistance/status') async status() {
    const c = await assistanceConfig();
    return {
      enabled: c.enabled,
      model: c.model,
      provider: 'ollama',
      externalKnowledgeEnabled: c.externalKnowledgeEnabled,
    };
  }
  @Put('ai-assistance/settings') @Roles('Administrator') async save(@Body() body: any, @Req() req: any) {
    const c = parse(
      z.object({
        enabled: z.boolean(),
        model: z.string().min(1).max(200),
        systemPrompt: z.string().trim().min(10).max(20000),
        version: z.number().int().positive(),
        externalKnowledgeEnabled: z.boolean().optional(),
      }),
      body,
    );
    if (c.enabled && !(await installedModels()).some((m: any) => m.name === c.model))
      throw new BadRequestException('Select an installed chat model.');
    const updated =
      await db.$executeRaw`UPDATE ai_assistance_config SET enabled=${c.enabled},model=${c.model},system_prompt=${c.systemPrompt},external_knowledge_enabled=coalesce(${c.externalKnowledgeEnabled ?? null}::boolean,external_knowledge_enabled),version=version+1,updated_at=now(),updated_by=${req.user.id} WHERE id=1 AND version=${c.version}`;
    if (!updated) throw new ConflictException('Settings changed. Refresh before saving.');
    await audit(req, 'ai-assistance.settings', 'local-ollama', {
      model: c.model,
      enabled: c.enabled,
      externalKnowledgeEnabled: c.externalKnowledgeEnabled,
    });
    return assistanceConfig();
  }
  @Post(['ai-assistance', 'copilot']) async copilot(@Body() body: any, @Req() req: any) {
    const {
      question,
      filters: requestFilters,
      lotNo,
      source,
      targetYield,
      useExternalKnowledge,
    } = parse(
      z.object({
        question: z.string().min(5).max(2000),
        filters: z.record(z.string()).default({}),
        consent: z.literal(true),
        lotNo: z.string().trim().max(100).optional(),
        source: z.enum(['1', '2']).default('1'),
        targetYield: z.number().min(0).max(100).default(98),
        useExternalKnowledge: z.boolean().default(false),
      }),
      body,
    );
    const config = await assistanceConfig();
    if (useExternalKnowledge && !config.externalKnowledgeEnabled)
      throw new BadRequestException('External knowledge is disabled by the administrator.');
    const selectedLot = lotNo || requestFilters.lot || lotFromQuestion(question);
    if (selectedLot) {
      const evidence = await lotRcaEvidence(selectedLot, source, targetYield);
      const topic = [
        question,
        ...evidence.processes.map((p) => p.name),
        ...evidence.defects.map((d) => d.description),
      ].join(' ');
      const knowledge = await externalKnowledge(useExternalKnowledge, topic);
      await audit(req, 'ai-assistance.lot-rca', 'warehouse-evidence', {
        source,
        externalKnowledge: useExternalKnowledge,
        references: knowledge.sources.length,
      });
      return askCopilot(question, { ...evidence, knowledge });
    }
    const dimensions = await this.analytics.filters();
    const resolved = copilotFilters(question, requestFilters, dimensions.process);
    const filters: Record<string, string> = {
      ...resolved,
      grain:
        resolved.process || /process|machine|equipment|wire.?bond/i.test(question) ? 'process' : 'assembly',
    };
    const end = filters.to ? new Date(filters.to) : new Date();
    const start = filters.from ? new Date(filters.from) : new Date(+end - 30 * 86400000);
    if (!Number.isFinite(+end) || !Number.isFinite(+start) || start > end)
      throw new BadRequestException('Invalid date range');
    const duration = Math.max(86400000, +end - +start + 86400000);
    const prior = {
      ...filters,
      from: new Date(+start - duration).toISOString().slice(0, 10),
      to: new Date(+start - 86400000).toISOString().slice(0, 10),
    };
    if (/this month/i.test(question) && /last month/i.test(question)) {
      prior.from = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1))
        .toISOString()
        .slice(0, 10);
      prior.to = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 0))
        .toISOString()
        .slice(0, 10);
    }
    const [summary, trend, processes, machines, defects, previousSummary, customers, previousCustomers] =
      await Promise.all([
        this.analytics.summary(filters),
        this.analytics.trend(filters),
        this.analytics.breakdown({ ...filters, dimension: 'process' }),
        this.analytics.breakdown({ ...filters, dimension: 'machine' }),
        this.analytics.defects(filters),
        this.analytics.summary(prior),
        this.analytics.breakdown({ ...filters, dimension: 'customer' }),
        this.analytics.breakdown({ ...prior, dimension: 'customer' }),
      ]);
    await audit(req, 'copilot.request', 'aggregate-evidence', { provider: 'ollama' });
    const knowledge = await externalKnowledge(useExternalKnowledge, question);
    return askCopilot(question, {
      knowledge,
      evidenceScope:
        'Up to 10 rows per ranking; defect rows are sampled grouped records, not an exhaustive defect ranking. Trend shows up to the latest 90 buckets. Summary KPIs are complete for the selected filters. Process and machine rankings use measured process history; assembly KPIs use completion records. These measures must not be treated as interchangeable.',
      filters,
      summary,
      trend: trend.slice(-90),
      processes: processes.slice(0, 10),
      machines: machines.slice(0, 10),
      defects: defects.slice(0, 10),
      previousPeriod: prior,
      previousSummary,
      customers: customers.slice(0, 10),
      previousCustomers: previousCustomers.slice(0, 10),
    });
  }
}
@Module({ controllers: [CopilotController] })
export class CopilotModule {}
