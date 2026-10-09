import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
// Workspace npm commands and container commands share one storage root.
export function storageDirectory(kind: 'uploads' | 'reports') {
  const root =
    process.env.YMS_DATA_DIR ||
    (existsSync(resolve('database/schema.prisma')) ? process.cwd() : resolve('../..'));
  const setting = process.env[kind === 'uploads' ? 'UPLOAD_DIR' : 'REPORT_DIR'] || kind;
  return isAbsolute(setting) ? setting : resolve(root, setting);
}
