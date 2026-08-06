/**
 * skill-summarize.spec.ts —— IK60X1：对话总结保存个人技能前端链路验收。
 *
 * route-intercept 模式（模板参照 e2e/skill/skill-direct-use.spec.ts 与
 * e2e/skill/skill-personal-manage.spec.ts）：seedAuth 注入登录态，
 * canvas Snapshot / SSE / 消息接纳 / 技能接口全部 fixture 拦截，不依赖真实后端。
 * SSE 用「挂起路由 + 帧队列」模拟长连接：无帧时挂起，注入帧后下一条连接立即下发。
 *
 * 锁定验收（契约 docs/specs/2026-08-03-creative-skill-asset-contract.md §15.1）：
 *  1. 「创建技能」页签点「总结当前对话」→ 面板关闭、输入框预填固定提示词、不自动发送；
 *  2. 用户可编辑，手动发送的消息体带 skill_summarize: true；一次性消费，第二条消息不带；
 *  3. 充分分支：SSE 注入「已保存技能 X」回复 → 对话可见；「我的技能」联动出现该技能
 *     （保存由服务端总结管道完成，浏览器全程不调用 POST /api/agent/skills/personal）；
 *  4. 不足分支：SSE 注入「信息不足，请补充…」回复 → 可见，全程不创建技能；
 *  5. 名称冲突分支：SSE 注入冲突+提议名回复 → 用户发「确认」（普通消息，不带意图字段）
 *     → SSE 注入最终保存成功回复 → 对话可见、「我的技能」出现新技能。
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { seedAuth } from "../_fixtures/auth";

test.setTimeout(60_000);

const COMPOSER = ".tc-agent-composer-editor";

/** 与 AgentChatPanel.SKILL_SUMMARIZE_PROMPT 常量同源的关键片段（全文含「保存为我的个人技能」）。 */
const PROMPT_FRAGMENT = "总结当前对话";

function result(data: unknown): string {
  return JSON.stringify({ code: 200, msg: "", success: true, data });
}

function fulfillJson(route: Route, body: string, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body });
}

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
      nodes: JSON.stringify([]),
    },
    conversation_messages: [],
    agent_runs: [],
    generation_jobs: [],
    assets: {},
    high_watermark_cursor: 10,
  };
}

/** SSE 帧队列：路由在无新帧时挂起（模拟长连接），注入帧后下一条连接立即下发。 */
function createSseHub(page: Page) {
  const frames: string[] = [];
  let delivered = 0;
  let cursor = 10;
  let notify: (() => void) | null = null;

  const hub = {
    /** 注入一条 assistant 完成回复（conversation.message_completed）。 */
    pushAssistantReply(content: string) {
      cursor += 1;
      frames.push(
        "data: " +
          JSON.stringify({
            schema_version: 1,
            event_id: `e2e-${cursor}`,
            event_type: "conversation.message_completed",
            cursor,
            project_id: 42,
            aggregate_type: "conversation",
            aggregate_id: "7",
            aggregate_version: 1,
            correlation_id: null,
            causation_id: null,
            occurred_at: "2026-07-19T09:00:00Z",
            payload: {
              message_id: 100 + cursor,
              conversation_id: 7,
              role: "assistant",
              content,
              sequence_no: cursor,
            },
          }) +
          "\n\n",
      );
      notify?.();
    },
  };

  return {
    hub,
    async route() {
      await page.route("**/api/projects/42/events?**", async (r) => {
        while (frames.length === delivered) {
          await new Promise<void>((resolve) => {
            notify = resolve;
          });
        }
        const body = frames.slice(delivered).join("");
        delivered = frames.length;
        notify = null;
        return r.fulfill({
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
          body,
        });
      });
    },
  };
}

type PersonalSkill = { creative_skill_id: string; name: string };

/** 技能接口 mock：personal 集合由测试侧维护（模拟服务端总结管道保存后的状态），
 *  mine 响应与之联动；POST personal 仅计数——总结链路浏览器不得调用它。 */
