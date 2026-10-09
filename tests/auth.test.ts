import { Reflector } from '@nestjs/core';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthGuard } from '../apps/api/src/auth';
import { normalizeEntraRoles } from '../packages/core/src';
test('Entra claim values map to business roles and ignore unknown claims', () => {
  assert.deepEqual(
    normalizeEntraRoles(['YieldEngineer', 'QAEngineer', 'Executive', 'unknown', 'constructor', null]),
    ['Yield Engineer', 'QA Engineer', 'Executive'],
  );
  assert.deepEqual(normalizeEntraRoles('Administrator'), []);
});
test('API denies requests without a bearer token when demo auth is disabled', async () => {
  const old = process.env.AUTH_DEMO;
  process.env.AUTH_DEMO = 'false';
  try {
    const guard = new AuthGuard(new Reflector());
    const context: any = {
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
    };
    await assert.rejects(() => guard.canActivate(context), { name: 'UnauthorizedException' });
  } finally {
    if (old === undefined) delete process.env.AUTH_DEMO;
    else process.env.AUTH_DEMO = old;
  }
});
