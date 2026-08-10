/**
 * skill-direct-use.spec.ts —— IK60WY：技能「直接使用」与下一次 AgentRun 一次性绑定验收。
 *
 * route-intercept 模式（模板参照 e2e/generate/generate-inbox.spec.ts 与
 * e2e/skill/skill-panel-library.spec.ts）：seedAuth 注入登录态，
 * 技能库 / 收件箱 / Snapshot / SSE 全部 fixture 拦截，不依赖真实后端。
 *
 * 锁定验收：
 *  1. 点「直接使用」关闭面板、输入框出现可移除技能标签、不自动发送、不创建引用（无 add 请求）；
 *  2. 发送时携带 forced_creative_skill_id；发送成功标签消失；
 *  3. 运行状态显示「使用技能：名称」，不显示来源，不写入 Agent 回复正文；
 *  4. 一次性语义：第二次发送不再携带该字段；
 *  5. 移除标签后发送不携带该字段。
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { seedAuth } from "../_fixtures/auth";

test.setTimeout(30_000);

const STORAGE_KEY = "bw.direct-skill-binding";
const BINDING = { creative_skill_id: "poster_gen", name: "海报大师" };

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

/** 登录态 + 首页公共端点 mock：假 token 走真服务器会 401 → apiFetch 弹登录框。 */
async function bootstrap(page: Page) {
  await seedAuth(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("bw-access-token", "e2e-access-token");
    window.localStorage.setItem("bw-refresh-token", "e2e-refresh-token");
  });
  await page.route("**/api/agent/templates/tags", (route) =>
    fulfillJson(route, result([])),
  );
  await page.route("**/api/agent/templates/page?**", (route) =>
    fulfillJson(route, result({ records: [], total: 0, current: 1, size: 50 })),
  );
  await page.route("**/api/usage/token**", (route) =>
    fulfillJson(route, result({ quota: 1000 })),
  );
}

function fulfillJson(route: Route, body: string, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body });
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

/** 首页技能库 fixture：1 条官方技能（稳定 ID poster_gen）。 */
async function mockSkillLibrary(
  page: Page,
  counters: { add: number; setAuto: number },
) {
  await page.route("**/api/agent/skills/library", (route) =>
    fulfillJson(
      route,
      result({
        records: [
          {
            creative_skill_id: "poster_gen",
            name: "海报大师",
            description: "电影感海报构图",
            cover_url: null,
            source: "official",
            asset_domain: "official",
            added: false,
            category: "film",
            usage_count: 128,
          },
        ],
        total: 1,
        current: 1,
        size: 50,
      }),
    ),
  );
  await page.route("**/api/agent/skills/mine", (route) =>
    fulfillJson(route, result({ records: [], total: 0, current: 1, size: 50 })),
  );
  await page.route("**/api/agent/skills/library/*/add", (route) => {
    counters.add += 1;
    return fulfillJson(route, result(null));
  });
  await page.route("**/api/agent/skills/mine/*", (route) => {
    if (route.request().method() === "PATCH") counters.setAuto += 1;
    return fulfillJson(route, result(null));
  });
}

/** 收件箱消息接纳拦截：记录每次请求体，固定回执 agent_run_id=50。 */
async function mockInboxMessages(
  page: Page,
  bodies: Array<Record<string, unknown>>,
) {
  await page.route("**/api/generation-inbox/messages", (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    return fulfillJson(
      route,
      result({
        project_id: 42,
        conversation_id: 7,
        message_id: 100 + bodies.length,
        agent_run_id: 50,
        accepted_cursor: bodies.length,
      }),
      202,
    );
  });
}

async function mockRecovery(
  page: Page,
  snap: Record<string, unknown>,
  assistantReply: string,
) {
  await page.route("**/api/projects/42/snapshot", (route) =>
    fulfillJson(route, result(snap)),
  );
  await page.route("**/api/projects/42/events**", (route) =>
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
      body:
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
          payload: {
            message_id: 101,
            conversation_id: 7,
            role: "assistant",
            content: assistantReply,
            sequence_no: 2,
          },
        }) +
        "\n\n",
    }),
  );
}

