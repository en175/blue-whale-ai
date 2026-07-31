/**
 * audio-dock.spec.ts —— IK55VM：音频悬浮列表 + 双子面板（mock）行为锁定。
 *
 * route-intercept 模式（模板参照 bottom-dock-keepalive.spec.ts），锁定验收：
 *  1. 音频按钮展开悬浮列表（音频生成/AI 音乐）；再点按钮/点外/Esc 关闭；
 *  2. 点选即开 Dock 对应子面板；music 面板字段齐全（曲风/歌词/纯伴奏/数量/模型）；
 *  3. 纯伴奏开启时歌词区禁用；面板内切子模式保留未提交输入；
 *  4. 显式时长/格式控件不存在；生成（mock）→ 音频卡落画布（封面+播放条）。
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { seedAuth } from "../_fixtures/auth";

// prod build + start；页面交互快，30s 兜底
test.setTimeout(30_000);

const AUDIO_DOCK = '[data-canvas-reference-drop-target="audio-dock"]';
const FLYOUT = '[role="menu"][aria-label="音频功能"]';

function result(data: unknown): string {
  return JSON.stringify({ code: 200, msg: "", success: true, data });
}

function fulfillJson(route: Route, body: string, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body });
}

/** 启动链路公共 mock（音频生成是前端 mock，无需生成接口）。 */
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

const audioButton = (page: Page) =>
  page.getByRole("button", { name: "音频生成", exact: true });

test("悬浮列表：点击展开、再点/点外/Esc 关闭、点选开 Dock", async ({
  page,
}) => {
  await bootstrap(page);
  await page.goto("/canvas");

  // 点击展开：两项子功能清单
  await audioButton(page).click();
  await expect(page.locator(FLYOUT)).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "音频生成" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "AI 音乐" })).toBeVisible();

  // 再点按钮关闭
  await audioButton(page).click();
  await expect(page.locator(FLYOUT)).toBeHidden();

  // 点外关闭
  await audioButton(page).click();
  await expect(page.locator(FLYOUT)).toBeVisible();
  await page
    .locator(".react-flow__pane")
    .click({ position: { x: 400, y: 200 } });
  await expect(page.locator(FLYOUT)).toBeHidden();

  // Esc 关闭
  await audioButton(page).click();
  await expect(page.locator(FLYOUT)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(FLYOUT)).toBeHidden();

  // 点选「音频生成」→ Dock audio 子面板
  await audioButton(page).click();
  await page.getByRole("menuitem", { name: "音频生成" }).click();
  await expect(page.locator(FLYOUT)).toBeHidden();
  await expect(page.locator(AUDIO_DOCK)).toBeVisible();
  await expect(
    page.locator(AUDIO_DOCK).getByRole("button", { name: "音频模式" }),
  ).toHaveText("音频生成");
  await expect(
    page.locator(AUDIO_DOCK).getByRole("button", { name: "音频参考（可选）" }),
  ).toBeVisible();
  await expect(
    page.locator(AUDIO_DOCK).getByRole("button", { name: "图片参考（可选）" }),
  ).toBeVisible();
});

