/**
 * bottom-dock-keepalive.spec.ts —— IK55VF：Dock 规范行为锁定。
 *
 * route-intercept 模式（模板参照 bottom-dock-reference.spec.ts），锁定四条验收：
 *  1. 工具栏按钮 toggle：点一次开、同模式再点关、异模式切换；
 *  2. 关闭再重开图像 Dock：未提交 prompt 与生成设置原样恢复（keep-alive）；
 *  3. 无遮罩：面板打开时画布可继续交互（滚轮平移视口生效、Dock 不关闭）；
 *  4. 生成中关闭面板：任务继续（不发取消请求）、结果照常落画布。
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { seedAuth } from "../_fixtures/auth";

// prod build + start；页面交互快，30s 兜底
test.setTimeout(30_000);

const IMAGE_DOCK = '[data-canvas-reference-drop-target="image-dock"]';
const VIDEO_DOCK = '[data-canvas-reference-drop-target="video-dock"]';
const ASSET_CONTENT_URL = "/api/projects/42/assets/100/content";
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

/** 启动链路公共 mock：登录态 + 项目列表 + 空 Snapshot + SSE + 模型能力表。 */
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
  // 顶栏 CreditBalance 余额：不 mock 会打真实 BFF 拿 401 → 清登录态弹登录框
  await page.route("**/api/usage/token**", (route) =>
    fulfillJson(route, result({ quota: 1000 })),
  );
  // recover/reconcile 列表默认空（各用例按需覆盖）
  await page.route("**/api/jobs?**", (route) =>
    fulfillJson(route, result({ records: [], total: 0, size: 50, current: 1 })),
  );
}

test("工具栏按钮 toggle：点一次开、同模式再点关、异模式切换", async ({
  page,
}) => {
  await bootstrap(page);
  await page.goto("/canvas");

  const imageButton = page.getByRole("button", { name: "图像生成" });
  const videoButton = page.getByRole("button", { name: "视频生成" });

  // 点一次开
  await imageButton.click();
  await expect(page.locator(IMAGE_DOCK)).toBeVisible();

  // 同模式再点关
  await imageButton.click();
  await expect(page.locator(IMAGE_DOCK)).toBeHidden();

  // 异模式切换：图像 → 视频 → 图像
  await videoButton.click();
  await expect(page.locator(VIDEO_DOCK)).toBeVisible();
  await imageButton.click();
  await expect(page.locator(IMAGE_DOCK)).toBeVisible();
});