async function mockSkillsApi(page: Page, personal: PersonalSkill[]) {
  const counters = { createPersonal: 0 };

  await page.route("**/api/agent/skills/library", (route) =>
    fulfillJson(route, result({ records: [], total: 0, current: 1, size: 50 })),
  );
  await page.route("**/api/agent/skills/mine", (route) =>
    fulfillJson(
      route,
      result({
        records: personal.map((s) => ({
          creative_skill_id: s.creative_skill_id,
          auto: false,
          name: s.name,
          description: `${s.name}简介`,
          cover_url: null,
          source: null,
          asset_domain: "personal",
        })),
        total: personal.length,
        current: 1,
        size: 50,
      }),
    ),
  );
  await page.route("**/api/agent/skills/personal", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    counters.createPersonal += 1;
    return fulfillJson(route, result({}));
  });

  return counters;
}

/** canvas 启动链路公共 mock（模板参照 e2e/canvas/asset-library-flyout.spec.ts）。 */
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
    fulfillJson(route, result(snapshot())),
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

/** 消息接纳拦截：记录请求体，固定回执。 */
async function mockConversationMessages(
  page: Page,
  bodies: Array<Record<string, unknown>>,
) {
  await page.route("**/api/projects/42/conversation/messages", (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    return fulfillJson(
      route,
      result({
        message_id: 100 + bodies.length,
        agent_run_id: 50,
        cursor: 10 + bodies.length,
      }),
    );
  });
}

/** 进入 canvas 并打开 AgentChatPanel → 技能面板 → 创建技能页签。 */
async function openCreateTab(page: Page) {
  await page.goto("/canvas");
  await page.getByRole("button", { name: "Canvas Agent" }).click();
  await page.getByLabel("技能", { exact: true }).click();
  await expect(page.getByTestId("skill-panel")).toBeVisible();
  await page.getByTestId("skill-tab-create").click();
}

test("入口：关面板、预填固定提示词、不自动发送；编辑后发送带 skill_summarize，第二条不带", async ({
  page,
}) => {
  const messageBodies: Array<Record<string, unknown>> = [];
  const personal: PersonalSkill[] = [];
  const sse = createSseHub(page);
  await bootstrap(page);
  await sse.route();
  await mockConversationMessages(page, messageBodies);
  const counters = await mockSkillsApi(page, personal);

  await openCreateTab(page);
  await page.getByTestId("skill-summarize-entry").click();

  // 面板关闭、输入框预填固定提示词（明确表达保存意图）、不自动发送
  await expect(page.getByTestId("skill-panel")).toBeHidden();
  const composer = page.locator(COMPOSER);
  await expect(composer).toContainText(PROMPT_FRAGMENT);
  await expect(composer).toContainText("保存为我的个人技能");
  await page.waitForTimeout(300);
  expect(messageBodies).toHaveLength(0);
  expect(counters.createPersonal).toBe(0);

  // 用户可编辑，手动发送携带 skill_summarize: true
  await composer.fill("总结这段对话里的海报方法论，保存为我的个人技能");
  await page.getByLabel("发送", { exact: true }).click();
  await expect.poll(() => messageBodies.length).toBe(1);
  expect(messageBodies[0]).toMatchObject({
    content: "总结这段对话里的海报方法论，保存为我的个人技能",
    skill_summarize: true,
  });

  // Agent 回复到达后再发第二条（运行中发送按钮置灰，与充分/冲突用例同一前置）
  sse.hub.pushAssistantReply("已总结当前对话并保存为个人技能「海报方法论」。");
  await expect(
    page.getByText("已总结当前对话并保存为个人技能「海报方法论」。"),
  ).toBeVisible();

  // 一次性消费：第二条普通消息不带该字段
  await composer.fill("再来一张海报");
  await page.getByLabel("发送", { exact: true }).click();
  await expect.poll(() => messageBodies.length).toBe(2);
  expect(messageBodies[1]).not.toHaveProperty("skill_summarize");
});