test("AI 音乐子面板：字段齐全、纯伴奏禁用歌词、切子模式保留未提交输入、无显式时长/格式", async ({
  page,
}) => {
  await bootstrap(page);
  await page.goto("/canvas");

  await audioButton(page).click();
  await page.getByRole("menuitem", { name: "AI 音乐" }).click();
  await expect(page.locator(AUDIO_DOCK)).toBeVisible();

  // music 字段：曲风/歌词/纯伴奏/数量/music mock 模型
  await expect(
    page.locator(`${AUDIO_DOCK} textarea[aria-label="曲风描述"]`),
  ).toBeVisible();
  await expect(
    page.locator(`${AUDIO_DOCK} textarea[aria-label="歌词"]`),
  ).toBeVisible();
  await expect(
    page.locator(AUDIO_DOCK).getByRole("switch", { name: "纯伴奏" }),
  ).toBeVisible();
  await expect(
    page.locator(AUDIO_DOCK).getByRole("button", { name: "数量" }),
  ).toHaveText("1x");
  await expect(
    page.locator(AUDIO_DOCK).getByRole("button", { name: "音频模型" }),
  ).toHaveText("音乐模型（mock）");

  // 显式时长/格式控件不存在
  for (const name of ["5s", "10s", "30s", "mp3", "wav"]) {
    await expect(
      page.locator(AUDIO_DOCK).getByRole("button", { name, exact: true }),
    ).toHaveCount(0);
  }

  // 填曲风 + 歌词
  await page
    .locator(`${AUDIO_DOCK} textarea[aria-label="曲风描述"]`)
    .fill("lo-fi hiphop");
  await page
    .locator(`${AUDIO_DOCK} textarea[aria-label="歌词"]`)
    .fill("午后的咖啡馆");

  // 纯伴奏开启 → 歌词禁用；关闭 → 恢复
  await page
    .locator(AUDIO_DOCK)
    .getByRole("switch", { name: "纯伴奏" })
    .click();
  await expect(
    page.locator(`${AUDIO_DOCK} textarea[aria-label="歌词"]`),
  ).toBeDisabled();
  await page
    .locator(AUDIO_DOCK)
    .getByRole("switch", { name: "纯伴奏" })
    .click();
  await expect(
    page.locator(`${AUDIO_DOCK} textarea[aria-label="歌词"]`),
  ).toBeEnabled();

  // 面板内切到音频生成（不关闭面板）→ 填 prompt → 切回 AI 音乐：输入保留
  await page
    .locator(AUDIO_DOCK)
    .getByRole("button", { name: "音频模式" })
    .click();
  await page.getByRole("option", { name: "音频生成" }).click();
  await expect(page.locator(AUDIO_DOCK)).toBeVisible();
  await page
    .locator(`${AUDIO_DOCK} textarea[aria-label="音频描述"]`)
    .fill("雨声白噪音");
  await page
    .locator(AUDIO_DOCK)
    .getByRole("button", { name: "音频模式" })
    .click();
  await page.getByRole("option", { name: "AI 音乐" }).click();
  await expect(
    page.locator(`${AUDIO_DOCK} textarea[aria-label="曲风描述"]`),
  ).toHaveValue("lo-fi hiphop");
  await expect(
    page.locator(`${AUDIO_DOCK} textarea[aria-label="歌词"]`),
  ).toHaveValue("午后的咖啡馆");
  await page
    .locator(AUDIO_DOCK)
    .getByRole("button", { name: "音频模式" })
    .click();
  await page.getByRole("option", { name: "音频生成" }).click();
  await expect(
    page.locator(`${AUDIO_DOCK} textarea[aria-label="音频描述"]`),
  ).toHaveValue("雨声白噪音");
});

test("生成（mock）：音频卡落画布（封面+播放条），关板重开输入保留", async ({
  page,
}) => {
  await bootstrap(page);
  await page.goto("/canvas");

  await audioButton(page).click();
  await page.getByRole("menuitem", { name: "音频生成" }).click();
  await expect(page.locator(AUDIO_DOCK)).toBeVisible();

  // 空 prompt 禁用生成
  const generateBtn = page
    .locator(AUDIO_DOCK)
    .getByRole("button", { name: /生成/ })
    .last();
  await expect(generateBtn).toBeDisabled();

  await page
    .locator(`${AUDIO_DOCK} textarea[aria-label="音频描述"]`)
    .fill("森林清晨环境音");
  await expect(generateBtn).toBeEnabled();
  await generateBtn.click();

  // mock 1.5s 后音频卡落画布（封面+播放条；节点带 prompt 标签）
  await expect(page.getByTestId("node-audio-player")).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    page.getByTestId("node-audio-player").getByRole("button", { name: "播放" }),
  ).toBeVisible();

  // 关板 → 悬浮列表重开同子面板：未提交输入保留（keep-alive + 提升态）
  await page.locator(AUDIO_DOCK).getByRole("button", { name: "Close" }).click();
  await expect(page.locator(AUDIO_DOCK)).toBeHidden();
  await audioButton(page).click();
  await page.getByRole("menuitem", { name: "音频生成" }).click();
  await expect(page.locator(AUDIO_DOCK)).toBeVisible();
  await expect(
    page.locator(`${AUDIO_DOCK} textarea[aria-label="音频描述"]`),
  ).toHaveValue("森林清晨环境音");
});
