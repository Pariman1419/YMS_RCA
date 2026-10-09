import { Prisma } from '@prisma/client';
import nodemailer from 'nodemailer';
import { spc } from '../../../packages/core/src';
import { db } from './loader';
async function raise(
  fingerprint: string,
  type: string,
  title: string,
  details: Prisma.InputJsonValue,
  severity = 'warning',
) {
  const alert = await db.alert.upsert({
    where: { fingerprint },
    create: { fingerprint, type, title, details, severity },
    update: {},
  });
  for (const channel of ['teams', 'email']) {
    if (channel === 'teams' && !process.env.TEAMS_WEBHOOK_URL) continue;
    if (channel === 'email' && (!process.env.SMTP_HOST || !process.env.ALERT_EMAIL_TO)) continue;
    await db.alertDelivery.upsert({
      where: { alertId_channel: { alertId: alert.id, channel } },
      create: { alertId: alert.id, channel },
      update: {},
    });
  }
}
export async function evaluateAlerts() {
  const rules = await db.alertRule.findMany({ where: { enabled: true } });
  const values = await db.$queryRaw<
    any[]
  >`SELECT process_id,machine_id,sum(input_qty)::float input,sum(output_qty)::float output,sum(reject_qty)::float reject FROM mv_yield_daily WHERE transaction_date >= CURRENT_DATE - INTERVAL '1 day' GROUP BY process_id,machine_id`;
  const day = new Date().toISOString().slice(0, 10);
  for (const row of values) {
    if (!row.input) continue;
    for (const rule of rules) {
      const rate = rule.type === 'yield' ? (row.output / row.input) * 100 : (row.reject / row.input) * 100;
      const violation =
        rule.type === 'yield'
          ? rate < rule.threshold
          : rule.type === 'scrap' || rule.type === 'machine'
            ? rate > rule.threshold
            : false;
      if (violation)
        await raise(
          `${rule.id}:${row.process_id}:${row.machine_id}:${day}`,
          rule.type,
          `${rule.name}: ${rate.toFixed(2)}%`,
          { ...row, threshold: rule.threshold, rate },
          rule.type === 'yield' ? 'critical' : 'warning',
        );
    }
  }
  const defectRule = rules.find((r) => r.type === 'defect');
  if (defectRule) {
    const spikes = await db.$queryRaw<
      any[]
    >`SELECT defect_code code,sum(qty) FILTER (WHERE occurred_at>=CURRENT_DATE)::float today,sum(qty) FILTER (WHERE occurred_at<CURRENT_DATE)::float/7 baseline FROM fact_defect WHERE occurred_at>=CURRENT_DATE-INTERVAL '7 days' GROUP BY defect_code`;
    for (const s of spikes)
      if (s.baseline > 0 && s.today / s.baseline > defectRule.threshold)
        await raise(`defect:${s.code}:${day}`, 'defect', `Defect spike: ${s.code}`, s);
  }
  const rule = rules.find((r) => r.type === 'spc');
  if (rule) {
    const measurements = await db.spc.findMany({
      where: { measuredAt: { gte: new Date(Date.now() - 86400000) } },
      orderBy: { measuredAt: 'asc' },
      take: 10000,
    });
    const groups = new Map<string, typeof measurements>();
    for (const r of measurements) {
      const key = `${r.machineId}:${r.processId}:${r.measurementName}`;
      groups.set(key, [...(groups.get(key) || []), r]);
    }
    for (const [key, rows] of groups) {
      for (let index = 0; index < rows.length; index++) {
        const last = rows[index];
        const violations = spc(
          rows.slice(Math.max(0, index - 7), index + 1).map((x) => x.value),
          last.target,
          (last.ucl - last.lcl) / 6,
        ).at(-1)!.rules;
        if (violations.length)
          await raise(
            `spc:${key}:${last.id}`,
            'spc',
            `SPC violation: ${last.measurementName}`,
            { machineId: last.machineId, rules: violations },
            'critical',
          );
      }
    }
  }
}
export async function deliverAlerts() {
  const pending = await db.alertDelivery.findMany({
    where: { status: 'pending', nextAttemptAt: { lte: new Date() }, attempts: { lt: 5 } },
    include: { alert: true },
    take: 50,
  });
  for (const item of pending) {
    try {
      if (item.channel === 'teams') {
        const result = await fetch(process.env.TEAMS_WEBHOOK_URL!, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({ text: `YMS ${item.alert.severity}: ${item.alert.title}` }),
        });
        if (!result.ok) throw new Error('Teams delivery failed');
      } else {
        const transport = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT) || 587,
          secure: process.env.SMTP_PORT === '465',
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
          connectionTimeout: 15000,
        });
        await transport.sendMail({
          from: process.env.SMTP_FROM,
          to: process.env.ALERT_EMAIL_TO,
          subject: `YMS: ${item.alert.title}`,
          text: JSON.stringify(item.alert.details),
        });
      }
      await db.alertDelivery.update({
        where: { id: item.id },
        data: { status: 'sent', attempts: { increment: 1 }, lastError: null },
      });
    } catch {
      await db.alertDelivery.update({
        where: { id: item.id },
        data: {
          status: item.attempts >= 4 ? 'failed' : 'pending',
          attempts: { increment: 1 },
          lastError: 'Delivery failed; inspect channel configuration',
          nextAttemptAt: new Date(Date.now() + Math.pow(2, item.attempts) * 60000),
        },
      });
    }
  }
}