test("充分分支：SSE 回复已保存 → 对话可见，「我的技能」出现该技能，浏览器不直接创建", async ({
  page,
}) => {
  const messageBodies: Array<Record<string, unknown>> = [];
  const personal: PersonalSkill[] = [];
  const sse = createSseHub(page);
  await bootstrap(page);
  await sse.route();
  await mockConversationMessages(page, messageBodies);
  const counters = await mockSkillsApi(page, personal);

  await openCreateTab(page);
  await page.getByTestId("skill-summarize-entry").click();
  await page.getByLabel("发送", { exact: true }).click();
  await expect.poll(() => messageBodies.length).toBe(1);
  expect(messageBodies[0]).toHaveProperty("skill_summarize", true);

  // 服务端总结管道保存成功：SSE 下发 assistant 回复，personal 集合联动（模拟服务端落库）
  sse.hub.pushAssistantReply("已总结当前对话并保存为个人技能「海报方法论」。");
  personal.push({
    creative_skill_id: "poster_methodology",
    name: "海报方法论",
  });

  await expect(
    page.getByText("已总结当前对话并保存为个人技能「海报方法论」。"),
  ).toBeVisible();

  // 「我的技能」出现新技能；浏览器全程未调用创建端点（保存由服务端管道完成）
  await page.getByLabel("技能", { exact: true }).click();
  await page.getByTestId("skill-tab-my").click();
  await expect(
    page.getByTestId("skill-my-row").filter({ hasText: "海报方法论" }),
  ).toBeVisible();
  expect(counters.createPersonal).toBe(0);
});

test("不足分支：SSE 回复信息不足 → 对话可见，全程不创建技能", async ({
  page,
}) => {
  const messageBodies: Array<Record<string, unknown>> = [];
  const personal: PersonalSkill[] = [];
  const sse = createSseHub(page);
  await bootstrap(page);
  await sse.route();
  await mockConversationMessages(page, messageBodies);
  const counters = await mockSkillsApi(page, personal);

  await openCreateTab(page);
  await page.getByTestId("skill-summarize-entry").click();
  await page.getByLabel("发送", { exact: true }).click();
  await expect.poll(() => messageBodies.length).toBe(1);

  sse.hub.pushAssistantReply(
    "当前对话信息不足，缺少可复用的风格与步骤描述，请补充后再试。",
  );

  await expect(page.getByText(/信息不足，请补充|缺少可复用/)).toBeVisible();
  // 不创建技能：浏览器未发创建请求，mine 仍为空
  expect(counters.createPersonal).toBe(0);
  await page.getByLabel("技能", { exact: true }).click();
  await page.getByTestId("skill-tab-my").click();
  await expect(page.getByTestId("skill-my-row")).toHaveCount(0);
});

test("名称冲突分支：确认消息为普通消息，最终保存成功回复可见且技能入列", async ({
  page,
}) => {
  const messageBodies: Array<Record<string, unknown>> = [];
  const personal: PersonalSkill[] = [];
  const sse = createSseHub(page);
  await bootstrap(page);
  await sse.route();
  await mockConversationMessages(page, messageBodies);
  const counters = await mockSkillsApi(page, personal);

  await openCreateTab(page);
  await page.getByTestId("skill-summarize-entry").click();
  await page.getByLabel("发送", { exact: true }).click();
  await expect.poll(() => messageBodies.length).toBe(1);
  expect(messageBodies[0]).toHaveProperty("skill_summarize", true);

  // 冲突：禁止保存，提议新名等待确认
  sse.hub.pushAssistantReply(
    "技能名称「海报方法论」与已有技能冲突，建议使用「海报方法论 V2」，回复确认即可保存。",
  );
  await expect(
    page.getByText(/名称「海报方法论」与已有技能冲突/),
  ).toBeVisible();
  expect(counters.createPersonal).toBe(0);

  // 用户发「确认」：普通消息，不带 skill_summarize（意图标记已一次性消费）
  const composer = page.locator(COMPOSER);
  await composer.fill("确认");
  await page.getByLabel("发送", { exact: true }).click();
  await expect.poll(() => messageBodies.length).toBe(2);
  expect(messageBodies[1]).toMatchObject({ content: "确认" });
  expect(messageBodies[1]).not.toHaveProperty("skill_summarize");

  // 服务端确认保存成功：最终回复可见，「我的技能」出现新技能
  sse.hub.pushAssistantReply("已保存为个人技能「海报方法论 V2」。");
  personal.push({
    creative_skill_id: "poster_methodology_v2",
    name: "海报方法论 V2",
  });
  await expect(
    page.getByText("已保存为个人技能「海报方法论 V2」。"),
  ).toBeVisible();

  await page.getByLabel("技能", { exact: true }).click();
  await page.getByTestId("skill-tab-my").click();
  await expect(
    page.getByTestId("skill-my-row").filter({ hasText: "海报方法论 V2" }),
  ).toBeVisible();
  expect(counters.createPersonal).toBe(0);
});
