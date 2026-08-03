/**
 * skill-panel-library.spec.ts —— IK60WT：Skill 面板三页签 + 官方技能库浏览体验验收。
 *
 * route-intercept 模式（模板参照 canvas/left-toolbar.spec.ts）：seedAuth 注入登录态，
 * 首页 composer「Skill」按钮（aria-label="Skills"）开面板；技能库接口
 * POST /api/agent/skills/library 用可控 fixture 拦截并记录请求体（keyword/category/sort/pageNum）。
 *
 * 锁定验收：
 *  1. 默认技能库页签、三页签切换、创建技能占位空态；
 *  2. 同次打开切页签保留查询与滚动状态，关闭重开重置回默认；
 *  3. 分类/搜索（按钮+Enter）/排序三档触发带对应参数的请求；滚动到底 pageNum+1；
 *  4. 卡片：@Blue Whale、使用人数、简介悬停 tooltip、无链接不导航、无省略号菜单；
 *  5. 弹窗：背景滚动锁定、焦点陷阱、ESC/遮罩按压/关闭按钮三路径、焦点恢复触发按钮；
 *  6. 响应式：3/2/1 列、无横向滚动、面板四边 32px 间距。
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { seedAuth } from "../_fixtures/auth";

// prod build + start；页面交互快，30s 兜底（无限滚动用例渲染 60 卡片同样足够）
test.setTimeout(30_000);

const PANEL = '[data-testid="skill-panel"]';
const STORE_GRID = ".tc-agent-skill-panel__store-grid";
const STORE_SCROLL = ".tc-agent-skill-panel__store-scroll";
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type LibraryRequest = {
  pageNum?: number;
  pageSize?: number;
  keyword?: string;
  category?: string;
  sort?: string;
  lang?: string;
};

function result(data: unknown): string {
  return JSON.stringify({ code: 200, msg: "", success: true, data });
}

function fulfillJson(route: Route, body: string, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body });
}

/** 技能库记录（契约 §3 白名单字段，snake_case wire） */
function libraryItem(i: number, overrides: Record<string, unknown> = {}) {
  return {
    creative_skill_id: `skill-${i}`,
    name: `技能 ${i}`,
    description: `技能 ${i} 的简介：用于验证悬停提示与卡片信息展示。`,
    cover_url: null,
    source: "official",
    asset_domain: "official",
    added: false,
    category: "film",
    usage_count: 100 + i,
    ...overrides,
  };
}

/**
 * 拦截 library/mine 接口。library 返回两页可控数据（total 默认 3 单页）；
 * 带 keyword 时返回 1 条确定性匹配，便于搜索状态断言。返回捕获的请求体列表。
 */
async function mockSkillsApi(
  page: Page,
  opts: { total?: number } = {},
): Promise<LibraryRequest[]> {
  const total = opts.total ?? 3;
  const requests: LibraryRequest[] = [];

  await page.route("**/api/agent/skills/library", (route) => {
    const body = route.request().postDataJSON() as LibraryRequest;
    requests.push(body);
    const pageNum = body.pageNum ?? 1;
    const pageSize = body.pageSize ?? 50;
    if (body.keyword) {
      return fulfillJson(
        route,
        result({
          records: [libraryItem(1, { name: `匹配「${body.keyword}」的技能` })],
          total: 1,
          current: pageNum,
          size: pageSize,
        }),
      );
    }
    const start = (pageNum - 1) * pageSize;
    const count = Math.max(0, Math.min(pageSize, total - start));
    const records = Array.from({ length: count }, (_, k) =>
      libraryItem(start + k + 1),
    );
    return fulfillJson(
      route,
      result({ records, total, current: pageNum, size: pageSize }),
    );
  });

  await page.route("**/api/agent/skills/mine", (route) =>
    fulfillJson(route, result({ records: [], total: 0, current: 1, size: 50 })),
  );

  return requests;
}

