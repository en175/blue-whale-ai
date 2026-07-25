/**
 * generate-inbox.spec.ts —— /generate 对话式创作页端到端（IK21O9）。
 *
 * 全部后端流量经 page.route 拦截（route-intercept 模式，参照 e2e/route-fallback/），
 * 不依赖真实后端；Snapshot/SSE 由 fulfill 的 JSON / text/event-stream 模拟。
 *
 * 覆盖：首条消息创建收件箱→对话恢复、新对话切换、删除二次确认、添加到项目。
 */
import { expect, test, type Route } from "@playwright/test";
import { seedAuth } from "../_fixtures/auth";

// prod build + start 已就绪；页面交互本身很快，30s 兜底
test.setTimeout(30_000);

const INBOX = {
  project: {
    id: 42,
    name: "生成收件箱",
    thumb: null,
    created_at: "2026-07-19T08:00:00Z",
    purpose: "generation_inbox",
  },
  active_conversation_id: 7,
};

function result(data: unknown): string {
  return JSON.stringify({ code: 200, msg: "", success: true, data });
}

function fulfillJson(route: Route, body: string, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body,
  });
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    project: {
      id: 42,
      name: "生成收件箱",
      thumb: null,
      created_at: "2026-07-19T08:00:00Z",
    },
    canvas: { id: null, project_id: 42, viewport: null, nodes: null },
    conversation_messages: [],
    agent_runs: [],
    generation_jobs: [],
    assets: {},
    high_watermark_cursor: 10,
    ...overrides,
  };
}

/** 单帧 SSE 事件（ProductEventEnvelope），用于模拟 Agent 实时回复。 */
function sseFrame(payload: Record<string, unknown>): string {
  return (
    "data: " +
    JSON.stringify({
      schema_version: 1,
      event_id: "e2e-1",
      event_type: "conversation.message_completed",
      cursor: 11,
      project_id: 42,
      aggregate_type: "conversation",
      aggregate_id: "7",
      aggregate_version: 1,
      correlation_id: null,
      causation_id: null,
      occurred_at: "2026-07-19T09:00:00Z",
      payload,
    }) +
    "\n\n"
  );
}

/** 注册 Snapshot + 空 SSE 流路由（SSE 立即结束，恢复闭环按退避重连，无害）。 */
async function mockRecovery(
  page: import("@playwright/test").Page,
  snap: Record<string, unknown>,
  sseBody = "",
) {
  await page.route("**/api/projects/42/snapshot", (route) =>
    fulfillJson(route, result(snap)),
  );
  await page.route("**/api/projects/42/events**", (route) =>
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
      body: sseBody,
    }),
  );
}

