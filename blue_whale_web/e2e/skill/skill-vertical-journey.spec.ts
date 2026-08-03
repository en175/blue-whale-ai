/**
 * skill-vertical-journey.spec.ts —— IK60X2：统一自动匹配、版本事实与浏览器纵向验收。
 *
 * route-intercept 模式（模板参照 skill-direct-use.spec.ts / skill-my-assets.spec.ts /
 * skill-panel-library.spec.ts）：seedAuth 注入登录态，skills/收件箱/Snapshot/SSE
 * 全部 fixture 拦截；mock 内部维护 added/auto/个人技能状态，开关与创建后 mine 联动。
 *
 * 锁定验收（契约 docs/specs/2026-08-03-creative-skill-asset-contract.md §16）：
 *  1. 主旅程：技能库（最多使用排序 + 使用人数）→ 添加官方 → 开官方 auto →
 *     编写模式创建个人技能（脏草稿确认后保留）→ 开个人 auto → 多候选可同时开启；
 *  2. 直接指定覆盖自动匹配：携带 forced_creative_skill_id，运行状态只显示「使用技能：名称」；
 *  3. auto 激活名经快照 activated_creative_skill_versions 到达前端，同样只显示名称不显示来源；
 *  4. 视觉/响应式（3/2/1 列、无横向滚动）、会话状态（切页签保留查询）、键盘焦点（陷阱 + ESC 恢复）。
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { seedAuth } from "../_fixtures/auth";

test.setTimeout(30_000);

const PANEL = '[data-testid="skill-panel"]';
const STORE_GRID = ".tc-agent-skill-panel__store-grid";

const OFFICIAL = [
  {
    id: "poster_gen",
    name: "海报大师",
    description: "电影感海报构图助手。",
    usage: 128,
  },
  {
    id: "storyboard_pro",
    name: "分镜大师",
    description: "影视分镜创作助手。",
    usage: 96,
  },
  {
    id: "marketing_copy",
    name: "营销文案",
    description: "营销文案生成助手。",
    usage: 64,
  },
];

const PERSONAL_SKILL_MD = `---
name: 我的分镜
description: 个人分镜方法
---

我的分镜创作正文。`;

function result(data: unknown): string {
  return JSON.stringify({ code: 200, msg: "", success: true, data });
}

function fulfillJson(route: Route, body: string, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body });
}

type LibraryRequest = {
  pageNum?: number;
  pageSize?: number;
  keyword?: string;
  category?: string;
  sort?: string;
  lang?: string;
};

/** 有状态技能后端：added 引用集合、官方 auto Map、个人技能数组（含 auto）。 */
function createSkillBackend() {
  const added = new Set<string>();
  const officialAuto = new Map<string, boolean>();
  const personal: {
    creative_skill_id: string;
    auto: boolean;
    name: string;
    description: string | null;
  }[] = [];
  const libraryRequests: LibraryRequest[] = [];
  const setAutoCalls: { id: string; auto: boolean }[] = [];

  const libraryRecords = () =>
    OFFICIAL.map((f) => ({
      creative_skill_id: f.id,
      name: f.name,
      description: f.description,
      cover_url: null,
      source: "official",
      asset_domain: "official",
      added: added.has(f.id),
      category: "film",
      usage_count: f.usage,
    }));

  const mineRecords = () => [
    ...OFFICIAL.filter((f) => added.has(f.id)).map((f) => ({
      creative_skill_id: f.id,
      auto: officialAuto.get(f.id) === true,
      name: f.name,
      description: f.description,
      cover_url: null,
      source: "official",
      asset_domain: "official",
    })),
    ...personal.map((p) => ({
      creative_skill_id: p.creative_skill_id,
      auto: p.auto,
      name: p.name,
      description: p.description,
      cover_url: null,
      source: null,
      asset_domain: "personal",
    })),
  ];

  return {
    added,
    officialAuto,
    personal,
    libraryRequests,
    setAutoCalls,
    libraryRecords,
    mineRecords,
  };
}

type SkillBackend = ReturnType<typeof createSkillBackend>;