// IK6XQI-4：生成页 /generate 已下线，本组用例基于该页面 UI（消息输入框/发送/收件箱 mock），
// 整体跳过，待迁移到画布入口后恢复。
test.describe.skip("技能直接使用（IK60WY）", () => {
  test("首页「直接使用」：关面板、出标签、不自动发送、不建引用", async ({
    page,
  }) => {
    const counters = { add: 0, setAuto: 0 };
    const messageBodies: Array<Record<string, unknown>> = [];
    await mockSkillLibrary(page, counters);
    await mockInboxMessages(page, messageBodies);

    await bootstrap(page);
    await page.goto("/");

    await page.getByRole("button", { name: "Skills" }).click();
    await expect(page.getByTestId("skill-panel")).toBeVisible();

    await page.getByRole("button", { name: /直接使用/ }).click();

    // 面板关闭 + 输入框出现可移除技能标签
    await expect(page.getByTestId("skill-panel")).toBeHidden();
    const tag = page.getByTestId("direct-skill-tag");
    await expect(tag).toBeVisible();
    await expect(tag).toContainText("海报大师");

    // 不自动发送、不创建「我的技能」引用、不改自动匹配开关（验收 1/2）
    await page.waitForTimeout(300);
    expect(messageBodies).toHaveLength(0);
    expect(counters.add).toBe(0);
    expect(counters.setAuto).toBe(0);

    // 移除标签后消失
    await page.getByRole("button", { name: "移除技能标签" }).click();
    await expect(tag).toBeHidden();
  });

  test("发送携带一次性绑定：状态显示「使用技能」，第二次发送不再携带", async ({
    page,
  }) => {
    const messageBodies: Array<Record<string, unknown>> = [];
    await page.route("**/api/generation-inbox", (route) =>
      fulfillJson(route, result(INBOX)),
    );
    await mockInboxMessages(page, messageBodies);
    await mockRecovery(
      page,
      snapshot({
        conversation_messages: [
          {
            message_id: 100,
            conversation_id: 7,
            role: "user",
            content: "做一张蓝鲸海报",
            sequence_no: 1,
          },
        ],
        agent_runs: [
          { agent_run_id: 50, conversation_id: 7, status: "running" },
        ],
      }),
      "好的，这就为你创作。",
    );

    await bootstrap(page);
    // 首页「直接使用」经 sessionStorage 传递的一次性绑定
    await page.addInitScript(
      ([key, value]) => window.sessionStorage.setItem(key, value),
      [STORAGE_KEY, JSON.stringify(BINDING)] as const,
    );
    await page.goto("/generate");

    // 标签接管显示在输入框
    const tag = page.getByTestId("direct-skill-tag");
    await expect(tag).toContainText("海报大师");

    // 发送：请求体携带 forced_creative_skill_id
    await page.getByLabel("消息输入框").fill("做一张蓝鲸海报");
    await page.getByRole("button", { name: "发送" }).click();
    await expect.poll(() => messageBodies.length).toBe(1);
    expect(messageBodies[0]).toMatchObject({
      content: "做一张蓝鲸海报",
      forced_creative_skill_id: "poster_gen",
    });

    // 一次性消费：标签消失
    await expect(tag).toBeHidden();

    // 运行状态只显示「使用技能：名称」，不显示来源
    const status = page.getByTestId("run-skill-status");
    await expect(status).toHaveText("使用技能：海报大师");

    // 不写入 Agent 回复正文
    const reply = page.getByText("好的，这就为你创作。");
    await expect(reply).toBeVisible();
    await expect(reply).not.toContainText("使用技能");

    // 第二次发送：绑定已被消费，不再携带 forced 字段（一次性语义）
    await page.getByLabel("消息输入框").fill("再来一张");
    await page.getByRole("button", { name: "发送" }).click();
    await expect.poll(() => messageBodies.length).toBe(2);
    expect(messageBodies[1]).not.toHaveProperty("forced_creative_skill_id");
  });

  test("移除标签后发送不携带绑定", async ({ page }) => {
    const messageBodies: Array<Record<string, unknown>> = [];
    await page.route("**/api/generation-inbox", (route) =>
      fulfillJson(route, result(INBOX)),
    );
    await mockInboxMessages(page, messageBodies);
    await mockRecovery(page, snapshot(), "好的。");

    await bootstrap(page);
    await page.addInitScript(
      ([key, value]) => window.sessionStorage.setItem(key, value),
      [STORAGE_KEY, JSON.stringify(BINDING)] as const,
    );
    await page.goto("/generate");

    await expect(page.getByTestId("direct-skill-tag")).toBeVisible();
    await page.getByRole("button", { name: "移除技能标签" }).click();
    await expect(page.getByTestId("direct-skill-tag")).toBeHidden();

    await page.getByLabel("消息输入框").fill("普通需求");
    await page.getByRole("button", { name: "发送" }).click();
    await expect.poll(() => messageBodies.length).toBe(1);
    expect(messageBodies[0]).not.toHaveProperty("forced_creative_skill_id");
  });
});
