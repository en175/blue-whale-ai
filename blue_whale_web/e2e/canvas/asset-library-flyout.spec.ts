/**
 * asset-library-flyout.spec.ts —— IK55VS：资产库悬浮列表 + 空卡新建冒烟；
 * IK5JMN 对齐 IK55VX（卡片库选择器）交付后的真实现状。
 *
 * route-intercept 模式（模板参照 audio-dock.spec.ts），锁定验收：
 *  1. 资产库按钮展开悬浮列表六项：首项「共享资产」可用，点击打开卡片库选择器
 *    （导入=复制快照、编辑不回写库由 IK55VX 票覆盖，本票只锁定入口可达）；
 *    再点按钮/Esc 关闭；
 *  2. 点五类卡项 → 画布新增对应类型空卡（头部 @+名称、从画布拖入、占位文案）；
 *     商品卡入口由独立的「商品卡」按钮悬浮列表承载，本票不再覆盖；
 *  3. 多次新建落点不重叠（网格错开）；角色卡显示「设置角色音色」区。
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { seedAuth } from "../_fixtures/auth";

// prod build + start；页面交互快，30s 兜底
test.setTimeout(30_000);

const FLYOUT = '[role="menu"][aria-label="资产库"]';
const REF_NODE = ".tc-reference-node";

function result(data: unknown): string {
  return JSON.stringify({ code: 200, msg: "", success: true, data });
}

function fulfillJson(route: Route, body: string, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body });
}

/** 启动链路公共 mock（与 audio-dock.spec.ts 同模板）。 */
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

const assetButton = (page: Page) =>
  page.getByRole("button", { name: "资产库", exact: true });

test("悬浮列表：六项完整、共享资产打开卡片库选择器、再点/Esc 关闭", async ({
  page,
}) => {
  await bootstrap(page);
  await page.goto("/canvas");

  await assetButton(page).click();
  await expect(page.locator(FLYOUT)).toBeVisible();
  const items = page.locator(`${FLYOUT} [role="menuitem"]`);
  await expect(items).toHaveCount(6);
  // 首项「共享资产」可用（IK55VX：打开卡片库选择器）
  await expect(items.first()).toHaveText("共享资产");
  const sharedItem = page.getByRole("menuitem", {
    name: "共享资产",
    exact: true,
  });
  await expect(sharedItem).toBeEnabled();
  for (const name of ["风格卡", "角色卡", "物体卡", "环境卡", "自定义卡"]) {
    await expect(
      page.getByRole("menuitem", { name, exact: true }),
    ).toBeVisible();
  }

  // 点「共享资产」→ 关闭悬浮列表并打开卡片库选择器（导入行为属 IK55VX 票，本票只锁入口可达）
  await sharedItem.click();
  await expect(page.locator(FLYOUT)).toBeHidden();
  const picker = page.getByRole("dialog", { name: "共享资产" });
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();

  // 再点按钮关闭
  await assetButton(page).click();
  await expect(page.locator(FLYOUT)).toBeVisible();
  await assetButton(page).click();
  await expect(page.locator(FLYOUT)).toBeHidden();

  // Esc 关闭
  await assetButton(page).click();
  await expect(page.locator(FLYOUT)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(FLYOUT)).toBeHidden();
});

test("点五类卡项新增对应空卡：形态齐全、落点不重叠、角色卡带音色区", async ({
  page,
}) => {
  await bootstrap(page);
  await page.goto("/canvas");

  const spawn = async (itemName: string) => {
    await assetButton(page).click();
    await page.getByRole("menuitem", { name: itemName, exact: true }).click();
    await expect(page.locator(FLYOUT)).toBeHidden();
  };

  // 风格卡：头部英文名 + 空态元素
  await spawn("风格卡");
  const styleCard = page.locator(REF_NODE).first();
  await expect(styleCard).toBeVisible();
  await expect(styleCard.getByText("Style")).toBeVisible();
  await expect(styleCard.getByText("从画布拖入")).toBeVisible();
  await expect(
    styleCard.getByText("描述视觉风格、配色与艺术方向…"),
  ).toBeVisible();
  await expect(styleCard.getByText(/1 张参考图/)).toBeVisible();
  // 回归(RF measured 回读塌缩环):空卡渲染高度≈默认卡高 242,不得塌缩成一条线
  // (可见性断言拦不住——文本在 overflow-hidden 的 2px 高卡片内仍算 visible)
  const styleBox = await styleCard.boundingBox();
  expect(styleBox).not.toBeNull();
  expect(styleBox!.height).toBeGreaterThan(200);

  // 角色卡：第二张卡、落点与第一张不重叠、带音色区
  await spawn("角色卡");
  await expect(page.locator(REF_NODE)).toHaveCount(2);
  const charCard = page.locator(REF_NODE).nth(1);
  await expect(charCard.getByText("Character")).toBeVisible();
  await expect(charCard.getByText("设置角色音色")).toBeVisible();
  const box1 = await styleCard.boundingBox();
  const box2 = await charCard.boundingBox();
  expect(box1).not.toBeNull();
  expect(box2).not.toBeNull();
  // 同塌缩回归:角色卡(默认 316+音色区)也不得渲染成一条线
  expect(box2!.height).toBeGreaterThan(200);
  const overlap =
    box1!.x < box2!.x + box2!.width &&
    box2!.x < box1!.x + box1!.width &&
    box1!.y < box2!.y + box2!.height &&
    box2!.y < box1!.y + box1!.height;
  expect(overlap).toBe(false);

  // 其余三类各落一张
  await spawn("物体卡");
  await spawn("环境卡");
  await spawn("自定义卡");
  await expect(page.locator(REF_NODE)).toHaveCount(5);
  await expect(page.locator(REF_NODE).nth(2).getByText("Object")).toBeVisible();
  await expect(
    page.locator(REF_NODE).nth(3).getByText("Environment"),
  ).toBeVisible();
  await expect(page.locator(REF_NODE).nth(4).getByText("Custom")).toBeVisible();
});
