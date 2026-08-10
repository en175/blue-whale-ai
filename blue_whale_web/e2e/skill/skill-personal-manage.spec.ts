/**
 * skill-personal-manage.spec.ts —— IK60WZ：个人技能只读查看、复制与永久删除验收。
 *
 * route-intercept 模式（模板参照 skill-my-assets.spec.ts）：seedAuth 注入登录态，
 * 首页 composer「Skill」按钮开面板。mine / GET/DELETE personal/{id} 全部拦截，
 * mock 内部维护 personal 存在性 → 删除后 mine 并集与只读端点联动（100100）。
 *
 * 锁定验收（契约 docs/specs/2026-08-03-creative-skill-asset-contract.md §13）：
 *  1. 查看：个人行菜单「查看技能」打开只读视图，展示完整 SKILL.md 原文，可复制 Markdown；
 *  2. 删除：确认框显示技能名与不可逆文案；确认后卡片立即移除 + 成功提示；
 *     删除后只读端点按 100100 不存在处理（删除后行为）；
 *  3. 取消删除不动资产；
 *  4. 官方技能经只读端点一律 100100，不返回官方内容（契约 §13.1）。
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { seedAuth } from "../_fixtures/auth";

test.setTimeout(30_000);

const PANEL = '[data-testid="skill-panel"]';

const OFFICIAL_FIXTURE = {
  id: "skill_storyboard",
  name: "分镜大师",
  description: "影视分镜创作助手。",
};
const PERSONAL_FIXTURE = {
  id: "my_personal_skill",
  name: "我的个人技能",
  description: "个人创建的私有技能。",
};
const SKILL_MD_CONTENT = `---
name: ${PERSONAL_FIXTURE.name}
description: ${PERSONAL_FIXTURE.description}
---

# 步骤

1. 做一件事
`;

function result(data: unknown): string {
  return JSON.stringify({ code: 200, msg: "", success: true, data });
}

function notExist(id: string): string {
  return JSON.stringify({
    code: 100100,
    msg: `Skill 不存在: ${id}`,
    success: false,
    data: null,
  });
}

function fulfillJson(route: Route, body: string, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body });
}

/** 拦截 skills 接口；personal 存在性在 DELETE 后联动 mine / GET 响应。 */
async function mockSkillsApi(page: Page) {
  let personalExists = true;
  const calls: { get: string[]; delete: string[] } = { get: [], delete: [] };

  await page.route("**/api/agent/skills/library", (route) => {
    const body = route.request().postDataJSON() as {
      pageNum?: number;
      pageSize?: number;
    };
    return fulfillJson(
      route,
      result({
        records: [
          {
            creative_skill_id: OFFICIAL_FIXTURE.id,
            name: OFFICIAL_FIXTURE.name,
            description: OFFICIAL_FIXTURE.description,
            cover_url: null,
            source: "official",
            asset_domain: "official",
            added: true,
            category: "film",
            usage_count: 10,
          },
        ],
        total: 1,
        current: body.pageNum ?? 1,
        size: body.pageSize ?? 50,
      }),
    );
  });

  await page.route("**/api/agent/skills/mine", (route) => {
    const body = route.request().postDataJSON() as {
      pageNum?: number;
      pageSize?: number;
    };
    const records = [
      {
        creative_skill_id: OFFICIAL_FIXTURE.id,
        auto: false,
        name: OFFICIAL_FIXTURE.name,
        description: OFFICIAL_FIXTURE.description,
        cover_url: null,
        source: "official",
        asset_domain: "official",
      },
      ...(personalExists
        ? [
            {
              creative_skill_id: PERSONAL_FIXTURE.id,
              auto: false,
              name: PERSONAL_FIXTURE.name,
              description: PERSONAL_FIXTURE.description,
              cover_url: null,
              source: null,
              asset_domain: "personal",
            },
          ]
        : []),
    ];
    return fulfillJson(
      route,
      result({
        records,
        total: records.length,
        current: body.pageNum ?? 1,
        size: body.pageSize ?? 50,
      }),
    );
  });

  await page.route("**/api/agent/skills/personal/*", (route) => {
    const url = route.request().url();
    const id = url.split("/personal/")[1].split("?")[0];
    const method = route.request().method();
    if (method === "GET") {
      calls.get.push(id);
      if (personalExists && id === PERSONAL_FIXTURE.id) {
        return fulfillJson(route, result({ content: SKILL_MD_CONTENT }));
      }
      return fulfillJson(route, notExist(id));
    }
    if (method === "DELETE") {
      calls.delete.push(id);
      if (personalExists && id === PERSONAL_FIXTURE.id) {
        personalExists = false;
        return fulfillJson(route, result(null));
      }
      return fulfillJson(route, notExist(id));
    }
    return route.fallback();
  });

  return calls;
}

/** 启动链路公共 mock：登录态 + 技能接口 + 截断外部静态资源。 */
async function bootstrap(page: Page) {
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
  const calls = await mockSkillsApi(page);
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
  return calls;
}

