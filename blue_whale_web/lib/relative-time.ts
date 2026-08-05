/**
 * 相对时间格式化（账户记录列表用：「53分钟前 / 3小时前 / 1天前」）。
 *
 * 输入为 unix 秒时间戳（Go TopUp.create_time / Log.created_at 均为秒）。
 * 纯函数：nowMs 可注入便于测试；非法输入一律 "—"。
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** 超过 30 天显示具体日期而非「N天前」 */
const MAX_RELATIVE_DAYS = 30;

export function formatRelativeTime(
  unixSeconds: number,
  nowMs: number = Date.now(),
): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return "—";
  const tsMs = unixSeconds * 1000;
  const diffMs = nowMs - tsMs;
  // 时钟漂移防御：未来时间按「刚刚」
  if (diffMs < MINUTE_MS) return "刚刚";
  if (diffMs < HOUR_MS) return `${Math.floor(diffMs / MINUTE_MS)}分钟前`;
  if (diffMs < DAY_MS) return `${Math.floor(diffMs / HOUR_MS)}小时前`;
  if (diffMs < MAX_RELATIVE_DAYS * DAY_MS) {
    return `${Math.floor(diffMs / DAY_MS)}天前`;
  }
  const d = new Date(tsMs);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
