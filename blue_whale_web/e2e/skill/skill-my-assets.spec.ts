/**
 * skill-my-assets.spec.ts —— IK60WX：添加官方技能并统一「我的技能」资产视图验收。
 *
 * route-intercept 模式（模板参照 skill-panel-library.spec.ts）：seedAuth 注入登录态，
 * 首页 composer「Skill」按钮开面板。library/mine/add/remove 接口全部拦截，
 * mock 内部维护 added 集合 → add/remove 后 library 的 added 状态与 mine 并集联动。
 *
 * 锁定验收（契约 docs/specs/2026-08-03-creative-skill-asset-contract.md §5.4/§6）：
 *  1. 添加成功：停留技能库，按钮变不可点击「已添加」+ 成功提示；
 *  2. 「我的技能」统一显示官方引用 ∪ 个人技能，@官方 / @个人 标记区分；
 *     官方行菜单仅「移出我的技能」；个人行菜单为「查看技能/删除技能」（IK60WZ）；
 *  3. 移除：菜单仅「移出我的技能」，立即生效、无确认、成功提示；
 *     移除后技能库卡片回到「添加」可再次添加；
 *  4. 同名冲突（100103）：添加被拒并展示服务端解释，按钮回滚，直接使用不受影响。
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { seedAuth } from "../_fixtures/auth";

test.setTimeout(30_000);

const PANEL = '[data-testid="skill-panel"]';

const OFFICIAL_FIXTURES = [
  {
    id: "skill_storyboard",
    name: "分镜大师",
    description: "影视分镜创作助手。",
  },
  {
    id: "skill_marketing",
    name: "营销文案",
    description: "营销文案生成助手。",
  },
];
const PERSONAL_FIXTURE = {
  id: "my_personal_skill",
  name: "我的个人技能",
  description: "个人创建的私有技能。",
};

type MockOpts = {
  /** 面板打开前已添加引用的官方技能 id */
  preAdded?: string[];
  /** add 命中该 id 时返回 100103 同名冲突 */
  conflictId?: string;
};

function result(data: unknown): string {
  return JSON.stringify({ code: 200, msg: "", success: true, data });
}

function fulfillJson(route: Route, body: string, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body });
}

/** library 记录（契约 §3 白名单字段，snake_case wire） */
function libraryRecord(id: string, added: boolean) {
  const f = OFFICIAL_FIXTURES.find((x) => x.id === id)!;
  return {
    creative_skill_id: f.id,
    name: f.name,
    description: f.description,
    cover_url: null,
    source: "official",
    asset_domain: "official",
    added,
    category: "film",
    usage_count: 10,
  };
}

/** mine 记录：官方引用行（含 auto）与个人技能行 */
function mineOfficialRecord(id: string) {
  const f = OFFICIAL_FIXTURES.find((x) => x.id === id)!;
  return {
    creative_skill_id: f.id,
    auto: false,
    name: f.name,
    description: f.description,
    cover_url: null,
    source: "official",
    asset_domain: "official",
  };
}

function minePersonalRecord() {
  return {
    creative_skill_id: PERSONAL_FIXTURE.id,
    auto: false,
    name: PERSONAL_FIXTURE.name,
    description: PERSONAL_FIXTURE.description,
    cover_url: null,
    source: null,
    asset_domain: "personal",
  };
}

/**
 * 拦截 skills 全部接口；added 集合在 add/remove 后联动 library/mine 响应。
 * 返回 add/remove 的调用记录供断言。
 */