async function openPanel(page: Page) {
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  const panel = page.locator(PANEL);
  await expect(panel).toBeVisible();
  return panel;
}

async function gotoMyTab(page: Page) {
  await page.getByTestId("skill-tab-my").click();
  await expect(page.getByTestId("skill-my-row")).toHaveCount(2);
}

test("查看：只读视图展示完整 SKILL.md 原文，可复制 Markdown 到剪贴板", async ({
  page,
  context,
}) => {
  const calls = await bootstrap(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openPanel(page);
  await gotoMyTab(page);

  const personalRow = page
    .getByTestId("skill-my-row")
    .filter({ hasText: PERSONAL_FIXTURE.name });
  await personalRow.getByTestId("skill-my-row-menu").click();
  await page.getByTestId("skill-my-row-view").click();

  const viewer = page.getByTestId("skill-personal-viewer");
  await expect(viewer).toBeVisible();
  // 完整 SKILL.md 原文：frontmatter 与正文都在，且只读（pre 展示，无编辑控件）
  const content = page.getByTestId("skill-personal-viewer-content");
  await expect(content).toContainText(`name: ${PERSONAL_FIXTURE.name}`);
  await expect(content).toContainText(
    `description: ${PERSONAL_FIXTURE.description}`,
  );
  await expect(content).toContainText("# 步骤");
  await expect(content).toContainText("1. 做一件事");
  expect(calls.get).toEqual([PERSONAL_FIXTURE.id]);

  // 复制 Markdown 到剪贴板
  await page.getByTestId("skill-personal-viewer-copy").click();
  await expect(page.getByTestId("skill-personal-viewer-copy")).toHaveText(
    "已复制",
  );
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toBe(SKILL_MD_CONTENT);
});

test("删除：确认框显示技能名与不可逆文案，确认后卡片立即移除；删除后正文不可再取", async ({
  page,
}) => {
  const calls = await bootstrap(page);
  await openPanel(page);
  await gotoMyTab(page);

  const personalRow = page
    .getByTestId("skill-my-row")
    .filter({ hasText: PERSONAL_FIXTURE.name });
  await personalRow.getByTestId("skill-my-row-menu").click();
  await page.getByTestId("skill-my-row-delete").click();

  // 确认框：技能名 + 删除后正文不可查看、复制或复用
  const dialog = page.getByTestId("skill-personal-delete-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`确认删除「${PERSONAL_FIXTURE.name}」？`);
  await expect(dialog).toContainText("不可查看、复制或复用");

  await page.getByTestId("skill-personal-delete-confirm").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("技能已删除")).toBeVisible();
  // 「我的技能」立即移除该卡片
  await expect(page.getByTestId("skill-my-row")).toHaveCount(1);
  await expect(
    page.getByTestId("skill-my-row").filter({ hasText: PERSONAL_FIXTURE.name }),
  ).toHaveCount(0);
  expect(calls.delete).toEqual([PERSONAL_FIXTURE.id]);

  // 删除后行为：只读端点按不存在处理（100100），正文不可再取
  const res = await page.evaluate(async (id) => {
    const r = await fetch(`/api/agent/skills/personal/${id}`);
    return (await r.json()) as { code: number; data: unknown };
  }, PERSONAL_FIXTURE.id);
  expect(res.code).toBe(100100);
  expect(res.data).toBeNull();
});

test("取消删除：弹层关闭，卡片保留，不触发删除请求", async ({ page }) => {
  const calls = await bootstrap(page);
  await openPanel(page);
  await gotoMyTab(page);

  const personalRow = page
    .getByTestId("skill-my-row")
    .filter({ hasText: PERSONAL_FIXTURE.name });
  await personalRow.getByTestId("skill-my-row-menu").click();
  await page.getByTestId("skill-my-row-delete").click();

  await page.getByTestId("skill-personal-delete-cancel").click();
  await expect(page.getByTestId("skill-personal-delete-dialog")).toHaveCount(0);
  await expect(page.getByTestId("skill-my-row")).toHaveCount(2);
  expect(calls.delete).toEqual([]);
});

test("官方技能经只读端点一律按不存在处理，不返回官方内容（契约 §13.1）", async ({
  page,
}) => {
  await bootstrap(page);
  await openPanel(page);

  const res = await page.evaluate(async (id) => {
    const r = await fetch(`/api/agent/skills/personal/${id}`);
    return (await r.json()) as { code: number; data: unknown };
  }, OFFICIAL_FIXTURE.id);
  expect(res.code).toBe(100100);
  expect(res.data).toBeNull();

  // 官方卡片无详情/查看/复制入口：官方行菜单仅「移出我的技能」
  await gotoMyTab(page);
  const officialRow = page
    .getByTestId("skill-my-row")
    .filter({ hasText: OFFICIAL_FIXTURE.name });
  await officialRow.getByTestId("skill-my-row-menu").click();
  const menu = page.locator('[role="menu"]');
  await expect(menu.getByRole("menuitem")).toHaveCount(1);
  await expect(menu.getByTestId("skill-my-row-remove")).toBeVisible();
});
