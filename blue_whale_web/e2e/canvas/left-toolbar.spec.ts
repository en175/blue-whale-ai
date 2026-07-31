/**
 * left-toolbar.spec.ts —— IK56MS：左侧工具栏 8 入口组装与整体验收冒烟。
 *
 * route-intercept 模式（模板参照 asset-library-flyout.spec.ts），锁定验收：
 *  1. 8 个入口完整、顺序固定、规格名可访问名称、两条分隔线（工具｜生成｜库），
 *     截图片号 7/8/9 不渲染；底部按钮完整落在 squircle 外框内（高度不截断）；
 *  2. 8 入口可观察结果：工具模式图标切换无高亮、上传唤起文件选择器、图像/视频 Dock
 *     toggle、音频/资产库/商品卡悬浮列表、文本卡新建、新建商品空卡；
 *  3. 悬浮列表与触发按钮顶对齐、距工具栏外框 6px；展开期间触发按钮保持选中背景；
 *     点画布空白任意位置关闭并还原选中态。
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { seedAuth } from "../_fixtures/auth";

// prod build + start；页面交互快，30s 兜底
test.setTimeout(30_000);

const TOOLBAR = '[data-tour-target="creation-sidebar"]';
const IMAGE_DOCK = '[data-canvas-reference-drop-target="image-dock"]';
const VIDEO_DOCK = '[data-canvas-reference-drop-target="video-dock"]';
const AUDIO_FLYOUT = '[role="menu"][aria-label="音频功能"]';
const ASSET_FLYOUT = '[role="menu"][aria-label="资产库"]';
const PRODUCT_FLYOUT = '[role="menu"][aria-label="商品卡"]';

function result(data: unknown): string {
  return JSON.stringify({ code: 200, msg: "", success: true, data });
}

function fulfillJson(route: Route, body: string, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body });
}

/** 启动链路公共 mock（与 asset-library-flyout.spec.ts 同模板）。 */
async function bootstrap(page: Page) {
  await seedAuth(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("bw-access-token", "e2e-access-token");
    window.localStorage.setItem("bw-refresh-token", "e2e-refresh-token");
  });

  const PROJECT_LIST = [
    { id: 42, name: "画布演示", thumb: null, created_at: "2026-07-19" },
  ];
  await page.route("**/api/projects?**", (route) =>
    fulfillJson(route, result(PROJECT_LIST)),
  );
  await page.route("**/api/projects", (route) => {
    if (route.request().method() === "GET") {
      return fulfillJson(route, result(PROJECT_LIST));
    }
    return route.fallback();
  });
  await page.route("**/api/projects/42/snapshot", (route) =>
    fulfillJson(
      route,
      result({
        project: {
          id: 42,
          name: "画布演示",
          thumb: null,
          created_at: "2026-07-19T08:00:00Z",
        },
        canvas: {
          id: 1,
          project_id: 42,
          viewport: null,
          nodes: JSON.stringify([]),
        },
        conversation_messages: [],
        agent_runs: [],
        generation_jobs: [],
        assets: {},
        high_watermark_cursor: 10,
      }),
    ),
  );
  await page.route("**/api/projects/42/events?**", (route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream", body: "" }),
  );
  await page.route("**/api/canvases**", (route) =>
    fulfillJson(
      route,
      result({ id: 1, project_id: 42, nodes: null, viewport: null }),
    ),
  );
  await page.route("**/api/generation/models?**", (route) =>
    fulfillJson(route, result([])),
  );
  await page.route("**/api/auth/refresh", (route) =>
    fulfillJson(
      route,
      result({
        access_token: "e2e-access-token",
        refresh_token: "e2e-refresh-token",
        expires_in: 3600,
        user_id: 1,
        username: "e2e",
        phone: "13800000000",
        is_new_user: false,
      }),
    ),
  );
  await page.route("**/api/usage/token**", (route) =>
    fulfillJson(route, result({ quota: 1000 })),
  );
  await page.route("**/api/jobs?**", (route) =>
    fulfillJson(route, result({ records: [], total: 0, size: 50, current: 1 })),
  );
}

const toolButton = (page: Page, name: string) =>
  page.locator(TOOLBAR).getByRole("button", { name, exact: true });

test("结构：8 入口顺序+规格名、两条分隔线、底部按钮不被外框截断", async ({
  page,
}) => {
  await bootstrap(page);
  await page.goto("/canvas");

  const buttons = page.locator(`${TOOLBAR} button`);
  await expect(buttons).toHaveCount(8);
  // 可访问名称（aria-label）精确等于规格名（按钮 1 带模式后缀），DOM 顺序即规格顺序
  const labels = await buttons.evaluateAll((els) =>
    els.map((el) => el.getAttribute("aria-label")),
  );
  expect(labels).toEqual([
    "工具模式：鼠标",
    "上传附件",
    "图像生成",
    "视频生成",
    "音频生成",
    "文本编辑卡",
    "资产库",
    "商品卡",
  ]);

  // 两条分隔线（工具｜生成｜库三段）；截图片号 7/8/9 不渲染（按钮总数=8 已锁定）
  await expect(page.locator(`${TOOLBAR} .shrink-0`)).toHaveCount(2);

  // 高度：末按钮完整落在 squircle 外框内（不被截断）
  const asideBox = await page.locator(TOOLBAR).boundingBox();
  const lastBox = await toolButton(page, "商品卡").boundingBox();
  expect(asideBox).not.toBeNull();
  expect(lastBox).not.toBeNull();
  expect(lastBox!.y).toBeGreaterThanOrEqual(asideBox!.y);
  expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(
    asideBox!.y + asideBox!.height + 0.5,
  );
});

