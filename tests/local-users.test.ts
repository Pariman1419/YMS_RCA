import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { db, redis } from '../apps/api/src/analytics';
import { passwordHash, verifyPassword, sessionHash } from '../apps/api/src/local-auth';
test('Passwords use salted hashes and reject incorrect input', async () => {
  const a = await passwordHash('admin'),
    b = await passwordHash('admin');
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('admin', a), true);
  assert.equal(await verifyPassword('wrong', a), false);
  assert.equal(sessionHash('secret').length, 64);
});
test(
  'Local administration enforces sessions, roles, user lifecycle and existing ETL edits',
  { skip: process.env.RUN_INTEGRATION !== 'true' },
  async () => {
    const base = process.env.TEST_API_URL || 'http://localhost:4000/api';
    const send = async (path: string, method = 'GET', body?: any, cookie = '') =>
      fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const signIn = async (username: string, password: string) => {
      const r = await send('/auth/login', 'POST', { username, password });
      assert.equal(r.status, 201);
      return r.headers.get('set-cookie')!.split(';')[0];
    };
    let userId: string | undefined;
    let queryId: string | undefined;
    const username = 'test-' + randomUUID();
    try {
      assert.equal((await send('/users')).status, 401);
      assert.equal(
        (await send('/auth/login', 'POST', { username: 'admin', password: 'incorrect' })).status,
        401,
      );
      const admin = await signIn('admin', process.env.BOOTSTRAP_ADMIN_PASSWORD || 'admin');
      assert.equal((await send('/users', 'GET', undefined, admin)).status, 200);
      const payload = {
        username,
        name: 'Test Executive',
        roles: ['Executive'],
        enabled: true,
        password: 'test-password',
      };
      const created = await send('/users', 'POST', payload, admin);
      assert.equal(created.status, 201);
      userId = (await created.json()).id;
      const executive = await signIn(username, 'test-password');
      assert.equal((await send('/analytics/summary', 'GET', undefined, executive)).status, 200);
      assert.equal((await send('/users', 'GET', undefined, executive)).status, 403);
      assert.equal((await send('/etl/queries', 'GET', undefined, executive)).status, 403);
      const createdQuery = await send(
        '/etl/queries',
        'POST',
        {
          queryName: 'test-' + randomUUID(),
          oracleSource: '1',
          targetTable: 'FACT_YIELD',
          sqlText: 'SELECT 1 AS CONNECTION_OK FROM DUAL',
          schedule: 'daily',
          enabled: false,
          loadMode: 'full',
        },
        admin,
      );
      assert.equal(createdQuery.status, 201);
      const original = await createdQuery.json();
      queryId = original.id;
      if (original) {
        const { queryName, oracleSource, targetTable, sqlText, schedule, enabled, loadMode } = original;
        const updated = await send(
          '/etl/queries/' + original.id,
          'PUT',
          { queryName, oracleSource, targetTable, sqlText, schedule, enabled, loadMode },
          admin,
        );
        assert.equal(updated.status, 200);
        assert.equal((await updated.json()).version, original.version + 1);
      }
      const modeConfig = {
        queryName: original.queryName,
        oracleSource: '1',
        targetTable: 'FACT_YIELD',
        sqlText: 'SELECT 1 FROM DUAL WHERE SYSDATE >= :LAST_SYNC_TIME AND SYSDATE < :SYNC_END_TIME',
        schedule: 'daily',
        enabled: false,
        loadMode: 'incremental',
        version: original.version + 1,
      };
      const modeEdit = await send('/etl/queries/' + queryId, 'PUT', modeConfig, admin);
      assert.equal(modeEdit.status, 200);
      assert.equal((await modeEdit.json()).loadMode, 'incremental');
      assert.equal(
        (await send('/etl/queries/' + queryId, 'PUT', { ...modeConfig, loadMode: 'delta' }, admin)).status,
        409,
      );
      const persisted = (await (await send('/etl/queries', 'GET', undefined, admin)).json()).find(
        (q: any) => q.id === queryId,
      );
      assert.equal(persisted.loadMode, 'incremental');
      assert.equal(
        (await send('/users/' + userId, 'PUT', { ...payload, enabled: false, password: undefined }, admin))
          .status,
        200,
      );
      assert.equal((await send('/me', 'GET', undefined, executive)).status, 401);
      assert.equal((await send('/auth/login', 'POST', { username, password: 'test-password' })).status, 401);
      await send('/users/' + userId, 'PUT', { ...payload, password: 'replacement' }, admin);
      const replacement = await signIn(username, 'replacement');
      assert.equal((await send('/auth/logout', 'POST', {}, replacement)).status, 201);
      assert.equal((await send('/me', 'GET', undefined, replacement)).status, 401);
      const forbiddenOrigin = await fetch(base + '/users', {
        method: 'POST',
        headers: { Cookie: admin, Origin: 'https://untrusted.example', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      assert.equal(forbiddenOrigin.status, 403);
    } finally {
      if (queryId) await db.etlQuery.delete({ where: { id: queryId } });
      if (userId) await db.$executeRaw`DELETE FROM app_user WHERE user_id=${userId}::uuid`;
      await db.$disconnect();
      await redis.quit();
    }
  },
);
