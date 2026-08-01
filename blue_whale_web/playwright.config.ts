/**
 * Playwright E2E 配置（IJZYVT — ARCH-8）
 *
 * - testDir 指向 ./e2e（与 vitest 的 test glob 不冲突 —— Playwright 用 .spec.ts 后缀）
 * - single project (chromium) 起步；多浏览器留给后续工单
 * - webServer 启动 `next build && next start`（prod mode），原因：
 *   dev mode 下 Next.js 强制注入 dev error overlay，**接管** client-side throw，
 *   app/error.tsx 不渲染（React ErrorBoundary 被绕开）。prod mode 才是 ErrorBoundary → error.tsx 的标准路径。
 *   本地/CI 一致走 prod，spec 可重复性高；spec 跑前会 build（~30-60s 一次性）。
 * - 不设 NEXT_PUBLIC_E2E_ERROR：error-boundary 触发改用 URL query string（`?e2e_error=1`）
 *   避免 webServer 全局 env 污染其他 spec
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // 与 vitest 配置保持一致：test 目录单独挂载在 blue_whale_web/e2e/，不混入 app/
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // 1.49+ 默认 headless 走 chrome-headless-shell，本机没装；指 channel=chromium 走 full chromium（已装）
        channel: "chromium",
      },
    },
  ],
  webServer: {
    // prod 模式：build 一次 + start 持续。CI 不复用，本地 reuseExistingServer 跳过 build 二次
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    // prod build 首次 ~30-60s + start ~3s；统一给 5min 兜底
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
  },
});
