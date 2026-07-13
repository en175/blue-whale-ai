/**
 * not-found.spec.ts —— 404 兜底渲染。
 *
 * 触发机制：访问 /canvas/<不存在-id>，因 app/canvas/[id] 不存在
 * 落到 app/not-found.tsx（根级 fallback，IJZYVA 已 ship）。
 */
import { expect, test } from "@playwright/test";

test.describe("Route fallback — 404", () => {
  test("renders not-found.tsx for unknown /canvas/<id>", async ({ page }) => {
    const response = await page.goto("/canvas/foo-bar-not-exist");
    expect(response?.status()).toBe(404);

    // 标题 + 返回首页链接
    await expect(
      page.getByRole("heading", { name: "页面不存在", level: 1 }),
    ).toBeVisible();
    const home = page.getByRole("link", { name: "返回首页" });
    await expect(home).toBeVisible();
    await expect(home).toHaveAttribute("href", "/");
  });
});