/** 启动链路公共 mock：登录态 + 技能接口 + 截断外部静态资源（防 load 事件被远程图拖慢）。 */
async function bootstrap(page: Page, opts: { total?: number } = {}) {
  await seedAuth(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("bw-access-token", "e2e-access-token");
    window.localStorage.setItem("bw-refresh-token", "e2e-refresh-token");
  });
  // 先注册兜底（Playwright 路由后注册者优先，具体 API 路由在其后注册）
  await page.route("**/*", (route) => {
    const url = route.request().url();
    return url.startsWith("http://localhost") || url.startsWith("data:")
      ? route.fallback()
      : route.abort();
  });
  const requests = await mockSkillsApi(page, opts);
  // 首页其余真实请求（模板/积分）：假 token 走真服务器会 401 → apiFetch 弹登录框
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

/** 打开面板：首页 composer「Skill」按钮 → 面板可见且默认技能库页签。 */
async function openPanel(page: Page) {
  const trigger = page.getByRole("button", { name: "Skills", exact: true });
  await trigger.click();
  const panel = page.locator(PANEL);
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("skill-tab-library")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  return { trigger, panel };
}

test("页签：默认技能库、三页签切换、创建技能占位空态", async ({ page }) => {
  const requests = await bootstrap(page);
  await openPanel(page);

  // 打开即请求技能库首页（默认 category=all / sort=featured）
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({
    pageNum: 1,
    category: "all",
    sort: "featured",
  });
  await expect(page.getByTestId("skill-library-card")).toHaveCount(3);

  // 我的技能：空态文案
  await page.getByTestId("skill-tab-my").click();
  await expect(page.getByTestId("skill-tab-my")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("还没有添加技能，去技能库逛逛。")).toBeVisible();

  // 创建技能：占位空态
  await page.getByTestId("skill-tab-create").click();
  await expect(page.getByTestId("skill-create-placeholder")).toBeVisible();
  await expect(page.getByText("即将上线，敬请期待。")).toBeVisible();
});

test("查询状态：同次打开切页签保留搜索，关闭重开重置回默认", async ({
  page,
}) => {
  const requests = await bootstrap(page);
  await openPanel(page);
  await expect.poll(() => requests.length).toBe(1);

  // 搜索「分镜」→ 1 条匹配
  await page.getByTestId("skill-search-input").fill("分镜");
  await page.getByTestId("skill-search-submit").click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].keyword).toBe("分镜");
  await expect(page.getByTestId("skill-library-card")).toHaveCount(1);

  // 切到我的技能再切回：搜索词/结果保留，且不重发 library 请求
  await page.getByTestId("skill-tab-my").click();
  await page.getByTestId("skill-tab-library").click();
  await expect(page.getByTestId("skill-search-input")).toHaveValue("分镜");
  await expect(page.getByTestId("skill-library-card")).toHaveCount(1);
  expect(requests.length).toBe(2);

  // 关闭重开：回到默认技能库、查询重置、重发默认请求
  await page.keyboard.press("Escape");
  await expect(page.locator(PANEL)).toBeHidden();
  await openPanel(page);
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[2]).toMatchObject({
    pageNum: 1,
    category: "all",
    sort: "featured",
  });
  await expect(page.getByTestId("skill-search-input")).toHaveValue("");
  await expect(page.getByTestId("skill-library-card")).toHaveCount(3);
});

test("查询参数：分类/搜索(按钮+Enter)/排序三档触发带对应参数的请求", async ({
  page,
}) => {
  const requests = await bootstrap(page);
  await openPanel(page);
  await expect.poll(() => requests.length).toBe(1);

  // 分类 chip → 带 category 的请求
  await page.getByTestId("skill-category-chip-film").click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toMatchObject({ category: "film", pageNum: 1 });
  await expect(page.getByTestId("skill-category-chip-film")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // 搜索按钮 → 带 keyword 的请求
  await page.getByTestId("skill-search-input").fill("预告片");
  await page.getByTestId("skill-search-submit").click();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[2]).toMatchObject({ keyword: "预告片", category: "film" });

  // Enter 提交 → 同样触发带 keyword 的请求
  await page.getByTestId("skill-search-input").fill("科幻");
  await page.getByTestId("skill-search-input").press("Enter");
  await expect.poll(() => requests.length).toBe(4);
  expect(requests[3].keyword).toBe("科幻");

  // 排序三档：most_used → newest → featured 各触发一次带 sort 的请求
  for (const sort of ["most_used", "newest", "featured"] as const) {
    const before = requests.length;
    await page.getByTestId("skill-sort-trigger").click();
    await page.getByTestId(`skill-sort-option-${sort}`).click();
    await expect.poll(() => requests.length).toBe(before + 1);
    expect(requests[requests.length - 1].sort).toBe(sort);
  }
});

