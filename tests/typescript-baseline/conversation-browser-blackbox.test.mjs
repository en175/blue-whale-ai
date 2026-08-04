// Node-only 浏览器层黑盒验收：持久化 Conversation 基础闭环（IK67GD T02）。
// 从真实 AgentChatPanel UI 驱动，断言面 = UI 可见事实 + 公开 API + Snapshot + 只读 SQL；
// 不 import 产品源码，不断言私有 helper 调用。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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

let sequence = 0;
function uniqueKey(prefix) {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
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

async function createProject(label, token) {
  const created = await postJson(
    "/api/projects",
    { name: `${label} ${Date.now()}` },
    token,
  );
  assert.equal(
    created.response.status,
    200,
    "服务=web 事实=创建 Project 应成功",
  );
  return String(created.body.data?.id);
}

async function fetchSnapshot(projectId, token) {
  const { response, body } = await requestJson(
    `/api/projects/${projectId}/snapshot`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  assert.equal(response.status, 200, "服务=web 事实=Snapshot 应可读");
  return body.data;
}

function fakeAgentEcho(prompt, resourceDigest = null) {
  const skillFingerprint = resourceDigest
    ? `\ncreative-skill:${resourceDigest}`
    : "";
  const fingerprint = createHash("sha256")
    .update(`blue-whale-agent-fake-v1\n${prompt}${skillFingerprint}`)
    .digest("hex");
  return `fake-agent-response:${fingerprint}`;
}

// ---- 共享浏览器上下文（同一用户、同一登录态，跨测试串行复用） ----

let browser;
let context;
let page;
let user;
let projectA;
let projectB;

before(async () => {
  user = await registerUser("browser");
  projectA = await createProject("浏览器验收A", user.token);
  projectB = await createProject("浏览器验收B", user.token);
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

async function openCanvas(projectId) {
  await page.goto(`${baseUrl}/canvas?project=${projectId}`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByLabel("Canvas Agent").click();
  await page.waitForSelector(".tc-agent-chat-panel", { timeout: 30_000 });
}

test("空 Project 显示欢迎态，预设只填输入框不发送", async () => {
  await openCanvas(projectA);
  await page.waitForSelector(".tc-agent-welcome", { timeout: 30_000 });

  const conversationPosts = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/conversation/messages")
    ) {
      conversationPosts.push(request.url());
    }
  });

  await page.click(".tc-agent-welcome-preset");
  const editorText = await page.evaluate(
    () =>
      document.querySelector(".tc-agent-composer-editor")?.innerText ?? "",
  );
  assert.ok(
    editorText.trim().length > 0,
    "服务=web 事实=预设应填入输入框",
  );
  // 给用户侧任何潜在异步提交留出暴露窗口
  await page.waitForTimeout(1_000);
  assert.equal(
    conversationPosts.length,
    0,
    "服务=web 事实=预设点击不得触发消息提交",
  );
  assert.equal(
    await page.locator(".tc-agent-user-bubble").count(),
    0,
    "服务=web 事实=预设点击不得产生消息气泡",
  );
  const snapshot = await fetchSnapshot(projectA, user.token);
  assert.equal(
    snapshot.conversation_messages.length,
    0,
    "服务=web 事实=预设点击不得创建产品事实",
  );
}, 120_000);

test("未发送草稿按 Project 保存：刷新与切换 Project 后恢复", async () => {
  // 承接上一测试的已打开面板（projectA）；先清空残留的预设文本
  await page.evaluate(() => {
    const editor = document.querySelector(".tc-agent-composer-editor");
    if (editor) editor.innerText = "";
    editor?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.click(".tc-agent-composer-editor");
  await page.keyboard.type("草稿A-未发送");
  const draftKeyA = `blue-whale:canvas-composer-draft:${projectA}`;
  assert.equal(
    await page.evaluate((key) => window.localStorage.getItem(key), draftKeyA),
    "草稿A-未发送",
    "服务=web 事实=草稿应按 Project 存入本浏览器",
  );

  // 刷新页面：草稿恢复
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByLabel("Canvas Agent").click();
  await page.waitForSelector(".tc-agent-chat-panel", { timeout: 30_000 });
  await page.waitForFunction(
    () =>
      (
        document.querySelector(".tc-agent-composer-editor")?.innerText ?? ""
      ).includes("草稿A-未发送"),
    null,
    { timeout: 15_000 },
  );

  // 切到 projectB：草稿互不串扰
  await openCanvas(projectB);
  const editorInB = await page.evaluate(
    () =>
      document.querySelector(".tc-agent-composer-editor")?.innerText ?? "",
  );
  assert.ok(
    !editorInB.includes("草稿A-未发送"),
    "服务=web 事实=切换 Project 不得串扰草稿",
  );

  // B 存自己的草稿，再切回 A 验证各自恢复
  await page.click(".tc-agent-composer-editor");
  await page.keyboard.type("草稿B-未发送");
  await openCanvas(projectA);
  await page.waitForFunction(
    () =>
      (
        document.querySelector(".tc-agent-composer-editor")?.innerText ?? ""
      ).includes("草稿A-未发送"),
    null,
    { timeout: 15_000 },
  );
}, 180_000);

test("第一条消息经公开 API 接纳：欢迎态消失，UI/Snapshot/持久化一致", async () => {
  // 清掉草稿，输入正式内容
  await page.evaluate(() => {
    const editor = document.querySelector(".tc-agent-composer-editor");
    if (editor) editor.innerText = "";
    editor?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const content = `验收首条消息 ${Date.now()}`;
  await page.click(".tc-agent-composer-editor");
  await page.keyboard.type(content);

  const acceptResponses = [];
  page.on("response", (response) => {
    if (
      response.request().method() === "POST" &&
      response.url().includes("/conversation/messages")
    ) {
      acceptResponses.push(response);
    }
  });

  await page.getByLabel("发送").click();

  // 公开 API 接纳事实：HTTP 202 + 包络 code=200
  await waitFor(
    async () => acceptResponses.length > 0,
    30_000,
    "服务=web 事实=应发出消息接纳请求",
  );
  const accept = acceptResponses[0];
  assert.equal(
    accept.status(),
    202,
    "服务=web 事实=首条消息接纳应返回 202",
  );
  const envelope = await accept.json();
  assert.equal(envelope.code, 200, "服务=web 事实=接纳包络 code 应为 200");

  // UI：欢迎态消失，用户气泡出现
  await page.waitForSelector(".tc-agent-user-bubble", { timeout: 30_000 });
  assert.equal(
    await page.locator(".tc-agent-welcome").count(),
    0,
    "服务=web 事实=首条消息接纳后欢迎态应消失",
  );
  assert.ok(
    (await page.locator(".tc-agent-user-bubble").first().innerText()).includes(
      content,
    ),
    "服务=web 事实=用户消息气泡应渲染已接纳内容",
  );

  // Agent 回复（fake 确定性回声）经 Snapshot/SSE 投影到 UI
  const expectedReply = fakeAgentEcho(content);
  await page.waitForFunction(
    (expected) =>
      Array.from(
        document.querySelectorAll(".tc-agent-agent-bubble"),
      ).some((el) => el.textContent?.includes(expected)),
    expectedReply,
    { timeout: 90_000 },
  );
  await page.getByLabel("Agent 状态：已完成").waitFor();
  await page.getByText("已完成回答。", { exact: true }).waitFor();

  // 草稿应已清除
  const draftKeyA = `blue-whale:canvas-composer-draft:${projectA}`;
  assert.equal(
    await page.evaluate((key) => window.localStorage.getItem(key), draftKeyA),
    null,
    "服务=web 事实=发送成功后草稿应清除",
  );

  // Snapshot 权威投影：恰两条正式消息，服务端顺序 user→assistant
  const snapshot = await waitFor(
    async () => {
      const current = await fetchSnapshot(projectA, user.token);
      return current.conversation_messages.length === 2 ? current : null;
    },
    90_000,
    "服务=web 事实=Snapshot 应含两条已接纳消息",
  );
  const ordered = [...snapshot.conversation_messages].sort(
    (left, right) => left.sequence_no - right.sequence_no,
  );
  assert.equal(ordered[0].role, "user", "服务=web 事实=首条应为 user");
  assert.equal(ordered[0].content, content, "服务=web 事实=user 内容一致");
  assert.equal(
    ordered[1].role,
    "assistant",
    "服务=web 事实=次条应为 assistant",
  );
  assert.equal(
    ordered[1].content,
    expectedReply,
    "服务=web 事实=assistant 内容应为确定性回声",
  );

  // 持久化事实：唯一 Conversation + 顺序号 1,2
  const conversationCount = Number(
    mysqlQuery(
      `SELECT COUNT(*) FROM conversations WHERE project_id=${projectA} AND is_delete=0`,
    ),
  );
  assert.equal(
    conversationCount,
    1,
    "服务=mysql 事实=普通 Project 只应有一个持久化 Conversation",
  );
  const rows = mysqlQuery(
    `SELECT role, sequence_no FROM conversation_messages WHERE project_id=${projectA} AND is_delete=0 ORDER BY sequence_no`,
  )
    .trim()
    .split("\n")
    .map((line) => line.split("\t"));
  assert.deepEqual(
    rows,
    [
      ["user", "1"],
      ["assistant", "2"],
    ],
    "服务=mysql 事实=正式消息应使用服务端身份与 Conversation 内顺序",
  );
}, 240_000);

test("forced 与 auto Skill 经公开 API 后在 AgentChatPanel 安全恢复", async () => {
  const forcedProject = await createProject("浏览器强制 Skill", user.token);
  const privateBody = `BROWSER_PRIVATE_SKILL_${Date.now()}`;
  const created = await postJson(
    "/api/agent/skills/personal",
    {
      content: `---\nname: Browser Forced\ndescription: acceptance\n---\n${privateBody}`,
    },
    user.token,
  );
  assert.equal(created.body.code, 200);
  const forcedSkillId = created.body.data?.creative_skill_id;
  const forcedKey = uniqueKey("browser-forced");
  await postJson(
    `/api/projects/${forcedProject}/conversation/messages`,
    {
      client_message_id: forcedKey,
      content: "浏览器强制技能消息",
      forced_creative_skill_id: forcedSkillId,
    },
    user.token,
    { "Idempotency-Key": forcedKey },
  );
  const forcedSnapshot = await waitFor(
    async () => {
      const current = await fetchSnapshot(forcedProject, user.token);
      return current.agent_runs?.at(-1)?.status === "completed" ? current : null;
    },
    90_000,
    "服务=agent-worker 事实=浏览器 forced Run 应完成",
  );
  assert.equal(JSON.stringify(forcedSnapshot).includes(privateBody), false);
  await openCanvas(forcedProject);
  await page.getByLabel("已激活技能：Browser Forced").waitFor();
  await page.getByLabel("Agent 状态：已完成").waitFor();
  await page.getByText("已使用「Browser Forced」完成回答。", { exact: true }).waitFor();

  const autoProject = await createProject("浏览器自动 Skill", user.token);
  const added = await postJson(
    "/api/agent/skills/library/acceptance_poster/add",
    {},
    user.token,
  );
  assert.equal(added.body.code, 200);
  const enabled = await requestJson(
    "/api/agent/skills/mine/acceptance_poster",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user.token}`,
      },
      body: JSON.stringify({ auto: true }),
    },
  );
  assert.equal(enabled.body.code, 200);
  const autoKey = uniqueKey("browser-auto");
  await postJson(
    `/api/projects/${autoProject}/conversation/messages`,
    { client_message_id: autoKey, content: "Acceptance Poster" },
    user.token,
    { "Idempotency-Key": autoKey },
  );
  await waitFor(
    async () => {
      const current = await fetchSnapshot(autoProject, user.token);
      return current.agent_runs?.at(-1)?.status === "completed" ? current : null;
    },
    90_000,
    "服务=agent-worker 事实=浏览器 auto Run 应完成",
  );
  await openCanvas(autoProject);
  await page.getByLabel("已激活技能：Acceptance Poster").waitFor();
  await page.getByLabel("Agent 状态：已完成").waitFor();
  await page.getByText("已使用「Acceptance Poster」完成回答。", { exact: true }).waitFor();
}, 300_000);

test("CommandId 幂等：同键同内容重放返回首次结果，同键异内容拒绝", async () => {
  const key = uniqueKey("browser-idem");
  const content = `幂等消息 ${Date.now()}`;
  const body = { client_message_id: key, content };

  const first = await postJson(
    `/api/projects/${projectB}/conversation/messages`,
    body,
    user.token,
    { "Idempotency-Key": key },
  );
  assert.equal(first.response.status, 202, "服务=web 事实=首次提交应接纳");
  const firstMessageId = first.body.data?.message_id;
  assert.ok(firstMessageId, "服务=web 事实=首次提交应返回消息身份");

  const replay = await postJson(
    `/api/projects/${projectB}/conversation/messages`,
    body,
    user.token,
    { "Idempotency-Key": key },
  );
  assert.equal(replay.response.status, 202, "服务=web 事实=重放应返回接纳");
  assert.equal(
    replay.body.data?.message_id,
    firstMessageId,
    "服务=web 事实=同键同内容重放应返回首次结果",
  );

  const conflict = await postJson(
    `/api/projects/${projectB}/conversation/messages`,
    { client_message_id: key, content: `${content}-被篡改` },
    user.token,
    { "Idempotency-Key": key },
  );
  assert.equal(
    conflict.body.code,
    100302,
    "服务=web 事实=同键异内容应拒绝（100302）",
  );


  // 只统计本次命令创建的 user 消息；agent-worker 可能已异步写入 assistant 回复。
  const messageCount = Number(
    mysqlQuery(
      `SELECT COUNT(*) FROM conversation_messages WHERE project_id=${projectB} AND client_message_id='${key}' AND role='user' AND is_delete=0`,
    ),
  );
  assert.equal(
    messageCount,
    1,
    "服务=mysql 事实=重放不得重复创建消息",
  );
}, 120_000);

test("刷新与 Web 重启后历史一致：只恢复已接纳正式消息", async () => {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByLabel("Canvas Agent").click();
  await page.waitForSelector(".tc-agent-chat-panel", { timeout: 30_000 });
  await page.waitForSelector(".tc-agent-user-bubble", { timeout: 30_000 });
  await page.waitForSelector(".tc-agent-agent-bubble", { timeout: 60_000 });
  assert.equal(
    await page.locator(".tc-agent-welcome").count(),
    0,
    "服务=web 事实=有历史的项目刷新后不得回到欢迎态",
  );

  compose("restart", "web");
  await waitFor(
    async () => {
      const response = await fetch(`${baseUrl}/build-info`, {
        signal: AbortSignal.timeout(2_000),
      });
      return response.ok ? true : null;
    },
    120_000,
    "服务=web 事实=重启后应就绪",
  );

  await page.goto(`${baseUrl}/canvas?project=${projectA}`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByLabel("Canvas Agent").click();
  await page.waitForSelector(".tc-agent-chat-panel", { timeout: 60_000 });
  await page.waitForSelector(".tc-agent-user-bubble", { timeout: 60_000 });
  await page.waitForSelector(".tc-agent-agent-bubble", { timeout: 60_000 });

  const userBubbles = await page.locator(".tc-agent-user-bubble").count();
  const agentBubbles = await page.locator(".tc-agent-agent-bubble").count();
  assert.equal(userBubbles, 1, "服务=web 事实=重启后用户消息应恰一条");
  assert.equal(agentBubbles, 1, "服务=web 事实=重启后 Agent 回复应恰一条");
  assert.equal(
    await page.locator(".tc-agent-welcome").count(),
    0,
    "服务=web 事实=重启后不得回到欢迎态",
  );

  // 重启不产生新的持久化消息（SSE/恢复不写产品事实）
  const messageCount = Number(
    mysqlQuery(
      `SELECT COUNT(*) FROM conversation_messages WHERE project_id=${projectA} AND is_delete=0`,
    ),
  );
  assert.equal(messageCount, 2, "服务=mysql 事实=重启前后消息数不变");
}, 300_000);

test("断线后历史保持一致，恢复联网后可继续提交", async () => {
  // 承接上一测试：页面位于 projectA、面板已展开且含两条历史
  await page.locator(".tc-agent-user-bubble").first().waitFor();
  assert.equal(await page.locator(".tc-agent-user-bubble").count(), 1);
  assert.equal(await page.locator(".tc-agent-agent-bubble").count(), 1);

  await context.setOffline(true);
  await page.waitForTimeout(5_000);
  // 断线期间已接纳历史不丢不重
  assert.equal(
    await page.locator(".tc-agent-user-bubble").count(),
    1,
    "服务=web 事实=断线期间用户消息应保持不变",
  );
  assert.equal(
    await page.locator(".tc-agent-agent-bubble").count(),
    1,
    "服务=web 事实=断线期间 Agent 回复应保持不变",
  );
  await context.setOffline(false);

  // 恢复循环自愈后，新消息仍可接纳并投影到 UI
  const content = `断线恢复消息 ${Date.now()}`;
  await page.click(".tc-agent-composer-editor");
  await page.keyboard.type(content);
  await page.getByLabel("发送").click();
  await page.waitForFunction(
    (expected) =>
      Array.from(document.querySelectorAll(".tc-agent-user-bubble")).some(
        (el) => el.textContent?.includes(expected),
      ),
    content,
    { timeout: 60_000 },
  );

  await waitFor(
    async () => {
      const snapshot = await fetchSnapshot(projectA, user.token);
      return snapshot.conversation_messages.some(
        (message) => message.role === "user" && message.content === content,
      )
        ? snapshot
        : null;
    },
    60_000,
    "服务=web 事实=断线恢复后新消息应进入 Snapshot",
  );
}, 300_000);

test("PlanPhase 对齐在 AgentChatPanel 经自然语言推进并展示阶段（IK67GY）", async () => {
  const projectId = await createProject("计划阶段验收", user.token);
  await openCanvas(projectId);

  await page.click(".tc-agent-composer-editor");
  await page.keyboard.type("创作：一张海报");
  await page.getByLabel("发送").click();

  await page.getByLabel("Agent 状态：等待输入").waitFor({ timeout: 60_000 });
  await page.getByLabel("计划阶段：需求对齐").waitFor();
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll(".tc-agent-agent-bubble")).some(
        (el) => el.textContent?.includes("请告诉我这次创作的主体是什么？"),
      ),
    null,
    { timeout: 30_000 },
  );

  // 澄清回答经同一 composer 提交（前端自动绑定可回答的澄清请求）
  await page.click(".tc-agent-composer-editor");
  await page.keyboard.type("主体：蓝鲸，预期：极简海报");
  await page.getByLabel("发送").click();

  await page.getByLabel("计划阶段：待最终确认").waitFor({ timeout: 60_000 });
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll(".tc-agent-agent-bubble")).some(
        (el) =>
          el.textContent?.includes("需求复述：主体「蓝鲸」，预期「极简海报」"),
      ),
    null,
    { timeout: 30_000 },
  );

  await page.click(".tc-agent-composer-editor");
  await page.keyboard.type("同意");
  await page.getByLabel("发送").click();

  await page.getByLabel("Agent 状态：已完成").waitFor({ timeout: 60_000 });
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll(".tc-agent-agent-bubble")).some(
        (el) =>
          el.textContent?.includes(
            "已完成需求对齐：主体「蓝鲸」，预期「极简海报」。",
          ),
      ),
    null,
    { timeout: 30_000 },
  );

  // Snapshot 权威事实：同一 Run 三个推进、每个推进一次 RunCommit
  const snapshot = await fetchSnapshot(projectId, user.token);
  const run = snapshot.agent_runs.at(-1);
  const ordinals = mysqlQuery(
    `SELECT ordinal FROM agent_advances WHERE agent_run_id = ${run.agent_run_id} ORDER BY ordinal;`,
  ).trim().split("\n");
  assert.deepEqual(ordinals, ["1", "2", "3"], "服务=持久化事实=UI 对齐流程应有三个推进");
}, 300_000);