async function mockSkillsApi(page: Page, backend: SkillBackend) {
  await page.route("**/api/agent/skills/library", (route) => {
    const body = route.request().postDataJSON() as LibraryRequest;
    backend.libraryRequests.push(body);
    let records = backend.libraryRecords();
    if (body.keyword) {
      records = records.filter(
        (r) =>
          r.name.includes(body.keyword!) ||
          r.description.includes(body.keyword!),
      );
    }
    if (body.sort === "most_used") {
      records = [...records].sort((a, b) => b.usage_count - a.usage_count);
    }
    return fulfillJson(
      route,
      result({
        records,
        total: records.length,
        current: body.pageNum ?? 1,
        size: body.pageSize ?? 50,
      }),
    );
  });

  await page.route("**/api/agent/skills/mine", (route) => {
    const body = route.request().postDataJSON() as {
      pageNum?: number;
      pageSize?: number;
    };
    const records = backend.mineRecords();
    return fulfillJson(
      route,
      result({
        records,
        total: records.length,
        current: body.pageNum ?? 1,
        size: body.pageSize ?? 50,
      }),
    );
  });

  await page.route("**/api/agent/skills/library/*/add", (route) => {
    const id = route.request().url().split("/library/")[1].split("/add")[0];
    backend.added.add(id);
    return fulfillJson(route, result(null));
  });

  await page.route("**/api/agent/skills/mine/*", (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    const id = route.request().url().split("/mine/")[1].split("?")[0];
    const body = route.request().postDataJSON() as { auto: boolean };
    backend.setAutoCalls.push({ id, auto: body.auto });
    if (backend.officialAuto.has(id) || backend.added.has(id)) {
      backend.officialAuto.set(id, body.auto);
    }
    const p = backend.personal.find((x) => x.creative_skill_id === id);
    if (p) p.auto = body.auto;
    return fulfillJson(route, result(null));
  });

  await page.route("**/api/agent/skills/personal", (route) => {
    const body = route.request().postDataJSON() as { content: string };
    const name = /^name:\s*(.+)$/m.exec(body.content)?.[1]?.trim() ?? "";
    const description =
      /^description:\s*(.+)$/m.exec(body.content)?.[1]?.trim() ?? "";
    backend.personal.push({
      creative_skill_id: "my_storyboard",
      auto: false,
      name,
      description,
    });
    return fulfillJson(
      route,
      result({
        creative_skill_id: "my_storyboard",
        auto: false,
        name,
        description,
        cover_url: null,
        source: null,
        asset_domain: "personal",
      }),
    );
  });
}

/** 登录态 + 首页公共端点 mock + 截断外部静态资源。 */
async function bootstrap(page: Page) {
  const backend = createSkillBackend();
  await seedAuth(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("bw-access-token", "e2e-access-token");
    window.localStorage.setItem("bw-refresh-token", "e2e-refresh-token");
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    return url.startsWith("http://localhost") || url.startsWith("data:")
      ? route.fallback()
      : route.abort();
  });
  await mockSkillsApi(page, backend);
  await page.route("**/api/agent/templates/tags", (route) =>
    fulfillJson(route, result([])),
  );
  await page.route("**/api/agent/templates/page?**", (route) =>
    fulfillJson(route, result({ records: [], total: 0, current: 1, size: 50 })),
  );
  await page.route("**/api/usage/token**", (route) =>
    fulfillJson(route, result({ quota: 1000 })),
  );
  await page.goto("/");
  return backend;
}

/** 打开面板：首页 composer「Skill」按钮 → 面板可见且默认技能库页签。 */
async function openPanel(page: Page) {
  const trigger = page.getByRole("button", { name: "Skills", exact: true });
  await trigger.click();
  const panel = page.locator(PANEL);
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("skill-tab-library")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  return { trigger, panel };
}

