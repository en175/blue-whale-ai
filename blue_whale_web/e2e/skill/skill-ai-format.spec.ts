/**
 * skill-ai-format.spec.ts —— IK60X0：编写模式 AI 格式化验收。
 *
 * route-intercept 模式（模板参照 e2e/skill/skill-upload.spec.ts）：
 * POST /api/agent/skills/personal/format 用可控 fixture 拦截（即可控 AI 替身），
 * POST /api/agent/skills/personal 记录请求以证明「无自动保存」。
 *
 * 锁定验收：
 *  1. 编写模式点击「AI 格式化」→ 编辑器草稿被完整替换，且未发创建请求（不自动保存），替换后仍可继续编辑；
 *  2. 接口失败 → 原草稿保留、显示明确错误，不产生部分覆盖；
 *  3. 上传模式不提供 AI 格式化入口。
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { seedAuth } from "../_fixtures/auth";

test.setTimeout(30_000);

const PANEL = '[data-testid="skill-panel"]';

const DRAFT = "---\nname: 我的草稿\ndescription: 草稿简介\n---\n\n草稿正文\n";
const FORMATTED =
  "---\nname: 格式化技能\ndescription: 格式化简介\n---\n\n格式化后的正文\n";

function result(data: unknown): string {
  return JSON.stringify({ code: 200, msg: "", success: true, data });
}

function fulfillJson(route: Route, body: string, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body });
}

/** 拦截 skills 接口：format 按 fixture 响应并记录请求体；personal 记录以证明未被调用。 */
async function mockSkillsApi(
  page: Page,
  opts: { formatResponse?: { code: number; msg: string } } = {},
) {
  const formatRequests: { content: string }[] = [];
  const createRequests: unknown[] = [];

  await page.route("**/api/agent/skills/personal/format", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    formatRequests.push(route.request().postDataJSON() as { content: string });
    const fail = opts.formatResponse;
    if (fail) {
      return fulfillJson(
        route,
        JSON.stringify({ ...fail, success: false, data: null }),
      );
    }
    return fulfillJson(route, result({ content: FORMATTED }));
  });

  await page.route("**/api/agent/skills/personal", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    createRequests.push(route.request().postDataJSON());
    return fulfillJson(route, result({}));
  });

  await page.route("**/api/agent/skills/mine", (route) =>
    fulfillJson(route, result({ records: [], total: 0, current: 1, size: 50 })),
  );

  await page.route("**/api/agent/skills/library", (route) =>
    fulfillJson(route, result({ records: [], total: 0, current: 1, size: 50 })),
  );

  return { formatRequests, createRequests };
}

async function bootstrap(
  page: Page,
  opts: { formatResponse?: { code: number; msg: string } } = {},
) {
  await seedAuth(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("bw-access-token", "e2e-access-token");
    window.localStorage.setItem("bw-refresh-token", "e2e-refresh-token");
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    return url.startsWith("http://localhost") || url.startsWith("data:")
      ? route.fallback()
      : route.abort();
  });
  const requests = await mockSkillsApi(page, opts);
  await page.route("**/api/agent/templates/tags", (route) =>
    fulfillJson(route, result([])),
  );
  await page.route("**/api/agent/templates/page?**", (route) =>
    fulfillJson(route, result({ records: [], total: 0, current: 1, size: 50 })),
  );
  await page.route("**/api/usage/token**", (route) =>
    fulfillJson(route, result({ quota: 1000 })),
  );
  await page.goto("/");
  return requests;
}

/** 打开面板进入创建页签（默认编写模式）并写入草稿。 */
async function openWriteModeWithDraft(page: Page) {
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await expect(page.locator(PANEL)).toBeVisible();
  await page.getByTestId("skill-tab-create").click();
  const editor = page.getByTestId("skill-md-editor");
  await expect(editor).toBeVisible();
  await editor.fill(DRAFT);
  return editor;
}

test("编写模式：点击 AI 格式化整段替换草稿，不自动保存，可继续编辑", async ({
  page,
}) => {
  const { formatRequests, createRequests } = await bootstrap(page);
  const editor = await openWriteModeWithDraft(page);

  await page.getByTestId("skill-ai-format-btn").click();

  // 完整替换：草稿原样上行，编辑器内容被 mock 返回整段替换
  await expect(editor).toHaveValue(FORMATTED);
  expect(formatRequests).toEqual([{ content: DRAFT }]);

  // 无自动保存：格式化全程不触发创建请求
  expect(createRequests).toEqual([]);

  // 替换后仍可继续手工修改
  await editor.press("End");
  await editor.pressSequentially("追加手工修改");
  await expect(editor).toHaveValue(`${FORMATTED}追加手工修改`);
});

test("接口失败：保留原草稿并显示明确错误，不产生部分覆盖", async ({ page }) => {
  await bootstrap(page, {
    formatResponse: { code: 100104, msg: "AI 返回内容无效，已保留原草稿" },
  });
  const editor = await openWriteModeWithDraft(page);

  await page.getByTestId("skill-ai-format-btn").click();

  await expect(editor).toHaveValue(DRAFT);
  await expect(
    page.locator(`${PANEL} >> text=AI 返回内容无效，已保留原草稿`),
  ).toBeVisible();
});

test("上传模式不提供 AI 格式化入口", async ({ page }) => {
  await bootstrap(page);
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await expect(page.locator(PANEL)).toBeVisible();
  await page.getByTestId("skill-tab-create").click();

  // 编写模式有入口
  await expect(page.getByTestId("skill-ai-format-btn")).toBeVisible();

  // 切上传模式后入口消失
  await page.getByTestId("skill-create-mode-upload").click();
  await expect(page.getByTestId("skill-upload-dropzone")).toBeVisible();
  await expect(page.getByTestId("skill-ai-format-btn")).toHaveCount(0);
});
