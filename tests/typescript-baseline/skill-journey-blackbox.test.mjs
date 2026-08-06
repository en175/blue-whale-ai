// Node-only 浏览器层黑盒验收：技能纵向主旅程（IK6B3E，兑现 IK60US Testing Decisions #1 选项 a）。
// 真实 BFF + 可控种子数据（deploy/typescript-baseline/init/003+004），一个用户 + 生成收件箱
// 私有 Project 内串行覆盖 7 条主路径：默认页签 / 查询状态保留 / 添加移除 / 直接使用 /
// 自动匹配 / 官方与个人差异 / 永久删除。
// 断言面 = UI 可见事实 + 公开 API + 只读 SQL；不 import 产品源码，不断言私有 helper。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const baseUrl = process.env.BW_ACCEPTANCE_WEB_URL ?? "http://127.0.0.1:3101";
const composeFile =
  process.env.BW_TS_COMPOSE_FILE ??
  "deploy/typescript-baseline/docker-compose.acceptance.yml";
const project =
  process.env.BW_TS_COMPOSE_PROJECT ?? "bw-ts-baseline-acceptance";

function compose(...args) {
  return execFileSync(
    "docker",
    ["compose", "-p", project, "-f", composeFile, ...args],
    { encoding: "utf8" },
  ).trim();
}

function mysqlQuery(sql) {
  return compose(
    "exec",
    "-T",
    "mysql",
    "mysql",
    "-uroot",
    "-pblue_whale",
    "-N",
    "-B",
    "blue_whale",
    "-e",
    sql,
  );
}

async function requestJson(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  return { response, body };
}

async function postJson(path, body, token, extraHeaders = {}) {
  return requestJson(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

async function waitFor(predicate, deadlineMs, message) {
  const deadline = Date.now() + deadlineMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `${message}${lastError ? `（最后错误：${lastError.message}）` : ""}`,
  );
}

async function registerUser(label) {
  const suffix = `${Date.now()}${process.pid}`;
  const username = `${label.slice(0, 8)}${suffix.slice(-9)}`;
  const password = `Ac${suffix.slice(-12)}!xY9`;
  const registration = await postJson("/api/auth/register", {
    username,
    password,
  });
  assert.equal(
    registration.response.status,
    200,
    "服务=web 事实=注册应成功",
  );
  const token = registration.body.data?.access_token;
  assert.equal(typeof token, "string", "服务=web 事实=注册应返回 token");
  const me = await requestJson("/api/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(me.response.status, 200, "服务=web 事实=当前用户应可读");
  return { token, username, userId: Number(me.body.data?.user_id) };
}

async function fetchSnapshot(projectId, token) {
  const { response, body } = await requestJson(
    `/api/projects/${projectId}/snapshot`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  assert.equal(response.status, 200, "服务=web 事实=Snapshot 应可读");
  return body.data;
}

// ---- 共享浏览器上下文（同一用户、同一登录态，7 条主路径串行复用） ----

let browser;
let context;
let page;
let user;
// 主路径6 创建、主路径7 删除的个人技能身份（串行传递）
let personalSkillId = null;

// 种子官方技能（deploy/typescript-baseline/init/003+004，确定性）
const SEED_SKILLS = [
  "Acceptance Poster",
  "Acceptance Storyboard",
  "Acceptance Teaser",
];
const STORYBOARD_ID = "acceptance_storyboard";
const STORYBOARD_NAME = "Acceptance Storyboard";
const PERSONAL_SKILL_NAME = "Journey Personal";
const PERSONAL_SKILL_MD = `---\nname: ${PERSONAL_SKILL_NAME}\ndescription: blackbox personal skill\n---\n# ${PERSONAL_SKILL_NAME}\n\nUse the frozen personal rules.`;

before(async () => {
  user = await registerUser("skilljny");
  browser = await chromium.launch();
  context = await browser.newContext();
  await context.addInitScript(
    ({ userJson, token }) => {
      window.localStorage.setItem("bw-user", userJson);
      window.localStorage.setItem("bw-access-token", token);
    },
    {
      userJson: JSON.stringify({
        userId: user.userId,
        username: user.username,
        phone: "",
        hasPassword: true,
      }),
      token: user.token,
    },
  );
  page = await context.newPage();
}, 120_000);

after(async () => {
  await browser?.close();
});

// ---- 页面辅助 ----

async function gotoHome() {
  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "Skills", exact: true })
    .waitFor({ timeout: 30_000 });
}

async function openSkillPanel() {
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await page.waitForSelector('[data-testid="skill-panel"]', {
    timeout: 30_000,
  });
  await waitFor(
    async () =>
      (await page.getAttribute(
        '[data-testid="skill-tab-library"]',
        "aria-selected",
      )) === "true",
    15_000,
    "服务=web 事实=打开面板应默认技能库页签",
  );
}

function libraryCard(name) {
  return page
    .locator('[data-testid="skill-library-card"]')
    .filter({ hasText: name });
}

function myRow(name) {
  return page.locator('[data-testid="skill-my-row"]').filter({ hasText: name });
}

async function waitCardCount(expected, message) {
  await waitFor(
    async () =>
      (await page.locator('[data-testid="skill-library-card"]').count()) ===
      expected,
    15_000,
    message,
  );
}

/** 捕获 POST /api/agent/skills/library 请求体（精确路径，不含 /add）。 */
function captureLibraryRequests() {
  const requests = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/agent/skills/library"
    ) {
      requests.push(request.postDataJSON());
    }
  });
  return requests;
}