test("主旅程：浏览/添加/双域 auto/创建个人技能/脏草稿保留", async ({
  page,
}) => {
  const backend = await bootstrap(page);
  // window.confirm（脏草稿）一律确认放行
  page.on("dialog", (dialog) => void dialog.accept());
  await openPanel(page);
  await expect(page.getByTestId("skill-library-card")).toHaveCount(3);

  // 1) 技能库：切「最多使用」排序 → 请求带 sort=most_used；卡片显示去重使用人数
  await page.getByTestId("skill-sort-trigger").click();
  await page.getByTestId("skill-sort-option-most_used").click();
  await expect
    .poll(() => backend.libraryRequests.at(-1)?.sort)
    .toBe("most_used");
  const firstCard = page.getByTestId("skill-library-card").first();
  await expect(firstCard).toContainText("海报大师");
  await expect(firstCard.getByTestId("skill-usage-count")).toHaveText(
    "128 人使用",
  );

  // 2) 添加官方技能 → 按钮变「已添加」
  await firstCard.getByTestId("skill-library-add-btn").click();
  await expect(page.getByText("技能已添加")).toBeVisible();
  await expect(firstCard.getByTestId("skill-library-add-btn")).toHaveText(
    "已添加",
  );

  // 3) 我的技能：开官方 auto（默认关 → 开后 aria-checked）
  await page.getByTestId("skill-tab-my").click();
  const officialSwitch = page.getByRole("switch", {
    name: "开启自动应用：海报大师",
  });
  await expect(officialSwitch).toHaveAttribute("aria-checked", "false");
  await officialSwitch.click();
  await expect
    .poll(() => backend.setAutoCalls.at(-1))
    .toEqual({ id: "poster_gen", auto: true });
  await expect(
    page.getByRole("switch", { name: "关闭自动应用：海报大师" }),
  ).toHaveAttribute("aria-checked", "true");

  // 4) 创建技能：编写草稿 → 脏态切页签（confirm 确认）→ 切回草稿保留
  await page.getByTestId("skill-tab-create").click();
  const editor = page.getByTestId("skill-md-editor");
  await editor.fill(PERSONAL_SKILL_MD);
  await page.getByTestId("skill-tab-my").click();
  await expect(page.getByTestId("skill-tab-my")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByTestId("skill-tab-create").click();
  await expect(editor).toHaveValue(PERSONAL_SKILL_MD);

  // 5) 保存 → 自动跳我的技能，个人行出现（@个人）
  await page.getByTestId("skill-save-btn").click();
  await expect(page.getByText("技能已保存")).toBeVisible();
  await expect(page.getByTestId("skill-tab-my")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("@个人")).toBeVisible();

  // 6) 开个人 auto：与官方并存（允许多个候选开启）
  const personalSwitch = page.getByRole("switch", {
    name: "开启自动应用：我的分镜",
  });
  await expect(personalSwitch).toHaveAttribute("aria-checked", "false");
  await personalSwitch.click();
  await expect
    .poll(() => backend.setAutoCalls.at(-1))
    .toEqual({ id: "my_storyboard", auto: true });
  await expect(
    page.getByRole("switch", { name: "关闭自动应用：我的分镜" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByRole("switch", { name: "关闭自动应用：海报大师" }),
  ).toHaveAttribute("aria-checked", "true");
});

test("AgentRun 状态：直接指定覆盖自动匹配；auto 激活名经快照到达且只显示名称", async ({
  page,
}) => {
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
  const messageBodies: Array<Record<string, unknown>> = [];

  await page.route("**/api/generation-inbox", (route) =>
    fulfillJson(route, result(INBOX)),
  );
  await page.route("**/api/generation-inbox/messages", (route) => {
    messageBodies.push(
      route.request().postDataJSON() as Record<string, unknown>,
    );
    return fulfillJson(
      route,
      result({
        project_id: 42,
        conversation_id: 7,
        message_id: 100 + messageBodies.length,
        agent_run_id: 50,
        accepted_cursor: messageBodies.length,
      }),
      202,
    );
  });
  // 快照：Run 50 已由服务端固定 auto 激活（分镜大师，§16.2）；
  // forced 发送后本地 map 覆盖为「海报大师」。
  await page.route("**/api/projects/42/snapshot", (route) =>
    fulfillJson(
      route,
      result({
        project: {
          id: 42,
          name: "生成收件箱",
          thumb: null,
          created_at: "2026-07-19T08:00:00Z",
        },
        canvas: { id: null, project_id: 42, viewport: null, nodes: null },
        conversation_messages: [
          {
            message_id: 100,
            conversation_id: 7,
            role: "user",
            content: "做个分镜",
            sequence_no: 1,
          },
        ],
        agent_runs: [
          {
            agent_run_id: 50,
            conversation_id: 7,
            status: "running",
            activated_creative_skill_versions: [
              {
                creative_skill_id: "storyboard_pro",
                creative_skill_version_id: "version.storyboard.1",
                name: "分镜大师",
                display_version: "1.0.0",
                resource_digest: `sha256:${"0".repeat(64)}`,
                source: "auto",
                reason: {
                  type: "agent_match",
                  detail: { matched_fields: ["conversation_messages"] },
                },
              },
            ],
          },
        ],
        generation_jobs: [],
        assets: {},
        high_watermark_cursor: 10,
      }),
    ),
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
            content: "好的，这就为你创作。",
            sequence_no: 2,
          },
        }) +
        "\n\n",
    }),
  );

  await seedAuth(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("bw-access-token", "e2e-access-token");
    window.localStorage.setItem("bw-refresh-token", "e2e-refresh-token");
  });
  await page.route("**/api/usage/token**", (route) =>
    fulfillJson(route, result({ quota: 1000 })),
  );

  // A) auto 激活：无本地绑定，技能名从快照回退显示，且不显示来源
  await page.goto("/generate");
  const status = page.getByTestId("run-skill-status");
  await expect(status).toHaveText("使用技能：分镜大师");
  await expect(status).not.toContainText("自动");
  await expect(status).not.toContainText("auto");

  // B) 直接指定覆盖自动匹配：携带绑定发送 → forced 名覆盖显示
  await page.addInitScript(
    ([key, value]) => window.sessionStorage.setItem(key, value),
    [STORAGE_KEY, JSON.stringify(BINDING)] as const,
  );
  await page.reload();
  await expect(page.getByTestId("direct-skill-tag")).toContainText("海报大师");
  await page.getByLabel("消息输入框").fill("做一张蓝鲸海报");
  await page.getByRole("button", { name: "发送" }).click();
  await expect.poll(() => messageBodies.length).toBe(1);
  expect(messageBodies[0]).toMatchObject({
    content: "做一张蓝鲸海报",
    forced_creative_skill_id: "poster_gen",
  });
  await expect(status).toHaveText("使用技能：海报大师");

  // 不写入 Agent 回复正文
  const reply = page.getByText("好的，这就为你创作。");
  await expect(reply).toBeVisible();
  await expect(reply).not.toContainText("使用技能");
});

