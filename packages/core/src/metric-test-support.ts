/**
 * metric 测试支持工具（IK7G9Y）。
 *
 * 从 console spy 的调用记录里解析 metric 事件 JSON 行，
 * 供各包单测共用；运行时不依赖 vitest。
 */

/** 解析 console spy 调用记录（logSpy.mock.calls），返回所有含 event 字段的 JSON 行。 */
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