async function mockSkillsApi(page: Page, opts: MockOpts = {}) {
  const added = new Set(opts.preAdded ?? []);
  const calls: { add: string[]; remove: string[] } = { add: [], remove: [] };

  await page.route("**/api/agent/skills/library", (route) => {
    const body = route.request().postDataJSON() as {
      pageNum?: number;
      pageSize?: number;
    };
    const records = OFFICIAL_FIXTURES.map((f) =>
      libraryRecord(f.id, added.has(f.id)),
    );
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

  await page.route("**/api/agent/skills/mine", (route) => {
    const body = route.request().postDataJSON() as {
      pageNum?: number;
      pageSize?: number;
    };
    const records = [
      ...OFFICIAL_FIXTURES.filter((f) => added.has(f.id)).map((f) =>
        mineOfficialRecord(f.id),
      ),
      minePersonalRecord(),
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

  await page.route("**/api/agent/skills/library/*/add", (route) => {
    const url = route.request().url();
    const id = url.split("/library/")[1].split("/add")[0];
    calls.add.push(id);
    if (opts.conflictId && id === opts.conflictId) {
      return fulfillJson(
        route,
        JSON.stringify({
          code: 100103,
          msg: `官方技能与你的个人技能「${PERSONAL_FIXTURE.name}」同名，无法添加；你仍可直接使用`,
          success: false,
          data: null,
        }),
      );
    }
    added.add(id);
    return fulfillJson(route, result(null));
  });

  await page.route("**/api/agent/skills/mine/*", (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    const url = route.request().url();
    const id = url.split("/mine/")[1].split("?")[0];
    calls.remove.push(id);
    added.delete(id);
    return fulfillJson(route, result(null));
  });

  return calls;
}

/** 启动链路公共 mock：登录态 + 技能接口 + 截断外部静态资源。 */
async function bootstrap(page: Page, opts: MockOpts = {}) {
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
  const calls = await mockSkillsApi(page, opts);
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

/** 打开面板：首页 composer「Skill」按钮 → 面板可见且默认技能库页签。 */
async function openPanel(page: Page) {
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  const panel = page.locator(PANEL);
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("skill-tab-library")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  return panel;
}

test("添加：成功停留技能库，按钮变不可点击「已添加」并显示成功提示", async ({
  page,
}) => {
  const calls = await bootstrap(page);
  await openPanel(page);
  await expect(page.getByTestId("skill-library-card")).toHaveCount(2);

  const addBtn = page
    .getByTestId("skill-library-card")
    .first()
    .getByTestId("skill-library-add-btn");
  await expect(addBtn).toHaveText("添加");
  await addBtn.click();

  // 成功提示 + 停留技能库页签
  await expect(page.getByText("技能已添加")).toBeVisible();
  await expect(page.getByTestId("skill-tab-library")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // 按钮变「已添加」且不可点击
  await expect(addBtn).toHaveText("已添加");
  await expect(addBtn).toBeDisabled();
  expect(calls.add).toEqual(["skill_storyboard"]);
});

test("我的技能：官方引用 ∪ 个人技能统一显示，@官方/@个人 标记，两域菜单项不同", async ({
  page,
}) => {
  await bootstrap(page, { preAdded: ["skill_storyboard"] });
  await openPanel(page);

  await page.getByTestId("skill-tab-my").click();
  await expect(page.getByTestId("skill-my-row")).toHaveCount(2);

  // 来源标记
  await expect(page.getByText("@官方")).toBeVisible();
  await expect(page.getByText("@个人")).toBeVisible();

  // 官方引用行菜单仅「移出我的技能」；个人行菜单为「查看技能/删除技能」（IK60WZ）
  const officialRow = page
    .getByTestId("skill-my-row")
    .filter({ hasText: "分镜大师" });
  const personalRow = page
    .getByTestId("skill-my-row")
    .filter({ hasText: "我的个人技能" });

  await officialRow.getByTestId("skill-my-row-menu").click();
  const officialMenu = page.locator('[role="menu"]');
  await expect(officialMenu.getByRole("menuitem")).toHaveCount(1);
  await expect(officialMenu.getByTestId("skill-my-row-remove")).toBeVisible();
  await page.keyboard.press("Escape");

  await personalRow.getByTestId("skill-my-row-menu").click();
  const personalMenu = page.locator('[role="menu"]');
  await expect(personalMenu.getByRole("menuitem")).toHaveCount(2);
  await expect(personalMenu.getByTestId("skill-my-row-view")).toHaveText(
    "查看技能",
  );
  await expect(personalMenu.getByTestId("skill-my-row-delete")).toHaveText(
    "删除技能",
  );
});

test("移除：菜单仅「移出我的技能」，立即生效并提示；技能库可再次添加", async ({
  page,
}) => {
  const calls = await bootstrap(page, { preAdded: ["skill_storyboard"] });
  await openPanel(page);

  await page.getByTestId("skill-tab-my").click();
  const officialRow = page
    .getByTestId("skill-my-row")
    .filter({ hasText: "分镜大师" });

  // 菜单只有一项「移出我的技能」
  await officialRow.getByTestId("skill-my-row-menu").click();
  const menu = page.locator('[role="menu"]');
  await expect(menu.getByRole("menuitem")).toHaveCount(1);
  await expect(menu.getByTestId("skill-my-row-remove")).toHaveText(
    "移出我的技能",
  );

  // 点击移除：行立即消失（无确认）+ 成功提示
  await menu.getByTestId("skill-my-row-remove").click();
  await expect(officialRow).toHaveCount(0);
  await expect(page.getByText("已从我的技能移出")).toBeVisible();
  await expect(page.getByTestId("skill-my-row")).toHaveCount(1); // 仅剩个人技能
  expect(calls.remove).toEqual(["skill_storyboard"]);

  // 切回技能库：该卡片回到「添加」，可再次添加（官方技能仍留在库里）
  await page.getByTestId("skill-tab-library").click();
  const card = page
    .getByTestId("skill-library-card")
    .filter({ hasText: "分镜大师" });
  const addBtn = card.getByTestId("skill-library-add-btn");
  await expect(addBtn).toHaveText("添加");
  await expect(addBtn).toBeEnabled();

  await addBtn.click();
  await expect(page.getByText("技能已添加")).toBeVisible();
  await expect(addBtn).toHaveText("已添加");
  await expect(addBtn).toBeDisabled();
  expect(calls.add).toEqual(["skill_storyboard"]);
});

test("同名冲突：添加被拒并解释，按钮回滚，直接使用不受影响", async ({
  page,
}) => {
  const calls = await bootstrap(page, { conflictId: "skill_storyboard" });
  await openPanel(page);

  const card = page
    .getByTestId("skill-library-card")
    .filter({ hasText: "分镜大师" });
  const addBtn = card.getByTestId("skill-library-add-btn");
  await addBtn.click();

  // 服务端冲突解释展示（100103），按钮回滚为可点击「添加」
  await expect(
    page.getByText(/与你的个人技能「我的个人技能」同名，无法添加/),
  ).toBeVisible();
  await expect(addBtn).toHaveText("添加");
  await expect(addBtn).toBeEnabled();
  expect(calls.add).toEqual(["skill_storyboard"]);

  // 直接使用不受影响：按钮存在且可点击
  const useBtn = card.getByRole("button", { name: /直接使用/ });
  await expect(useBtn).toBeEnabled();
});