/** 捕获 POST /api/generation-inbox/messages 请求体与 202 回执 data。 */
function captureInboxMessages() {
  const bodies = [];
  const receipts = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/generation-inbox/messages"
    ) {
      bodies.push(request.postDataJSON());
    }
  });
  page.on("response", (response) => {
    if (
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/generation-inbox/messages" &&
      response.status() === 202
    ) {
      void response.json().then((envelope) => receipts.push(envelope.data));
    }
  });
  return { bodies, receipts };
}

async function sendInboxMessage(content) {
  await page.getByLabel("消息输入框").fill(content);
  await page.getByRole("button", { name: "发送" }).click();
}

async function waitRunCompleted(receipt) {
  await waitFor(
    async () => {
      const snapshot = await fetchSnapshot(receipt.project_id, user.token);
      const run = snapshot.agent_runs.find(
        (candidate) =>
          String(candidate.agent_run_id) === String(receipt.agent_run_id),
      );
      return run?.status === "completed" ? true : null;
    },
    120_000,
    "服务=agent-worker 事实=AgentRun 应完成",
  );
}

// ---- 7 条主路径（串行，状态在同一用户内递进） ----

test("主路径1 默认页签：打开面板默认技能库，默认查询渲染种子技能", async () => {
  const libraryRequests = captureLibraryRequests();
  await gotoHome();
  await openSkillPanel();

  await waitFor(
    () => libraryRequests.length > 0,
    15_000,
    "服务=web 事实=打开面板应请求技能库",
  );
  assert.deepEqual(
    {
      pageNum: libraryRequests[0].pageNum,
      category: libraryRequests[0].category,
      sort: libraryRequests[0].sort,
    },
    { pageNum: 1, category: "all", sort: "featured" },
    "服务=web 事实=默认查询应为 pageNum=1/category=all/sort=featured",
  );

  await waitCardCount(3, "服务=web 事实=技能库应渲染 3 张种子技能卡片");
  for (const name of SEED_SKILLS) {
    await libraryCard(name).first().waitFor({ timeout: 15_000 });
  }
}, 120_000);

