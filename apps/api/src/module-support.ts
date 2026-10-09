import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { db } from './analytics';
export const engineers = [
  'Administrator',
  'Yield Engineer',
  'QA Engineer',
  'Production Engineer',
  'Process Engineer',
];
export function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.output<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
  return parsed.data;
}
export async function audit(
  req: { user: { id: string } },
  action: string,
  resource: string,
  details: any = {},
) {
  await db.audit.create({ data: { actor: req.user.id, action, resource, details } });
}
