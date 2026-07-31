/**
 * bottom-dock-reference.spec.ts —— IK2BCU：BottomDock 私有参考图鉴权预览与提交。
 *
 * 用户动线全覆盖（route-intercept 模式，参照 e2e/generate/generate-inbox.spec.ts）：
 *  1. 画布已有私有 Asset 图片节点（/api/canvases doc 持久化节点，Snapshot 提供
 *     assets access_url 水合，access_url 受保护）；
 *  2. 打开图片 Dock →「从画布选择」→ 点中节点 → Dock 缩略图经带身份读取展示
 *     （断言内容请求携带 Authorization、缩略图 src 为 blob: 临时资源、
 *     Dock 内不存在以受保护地址为 src 的普通图片请求）；
 *  3. 提交生成 → 捕获 payload：`input_asset_ids` 恰为 UI 当前选中 Asset；
 *  4. 移除参考图 → 缩略图消失 → 再次提交 → `input_asset_ids` 为空，
 *     证明移除后该 Asset 不再进入下一次 GenerationJob。
 *
 * 匿名 401 / 外 Project 拒绝由服务端 IT 兜底（BottomDockGenerationJobIT 等），
 * 本 spec 只验收已登录属主的浏览器行为。
 */
import { expect, test, type Route } from "@playwright/test";
import { seedAuth } from "../_fixtures/auth";

// prod build + start；页面交互快，30s 兜底
test.setTimeout(30_000);

const IMAGE_DOCK = '[data-canvas-reference-drop-target="image-dock"]';
const ASSET_CONTENT_URL = "/api/projects/42/assets/9/content";
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

/** 画布 doc 持久化的私有图片节点（Asset 9，受保护 access_url；老 NodeItem 平铺格式）。 */
const PERSISTED_IMAGE_NODE = {
  id: "node-img-1",
  type: "image",
  position: { x: 120, y: 120 },
  width: 240,
  height: 240,
  content: "蓝鲸参考图",
  assetId: "9",
  imageUrl: ASSET_CONTENT_URL,
};

/** Snapshot：画布节点由 /api/canvases doc 提供，这里只提供 assets（access_url 水合）。 */
function snapshot() {
  return {
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
      nodes: null,
    },
    conversation_messages: [],
    agent_runs: [],
    generation_jobs: [],
    assets: {
      "9": { asset_id: 9, type: "image", access_url: ASSET_CONTENT_URL },
    },
    high_watermark_cursor: 10,
  };
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
    tools: false,
  },
};

test("BottomDock 私有参考图：鉴权预览 → 提交当前选中 Asset → 移除后不再提交", async ({
  page,
}) => {
  await seedAuth(page);
  // canvas 页 online 判定依赖 access token（useCanvasProjects loadAccessToken）
  await page.addInitScript(() => {
    window.localStorage.setItem("bw-access-token", "e2e-access-token");
    window.localStorage.setItem("bw-refresh-token", "e2e-refresh-token");
  });

  // 启动链路：项目列表 → Snapshot → SSE（空流，恢复循环自行重试无害）
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
    fulfillJson(route, result(snapshot())),
  );
  await page.route("**/api/projects/42/events?**", (route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream", body: "" }),
  );
  await page.route("**/api/canvases**", (route) =>
    fulfillJson(
      route,
      result({
        id: 1,
        project_id: 42,
        nodes: JSON.stringify([PERSISTED_IMAGE_NODE]),
        viewport: null,
      }),
    ),
  );
  await page.route("**/api/generation/models?**", (route) =>
    fulfillJson(route, result([IMAGE_MODEL])),
  );

  // AuthContext mount 会用 refresh_token 静默换新：拦截成功刷新，保持登录态（否则 401 会清 tokens）
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

  // 私有 Asset 内容：记录是否带身份，返回 1px PNG
  let contentSawAuthorization = false;
  await page.route(`**${ASSET_CONTENT_URL}`, (route) => {
    if (route.request().headers()["authorization"]) {
      contentSawAuthorization = true;
    }
    return route.fulfill({
      status: 200,
      contentType: "image/png",
      body: PNG_1PX,
    });
  });

  // 生成命令：只捕获 payload，不真正落库
  const capturedPayloads: { input_asset_ids?: unknown[] }[] = [];
  await page.route("**/api/projects/42/generation-jobs**", async (route) => {
    if (route.request().method() === "POST") {
      try {
        capturedPayloads.push(route.request().postDataJSON());
      } catch {
        /* 忽略非 JSON */
      }
      return fulfillJson(route, result({ generation_job_id: 100, cursor: 11 }));
    }
    return route.fallback();
  });

  await page.goto("/canvas");
  // 画布节点经 AuthenticatedImage 加载（鉴权读取出图后才可点）；
  // 节点外层 div 与内层 img 共享 accessible name，用 RF 节点作用域规避 strict-mode 双匹配。
  const canvasNodeImage = page.locator(
    '.react-flow__node img[alt="蓝鲸参考图"]',
  );
  await expect(canvasNodeImage).toHaveAttribute("src", /^blob:/, {
    timeout: 10_000,
  });

  // 打开图片 Dock →「从画布选择」→ 点中节点
  await page.getByRole("button", { name: "图像生成" }).click();
  await expect(page.locator(IMAGE_DOCK)).toBeVisible();
  await page
    .locator(IMAGE_DOCK)
    .getByRole("button", { name: "Upload reference image" })
    .click();
  await page.getByRole("menuitem", { name: "从画布选择" }).click();
  await canvasNodeImage.click();

  // 鉴权预览：Dock 缩略图为 blob: 临时资源，且不存在裸用受保护地址的普通图片请求
  const dockThumb = page
    .locator(IMAGE_DOCK)
    .getByRole("img", { name: "蓝鲸参考图" });
  await expect(dockThumb).toHaveAttribute("src", /^blob:/, { timeout: 10_000 });
  await expect(page.locator(`${IMAGE_DOCK} img[src^="/api/"]`)).toHaveCount(0);
  expect(contentSawAuthorization, "Asset 内容请求必须携带登录身份").toBe(true);

  // 提交生成：input_asset_ids 恰为 UI 当前选中的 Asset 9
  await page.locator(`${IMAGE_DOCK} [contenteditable="true"]`).click();
  await page.keyboard.type("蓝鲸跃出海面");
  await page
    .locator(`${IMAGE_DOCK} button`)
    .filter({ hasText: /生成/ })
    .click();
  await expect.poll(() => capturedPayloads.length).toBe(1);
  expect(capturedPayloads[0].input_asset_ids).toEqual([9]);

  // 移除参考图：缩略图消失，下一次提交不再包含该 Asset
  await page
    .locator(IMAGE_DOCK)
    .getByRole("button", { name: "移除 蓝鲸参考图" })
    .click();
  await expect(dockThumb).toHaveCount(0);
  await page
    .locator(`${IMAGE_DOCK} button`)
    .filter({ hasText: /生成/ })
    .click();
  await expect.poll(() => capturedPayloads.length).toBe(2);
  expect(capturedPayloads[1].input_asset_ids).toEqual([]);
});