test("关闭再重开图像 Dock：未提交 prompt 与生成设置原样恢复", async ({
  page,
}) => {
  await bootstrap(page);
  await page.goto("/canvas");

  await page.getByRole("button", { name: "图像生成" }).click();
  await expect(page.locator(IMAGE_DOCK)).toBeVisible();

  // 输入 prompt + 改生成设置（数量 1x → 2x；比例 → 16:9；联网搜索 → 开）
  await page.locator(`${IMAGE_DOCK} [contenteditable="true"]`).click();
  await page.keyboard.type("蓝鲸跃出海面");
  await page
    .locator(IMAGE_DOCK)
    .getByRole("button", { name: "生成数量" })
    .click();
  await page.getByRole("option", { name: "2x" }).click();
  await expect(
    page.locator(IMAGE_DOCK).getByRole("button", { name: "生成数量" }),
  ).toHaveText("2x");

  await page
    .locator(IMAGE_DOCK)
    .getByRole("button", { name: "图像模型设置" })
    .click();
  await page.getByRole("button", { name: "16:9" }).click();
  await page.getByRole("switch", { name: "联网搜索" }).click();
  await expect(page.getByRole("switch", { name: "联网搜索" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  // 关闭设置浮层
  await page
    .locator(IMAGE_DOCK)
    .getByRole("button", { name: "图像模型设置" })
    .click();
  await expect(
    page.locator(IMAGE_DOCK).getByRole("button", { name: "图像模型设置" }),
  ).toContainText("16:9");

  // 关闭 → 重开
  await page
    .locator(".react-flow__pane")
    .click({ position: { x: 300, y: 100 } });
  await expect(page.locator(IMAGE_DOCK)).toBeHidden();
  await page.getByRole("button", { name: "图像生成" }).click();
  await expect(page.locator(IMAGE_DOCK)).toBeVisible();

  // prompt 与设置原样恢复
  await expect(
    page.locator(`${IMAGE_DOCK} [contenteditable="true"]`),
  ).toHaveText("蓝鲸跃出海面");
  await expect(
    page.locator(IMAGE_DOCK).getByRole("button", { name: "生成数量" }),
  ).toHaveText("2x");
  await expect(
    page.locator(IMAGE_DOCK).getByRole("button", { name: "图像模型设置" }),
  ).toContainText("16:9");
  await page
    .locator(IMAGE_DOCK)
    .getByRole("button", { name: "图像模型设置" })
    .click();
  await expect(page.getByRole("switch", { name: "联网搜索" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("无遮罩：面板打开时画布可继续交互（滚轮平移生效、Dock 不关闭）", async ({
  page,
}) => {
  await bootstrap(page);
  await page.goto("/canvas");

  await page.getByRole("button", { name: "图像生成" }).click();
  await expect(page.locator(IMAGE_DOCK)).toBeVisible();

  const viewport = page.locator(".react-flow__viewport");
  const readTransform = () =>
    viewport.evaluate((el) => (el as HTMLElement).style.transform);
  const before = await readTransform();
  const pane = page.locator(".react-flow__pane");
  await pane.hover();
  await page.mouse.wheel(120, 160);
  await expect.poll(readTransform).not.toBe(before);

  // 画布交互（滚轮平移已生效）未关闭 Dock —— 无遮罩，画布可持续操作
  await expect(page.locator(IMAGE_DOCK)).toBeVisible();
});

test("生成中关闭面板：任务继续（不发取消）且结果照常落画布", async ({
  page,
}) => {
  await bootstrap(page);

  // 生成命令：捕获 payload；轮询：jobDone 置真前 processing、之后 succeeded
  let jobDone = false;
  let cancelCalls = 0;
  await page.route("**/api/projects/42/generation-jobs**", async (route) => {
    const req = route.request();
    if (req.method() === "POST" && !req.url().includes("/cancel")) {
      return fulfillJson(route, result({ generation_job_id: 100, cursor: 11 }));
    }
    if (req.url().includes("/cancel")) {
      cancelCalls += 1;
      return fulfillJson(route, result({}));
    }
    return route.fallback();
  });
  // 轮询走 listJobs（GET /api/jobs?ids=100）：jobDone 置真前 processing、之后 succeeded。
  // 后注册的路由优先，覆盖 bootstrap 的空 records 兜底。
  await page.route("**/api/jobs?**", (route) => {
    const url = new URL(route.request().url());
    const ids = (url.searchParams.get("ids") ?? "").split(",");
    if (ids.includes("100")) {
      return fulfillJson(
        route,
        result({
          records: [
            jobDone
              ? {
                  job_id: "100",
                  type: "image",
                  status: "succeeded",
                  progress: 100,
                  input: null,
                  created_at: "2026-07-29T00:00:00Z",
                  output_assets: [
                    {
                      id: "100",
                      url: ASSET_CONTENT_URL,
                      type: "image",
                      width: 1024,
                      height: 1024,
                    },
                  ],
                  error: null,
                }
              : {
                  job_id: "100",
                  type: "image",
                  status: "processing",
                  progress: 40,
                  input: null,
                  created_at: "2026-07-29T00:00:00Z",
                  output_assets: [],
                  error: null,
                },
          ],
          total: 1,
          size: 50,
          current: 1,
        }),
      );
    }
    return fulfillJson(
      route,
      result({ records: [], total: 0, size: 50, current: 1 }),
    );
  });
  await page.route(`**${ASSET_CONTENT_URL}`, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG_1PX }),
  );

  await page.goto("/canvas");
  await page.getByRole("button", { name: "图像生成" }).click();
  await expect(page.locator(IMAGE_DOCK)).toBeVisible();

  // 提交生成
  await page.locator(`${IMAGE_DOCK} [contenteditable="true"]`).click();
  await page.keyboard.type("蓝鲸跃出海面");
  await page
    .locator(`${IMAGE_DOCK} button`)
    .filter({ hasText: /生成/ })
    .click();

  // 生成中关闭面板
  await page
    .locator(".react-flow__pane")
    .click({ position: { x: 300, y: 100 } });
  await expect(page.locator(IMAGE_DOCK)).toBeHidden();

  // 任务完成 → 结果照常落画布（面板保持关闭）
  jobDone = true;
  await expect(
    page.locator('.react-flow__node img[alt="蓝鲸跃出海面"]'),
  ).toHaveAttribute("src", /^blob:/, { timeout: 10_000 });
  await expect(page.locator(IMAGE_DOCK)).toBeHidden();
  expect(cancelCalls, "关闭面板不得取消进行中的生成任务").toBe(0);
});

test("IK5OWS 点击面板外部隐藏，再打开后提示词保留", async ({ page }) => {
  await bootstrap(page);
  await page.goto("/canvas");

  await page.getByRole("button", { name: "图像生成" }).click();
  await expect(page.locator(IMAGE_DOCK)).toBeVisible();

  // 输入提示词
  await page.locator(`${IMAGE_DOCK} [contenteditable="true"]`).click();
  await page.keyboard.type("一只橘猫");

  // 点击画布空白区域（面板外部）→ 面板隐藏
  await page
    .locator(".react-flow__pane")
    .click({ position: { x: 300, y: 100 } });
  await expect(page.locator(IMAGE_DOCK)).toBeHidden();

  // 重新打开面板 → 内容保留
  await page.getByRole("button", { name: "图像生成" }).click();
  await expect(page.locator(IMAGE_DOCK)).toBeVisible();
  await expect(
    page.locator(`${IMAGE_DOCK} [contenteditable="true"]`),
  ).toHaveText("一只橘猫");
});
