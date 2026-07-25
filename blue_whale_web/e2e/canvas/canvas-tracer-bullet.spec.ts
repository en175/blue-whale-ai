/**
 * canvas-tracer-bullet.spec.ts —— Canvas 工作台 tracer-bullet 端到端。
 *
 * 流程：seed auth → 打开 /canvas → 项目 1 预置的失败卡（status: "failed"）
 * → 点重试 CTA → 等 CTA aria-label 翻成 "手动应用"（终态 normal）。
 *
 * 关键时序：AgentChatPanel.tsx:230-235 设定 onSetCardStatus("generating")
 * 后 800ms 落到 normal。Playwright 5s 容差（5×）+ spec 内 retries: 1 兜底。
 */
import { expect, test } from "@playwright/test";
import { seedAuth } from "../_fixtures/auth";

// dev 模式首次访问编译慢：~10-15s
test.setTimeout(30_000);
// 仅本 spec 文件 retry 1 次：Canvas 时序窗口 800ms，比其他 spec 略脆弱
test.describe.configure({ retries: 1 });

test.describe("Canvas — retry chain tracer-bullet", () => {
  test("failed card → click retry → terminal normal CTA", async ({ page }) => {
    // 1. 注入 auth，避开 LoginModal
    await seedAuth(page);

    // 2. 进入 /canvas —— 4 个项目预置，#1 ("小猫创作") 包含 1 张 status=failed 卡
    await page.goto("/canvas");

    // 卡片在 AgentChatPanel 内渲染，面板默认收起，先打开
    await page.getByRole("button", { name: "Canvas Agent" }).click();

    // 等待至少 1 张卡渲染（处理 mock reply 的 setTimeout 入场）
    const cardCta = page.locator("button.tc-agent-card-cta");
    await expect(cardCta).toHaveCount(1, { timeout: 10_000 });

    // 3. 断言 CTA 当前是重试态（aria-label 含 "重试"）
    await expect(cardCta).toHaveAttribute("aria-label", "生成失败，可重试", {
      timeout: 5_000,
    });

    // 4. 点重试
    await cardCta.click();

    // 5. 等待终态：同一 button（ChatBubbles.tsx 同一 React 实例，aria-label 属性翻）
    // AgentChatPanel.tsx:233-235 800ms 推进，Playwright 5s 容差 = 6×
    await expect(cardCta).toHaveAttribute("aria-label", "手动应用", {
      timeout: 5_000,
    });
  });
});