test("视觉/响应式/会话状态/键盘焦点", async ({ page }) => {
  const backend = await bootstrap(page);
  const { trigger, panel } = await openPanel(page);
  await expect(page.getByTestId("skill-library-card")).toHaveCount(3);

  // 响应式：3/2/1 列 + 全程无横向滚动
  const grid = page.locator(STORE_GRID);
  const columnCount = () =>
    grid.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
    );
  const noHorizontalScroll = () =>
    page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    );
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect.poll(columnCount).toBe(3);
  expect(await noHorizontalScroll()).toBe(true);
  await page.setViewportSize({ width: 800, height: 720 });
  await expect.poll(columnCount).toBe(2);
  expect(await noHorizontalScroll()).toBe(true);
  await page.setViewportSize({ width: 500, height: 720 });
  await expect.poll(columnCount).toBe(1);
  expect(await noHorizontalScroll()).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });

  // 会话状态：搜索后切页签再切回，关键词与结果保留，不重发请求
  await page.getByTestId("skill-search-input").fill("分镜");
  await page.getByTestId("skill-search-submit").click();
  await expect(page.getByTestId("skill-library-card")).toHaveCount(1);
  const requestCount = backend.libraryRequests.length;
  await page.getByTestId("skill-tab-my").click();
  await page.getByTestId("skill-tab-library").click();
  await expect(page.getByTestId("skill-search-input")).toHaveValue("分镜");
  await expect(page.getByTestId("skill-library-card")).toHaveCount(1);
  expect(backend.libraryRequests.length).toBe(requestCount);

  // 键盘焦点：打开后焦点在面板内，Tab 在面板内循环不逃逸
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.querySelector('[data-testid="skill-panel"]');
        return root?.contains(document.activeElement) ?? false;
      }),
    )
    .toBe(true);
  const focusable = panel.locator(
    'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  await focusable.last().focus();
  await page.keyboard.press("Tab");
  // 循环回面板内第一个可聚焦元素，焦点始终不离开面板
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.querySelector('[data-testid="skill-panel"]');
        return root?.contains(document.activeElement) ?? false;
      }),
    )
    .toBe(true);

  // ESC 关闭 → 焦点恢复触发按钮
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
});
