import 'dotenv/config';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { db, redis } from '../apps/api/src/analytics';
import { randomUUID } from 'node:crypto';
import { passwordHash } from '../apps/api/src/local-auth';
test(
  'AI admin settings enforce installed models, concurrency and roles; defect filters match operation and model',
  { skip: process.env.RUN_INTEGRATION !== 'true' },
  async () => {
    const base = 'http://127.0.0.1:4000/api';
    async function login(username: string, password: string) {
      const r = await fetch(base + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      assert.equal(r.status, 201);
      return r.headers.get('set-cookie')!.split(';')[0];
    }
    const cookie = await login('admin', 'admin');
    const send = (path: string, method = 'GET', body?: any, c = cookie) =>
      fetch(base + path, {
        method,
        headers: { Cookie: c, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const original = await (await send('/ai-assistance/settings')).json();
    let changed: any;
    const id = randomUUID(),
      username = 'ai-test-' + id.slice(0, 8);
    try {
      const models = await (await send('/ai-assistance/models')).json();
      assert(models.some((m: any) => m.name === 'gemma3:1b'));
      assert(!models.some((m: any) => /embed/.test(m.name)));
      assert.equal(
        (await send('/ai-assistance/settings', 'PUT', { ...original, model: 'not-installed' })).status,
        400,
      );
      const result = await send('/ai-assistance/settings', 'PUT', {
        enabled: original.enabled,
        model: original.model,
        systemPrompt: original.systemPrompt + '\nValidation check.',
        version: original.version,
      });
      assert.equal(result.status, 200);
      changed = await result.json();
      assert.equal(changed.version, original.version + 1);
      assert.equal((await send('/ai-assistance/settings', 'PUT', { ...original })).status, 409);
      const hashed = await passwordHash('test-password');
      await db.$executeRaw`INSERT INTO app_user(user_id,username,display_name,password_hash,roles) VALUES(${id}::uuid,${username},'AI permission test',${hashed},ARRAY['Yield Engineer'])`;
      const engineer = await login(username, 'test-password');
      assert.equal((await send('/ai-assistance/settings', 'GET', undefined, engineer)).status, 403);
      assert.equal((await send('/ai-assistance/models', 'GET', undefined, engineer)).status, 403);
      assert.equal((await send('/ai-assistance/status', 'GET', undefined, engineer)).status, 200);
      assert.equal((await send('/analytics/machines/1/model', 'PUT', { model: 'x' }, engineer)).status, 403);
      const options = await (await send('/analytics/defect-filters')).json();
      assert(options.operation.includes('D/A-MAP'));
      const rows = await (
        await send(
          '/analytics/defects?from=2025-01-01&to=2026-10-06&operation=D%2FA-MAP&machineModel=Unmapped',
        )
      ).json();
      assert(rows.length > 0);
      assert(rows.every((r: any) => r.operation === 'D/A-MAP' && r.machineModel === null));
    } finally {
      if (changed) await send('/ai-assistance/settings', 'PUT', { ...original, version: changed.version });
      await db.$executeRaw`DELETE FROM auth_session WHERE user_id=${id}::uuid`;
      await db.$executeRaw`DELETE FROM app_user WHERE user_id=${id}::uuid`;
      await db.$disconnect();
      await redis.quit();
    }
  },
);