test("无限滚动：滚到底部触发 pageNum+1 加载（两页 fixture）", async ({
  page,
}) => {
  // PAGE_SIZE=50：total=60 → 第一页 50 条、hasMore；滚到底拉第二页 10 条
  const requests = await bootstrap(page, { total: 60 });
  await openPanel(page);
  await expect.poll(() => requests.length).toBe(1);
  await expect(page.getByTestId("skill-library-card")).toHaveCount(50);

  await page
    .locator(STORE_SCROLL)
    .evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await expect.poll(() => requests.map((r) => r.pageNum)).toContain(2);
  await expect(page.getByTestId("skill-library-card")).toHaveCount(60);
  await expect(page.getByText("没有更多了")).toBeVisible();
});

test("滚动状态：同次打开切页签保留滚动位置，关闭重开重置", async ({ page }) => {
  await bootstrap(page, { total: 60 });
  await openPanel(page);
  await expect(page.getByTestId("skill-library-card")).toHaveCount(50);

  const scroll = page.locator(STORE_SCROLL);
  await scroll.evaluate((el) => el.scrollTo({ top: 600 }));
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBe(600);

  // 切到我的技能再切回：滚动位置保留（页签保持挂载 hidden）
  await page.getByTestId("skill-tab-my").click();
  await page.getByTestId("skill-tab-library").click();
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBe(600);

  // 关闭重开：整棵卸载重挂，滚动位置重置
  await page.keyboard.press("Escape");
  await expect(page.locator(PANEL)).toBeHidden();
  await openPanel(page);
  await expect(page.getByTestId("skill-library-card")).toHaveCount(50);
  await expect
    .poll(() => page.locator(STORE_SCROLL).evaluate((el) => el.scrollTop))
    .toBe(0);
});

test("卡片：作者/使用人数/简介 tooltip/无链接不导航/无省略号菜单", async ({
  page,
}) => {
  await bootstrap(page);
  await openPanel(page);
  const card = page.getByTestId("skill-library-card").first();
  await expect(card).toBeVisible();

  // 作者 + 使用人数
  await expect(card.getByText("@Blue Whale")).toBeVisible();
  await expect(card.getByTestId("skill-usage-count")).toHaveText(
    /^\d+ 人使用$/,
  );

  // 简介悬停提示：data-tooltip + data-tooltip-multiline（CSS ::before 实现）
  const desc = card.locator(".tc-agent-skill-row__desc");
  await expect(desc).toHaveAttribute("data-tooltip", /技能 1 的简介/);
  await expect(desc).toHaveAttribute("data-tooltip-multiline", "");

  // 卡片本体无链接、点击不导航（封面区域点击），面板保持打开
  await expect(card.locator("a")).toHaveCount(0);
  await card.locator(".tc-agent-skill-card__cover").click();
  await expect(page.locator(PANEL)).toBeVisible();
  expect(page.url()).toBe("http://localhost:3000/");

  // 卡片内无省略号菜单按钮：仅「直接使用」+「添加」两个操作
  await expect(card.locator("button")).toHaveCount(2);
  await expect(card.locator('[aria-label*="更多"]')).toHaveCount(0);
});

test("弹窗：背景滚动锁定 + 面板内滚动容器存在", async ({ page }) => {
  await bootstrap(page, { total: 60 });
  await openPanel(page);

  // 背景滚动锁定
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .toBe("hidden");
  // 面板内滚动容器存在且可滚（60 卡片超出面板高度）
  const scroller = page.locator(STORE_SCROLL);
  await expect(scroller).toBeVisible();
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollHeight > el.clientHeight))
    .toBe(true);

  // 关闭后滚动锁定解除
  await page.keyboard.press("Escape");
  await expect(page.locator(PANEL)).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .toBe("");
});

