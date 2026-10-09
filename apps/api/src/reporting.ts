import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import pptxgen from 'pptxgenjs';
export async function renderReport(
  rows: Record<string, any>[],
  format: string,
): Promise<{ buffer: Buffer; type: string; extension: string }> {
  const keys = rows.length ? Object.keys(rows[0]) : ['name', 'input', 'output', 'reject', 'yield'];
  const text = (v: any) => (v === null || v === undefined ? '' : String(v));
  if (format === 'csv') {
    const esc = (v: any) => '"' + text(v).replace(/"/g, '""') + '"';
    const safe = (v: any) => (typeof v === 'string' && /^[=+@-]/.test(v) ? "'" + v : v);
    return {
      buffer: Buffer.from(
        [keys.map(esc).join(','), ...rows.map((r) => keys.map((k) => esc(safe(r[k]))).join(','))].join(
          '\r\n',
        ),
      ),
      type: 'text/csv',
      extension: 'csv',
    };
  }
  if (format === 'xlsx') {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Yield analysis');
    sheet.columns = keys.map((k) => ({ header: k, key: k, width: 22 }));
    sheet.addRows(rows);
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10243A' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: 'A1', to: { row: 1, column: keys.length } };
    return {
      buffer: Buffer.from(await book.xlsx.writeBuffer()),
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: 'xlsx',
    };
  }
  if (format === 'pdf') {
    const doc = new PDFDocument({ margin: 40, layout: 'landscape' });
    const chunks: Buffer[] = [];
    const complete = new Promise<Buffer>((resolve) => {
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });
    doc.fontSize(20).text('YMS | Yield analysis');
    doc.fontSize(9).text('Generated ' + new Date().toISOString());
    doc.moveDown();
    doc.text(keys.join(' | '));
    for (const row of rows) {
      if (doc.y > 510) doc.addPage();
      doc.text(keys.map((k) => text(row[k])).join(' | '));
    }
    doc.end();
    return { buffer: await complete, type: 'application/pdf', extension: 'pdf' };
  }
  if (format === 'pptx') {
    const deck = new pptxgen();
    deck.layout = 'LAYOUT_WIDE';
    for (let offset = 0; offset < Math.max(rows.length, 1); offset += 12) {
      const slide = deck.addSlide();
      slide.background = { color: '0B1727' };
      slide.addText('YMS / Yield performance', {
        x: 0.5,
        y: 0.3,
        w: 12,
        h: 0.5,
        color: 'FFFFFF',
        fontSize: 26,
      });
      slide.addTable(
        [
          keys.map((k) => ({ text: k })),
          ...rows.slice(offset, offset + 12).map((r) => keys.map((k) => ({ text: text(r[k]) }))),
        ],
        {
          x: 0.5,
          y: 1.2,
          w: 12,
          fontSize: 12,
          color: 'FFFFFF',
          fill: { color: '14283E' },
          border: { color: '264057', pt: 1 },
          rowH: 0.32,
        },
      );
    }
    return {
      buffer: (await deck.write({ outputType: 'nodebuffer' })) as Buffer,
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      extension: 'pptx',
    };
  }
  throw new Error('Unsupported report format');
}