test("主路径2 查询状态保留：切页签保留搜索，关闭重开重置回默认", async () => {
  const libraryRequests = captureLibraryRequests();
  await gotoHome();
  await openSkillPanel();
  await waitFor(() => libraryRequests.length === 1, 15_000, "服务=web 事实=打开应发一次默认请求");

  // 搜索「Storyboard」→ 仅命中 Acceptance Storyboard
  await page.getByTestId("skill-search-input").fill("Storyboard");
  await page.getByTestId("skill-search-submit").click();
  await waitFor(
    () => libraryRequests.length === 2,
    15_000,
    "服务=web 事实=搜索应触发带关键词的请求",
  );
  assert.equal(
    libraryRequests[1].keyword,
    "Storyboard",
    "服务=web 事实=搜索请求应携带关键词",
  );
  await waitCardCount(1, "服务=web 事实=搜索应只命中 1 张卡片");

  // 切到我的技能再切回：关键词/结果保留，不重发请求
  await page.getByTestId("skill-tab-my").click();
  await page.getByTestId("skill-tab-library").click();
  assert.equal(
    await page.inputValue('[data-testid="skill-search-input"]'),
    "Storyboard",
    "服务=web 事实=切页签后搜索词应保留",
  );
  assert.equal(
    await page.locator('[data-testid="skill-library-card"]').count(),
    1,
    "服务=web 事实=切页签后搜索结果应保留",
  );
  assert.equal(
    libraryRequests.length,
    2,
    "服务=web 事实=切页签不得重发技能库请求",
  );

  // 关闭重开：重置回默认查询并重发请求
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-testid="skill-panel"]', {
    state: "hidden",
  });
  await openSkillPanel();
  await waitFor(
    () => libraryRequests.length === 3,
    15_000,
    "服务=web 事实=重开面板应重发默认请求",
  );
  assert.deepEqual(
    {
      pageNum: libraryRequests[2].pageNum,
      category: libraryRequests[2].category,
      sort: libraryRequests[2].sort,
    },
    { pageNum: 1, category: "all", sort: "featured" },
    "服务=web 事实=重开后查询应重置回默认",
  );
  assert.equal(
    await page.inputValue('[data-testid="skill-search-input"]'),
    "",
    "服务=web 事实=重开后搜索词应清空",
  );
  await waitCardCount(3, "服务=web 事实=重开后应恢复全部种子卡片");
}, 120_000);

test("主路径3 添加与移除：官方技能进出我的技能", async () => {
  await gotoHome();
  await openSkillPanel();
  await waitCardCount(3, "服务=web 事实=技能库应渲染种子卡片");

  // 添加：提示 + 停留技能库 + 按钮变「已添加」不可点
  const addBtn = libraryCard(STORYBOARD_NAME).getByTestId(
    "skill-library-add-btn",
  );
  assert.equal(
    (await addBtn.innerText()).trim(),
    "添加",
    "服务=web 事实=未添加时按钮应为添加",
  );
  await addBtn.click();
  await page.locator("text=技能已添加").first().waitFor({ timeout: 15_000 });
  assert.equal(
    await page.getAttribute(
      '[data-testid="skill-tab-library"]',
      "aria-selected",
    ),
    "true",
    "服务=web 事实=添加后应停留技能库页签",
  );
  await waitFor(
    async () => (await addBtn.innerText()).trim() === "已添加",
    15_000,
    "服务=web 事实=添加后按钮应变已添加",
  );
  assert.ok(await addBtn.isDisabled(), "服务=web 事实=已添加按钮应不可点击");

  // 我的技能出现该行；菜单仅「移出我的技能」，点击立即生效
  await page.getByTestId("skill-tab-my").click();
  const row = myRow(STORYBOARD_NAME);
  await row.waitFor({ timeout: 15_000 });
  await row.getByTestId("skill-my-row-menu").click();
  const menu = page.locator('[role="menu"]');
  await menu.waitFor({ timeout: 15_000 });
  assert.equal(
    await menu.locator('[role="menuitem"]').count(),
    1,
    "服务=web 事实=官方行菜单应仅一项",
  );
  await menu.getByTestId("skill-my-row-remove").click();
  await page
    .locator("text=已从我的技能移出")
    .first()
    .waitFor({ timeout: 15_000 });
  assert.equal(
    await myRow(STORYBOARD_NAME).count(),
    0,
    "服务=web 事实=移除后行应立即消失",
  );

  // 切回技能库：按钮恢复「添加」可再次点击
  await page.getByTestId("skill-tab-library").click();
  await waitFor(
    async () => (await addBtn.innerText()).trim() === "添加",
    15_000,
    "服务=web 事实=移除后技能库按钮应恢复添加",
  );
  assert.ok(await addBtn.isEnabled(), "服务=web 事实=恢复后按钮应可点击");
}, 120_000);