test("弹窗：焦点陷阱 Tab/Shift+Tab 循环不离开面板", async ({ page }) => {
  await bootstrap(page);
  const { panel } = await openPanel(page);
  await expect(page.getByTestId("skill-library-card")).toHaveCount(3);

  // 初始焦点落在面板容器上
  await expect(panel).toBeFocused();

  const focusableCount = await panel.evaluate(
    (root, selector) =>
      Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
        (n) => n.offsetParent !== null,
      ).length,
    FOCUSABLE_SELECTOR,
  );
  expect(focusableCount).toBeGreaterThan(0);

  // Tab 正向走完整圈 + 1：每次焦点都在面板内（循环回第一个）
  for (let i = 0; i < focusableCount + 1; i++) {
    await page.keyboard.press("Tab");
    const inside = await panel.evaluate((root) =>
      root.contains(document.activeElement),
    );
    expect(inside).toBe(true);
  }

  // Shift+Tab 从第一个元素反向循环到最后一个，仍在面板内
  await page.keyboard.press("Shift+Tab");
  const lastFocused = await panel.evaluate((root, selector) => {
    const nodes = Array.from(
      root.querySelectorAll<HTMLElement>(selector),
    ).filter((n) => n.offsetParent !== null);
    return document.activeElement === nodes[nodes.length - 1];
  }, FOCUSABLE_SELECTOR);
  expect(lastFocused).toBe(true);
});

test("弹窗：ESC/遮罩按压/关闭按钮三条关闭路径 + 焦点恢复触发按钮", async ({
  page,
}) => {
  await bootstrap(page);
  const trigger = page.getByRole("button", { name: "Skills", exact: true });
  const panel = page.locator(PANEL);

  // 1) ESC 关闭 → 焦点还给触发按钮
  await openPanel(page);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();

  // 2) 遮罩鼠标按下关闭（onMouseDown 范式）→ 焦点恢复
  await openPanel(page);
  await page.mouse.click(8, 8); // 面板四边留 32px，(8,8) 必落在遮罩上
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();

  // 3) 右上关闭按钮 → 焦点恢复
  await openPanel(page);
  await page.getByTestId("skill-panel-close").click();
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("响应式：3/2/1 列、无横向滚动、面板四边约 32px 间距", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await bootstrap(page);
  const { panel } = await openPanel(page);
  await expect(page.getByTestId("skill-library-card")).toHaveCount(3);

  const grid = page.locator(STORE_GRID);
  const columnCount = () =>
    grid.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
    );
  const noHorizontalScroll = () =>
    page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    );
  const assertPanelMargins = async () => {
    // 面板 w/h = 100vw/vh - 64px、flex 居中 → 四边各 32px（200ms 入场动画，poll 等落位）
    await expect
      .poll(async () => (await panel.boundingBox())?.x)
      .toBeCloseTo(32, 0);
    const box = await panel.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(Math.abs(box!.y - 32)).toBeLessThanOrEqual(2);
    expect(
      Math.abs(viewport!.width - (box!.x + box!.width) - 32),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(viewport!.height - (box!.y + box!.height) - 32),
    ).toBeLessThanOrEqual(2);
  };

  // 桌面宽：3 列
  await expect.poll(columnCount).toBe(3);
  expect(await noHorizontalScroll()).toBe(true);
  await assertPanelMargins();

  // 中等：2 列（768–1023）
  await page.setViewportSize({ width: 800, height: 720 });
  await expect.poll(columnCount).toBe(2);
  expect(await noHorizontalScroll()).toBe(true);
  await assertPanelMargins();

  // 窄屏：1 列
  await page.setViewportSize({ width: 500, height: 720 });
  await expect.poll(columnCount).toBe(1);
  // 500px 处不做 document 级横向滚动断言：首页 AgentComposer 工具栏自身在
  // 500px 已有横向溢出（预存问题，与本面板无关，scrollWidth≈589>500）。
  // 此处锁定面板自身不引入横向溢出：面板四边在视口内 + 滚动容器无 x 溢出。
  const scroller = page.locator(STORE_SCROLL);
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollWidth <= el.clientWidth))
    .toBe(true);
  await assertPanelMargins();
});
