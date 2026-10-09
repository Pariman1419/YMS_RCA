import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
test(
  'Lot RCA API validates identity, range and optional external policy',
  { skip: process.env.RUN_INTEGRATION !== 'true' },
  async () => {
    const base = 'http://127.0.0.1:4000/api';
    const login = await fetch(base + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin' }),
    });
    assert.equal(login.status, 201);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const send = (path: string, method = 'GET', body?: any) =>
      fetch(base + path, {
        method,
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const original = await (await send('/ai-assistance/settings')).json();
    let changed: any;
    try {
      assert.equal(
        (
          await send('/ai-assistance', 'POST', {
            question: 'Investigate lot',
            lotNo: 'UNKNOWN-NOT-A-LOT',
            consent: true,
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await send('/ai-assistance', 'POST', {
            question: 'Investigate lot',
            lotNo: 'IS3PT2317.8',
            targetYield: 101,
            consent: true,
          })
        ).status,
        400,
      );
      const saved = await send('/ai-assistance/settings', 'PUT', {
        ...original,
        externalKnowledgeEnabled: false,
      });
      assert.equal(saved.status, 200);
      changed = await saved.json();
      assert.equal(
        (
          await send('/ai-assistance', 'POST', {
            question: 'Investigate lot',
            lotNo: 'IS3PT2317.8',
            useExternalKnowledge: true,
            consent: true,
          })
        ).status,
        400,
      );
    } finally {
      if (changed) {
        const restored = await send('/ai-assistance/settings', 'PUT', {
          ...original,
          version: changed.version,
        });
        assert.equal(restored.status, 200);
      }
    }
  },
);
