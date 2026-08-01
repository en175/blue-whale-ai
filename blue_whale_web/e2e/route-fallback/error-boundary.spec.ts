/**
 * error-boundary.spec.ts —— 触发 Next.js App Router 错误边界，断言 error.tsx 渲染。
 *
 * 触发机制：app/_components/home-client.tsx 在 ?e2e_error=1 时 client-side render 抛错。
 * env var 方案会让 webServer 全局污染其他 spec，故走 query string。
 *
 * Selector 备注：Next.js 永远注入 `<div role="alert" id="__next-route-announcer__">`，
 * 用 getByRole('alert') 会 strict mode 撞车。直接锁 main[role="alert"] 定位 error.tsx。
 */
import { expect, test } from "@playwright/test";

// prod build 已编译完成 → server 3s + hydration ~1s + ErrorBoundary 替换 < 1s = ~5s 足够
// 留 30s 兜底
test.setTimeout(30_000);

test.describe("Route fallback — error boundary", () => {
  test("renders error.tsx when query string triggers throw", async ({
    page,
  }) => {
    await page.goto("/?e2e_error=1");

    // 错误页主区：直接定位 error.tsx 的 <main role="alert">，避开 Next.js route announcer div
    const alert = page.locator('main[role="alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("出了点问题");

    // 重试按钮存在且可点
    const retry = page.getByRole("button", { name: "重试" });
    await expect(retry).toBeVisible();
    await expect(retry).toBeEnabled();

    // 返回首页链接指向 /
    const home = page.getByRole("link", { name: "返回首页" });
    await expect(home).toBeVisible();
    await expect(home).toHaveAttribute("href", "/");
  });
});
