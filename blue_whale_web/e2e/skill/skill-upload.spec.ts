/**
 * skill-upload.spec.ts —— IK60WW：上传 SKILL.md 创建个人技能验收。
 *
 * route-intercept 模式（模板参照 e2e/skill/skill-panel-library.spec.ts）：
 * seedAuth 注入登录态，POST /api/agent/skills/personal 与 /mine 用可控 fixture
 * 拦截并记录请求体。
 *
 * 锁定验收：
 *  1. 上传模式与编写模式分离：选择文件后停留上传模式，显示文件名与校验状态，内容不进编写编辑器；
 *  2. 非 .md / 非法 frontmatter / 空 name / 空 description / 空正文分别显示具体错误并阻止保存；
 *  3. 选择文件不隐式创建资产，仅「保存到我的技能」触发 POST；保存成功进「我的技能」并显示新技能；
 *  4. 名称冲突（100101）显示服务端错误且保留文件状态；
 *  5. 切换创建模式/页签保留上传文件与编写草稿。
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { seedAuth } from "../_fixtures/auth";

test.setTimeout(30_000);

const PANEL = '[data-testid="skill-panel"]';

const VALID_MD = "---\nname: 上传的技能\ndescription: 上传简介\n---\n正文内容";

function result(data: unknown): string {
  return JSON.stringify({ code: 200, msg: "", success: true, data });
}

function fulfillJson(route: Route, body: string, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body });
}

function mineRecord(name: string) {
  return {
    creative_skill_id: "uploaded_skill",
    name,
    description: "上传简介",
    cover_url: null,
    source: null,
    asset_domain: "personal",
    auto: false,
  };
}

/** 拦截 skills 接口：personal 记录请求体（可配失败响应），mine 保存后返回新记录。 */
async function mockSkillsApi(
  page: Page,
  opts: { personalResponse?: { code: number; msg: string } } = {},
) {
  const personalRequests: { content: string }[] = [];
  let saved: string | null = null;

  await page.route("**/api/agent/skills/personal", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { content: string };
    personalRequests.push(body);
    const fail = opts.personalResponse;
    if (fail) {
      return fulfillJson(
        route,
        JSON.stringify({ ...fail, success: false, data: null }),
      );
    }
    saved = "上传的技能";
    return fulfillJson(route, result(mineRecord("上传的技能")));
  });

  await page.route("**/api/agent/skills/mine", (route) =>
    fulfillJson(
      route,
      result({
        records: saved ? [mineRecord(saved)] : [],
        total: saved ? 1 : 0,
        current: 1,
        size: 50,
      }),
    ),
  );

  await page.route("**/api/agent/skills/library", (route) =>
    fulfillJson(route, result({ records: [], total: 0, current: 1, size: 50 })),
  );

  return personalRequests;
}

async function bootstrap(
  page: Page,
  opts: { personalResponse?: { code: number; msg: string } } = {},
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
  const personalRequests = await mockSkillsApi(page, opts);
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
  return personalRequests;
}

/** 打开面板并切到创建页签的上传模式。 */
async function openUploadMode(page: Page) {
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await expect(page.locator(PANEL)).toBeVisible();
  await page.getByTestId("skill-tab-create").click();
  await page.getByTestId("skill-create-mode-upload").click();
  await expect(page.getByTestId("skill-upload-dropzone")).toBeVisible();
}

function uploadFile(page: Page, fileName: string, content: string) {
  return page.getByTestId("skill-upload-input").setInputFiles({
    name: fileName,
    mimeType: "text/markdown",
    buffer: Buffer.from(content, "utf-8"),
  });
}

