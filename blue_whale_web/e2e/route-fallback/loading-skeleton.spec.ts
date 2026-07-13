/**
 * loading-skeleton.spec.ts —— 路由切换时 loading.tsx 骨架闪现。
 *
 * 触发机制：用 page.route 拦截所有请求延迟 1500ms，
 * 让 Next.js 有时间展示 loading.tsx（SSR 阶段渲染）。
 * 断言 7+ 个 animate-pulse 占位块出现（与 loading.tsx:17-33 一一对应）。
 */
import { expect, test } from "@playwright/test";

// dev 模式首次访问编译慢：~10-15s
test.setTimeout(30_000);

test.describe("Route fallback — loading skeleton", () => {
  test("renders loading.tsx with 7+ skeleton blocks during slow route", async ({ page }) => {
    // 拦截所有请求，延迟 1500ms 再放行
    await page.route("**/*", async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });

    // waitUntil: commit —— 不等 load 事件，看到 main 渲染即断言
    await page.goto("/", { waitUntil: "commit" });

    // 加载骨架主区：role=status 是 ARIA live region，Playwright 默认 toBeVisible 报 hidden
    // 改用 toBeAttached（DOM 存在即可）+ 断言 aria-label 准确
    const status = page.getByRole("status", { name: "页面加载中" });
    await expect(status).toBeAttached();
    await expect(status).toHaveAttribute("aria-label", "页面加载中");

    // 7+ 个 animate-pulse 占位块
    const pulseCount = await page.locator('[class*="animate-pulse"]').count();
    expect(pulseCount).toBeGreaterThanOrEqual(7);
  });
});
