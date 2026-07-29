/**
 * video-dock-frames-progress.spec.ts —— IK55VL：视频面板首尾帧槽与关板进度上卡。
 *
 * route-intercept 模式（模板参照 bottom-dock-keepalive.spec.ts），锁定三条验收：
 *  1. 首尾帧槽：切 first-last 渲染槽 UI，本地上传入槽（presign→PUT→complete）；
 *     关闭再重开 Dock，prompt/refMode/首尾帧预览原样保留（沿用 IK55VF keep-alive）；
 *  2. 生成中关板：任务继续（不发取消）、进度呈现在画布视频卡（处理中 X%）、结果照常落画布；
 *  3. 画布视频卡取消入口：点击「取消生成」发 cancel，轮询 cancelled 后卡片转「视频生成已取消」。
 *
 * 评审决议（IK55VL 原型评审）：面板内不再保留 videoJobStatus 状态条，
 * 取消入口落在画布视频卡生成中态上（hover 显示）。
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { seedAuth } from "../_fixtures/auth";

test.setTimeout(30_000);

const VIDEO_DOCK = '[data-canvas-reference-drop-target="video-dock"]';
const VIDEO_CONTENT_URL = "/api/projects/42/assets/200/content";
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function result(data: unknown): string {
  return JSON.stringify({ code: 200, msg: "", success: true, data });
}

function fulfillJson(route: Route, body: string, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body });
}

/** 启动链路公共 mock（与 bottom-dock-keepalive 同源，视频面板模型走前端常量表不需能力接口）。 */
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

/** 首尾帧本地上传三步流 mock：presign → PUT(TOS 直连)→ complete。 */
async function mockFrameUpload(page: Page) {
  await page.route("**/api/agent/assets/uploads/presign", (route) =>
    fulfillJson(
      route,
      result({
        storage_key: "uploads/42/image/frame-1.png",
        upload_url: "https://tos.test/upload/frame-1",
        headers: {},
      }),
    ),
  );
  await page.route("https://tos.test/**", (route) => {
    if (route.request().method() === "PUT") {
      return route.fulfill({ status: 200, body: "" });
    }
    return route.fulfill({
      status: 200,
      contentType: "image/png",
      body: PNG_1PX,
    });
  });
  await page.route("**/api/agent/assets/uploads/complete", (route) =>
    fulfillJson(
      route,
      result({ asset_id: "301", url: "https://tos.test/first.png" }),
    ),
  );
}

/** 视频生成命令 + 轮询 mock：jobId 200；jobDone 前 processing(40%)，之后 succeeded。 */
async function mockVideoJob(
  page: Page,
  state: { done: boolean; cancelled: boolean; cancelCalls: number },
) {
  await page.route("**/api/projects/42/generation-jobs**", async (route) => {
    const req = route.request();
    if (req.url().includes("/cancel")) {
      state.cancelCalls += 1;
      state.cancelled = true;
      return fulfillJson(route, result({}));
    }
    if (req.method() === "POST") {
      return fulfillJson(route, result({ generation_job_id: 200, cursor: 11 }));
    }
    return route.fallback();
  });
  await page.route("**/api/jobs?**", (route) => {
    const url = new URL(route.request().url());
    const ids = (url.searchParams.get("ids") ?? "").split(",");
    if (ids.includes("200")) {
      const record = state.cancelled
        ? {
            job_id: "200",
            type: "video",
            status: "cancelled",
            progress: 40,
            input: null,
            created_at: "2026-07-29T00:00:00Z",
            output_assets: [],
            error: null,
          }
        : state.done
          ? {
              job_id: "200",
              type: "video",
              status: "succeeded",
              progress: 100,
              input: null,
              created_at: "2026-07-29T00:00:00Z",
              output_assets: [
                {
                  id: "200",
                  url: VIDEO_CONTENT_URL,
                  type: "video",
                  width: 1280,
                  height: 720,
                },
              ],
              error: null,
            }
          : {
              job_id: "200",
              type: "video",
              status: "processing",
              progress: 40,
              input: null,
              created_at: "2026-07-29T00:00:00Z",
              output_assets: [],
              error: null,
            };
      return fulfillJson(
        route,
        result({ records: [record], total: 1, size: 50, current: 1 }),
      );
    }
    return fulfillJson(
      route,
      result({ records: [], total: 0, size: 50, current: 1 }),
    );
  });
  await page.route(`**${VIDEO_CONTENT_URL}`, (route) =>
    route.fulfill({ status: 200, contentType: "video/mp4", body: "" }),
  );
}