test("接线：8 入口各自的可观察结果", async ({ page }) => {
  await bootstrap(page);
  await page.goto("/canvas");

  // 1 工具模式：点击只切图标（aria-label 变抓手），不产生高亮背景
  const selectBtn = toolButton(page, "工具模式：鼠标");
  const classBefore = await selectBtn.getAttribute("class");
  await selectBtn.click();
  const handBtn = toolButton(page, "工具模式：抓手");
  await expect(handBtn).toBeVisible();
  expect(await handBtn.getAttribute("class")).toBe(classBefore);
  await handBtn.click(); // 还原鼠标模式，避免影响后续画布点击语义

  // 2 上传附件：唤起文件选择器
  const chooser = page.waitForEvent("filechooser");
  await toolButton(page, "上传附件").click();
  await chooser;

  // 3 图像生成：Dock toggle（开→关）
  await toolButton(page, "图像生成").click();
  await expect(page.locator(IMAGE_DOCK)).toBeVisible();
  await toolButton(page, "图像生成").click();
  await expect(page.locator(IMAGE_DOCK)).toBeHidden();

  // 4 视频生成：Dock 打开
  await toolButton(page, "视频生成").click();
  await expect(page.locator(VIDEO_DOCK)).toBeVisible();
  await toolButton(page, "视频生成").click();
  await expect(page.locator(VIDEO_DOCK)).toBeHidden();

  // 5 音频生成：悬浮列表两项，再点按钮关闭
  await toolButton(page, "音频生成").click();
  await expect(page.locator(AUDIO_FLYOUT)).toBeVisible();
  await expect(page.locator(`${AUDIO_FLYOUT} [role="menuitem"]`)).toHaveCount(
    2,
  );
  await toolButton(page, "音频生成").click();
  await expect(page.locator(AUDIO_FLYOUT)).toBeHidden();

  // 6 文本编辑卡：画布新增文本卡
  await toolButton(page, "文本编辑卡").click();
  await expect(page.locator(".tc-text-node").first()).toBeVisible();

  // 7 资产库：悬浮列表展开，Esc 关闭
  await toolButton(page, "资产库").click();
  await expect(page.locator(ASSET_FLYOUT)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(ASSET_FLYOUT)).toBeHidden();

  // 8 商品卡：悬浮列表两项；新建商品 → 画布新增空商品卡
  await toolButton(page, "商品卡").click();
  await expect(page.locator(PRODUCT_FLYOUT)).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "新建商品", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "导入商品", exact: true }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "新建商品", exact: true }).click();
  await expect(page.locator(PRODUCT_FLYOUT)).toBeHidden();
  await expect(page.locator(".tc-reference-node").first()).toBeVisible();
});

test("悬浮列表：顶对齐+6px 间距、触发按钮选中态、点空白关闭（IK56MS 反馈 2/3/4/5）", async ({
  page,
}) => {
  await bootstrap(page);
  await page.goto("/canvas");

  // 工具栏有 tc-enter 左滑入场动画（300ms delay + 450ms）：delay 期间元素静止在
  // translateX(-16px)，Playwright 稳定性检查会通过并提前点击，悬浮列表会停在过时位置。
  // aside 是定位壳不随动画移动，必须等动画主体（子 div）落位到 left-4=16px 再点击。
  await expect
    .poll(
      async () => (await page.locator(`${TOOLBAR} > div`).boundingBox())?.x,
      {
        timeout: 5_000,
      },
    )
    .toBeCloseTo(16, 0);

  const audioBtn = toolButton(page, "音频生成");
  await audioBtn.click();
  const flyout = page.locator(AUDIO_FLYOUT);
  await expect(flyout).toBeVisible();

  // 顶对齐：悬浮列表顶边与触发按钮顶边齐平；间距：距工具栏外框 6px
  const btnBox = await audioBtn.boundingBox();
  const flyoutBox = await flyout.boundingBox();
  const asideBox = await page.locator(TOOLBAR).boundingBox();
  expect(btnBox).not.toBeNull();
  expect(flyoutBox).not.toBeNull();
  expect(asideBox).not.toBeNull();
  expect(Math.abs(flyoutBox!.y - btnBox!.y)).toBeLessThanOrEqual(1);
  const gap = flyoutBox!.x - (asideBox!.x + asideBox!.width);
  expect(Math.abs(gap - 6)).toBeLessThanOrEqual(1);

  // 展开期间触发按钮保持选中背景（注意 hover:bg-white/[0.08] 含同名子串，须按独立类名匹配）
  const selectedRe = /(^|\s)bg-white\/\[0\.08\]/;
  expect(await audioBtn.getAttribute("class")).toMatch(selectedRe);

  // 点画布空白任意位置：悬浮列表关闭且选中态还原
  await page.mouse.click(700, 450);
  await expect(flyout).toBeHidden();
  expect(await audioBtn.getAttribute("class")).not.toMatch(selectedRe);
  expect(await audioBtn.getAttribute("class")).toContain("bg-transparent");
});