test("主路径4 直接使用：一次性 forced 绑定驱动真实 AgentRun 并落库", async () => {
  const { bodies, receipts } = captureInboxMessages();
  const addCalls = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/add")) addCalls.push(1);
  });

  // 首页技能库点「直接使用」：关面板、出标签、不自动发送、不建引用
  await gotoHome();
  await openSkillPanel();
  await libraryCard(STORYBOARD_NAME)
    .getByRole("button", { name: /直接使用/ })
    .click();
  await page.waitForSelector('[data-testid="skill-panel"]', {
    state: "hidden",
  });
  const tag = page.locator('[data-testid="direct-skill-tag"]');
  await tag.waitFor({ timeout: 15_000 });
  assert.ok(
    (await tag.innerText()).includes(STORYBOARD_NAME),
    "服务=web 事实=技能标签应显示技能名",
  );
  await page.waitForTimeout(1_000);
  assert.equal(
    bodies.length,
    0,
    "服务=web 事实=直接使用不得自动发送消息",
  );
  assert.equal(
    addCalls.length,
    0,
    "服务=web 事实=直接使用不得创建我的技能引用",
  );

  // 绑定经 sessionStorage 带到 /generate；发送携带 forced_creative_skill_id
  await page.goto(`${baseUrl}/generate`, { waitUntil: "domcontentloaded" });
  await tag.waitFor({ timeout: 15_000 });
  // fake:delay 保持 Run 未终态，为 UI 运行状态断言留出确定性窗口
  await sendInboxMessage("黑盒直接技能 fake:delay:5000");
  await waitFor(
    () => bodies.length === 1,
    30_000,
    "服务=web 事实=应发出收件箱消息",
  );
  assert.equal(
    bodies[0].forced_creative_skill_id,
    STORYBOARD_ID,
    "服务=web 事实=发送应携带一次性 forced 绑定",
  );

  // UI 运行状态：「使用技能：名称」（本地绑定名优先，fake:delay 窗口内稳定可见）
  await page.waitForSelector('[data-testid="run-skill-status"]', {
    timeout: 30_000,
  });
  assert.equal(
    (await page.locator('[data-testid="run-skill-status"]').innerText()).trim(),
    `使用技能：${STORYBOARD_NAME}`,
    "服务=web 事实=运行状态应显示使用技能名称",
  );
  // 一次性消费：标签消失
  await page.waitForSelector('[data-testid="direct-skill-tag"]', {
    state: "hidden",
  });

  // 完整 AgentRun 完成 + 只读 SQL 核验 forced 激活落库
  await waitFor(() => receipts.length === 1, 30_000, "服务=web 事实=应收到 202 回执");
  await waitRunCompleted(receipts[0]);
  assert.equal(
    mysqlQuery(
      `SELECT activation_source FROM creative_skill_activation WHERE agent_run_id='${receipts[0].agent_run_id}' AND creative_skill_id='${STORYBOARD_ID}'`,
    ),
    "forced",
    "服务=mysql 事实=forced 激活应落 creative_skill_activation",
  );

  // 一次性语义：第二条消息不再携带 forced 字段
  await sendInboxMessage("黑盒第二条普通消息");
  await waitFor(
    () => bodies.length === 2,
    30_000,
    "服务=web 事实=应发出第二条消息",
  );
  assert.ok(
    !("forced_creative_skill_id" in bodies[1]),
    "服务=web 事实=第二条消息不得再携带 forced 绑定",
  );
  await waitFor(() => receipts.length === 2, 30_000, "服务=web 事实=应收到第二条回执");
  await waitRunCompleted(receipts[1]);
}, 300_000);

