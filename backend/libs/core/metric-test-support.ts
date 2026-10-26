
export function metricEventsFrom(
  calls: ReadonlyArray<ReadonlyArray<unknown>>,
): Array<Record<string, unknown>> {
  return calls
    .map((call) => {
      try {
        return JSON.parse(String(call[0])) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter(
      (record): record is Record<string, unknown> =>
        record !== null && typeof record.event === "string",
    );
}