test("有效上传：显示校验状态，保存后进入我的技能", async ({ page }) => {
  const personalRequests = await bootstrap(page);
  await openUploadMode(page);

  await uploadFile(page, "SKILL.md", VALID_MD);

  // 停留上传模式：文件名 + 校验状态，编写编辑器不承载该内容
  await expect(page.getByTestId("skill-upload-file")).toContainText("SKILL.md");
  await expect(page.getByTestId("skill-upload-status-ok")).toContainText(
    "上传的技能",
  );
  await page.getByTestId("skill-create-mode-write").click();
  await expect(page.getByTestId("skill-md-editor")).not.toHaveValue(VALID_MD);
  await page.getByTestId("skill-create-mode-upload").click();

  // 选择文件不隐式创建资产
  expect(personalRequests).toHaveLength(0);

  await page.getByTestId("skill-save-btn").click();
  await expect.poll(() => personalRequests.length).toBe(1);
  expect(personalRequests[0].content).toBe(VALID_MD);

  // 保存成功 → 我的技能页签 + 新技能可见
  await expect(page.getByTestId("skill-tab-my")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("上传的技能").first()).toBeVisible();
});

const BAD_FILES: {
  label: string;
  fileName: string;
  content: string;
  error: string;
}[] = [
  {
    label: "非 .md 文件",
    fileName: "skill.txt",
    content: VALID_MD,
    error: "仅支持 .md 文件",
  },
  {
    label: "无 frontmatter",
    fileName: "skill.md",
    content: "纯正文，无 frontmatter",
    error: "YAML frontmatter 格式不合法",
  },
  {
    label: "frontmatter 未闭合",
    fileName: "skill.md",
    content: "---\nname: Test\n",
    error: "YAML frontmatter 格式不合法",
  },
  {
    label: "name 为空",
    fileName: "skill.md",
    content: "---\nname: \ndescription: Desc\n---\nbody",
    error: "名称不能为空",
  },
  {
    label: "description 为空",
    fileName: "skill.md",
    content: "---\nname: Test\ndescription: \n---\nbody",
    error: "简介不能为空",
  },
  {
    label: "正文为空",
    fileName: "skill.md",
    content: "---\nname: Test\ndescription: Desc\n---\n",
    error: "正文不能为空",
  },
];

for (const bad of BAD_FILES) {
  test(`失败输入：${bad.label} → 具体错误且阻止保存`, async ({ page }) => {
    const personalRequests = await bootstrap(page);
    await openUploadMode(page);

    await uploadFile(page, bad.fileName, bad.content);
    await expect(page.getByTestId("skill-upload-status-error")).toHaveText(
      bad.error,
    );
    await expect(page.getByTestId("skill-save-btn")).toBeDisabled();
    expect(personalRequests).toHaveLength(0);
  });
}

test("名称冲突：显示服务端错误且保留文件状态", async ({ page }) => {
  const personalRequests = await bootstrap(page, {
    personalResponse: { code: 100101, msg: "同名技能已存在" },
  });
  await openUploadMode(page);

  await uploadFile(page, "SKILL.md", VALID_MD);
  await expect(page.getByTestId("skill-upload-status-ok")).toBeVisible();
  await page.getByTestId("skill-save-btn").click();

  await expect(page.getByText("同名技能已存在")).toBeVisible();
  await expect.poll(() => personalRequests.length).toBe(1);
  // 文件状态保留，允许改名后重传
  await expect(page.getByTestId("skill-upload-file")).toContainText("SKILL.md");
});

test("模式与页签切换保留上传文件与编写草稿", async ({ page }) => {
  await bootstrap(page);
  await openUploadMode(page);

  await uploadFile(page, "SKILL.md", VALID_MD);

  // 切到编写模式写草稿，再切回上传：两边状态都在
  await page.getByTestId("skill-create-mode-write").click();
  await page.getByTestId("skill-md-editor").fill("草稿内容");
  await page.getByTestId("skill-create-mode-upload").click();
  await expect(page.getByTestId("skill-upload-file")).toContainText("SKILL.md");
  await page.getByTestId("skill-create-mode-write").click();
  await expect(page.getByTestId("skill-md-editor")).toHaveValue("草稿内容");

  // 切页签再回创建页签：上传文件仍在
  await page.getByTestId("skill-create-mode-upload").click();
  await page.getByTestId("skill-tab-library").click();
  await page.getByTestId("skill-tab-create").click();
  await expect(page.getByTestId("skill-upload-file")).toContainText("SKILL.md");
});