test("主路径5 自动匹配：auto 开关驱动服务端确定性激活并落库", async () => {
  const { bodies, receipts } = captureInboxMessages();
  const autoCalls = [];
  page.on("request", (request) => {
    if (
      request.method() === "PATCH" &&
      new URL(request.url()).pathname ===
        `/api/agent/skills/mine/${STORYBOARD_ID}`
    ) {
      autoCalls.push(request.postDataJSON());
    }
  });

  // 重新添加 Acceptance Storyboard 并开启 auto（此刻唯一 auto 候选，激活确定性）
  await gotoHome();
  await openSkillPanel();
  await libraryCard(STORYBOARD_NAME)
    .getByTestId("skill-library-add-btn")
    .click();
  await page.locator("text=技能已添加").first().waitFor({ timeout: 15_000 });
  await page.getByTestId("skill-tab-my").click();
  const switchOn = page.getByRole("switch", {
    name: `开启自动应用：${STORYBOARD_NAME}`,
  });
  await switchOn.waitFor({ timeout: 15_000 });
  assert.equal(
    await switchOn.getAttribute("aria-checked"),
    "false",
    "服务=web 事实=auto 默认应关闭",
  );
  await switchOn.click();
  await waitFor(
    () => autoCalls.length === 1,
    15_000,
    "服务=web 事实=开关应触发 auto 请求",
  );
  assert.deepEqual(autoCalls[0], { auto: true }, "服务=web 事实=应开启 auto");
  const switchOff = page.getByRole("switch", {
    name: `关闭自动应用：${STORYBOARD_NAME}`,
  });
  await switchOff.waitFor({ timeout: 15_000 });
  assert.equal(
    await switchOff.getAttribute("aria-checked"),
    "true",
    "服务=web 事实=点击后 auto 应开启",
  );

  // 发送消息：无 forced 绑定，服务端 auto 确定性激活唯一候选
  await page.goto(`${baseUrl}/generate`, { waitUntil: "domcontentloaded" });
  await sendInboxMessage("黑盒自动技能 fake:delay:5000");
  await waitFor(() => bodies.length === 1, 30_000, "服务=web 事实=应发出收件箱消息");
  assert.ok(
    !("forced_creative_skill_id" in bodies[0]),
    "服务=web 事实=auto 旅程不得携带 forced 绑定",
  );

  // UI 运行状态只显示技能名，不显示来源
  await page.waitForSelector('[data-testid="run-skill-status"]', {
    timeout: 30_000,
  });
  const statusText = (
    await page.locator('[data-testid="run-skill-status"]').innerText()
  ).trim();
  assert.equal(
    statusText,
    `使用技能：${STORYBOARD_NAME}`,
    "服务=web 事实=运行状态应只显示技能名",
  );
  assert.ok(
    !statusText.includes("自动") && !statusText.includes("auto"),
    "服务=web 事实=运行状态不得显示激活来源",
  );

  // 完整 AgentRun 完成 + 只读 SQL 核验 auto 激活落库
  await waitFor(() => receipts.length === 1, 30_000, "服务=web 事实=应收到 202 回执");
  await waitRunCompleted(receipts[0]);
  assert.equal(
    mysqlQuery(
      `SELECT activation_source FROM creative_skill_activation WHERE agent_run_id='${receipts[0].agent_run_id}' AND creative_skill_id='${STORYBOARD_ID}'`,
    ),
    "auto",
    "服务=mysql 事实=auto 激活应落 creative_skill_activation",
  );
}, 300_000);

