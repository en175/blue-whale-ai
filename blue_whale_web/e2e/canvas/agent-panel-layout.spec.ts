/**
 * agent-panel-layout.spec.ts —— Agent 对话浮框布局锁定：
 * 面板从关闭态打开后，背景壳（SmoothCorners）必须覆盖整个面板，composer 必须落在面板内。
 *
 * 回归来源：panelSize 初始值 {468,600} 的 stale state —— 测量/观察 effect 只在挂载时
 * 运行一次，而挂载时 isOpen=false、panelRef 为 null，背景壳永远停在 600px 初始高度。
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { seedAuth } from "../_fixtures/auth";

test.setTimeout(30_000);

function result(data: unknown): string {
  return JSON.stringify({ code: 200, msg: "", success: true, data });
}

function fulfillJson(route: Route, body: string, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body });
}

/** 启动链路公共 mock（对齐 audio-dock.spec.ts）。 */
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

test("从关闭态打开面板：背景壳覆盖整个面板，composer 落在面板内", async ({
  page,
}) => {
  await bootstrap(page);
  await page.goto("/canvas");

  const panel = page.locator('[role="dialog"][aria-label="Canvas Agent 对话"]');
  // 面板默认关闭 —— 这正是触发 stale panelSize 的路径
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: "Canvas Agent" }).click();
  await expect(panel).toBeVisible();

  const metrics = await page.evaluate(() => {
    const panelEl = document.querySelector(
      '[role="dialog"][aria-label="Canvas Agent 对话"]',
    );
    const shell = panelEl?.querySelector('[data-slot="smooth-corners"]');
    const composer = panelEl?.querySelector(".tc-agent-composer-outer");
    const rectOf = (el: Element | null | undefined) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom };
    };
    return {
      viewportH: window.innerHeight,
      panel: rectOf(panelEl),
      shell: rectOf(shell),
      composer: rectOf(composer),
    };
  });

  expect(metrics.panel, "面板应渲染").not.toBeNull();
  expect(metrics.shell, "背景壳应渲染").not.toBeNull();
  expect(metrics.composer, "composer 应渲染").not.toBeNull();

  // 面板底边距视口底 70px（fixed top-[68px] bottom-[70px]）
  expect(
    Math.abs(metrics.viewportH - metrics.panel!.bottom - 70),
    "面板底边应距视口底 70px",
  ).toBeLessThanOrEqual(2);
  // 背景壳底边与面板底边对齐（背景覆盖整个面板，含 composer 区域）
  expect(
    Math.abs(metrics.shell!.bottom - metrics.panel!.bottom),
    "背景壳应覆盖到面板底部",
  ).toBeLessThanOrEqual(2);
  // composer 落在面板内
  expect(
    metrics.composer!.bottom,
    "composer 底部不应超出面板底部",
  ).toBeLessThanOrEqual(metrics.panel!.bottom + 2);
});