test.describe("/generate — 对话式创作页", () => {
  test("首条消息原子创建收件箱 → 进入对话态并恢复对话", async ({ page }) => {
    let inboxExists = false;
    await page.route("**/api/generation-inbox", (route) => {
      if (route.request().method() === "GET") {
        return fulfillJson(route, result(inboxExists ? INBOX : null));
      }
      return route.fallback();
    });
    await page.route("**/api/generation-inbox/messages", (route) => {
      inboxExists = true;
      return fulfillJson(
        route,
        result({
          project_id: 42,
          conversation_id: 7,
          message_id: 100,
          agent_run_id: 50,
          accepted_cursor: 1,
        }),
        202,
      );
    });
    await mockRecovery(
      page,
      snapshot({
        conversation_messages: [
          {
            message_id: 100,
            conversation_id: 7,
            role: "user",
            content: "生成一只蓝鲸",
            sequence_no: 1,
          },
        ],
      }),
      sseFrame({
        message_id: 101,
        conversation_id: 7,
        role: "assistant",
        content: "好的，我来帮你创作",
        sequence_no: 2,
      }),
    );

    await seedAuth(page);
    await page.goto("/generate");

    // 空态：欢迎文案 + 输入框
    await expect(page.getByText("让 Agent 帮你创作")).toBeVisible();

    await page.getByLabel("消息输入框").fill("生成一只蓝鲸");
    await page.getByRole("button", { name: "发送" }).click();

    // 对话态：顶栏出现，用户消息（Snapshot 恢复）与 Agent 回复（SSE）都渲染
    await expect(page.getByRole("button", { name: "新对话" })).toBeVisible();
    await expect(page.getByText("生成一只蓝鲸")).toBeVisible();
    await expect(page.getByText("好的，我来帮你创作")).toBeVisible();
  });

  test("新对话切到空视图，历史入口切回原对话", async ({ page }) => {
    await page.route("**/api/generation-inbox", (route) =>
      fulfillJson(route, result({ ...INBOX, active_conversation_id: 9 })),
    );
    await page.route("**/api/generation-inbox/conversations", (route) => {
      if (route.request().method() === "POST") {
        return fulfillJson(
          route,
          result({ id: 10, created_at: "2026-07-19T09:00:00Z", preview: "" }),
        );
      }
      return fulfillJson(
        route,
        result([
          { id: 9, created_at: "2026-07-19T07:00:00Z", preview: "旧对话预览" },
        ]),
      );
    });
    await mockRecovery(
      page,
      snapshot({
        conversation_messages: [
          {
            message_id: 1,
            conversation_id: 9,
            role: "user",
            content: "旧对话的消息",
            sequence_no: 1,
          },
        ],
      }),
    );

    await seedAuth(page);
    await page.goto("/generate");
    await expect(page.getByText("旧对话的消息")).toBeVisible();

    // 新对话 → 空的新对话视图
    await page.getByRole("button", { name: "新对话" }).click();
    await expect(page.getByText("旧对话的消息")).toBeHidden();
    await expect(page.getByText("这个对话还没有消息")).toBeVisible();

    // 历史入口 → 切回原对话
    await page.getByRole("button", { name: "历史" }).click();
    await page.getByRole("button", { name: /旧对话预览/ }).click();
    await expect(page.getByText("旧对话的消息")).toBeVisible();
  });

  test("删除收件箱需二次确认，确认后回空态", async ({ page }) => {
    let deleteCalls = 0;
    await page.route("**/api/generation-inbox", (route) => {
      if (route.request().method() === "DELETE") {
        deleteCalls += 1;
        return fulfillJson(route, result(null));
      }
      return fulfillJson(route, result(INBOX));
    });
    await mockRecovery(page, snapshot());

    await seedAuth(page);
    await page.goto("/generate");
    await expect(page.getByRole("button", { name: "新对话" })).toBeVisible();

    // 第一次：取消 → 不发 DELETE
    await page.getByRole("button", { name: "删除" }).click();
    await expect(
      page.getByRole("dialog", { name: "删除生成收件箱" }),
    ).toBeVisible();
    await expect(
      page.getByText(/永久删除收件箱及全部对话、生成任务与作品/),
    ).toBeVisible();
    await page.getByRole("button", { name: "取消" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(deleteCalls).toBe(0);

    // 第二次：确认 → 发 DELETE → 回空态
    await page.getByRole("button", { name: "删除" }).click();
    await page.getByRole("button", { name: "永久删除" }).click();
    await expect.poll(() => deleteCalls).toBe(1);
    await expect(page.getByText("让 Agent 帮你创作")).toBeVisible();
  });

  test("添加到项目：选择目标项目后复制成功并给出打开项目链接", async ({
    page,
  }) => {
    let copyBody: unknown = null;
    let copyIdempotencyKey: string | undefined;
    await page.route("**/api/generation-inbox", (route) =>
      fulfillJson(route, result({ ...INBOX, active_conversation_id: 1 })),
    );
    await mockRecovery(
      page,
      snapshot({
        conversation_messages: [
          {
            message_id: 1,
            conversation_id: 1,
            role: "user",
            content: "生成蓝鲸",
            sequence_no: 1,
          },
        ],
        agent_runs: [{ agent_run_id: 5, conversation_id: 1 }],
        generation_jobs: [
          {
            job_id: 9,
            type: "image",
            source: "agent_run",
            agent_run_id: 5,
            status: "succeeded",
            input: { prompt: "蓝鲸" },
            outputs: [{ slot_index: 0, status: "succeeded", asset_id: 9 }],
          },
        ],
        assets: {
          "9": {
            asset_id: 9,
            type: "image",
            access_url: "/api/projects/42/assets/9/content",
          },
        },
      }),
    );
    // 作品图片（AuthenticatedImage 鉴权加载）
    await page.route("**/api/projects/42/assets/9/content", (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
          "base64",
        ),
      }),
    );
    await page.route("**/api/projects", (route) =>
      fulfillJson(
        route,
        result([
          { id: 77, name: "演示项目", thumb: null, created_at: "2026-07-18" },
        ]),
      ),
    );
    await page.route("**/api/projects/77/assets", async (route) => {
      copyBody = route.request().postDataJSON();
      copyIdempotencyKey = route.request().headers()["idempotency-key"];
      return fulfillJson(
        route,
        result({
          id: 101,
          type: "image",
          url: "/assets/101/content",
          width: 1024,
          height: 1024,
          duration: null,
          source: "generated",
          created_at: "2026-07-19T09:00:00Z",
        }),
      );
    });

    await seedAuth(page);
    await page.goto("/generate");

    await page.getByRole("button", { name: "添加到项目" }).click();
    await expect(
      page.getByRole("dialog", { name: "添加到项目" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "演示项目" }).click();
    await expect(page.getByText(/已添加到/)).toBeVisible();
    expect(copyBody).toEqual({ source_asset_id: 9 });
    expect(copyIdempotencyKey).toBeTruthy();
    // 「打开项目」必须定位到副本落入的目标项目（画布 ?project=<id>）
    await expect(page.getByRole("link", { name: "打开项目" })).toHaveAttribute(
      "href",
      "/canvas?project=77",
    );
  });
});
