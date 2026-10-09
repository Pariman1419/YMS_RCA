import oracledb from 'oracledb';
import { extractJdbc } from './jdbc';
import { validateSql } from '../../../packages/core/src';
const pools = new Map<string, Promise<oracledb.Pool>>();
export async function poolFor(source: string) {
  if (!['1', '2'].includes(source)) throw new Error('Unregistered Oracle source');
  const existing = pools.get(source);
  if (existing) return existing;
  const prefix = `SOURCE_DB_${source}_`;
  const get = (key: string) => process.env[prefix + key];
  if (!get('USERNAME') || !get('PASSWORD')) throw new Error(`Credentials missing for source ${source}`);
  const pool = oracledb.createPool({
    user: get('USERNAME'),
    password: get('PASSWORD'),
    connectString: `${get('HOST')}:${get('PORT') || 1521}/${get('SERVICE')}`,
    poolMin: 0,
    poolMax: 4,
    poolIncrement: 1,
    queueTimeout: Number(process.env.ORACLE_QUEUE_TIMEOUT_MS) || 10000,
    poolTimeout: 60,
  });
  pools.set(source, pool);
  try {
    return await pool;
  } catch (error) {
    pools.delete(source);
    throw error;
  }
}
export async function* extract(
  source: string,
  sql: string,
  mode: string,
  start: Date,
  end: Date,
  test = false,
  lots?: string[],
): AsyncGenerator<Record<string, unknown>[]> {
  if (process.env.ORACLE_TRANSPORT === 'jdbc') {
    yield* extractJdbc(source, sql, mode, start, end, test, lots);
    return;
  }
  let text = validateSql(sql, mode);
  if (lots) throw new Error('Assembly lot enrichment requires ORACLE_TRANSPORT=jdbc');
  let connection: oracledb.Connection | undefined;
  let result: oracledb.ResultSet<any> | undefined;
  try {
    connection = await (await poolFor(source)).getConnection();
    connection.callTimeout = Number(process.env.ORACLE_CALL_TIMEOUT_MS) || 30000;
    await connection.execute('SET TRANSACTION READ ONLY');
    const binds: oracledb.BindParameters = {};
    if (/:LAST_SYNC_TIME\b/i.test(text)) binds.LAST_SYNC_TIME = start;
    if (/:SYNC_END_TIME\b/i.test(text)) binds.SYNC_END_TIME = end;
    const response = await connection.execute<Record<string, unknown>>(text, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      resultSet: true,
      fetchArraySize: 1000,
    });
    result = response.resultSet;
    if (!result) throw new Error('Expected Oracle result set');
    const deadline = Date.now() + (test ? 60000 : 3600000);
    while (true) {
      if (Date.now() > deadline) throw new Error('Extraction job deadline exceeded');
      const rows = await result.getRows(test ? 5 : 1000);
      if (!rows.length) break;
      yield rows;
      if (test) break;
    }
  } finally {
    try {
      await result?.close();
    } finally {
      if (connection) {
        try {
          await connection.rollback();
        } finally {
          await connection.close();
        }
      }
    }
  }
}
export async function closePools() {
  await Promise.allSettled([...pools.values()].map(async (p) => (await p).close(10)));
}
