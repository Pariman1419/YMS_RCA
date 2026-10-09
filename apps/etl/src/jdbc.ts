import { validateSql } from '../../../packages/core/src';
export function jdbcStatement(sql: string, start: Date, end: Date, lots?: string[]) {
  const binds: (string | { type: string; value: string })[] = [];
  // Preserve quoted strings, Oracle q-quotes, identifiers and comments.
  const text = sql.replace(
    /q'\[[\s\S]*?\]'|q'\{[\s\S]*?\}'|q'\([\s\S]*?\)'|q'<[\s\S]*?>'|'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\r\n]*|\/\*[\s\S]*?\*\/|:(LAST_SYNC_TIME|SYNC_END_TIME|LOT_LIST)\b/gi,
    (match, name) => {
      if (!name) return match;
      if (name.toUpperCase() === 'LOT_LIST') {
        if (!lots?.length || lots.length > 500)
          throw new Error('LOT_LIST requires 1–500 assembly lot numbers');
        binds.push(...lots.map((value) => ({ type: 'string', value })));
        return lots.map(() => '?').join(',');
      }
      binds.push(name.toUpperCase() === 'LAST_SYNC_TIME' ? start.toISOString() : end.toISOString());
      return '?';
    },
  );
  return { sql: text, binds };
}
export async function* extractJdbc(
  source: string,
  sql: string,
  mode: string,
  start: Date,
  end: Date,
  test = false,
  lots?: string[],
): AsyncGenerator<Record<string, unknown>[]> {
  if (!['1', '2'].includes(source)) throw new Error('Unregistered Oracle source');
  const key = process.env.JDBC_BRIDGE_TOKEN;
  if (!key) throw new Error('JDBC_BRIDGE_TOKEN is not configured');
  const statement = jdbcStatement(validateSql(sql, mode), start, end, lots);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), test ? 60000 : 3600000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const res = await fetch((process.env.JDBC_BRIDGE_URL || 'http://127.0.0.1:4010') + '/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ source, ...statement, test }),
      signal: controller.signal,
    });
    if (!res.ok)
      throw new Error(
        (await res.json().catch(() => ({ message: 'JDBC bridge unavailable' }))).message ||
          'JDBC extraction failed',
      );
    if (!res.body) throw new Error('JDBC bridge returned no result stream');
    reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '',
      complete = false;
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.error) throw new Error(event.error);
        if (event.done) complete = true;
        if (event.rows)
          yield event.rows.map((r: Record<string, unknown>) => ({
            ...r,
            ...(r.TRANSACTION_DATE ? { TRANSACTION_DATE: new Date(r.TRANSACTION_DATE as string) } : {}),
          }));
      }
      if (done) break;
    }
    if (!complete) throw new Error('JDBC result stream ended before completion');
  } finally {
    clearTimeout(timer);
    await reader?.cancel().catch(() => {});
    controller.abort();
  }
}