/** 打开视频 Dock 并提交一次生成（prompt「蓝鲸跃出海面」）。 */
async function submitVideoGeneration(page: Page) {
  await page.getByRole("button", { name: "AI 视频" }).click();
  await expect(page.locator(VIDEO_DOCK)).toBeVisible();
  await page.locator(`${VIDEO_DOCK} [contenteditable="true"]`).click();
  await page.keyboard.type("蓝鲸跃出海面");
  await page
    .locator(`${VIDEO_DOCK} button`)
    .filter({ hasText: /生成/ })
    .click();
}

test("首尾帧槽：入槽可用，关闭再重开 Dock 输入与首尾帧原样保留", async ({
  page,
}) => {
  await bootstrap(page);
  await mockFrameUpload(page);
  await page.goto("/canvas");

  await page.getByRole("button", { name: "AI 视频" }).click();
  await expect(page.locator(VIDEO_DOCK)).toBeVisible();

  // 切 refMode → 首尾帧，槽 UI 出现
  await page
    .locator(VIDEO_DOCK)
    .getByRole("button", { name: "全能参考" })
    .click();
  await page.getByRole("button", { name: "首尾帧" }).last().click();
  await expect(
    page.locator(VIDEO_DOCK).getByRole("button", { name: "首帧", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(VIDEO_DOCK).getByRole("button", { name: "尾帧", exact: true }),
  ).toBeVisible();

  // prompt + 首帧本地上传入槽
  await page.locator(`${VIDEO_DOCK} [contenteditable="true"]`).click();
  await page.keyboard.type("蓝鲸跃出海面");
  await page
    .locator('input[type="file"][accept*="image/jpeg"]')
    .first()
    .setInputFiles({
      name: "first.png",
      mimeType: "image/png",
      buffer: PNG_1PX,
    });
  await expect(
    page.locator(VIDEO_DOCK).getByRole("img", { name: "首帧" }),
  ).toBeVisible();

  // 关闭 → 重开：prompt / refMode / 首尾帧预览原样保留（keep-alive）
  await page.locator(VIDEO_DOCK).getByRole("button", { name: "Close" }).click();
  await expect(page.locator(VIDEO_DOCK)).toBeHidden();
  await page.getByRole("button", { name: "AI 视频" }).click();
  await expect(page.locator(VIDEO_DOCK)).toBeVisible();

  await expect(
    page.locator(`${VIDEO_DOCK} [contenteditable="true"]`),
  ).toHaveText("蓝鲸跃出海面");
  await expect(
    page.locator(VIDEO_DOCK).getByRole("button", { name: "首帧", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(VIDEO_DOCK).getByRole("img", { name: "首帧" }),
  ).toBeVisible();
});

test("生成中关板：任务继续（不发取消）、进度上画布视频卡、结果照常落画布", async ({
  page,
}) => {
  await bootstrap(page);
  const state = { done: false, cancelled: false, cancelCalls: 0 };
  await mockVideoJob(page, state);
  await page.goto("/canvas");
  await submitVideoGeneration(page);

  // 生成中关闭面板 → 进度呈现在画布视频卡（处理中 40%）
  await page.locator(VIDEO_DOCK).getByRole("button", { name: "Close" }).click();
  await expect(page.locator(VIDEO_DOCK)).toBeHidden();
  await expect(page.locator(".react-flow__node")).toContainText("处理中 40%", {
    timeout: 10_000,
  });
  expect(state.cancelCalls, "关闭面板不得取消进行中的生成任务").toBe(0);

  // 重开面板：任务权威状态仍呈现在画布视频卡上（评审决议 R1：状态不进面板）
  await page.getByRole("button", { name: "AI 视频" }).click();
  await expect(page.locator(VIDEO_DOCK)).toBeVisible();
  await expect(page.locator(".react-flow__node")).toContainText("处理中 40%");

  // 任务完成 → 结果照常落画布（视频卡出 <video>）
  state.done = true;
  await expect(page.locator(".react-flow__node video")).toHaveCount(1, {
    timeout: 10_000,
  });
});

test("画布视频卡取消入口：点击「取消生成」发 cancel，卡片转已取消", async ({
  page,
}) => {
  await bootstrap(page);
  const state = { done: false, cancelled: false, cancelCalls: 0 };
  await mockVideoJob(page, state);
  await page.goto("/canvas");
  await submitVideoGeneration(page);

  // 卡片进入生成中态 → 点击卡片上的取消入口
  await expect(page.locator(".react-flow__node")).toContainText("处理中", {
    timeout: 10_000,
  });
  await page
    .locator(".react-flow__node")
    .getByRole("button", { name: "取消生成" })
    .click();
  await expect.poll(() => state.cancelCalls).toBe(1);

  // 轮询返回 cancelled → 卡片转「视频生成已取消」
  await expect(page.locator(".react-flow__node")).toContainText(
    "视频生成已取消",
    { timeout: 10_000 },
  );
});
