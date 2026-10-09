// Deterministic query planning: language never becomes executable SQL.
export function copilotFilters(
  question: string,
  filters: Record<string, string>,
  processes: string[],
  now = new Date(),
) {
  const selected = { ...filters };
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const text = question.toLowerCase();
  const process = processes.find((name) => text.includes(name.toLowerCase()));
  if (process) selected.process = process;
  if (/this week/.test(text)) {
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    selected.from = start.toISOString().slice(0, 10);
    selected.to = today.toISOString().slice(0, 10);
  } else if (/this month/.test(text)) {
    selected.from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10);
    selected.to = today.toISOString().slice(0, 10);
  }
  return selected;
}
