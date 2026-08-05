/**
 * bottom-dock-opaque.spec.ts —— Dock 面板背景锁定：完全不透明。
 *
 * 回归来源：用户反馈图像/视频生成面板透底（玻璃拟态 rgba(41,41,41,0.92) + blur(40px)），
 * 要求改为实心底色。锁定 SmoothCorners 背景壳计算样式为 rgb(29,29,29)（--tc-dock-panel-bg）
 * 且无 backdrop-filter。
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { seedAuth } from "../_fixtures/auth";

test.setTimeout(30_000);

const IMAGE_DOCK = '[data-canvas-reference-drop-target="image-dock"]';
const VIDEO_DOCK = '[data-canvas-reference-drop-target="video-dock"]';
const SHELL = '[data-slot="smooth-corners"]';

const IMAGE_MODEL = {
  model_id: "doubao-seedream-5-0-260128",
  provider_id: "volc",
  model_label: "Seedream 5.0",
  icon: null,
  supported_sizes: [{ id: "2k", label: "2K", api_value: "2K" }],
  supported_aspect_ratios: ["1:1"],
  supported_formats: ["png"],
  default_size: "2k",
  default_format: "png",
  default_aspect_ratio: "1:1",
  features: {
    reference_image: true,
    watermark: false,
    quantity_max: 4,
    sequential_image_generation: false,
    stream: false,
    tools: true,
  },
};

function result(data: unknown): string {
  return JSON.stringify({ code: 200, msg: "", success: true, data });
}
function fulfillJson(route: Route, body: string, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body });
}

/** 启动链路公共 mock（对齐 bottom-dock-keepalive.spec.ts）。 */
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
    fulfillJson(route, result([IMAGE_MODEL])),
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

/** 读取 Dock 背景壳计算样式。 */
async function shellStyle(page: Page, dock: string) {
  return page.locator(`${dock} ${SHELL}`).evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      backgroundColor: cs.backgroundColor,
      backdropFilter: cs.backdropFilter,
    };
  });
}

test("图像 Dock 背景壳完全不透明（普通态 + 放大态）", async ({ page }) => {
  await bootstrap(page);
  await page.goto("/canvas");

  await page.getByRole("button", { name: "图像生成" }).click();
  await expect(page.locator(IMAGE_DOCK)).toBeVisible();

  const normal = await shellStyle(page, IMAGE_DOCK);
  expect(normal.backgroundColor).toBe("rgb(29, 29, 29)");
  expect(normal.backdropFilter).toBe("none");

  // 放大态（IK5OWV）：同一背景壳，必须同样不透明
  await page
    .locator(IMAGE_DOCK)
    .getByRole("button", { name: "放大面板" })
    .click();
  await page.waitForTimeout(400);
  const expanded = await shellStyle(page, IMAGE_DOCK);
  expect(expanded.backgroundColor).toBe("rgb(29, 29, 29)");
  expect(expanded.backdropFilter).toBe("none");
});

test("视频 Dock 背景壳完全不透明", async ({ page }) => {
  await bootstrap(page);
  await page.goto("/canvas");

  await page.getByRole("button", { name: "视频生成" }).click();
  await expect(page.locator(VIDEO_DOCK)).toBeVisible();

  const style = await shellStyle(page, VIDEO_DOCK);
  expect(style.backgroundColor).toBe("rgb(29, 29, 29)");
  expect(style.backdropFilter).toBe("none");
});
