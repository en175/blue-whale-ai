/**
 * 全栈 MVP 验收 Playwright 配置（IK1NS2）
 *
 * 与纯前端 Mock E2E（playwright.config.ts → ./e2e）明确分离：
 * - 本配置不带 webServer —— 栈由 scripts/run-mvp-acceptance.sh 以隔离 Docker Compose 提供
 *   （Web/Gateway/User/Agent/Worker/MySQL/Redis/Nacos，Fake Provider + 测试 ContentReview）
 * - testDir ./e2e-fullstack 独立挂载，互不混入
 * - 串行单 worker、零重试：Fake 链路确定性，重试只会掩盖真实问题
 * - 失败保留 trace 与截图；服务侧脱敏日志由运行器写入同一 outputDir 下的 service-logs/
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-fullstack",
  // 只收 *.spec.ts；_fixtures 下的 vitest 单测（*.test.ts）归 `npm run test`，不进 Playwright
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  outputDir: "test-results/fullstack",
  timeout: 8 * 60_000,
  expect: { timeout: 30_000 },
  use: {
    // 由 scripts/run-mvp-acceptance.sh 注入；缺省与 docker-compose.acceptance.yml 的 web 端口一致
    baseURL: process.env.BW_ACCEPTANCE_BASE_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium",
      },
    },
  ],
});
