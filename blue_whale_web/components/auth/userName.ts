/**
 * generateUsername —— 生成 mock 用户名：`用户` + 4 位数字（如 `用户7281`）。
 *
 * rand 可注入（测试确定性），默认 Math.random。
 * 4 位 = Math.floor(rand * 10000)，padStart 补零。
 */
export function generateUsername(rand: () => number = Math.random): string {
  const n = Math.floor(rand() * 10000);
  return `用户${String(n).padStart(4, "0")}`;
}
