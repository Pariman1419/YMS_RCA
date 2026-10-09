import {
  BadRequestException,
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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import 'reflect-metadata';
import { z } from 'zod';
import '../../../../packages/core/src/env';
import { storageDirectory } from '../../../../packages/core/src/storage';
import { AnalyticsService, db } from '../analytics';
import { Roles } from '../auth';
import { audit, engineers, parse } from '../module-support';
@ApiTags('Lots')
@ApiBearerAuth()
@Controller()
export class LotsController {
  constructor(@Inject(AnalyticsService) private analytics: AnalyticsService) {}
  @Get('lots') lots(@Query() q: any) {
    return this.analytics.lots(q);
  }
  @Get('lots/:lot') async lot(@Param('lot') lot: string, @Query() q: any) {
    const source = String(q.source || '1');
    const processPage = Math.max(1, Math.min(100000, Number(q.processPage) || 1));
    const processLimit = 100;
    const materialPage = Math.max(1, Math.min(100000, Math.floor(Number(q.materialPage) || 1)));
    const [materials, materialCounts] = await Promise.all([
      db.$queryRaw<any[]>(
        Prisma.sql`SELECT id,sequence_no::float8 AS "sequenceNo",item_group AS "itemGroup",size_type AS "sizeType",item_no AS "itemNo",item_lot_no AS "itemLotNo",imported_at AS "importedAt" FROM fact_lot_material WHERE lot_no=${lot} AND assembly_source=${source} ORDER BY sequence_no,source_key LIMIT 100 OFFSET ${(materialPage - 1) * 100}`,
      ),
      db.$queryRaw<any[]>(
        Prisma.sql`SELECT count(*)::int AS total FROM fact_lot_material WHERE lot_no=${lot} AND assembly_source=${source}`,
      ),
    ]);
    const [processHistory, processCount, lotDefects] = await Promise.all([
      db.$queryRaw<any[]>(
        Prisma.sql`SELECT h.id,h.source_key AS "sourceKey",h.operation_sequence AS "operationSequence",h.process_code AS "processCode",h.started_at AS "startedAt",h.completed_at AS "completedAt",h.input_qty::float8 AS "inputQty",h.output_qty::float8 AS "outputQty",h.reject_qty::float8 AS "rejectQty",h.yield_percentage::float8 AS "yieldPercentage",h.status,h.quality_status AS "qualityStatus",h.quality_errors AS "qualityErrors",h.raw_payload AS "rawPayload",jsonb_build_object('name',p.process_name) process,jsonb_build_object('name',m.machine_name) machine FROM fact_lot_process h JOIN dim_process p ON p.process_id=h.process_id JOIN dim_machine m ON m.machine_id=h.machine_id WHERE h.lot_no=${lot} AND h.assembly_source=${source} ORDER BY h.operation_sequence NULLS LAST,h.started_at NULLS LAST,h.source_key LIMIT ${processLimit} OFFSET ${(processPage - 1) * processLimit}`,
      ),
      db.lotProcess.count({ where: { lotNo: lot, assemblySource: source } }),
      db.$queryRaw<any[]>(
        Prisma.sql`SELECT h.id,h.defect_code code,h.defect_description description,h.qty::float8 qty,h.rework_qty::float8 AS "reworkQty",h.operation_sequence::float8 AS "operationSequence",h.raw_payload->>'OPERATION_CODE' AS "operationCode",h.raw_payload->>'WIP_OPTN_CODE' AS "wipOperation",h.raw_payload->>'PROCESS_AREA_CODE' AS "processArea",h.raw_payload->>'EXT_REJ_CODE' AS "externalRejectCode",h.raw_payload->>'EXT_REJ_DESC' AS "externalRejectDescription",h.quality_status AS "qualityStatus",h.raw_payload AS "rawPayload",jsonb_build_object('name',m.machine_name) machine FROM fact_lot_defect h JOIN dim_machine m ON m.machine_id=h.machine_id WHERE h.lot_no=${lot} AND h.assembly_source=${source} ORDER BY h.operation_sequence NULLS LAST LIMIT 1000`,
      ),
    ]);
    const [history, defects, scraps, comments, attachments] = await Promise.all([
      db.yield.findMany({
        where: { lotNo: lot, source },
        include: { customer: true, product: true, bom: true, process: true, machine: true },
        orderBy: { transactionDate: 'asc' },
        take: 1000,
      }),
      db.defect.findMany({ where: { lotNo: lot }, include: { process: true, machine: true }, take: 1000 }),
      db.scrap.findMany({ where: { lotNo: lot }, take: 1000 }),
      db.lotComment.findMany({ where: { lotNo: lot }, orderBy: { createdAt: 'desc' }, take: 100 }),
      db.attachment.findMany({
        where: { lotNo: lot },
        select: { id: true, name: true, size: true, createdAt: true },
        take: 100,
      }),
    ]);
    if (!history.length) throw new NotFoundException();
    return {
      history,
      assembly: history.at(-1),
      materials,
      materialTotal: materialCounts[0].total,
      materialPage,
      processHistory,
      processTotal: processCount,
      processPage,
      processLimit,
      defects: lotDefects,
      scraps,
      comments,
      attachments,
    };
  }
  @Post('lots/:lot/comments') @Roles(...engineers) async comment(
    @Param('lot') lot: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const { text } = parse(z.object({ text: z.string().min(1).max(4000) }), body);
    if (!(await db.yield.findFirst({ where: { lotNo: lot }, select: { id: true } })))
      throw new NotFoundException('Lot not found');
    const item = await db.lotComment.create({ data: { lotNo: lot, author: req.user.id, body: text } });
    await audit(req, 'lot.comment', lot);
    return item;
  }
  @Post('lots/:lot/attachments')
  @Roles(...engineers)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  async attach(@Param('lot') lot: string, @UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file || !['application/pdf', 'image/png', 'image/jpeg', 'text/plain'].includes(file.mimetype))
      throw new BadRequestException('Allowed: PDF, PNG, JPEG, text, up to 10 MB');
    if (!(await db.yield.findFirst({ where: { lotNo: lot }, select: { id: true } })))
      throw new NotFoundException('Lot not found');
    const signatures: Record<string, boolean> = {
      'application/pdf': file.buffer.subarray(0, 5).toString() === '%PDF-',
      'image/png': file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      'image/jpeg': file.buffer[0] === 255 && file.buffer[1] === 216 && file.buffer[2] === 255,
      'text/plain': !file.buffer.includes(0),
    };
    if (!signatures[file.mimetype]) throw new BadRequestException('File content does not match its type');
    const base = storageDirectory('uploads');
    await mkdir(base, { recursive: true });
    const storageKey = randomUUID();
    await writeFile(join(base, storageKey), file.buffer);
    const item = await db.attachment.create({
      data: {
        lotNo: lot,
        name: file.originalname.replace(/[\\/\r\n]/g, '_').slice(0, 200),
        storageKey,
        mimeType: file.mimetype,
        size: file.size,
        uploadedBy: req.user.id,
      },
    });
    await audit(req, 'attachment.create', item.id);
    return { id: item.id, name: item.name };
  }
  @Get('attachments/:id') async download(@Param('id') id: string, @Res() res: Response) {
    const file = await db.attachment.findUnique({ where: { id } });
    if (!file) throw new NotFoundException();
    const buffer = await readFile(join(storageDirectory('uploads'), file.storageKey));
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    res.send(buffer);
  }
}
@Module({ controllers: [LotsController] })
export class LotsModule {}
