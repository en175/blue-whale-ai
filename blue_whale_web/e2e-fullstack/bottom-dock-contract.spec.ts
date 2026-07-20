/**
 * BottomDock 运行态契约验收（IK2BCH T6.1）
 *
 * 双重核验，均针对「实际运行制品」而非工作区源码：
 *  1. 构建身份：GET /__build_info → git_commit/build_time 非 "unknown"，证明运行镜像携带构建身份。
 *  2. BottomDock 基础图片命令：page.route 拦截 generation-jobs 请求，核 payload 含五字段
 *     （model_id/size/web_search/input_asset_ids/expected_output_count），证明运行 bundle 真传五字段
 *     ——这正是用户原 bug（旧 bundle 只发 prompt+aspect_ratio，缺 model_id 被服务端拒）的回归门。
 *
 * 由 scripts/run-mvp-acceptance.sh 驱动（隔离 Compose 全栈，Fake Provider，零真实费用）。
 * 本套件需 8 服务 Docker 栈（~5-10 分钟起），CI/本地不强制跑通；逻辑正确性由前端单测
 * （lib/api-client.test.ts）+ 后端 IT（BottomDockGenerationJobIT）保证，全栈留作用户验收。
 *
 * 构建身份的「等于 checkout revision」强断言在 README runbook 人工核（docker inspect LABEL
 * 与 curl /__build_info 比对），spec 内只断非 unknown（避免 ENV 透传 / docker inspect 复杂度）。
 *
 * UI 选择器以组件 aria-label 为准；BottomDock UI 变化时同步本 spec。
 */
import { expect, test, type Page } from "@playwright/test";
import {
  bearerClient,
  loginViaApi,
  seedSession,
} from "./_fixtures/fullstack-auth";

interface CapturedPayload {
  type: string;
  input_asset_ids: unknown[];
  expected_output_count: number;
  parameters: {
    prompt?: string;
    aspect_ratio?: string;
    model_id?: string;
    size?: string;
    web_search?: boolean;
  };
}

const IMAGE_DOCK = '[data-canvas-reference-drop-target="image-dock"]';

/** LeftToolbar「AI 图片」工具按钮打开 BottomDock image 模式。 */
async function openImageDock(page: Page): Promise<void> {
  await page.getByRole("button", { name: "AI 图片" }).click();
  await expect(page.locator(IMAGE_DOCK)).toBeVisible({ timeout: 10_000 });
}

test("BottomDock 运行态契约：构建身份非 unknown + 基础图片请求含五字段", async ({
  page,
  baseURL,
}) => {
  const session = await loginViaApi(baseURL!);
  await seedSession(page, session);

  await test.step("构建身份：运行制品 /__build_info 非 unknown", async () => {
    const res = await page.request.get(`${baseURL}/__build_info`);
    expect(res.ok()).toBeTruthy();
    const info = (await res.json()) as {
      git_commit: string;
      build_time: string;
    };
    expect(info.git_commit, "git_commit 不能是 unknown").not.toBe("unknown");
    expect(info.build_time, "build_time 不能是 unknown").not.toBe("unknown");
  });

  await test.step("BottomDock 基础图片请求 payload 含五字段", async () => {
    await page.goto("/canvas");
    await openImageDock(page);

    let captured: CapturedPayload | undefined;
    await page.route("**/api/projects/*/generation-jobs**", async (route) => {
      try {
        captured = route.request().postDataJSON() as CapturedPayload;
      } catch {
        captured = undefined;
      }
      // 继续转发让请求落地（服务端接受或拒绝均可，本断言只核客户端发出的 payload）
      await route.continue();
    });

    // 填 prompt（contentEditable editor）+ 触发生成
    await page.locator(`${IMAGE_DOCK} [contenteditable="true"]`).click();
    await page.keyboard.type("蓝鲸跃出海面");
    await page
      .locator(`${IMAGE_DOCK} button`)
      .filter({ hasText: /生成/ })
      .click();

    await expect.poll(async () => captured, { timeout: 30_000 }).toBeTruthy();

    // 顶层契约字段
    expect(captured!.type).toBe("image");
    expect(captured!.input_asset_ids).toEqual([]);
    expect(captured!.expected_output_count).toBeGreaterThanOrEqual(1);
    // 五字段核验（运行 bundle 真传，非工作区源码）
    expect(captured!.parameters.model_id, "model_id 必传").toBeTruthy();
    expect(captured!.parameters.size, "size 必传").toBeTruthy();
    expect(captured!.parameters.web_search, "web_search 必传为布尔").toBeTypeOf(
      "boolean",
    );
    expect(captured!.parameters.prompt).toContain("蓝鲸");
    expect(captured!.parameters.aspect_ratio).toBeTruthy();
  });

  await (await bearerClient(baseURL!, session)).dispose();
});