test("主路径6 官方与个人差异：创建个人技能后两域标记与菜单分化", async () => {
  const personalReceipts = [];
  page.on("response", (response) => {
    if (
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/agent/skills/personal"
    ) {
      void response.json().then((envelope) => personalReceipts.push(envelope));
    }
  });

  // 经真实 UI 创建个人技能（编写模式）
  await gotoHome();
  await openSkillPanel();
  await page.getByTestId("skill-tab-create").click();
  await page.getByTestId("skill-md-editor").fill(PERSONAL_SKILL_MD);
  await page.getByTestId("skill-save-btn").click();
  await page.locator("text=技能已保存").first().waitFor({ timeout: 15_000 });
  await waitFor(
    async () =>
      (await page.getAttribute(
        '[data-testid="skill-tab-my"]',
        "aria-selected",
      )) === "true",
    15_000,
    "服务=web 事实=保存后应自动切到我的技能",
  );
  await waitFor(
    () => personalReceipts.length === 1,
    15_000,
    "服务=web 事实=应发出个人技能创建请求",
  );
  assert.equal(personalReceipts[0].code, 200, "服务=web 事实=创建应成功");
  personalSkillId = personalReceipts[0].data?.creative_skill_id;
  assert.equal(
    typeof personalSkillId,
    "string",
    "服务=web 事实=应返回个人技能身份",
  );

  // 两域并集：我的技能行的官方/个人徽标（徽标文本不带 @，d7e28b96 后形态）
  await myRow(STORYBOARD_NAME).getByText("官方").waitFor({ timeout: 15_000 });
  await myRow(PERSONAL_SKILL_NAME).getByText("个人").waitFor({ timeout: 15_000 });

  // 菜单分化：官方行仅「移出我的技能」；个人行「查看技能/删除技能」
  const officialRow = myRow(STORYBOARD_NAME);
  await officialRow.getByTestId("skill-my-row-menu").click();
  const officialMenu = page.locator('[role="menu"]');
  await officialMenu.waitFor({ timeout: 15_000 });
  assert.equal(
    await officialMenu.locator('[role="menuitem"]').count(),
    1,
    "服务=web 事实=官方行菜单应仅移出一项",
  );
  await officialMenu.getByTestId("skill-my-row-remove").waitFor();
  await page.keyboard.press("Escape");

  const personalRow = myRow(PERSONAL_SKILL_NAME);
  await personalRow.getByTestId("skill-my-row-menu").click();
  const personalMenu = page.locator('[role="menu"]');
  await personalMenu.waitFor({ timeout: 15_000 });
  assert.equal(
    await personalMenu.locator('[role="menuitem"]').count(),
    2,
    "服务=web 事实=个人行菜单应有查看/删除两项",
  );
  await personalMenu.getByTestId("skill-my-row-view").waitFor();
  await personalMenu.getByTestId("skill-my-row-delete").waitFor();
  await page.keyboard.press("Escape");

  // 公开 API：官方技能走个人只读端点一律 100100，不泄漏官方内容
  const officialRead = await requestJson(
    `/api/agent/skills/personal/${STORYBOARD_ID}`,
    { headers: { Authorization: `Bearer ${user.token}` } },
  );
  assert.equal(
    officialRead.body.code,
    100100,
    "服务=web 事实=官方技能经个人只读端点应按不存在处理",
  );
  assert.equal(
    officialRead.body.data,
    null,
    "服务=web 事实=官方技能经个人只读端点不得返回内容",
  );
}, 120_000);

test("主路径7 永久删除：确认后物理删除个人技能", async () => {
  assert.equal(
    typeof personalSkillId,
    "string",
    "主路径6 应已创建个人技能",
  );

  await gotoHome();
  await openSkillPanel();
  await page.getByTestId("skill-tab-my").click();
  const personalRow = myRow(PERSONAL_SKILL_NAME);
  await personalRow.waitFor({ timeout: 15_000 });
  await personalRow.getByTestId("skill-my-row-menu").click();
  await page.getByTestId("skill-my-row-delete").click();

  // 确认框：技能名 + 不可逆文案
  const dialog = page.locator('[data-testid="skill-personal-delete-dialog"]');
  await dialog.waitFor({ timeout: 15_000 });
  const dialogText = await dialog.innerText();
  assert.ok(
    dialogText.includes(`确认删除「${PERSONAL_SKILL_NAME}」？`),
    "服务=web 事实=确认框应显示技能名",
  );
  assert.ok(
    dialogText.includes("不可查看、复制或复用"),
    "服务=web 事实=确认框应显示不可逆文案",
  );

  await page.getByTestId("skill-personal-delete-confirm").click();
  await page.locator("text=技能已删除").first().waitFor({ timeout: 15_000 });
  assert.equal(
    await myRow(PERSONAL_SKILL_NAME).count(),
    0,
    "服务=web 事实=删除后行应立即消失",
  );

  // 只读 SQL：本体与版本行物理删除
  assert.equal(
    Number(
      mysqlQuery(
        `SELECT COUNT(*) FROM creative_skill WHERE creative_skill_id='${personalSkillId}'`,
      ),
    ),
    0,
    "服务=mysql 事实=个人技能本体应物理删除",
  );
  assert.equal(
    Number(
      mysqlQuery(
        `SELECT COUNT(*) FROM creative_skill_version WHERE creative_skill_id='${personalSkillId}'`,
      ),
    ),
    0,
    "服务=mysql 事实=个人技能版本应物理删除",
  );

  // 公开 API：删除后只读端点按不存在处理
  const deletedRead = await requestJson(
    `/api/agent/skills/personal/${personalSkillId}`,
    { headers: { Authorization: `Bearer ${user.token}` } },
  );
  assert.equal(
    deletedRead.body.code,
    100100,
    "服务=web 事实=删除后只读端点应返回 100100",
  );
  assert.equal(
    deletedRead.body.data,
    null,
    "服务=web 事实=删除后只读端点不得返回内容",
  );
}, 120_000);
