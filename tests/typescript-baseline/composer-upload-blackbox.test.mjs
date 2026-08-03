// Node-only 浏览器层黑盒验收：上传与 AssetMention 编辑闭环（IK67GX T03）。
// 从真实 AgentChatPanel UI 驱动，断言面 = UI 可见事实 + 公开 API + 只读 SQL；
// 不 import 产品源码，不断言私有 helper 调用。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const baseUrl = process.env.BW_ACCEPTANCE_WEB_URL ?? "http://127.0.0.1:3101";
const storageStubUrl =
  process.env.BW_ACCEPTANCE_STORAGE_STUB_URL ?? "http://127.0.0.1:4330";
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
  ).trim();
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

// storage-stub 场景控制（仿 provider-stub）：PUT 延迟/失败注入。
async function setStorageScenario(scenario) {
  const response = await fetch(`${storageStubUrl}/__acceptance/scenarios`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(scenario),
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, 200, "服务=storage-stub 事实=场景应可配置");
}

async function resetStorageScenario() {
  const response = await fetch(`${storageStubUrl}/__acceptance/scenarios`, {
    method: "DELETE",
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, 200, "服务=storage-stub 事实=场景应可复位");
}

async function registerUser(label) {
  const suffix = `${Date.now()}${process.pid}`;
  const username = `${label.slice(0, 8)}${suffix.slice(-9)}`;
  const password = `Ac${suffix.slice(-12)}!xY9`;
  const registration = await postJson("/api/auth/register", {
    username,
    password,
  });
  assert.equal(registration.response.status, 200, "服务=web 事实=注册应成功");
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
  assert.equal(created.response.status, 200, "服务=web 事实=创建 Project 应成功");
  return String(created.body.data?.id);
}

function assetCount(userId) {
  return Number(
    mysqlQuery(
      `SELECT COUNT(*) FROM assets WHERE user_id=${userId} AND is_delete=0`,
    ),
  );
}

// 画布序列化把 assetId 落成 JSON 数字（serialize → wireInteger），且保存有 800ms 去抖：
// 断言用 JSON_TABLE 取节点的 assetId 与 position 坐标（布局事实），并轮询等待保存 flush。
async function waitForNodeWithAsset(projectId, assetId) {
  await waitFor(
    async () => {
      const count = Number(
        mysqlQuery(
          `SELECT COUNT(*) FROM canvas, JSON_TABLE(nodes_json, '$[*]' COLUMNS (assetId BIGINT PATH '$.assetId', posX DOUBLE PATH '$.position.x', posY DOUBLE PATH '$.position.y')) AS jt WHERE project_id=${projectId} AND assetId=${assetId} AND posX IS NOT NULL AND posY IS NOT NULL`,
        ),
      );
      return count === 1 ? true : null;
    },
    30_000,
    `服务=mysql 事实=画布应持久化并放置引用该 Asset(${assetId}) 的节点`,
  );
}

function messageCount(projectId) {
  return Number(
    mysqlQuery(
      `SELECT COUNT(*) FROM conversation_messages WHERE project_id=${projectId} AND is_delete=0`,
    ),
  );
}

// 1x1 透明 PNG（合法图片字节，供尺寸探测）。
const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk" +
    "YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
// 视频/音频只走字节持久化链路，内容不参与解码（元数据探测超时回退）。
const mp4Bytes = Buffer.from("acceptance-fake-mp4-bytes");
const mp3Bytes = Buffer.from("acceptance-fake-mp3-bytes");

let browser;
let context;
let page;
let user;
let projectId;

before(async () => {
  user = await registerUser("upload");
  projectId = await createProject("上传验收", user.token);
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
  await page.goto(`${baseUrl}/canvas?project=${projectId}`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByLabel("Canvas Agent").click();
  await page.waitForSelector(".tc-agent-chat-panel", { timeout: 30_000 });
}, 120_000);

after(async () => {
  await resetStorageScenario().catch(() => {});
  await browser?.close();
});

test("图/视/音上传闭环：状态流转、pill、持久化 Asset 与 NodeItem、上传中禁发送", async () => {
  // 先输入文字使发送可用：上传期间变禁用才能归因于上传门禁
  await page.click(".tc-agent-composer-editor");
  await page.keyboard.type("上传门禁文本");
  assert.equal(
    await page.locator(".tc-agent-send-btn").isDisabled(),
    false,
    "服务=web 事实=有输入内容时发送应可用",
  );

  // 首个 PUT 注入 2s 延迟，确定性观察「上传中」与发送门禁
  await setStorageScenario({ put: { mode: "success", delayMs: 2000, times: 1 } });
  await page.setInputFiles(".tc-agent-composer-file-input", {
    name: "acceptance-image.png",
    mimeType: "image/png",
    buffer: pngBytes,
  });

  await page.waitForSelector('[data-composer-upload-status="uploading"]', {
    timeout: 15_000,
  });
  assert.equal(
    await page.locator(".tc-agent-send-btn").isDisabled(),
    true,
    "服务=web 事实=存在未完成上传时发送应禁用",
  );
  // Enter 快捷发送同受门禁（handleSend 入口拦截，不得发消息接纳请求）
  const gatePosts = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/conversation/messages")
    ) {
      gatePosts.push(request.url());
    }
  });
  await page.locator(".tc-agent-composer-editor").click();
  await page.locator(".tc-agent-composer-editor").press("Enter");
  await page.waitForTimeout(300);
  assert.equal(
    gatePosts.length,
    0,
    "服务=web 事实=上传中按 Enter 不得提交消息",
  );

  await page.waitForSelector('[data-composer-upload-status="success"]', {
    timeout: 30_000,
  });
  await resetStorageScenario();

  // 成功上传自动插入可移除 pill（携带 assetId）
  const pillAssetId = await page.waitForFunction(
    () =>
      document
        .querySelector(".tc-agent-composer-editor [data-mention-asset-id]")
        ?.getAttribute("data-mention-asset-id") ?? null,
    null,
    { timeout: 15_000 },
  );
  assert.ok(pillAssetId, "服务=web 事实=成功上传应插入带 assetId 的 pill");
  // pill 计入输入内容后发送恢复可用
  assert.equal(
    await page.locator(".tc-agent-send-btn").isDisabled(),
    false,
    "服务=web 事实=上传完成后发送应恢复可用",
  );

  // 持久化 Asset：归属本项目、来源 uploaded、状态 normal
  const assetRows = mysqlQuery(
    `SELECT id, project_id, source, status FROM assets WHERE id=${pillAssetId}`,
  ).split("\t");
  assert.equal(assetRows[1], projectId, "服务=mysql 事实=Asset 应归属当前 Project");
  assert.equal(assetRows[2], "uploaded", "服务=mysql 事实=Asset 来源应为 uploaded");
  assert.equal(assetRows[3], "normal", "服务=mysql 事实=Asset 状态应为 normal");

  // NodeItem 事实：画布节点引用该 assetId（首次放置已发生，等待保存 flush）
  await waitForNodeWithAsset(projectId, pillAssetId);

  // 视频与音频走同一闭环
  await page.setInputFiles(".tc-agent-composer-file-input", {
    name: "acceptance-video.mp4",
    mimeType: "video/mp4",
    buffer: mp4Bytes,
  });
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-composer-upload-status="success"]')
        .length === 2,
    null,
    { timeout: 60_000 },
  );
  await page.setInputFiles(".tc-agent-composer-file-input", {
    name: "acceptance-audio.mp3",
    mimeType: "audio/mpeg",
    buffer: mp3Bytes,
  });
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-composer-upload-status="success"]')
        .length === 3,
    null,
    { timeout: 60_000 },
  );

  const pillCount = await page
    .locator(".tc-agent-composer-editor [data-mention-asset-id]")
    .count();
  assert.equal(pillCount, 3, "服务=web 事实=三次成功上传应有三个 pill");
  const uploadedRows = mysqlQuery(
    `SELECT COUNT(*) FROM assets WHERE user_id=${user.userId} AND project_id=${projectId} AND source='uploaded' AND is_delete=0`,
  );
  assert.equal(uploadedRows, "3", "服务=mysql 事实=图/视/音应各持久化一个 Asset");
}, 300_000);

test("失败上传单独重试成功：Asset/节点/pill 各恰一个，不重复创建", async () => {
  const before = assetCount(user.userId);

  await setStorageScenario({ put: { mode: "fail", status: 500, times: 1 } });
  await page.setInputFiles(".tc-agent-composer-file-input", {
    name: "acceptance-retry.png",
    mimeType: "image/png",
    buffer: pngBytes,
  });
  const errorEntry = page.locator('[data-composer-upload-status="error"]');
  await errorEntry.waitFor({ timeout: 30_000 });
  const entryId = await errorEntry.getAttribute("data-composer-upload-entry");
  assert.ok(entryId, "服务=web 事实=失败上传应展示失败状态条目");
  assert.equal(
    assetCount(user.userId),
    before,
    "服务=mysql 事实=失败上传不得产生 Asset",
  );

  await resetStorageScenario();
  await page.click(`[data-composer-upload-entry="${entryId}"] [data-composer-upload-retry]`);
  await page.waitForSelector(
    `[data-composer-upload-entry="${entryId}"][data-composer-upload-status="success"]`,
    { timeout: 60_000 },
  );

  // 重试只新增一个 Asset（会话复用，不重复创建）
  const after = assetCount(user.userId);
  assert.equal(after, before + 1, "服务=mysql 事实=重试成功后 Asset 应恰新增一个");
  const retriedAssetId = mysqlQuery(
    `SELECT id FROM assets WHERE user_id=${user.userId} AND is_delete=0 ORDER BY id DESC LIMIT 1`,
  );
  await waitForNodeWithAsset(projectId, retriedAssetId);
  const pillForRetry = await page
    .locator(
      `.tc-agent-composer-editor [data-mention-asset-id="${retriedAssetId}"]`,
    )
    .count();
  assert.equal(pillForRetry, 1, "服务=web 事实=重试成功后 pill 应恰一个");
}, 300_000);

test("失败上传可移除：输入文字与其他成功上传保持不变", async () => {
  await page.click(".tc-agent-composer-editor");
  await page.keyboard.type("保留我");

  const successBefore = await page
    .locator('[data-composer-upload-status="success"]')
    .count();
  const assetsBefore = assetCount(user.userId);

  await setStorageScenario({ put: { mode: "fail", status: 500, times: 1 } });
  await page.setInputFiles(".tc-agent-composer-file-input", {
    name: "acceptance-remove.png",
    mimeType: "image/png",
    buffer: pngBytes,
  });
  await page
    .locator('[data-composer-upload-status="error"]')
    .last()
    .waitFor({ timeout: 30_000 });
  await page
    .locator('[data-composer-upload-status="error"] [data-composer-upload-remove]')
    .last()
    .click();
  await resetStorageScenario();

  assert.equal(
    await page.locator('[data-composer-upload-status="error"]').count(),
    0,
    "服务=web 事实=失败条目移除后应消失",
  );
  const editorText = await page.evaluate(
    () =>
      document.querySelector(".tc-agent-composer-editor")?.innerText ?? "",
  );
  assert.ok(editorText.includes("保留我"), "服务=web 事实=输入文字应保持不变");
  assert.equal(
    await page.locator('[data-composer-upload-status="success"]').count(),
    successBefore,
    "服务=web 事实=其他成功上传条目应保持不变",
  );
  assert.equal(
    assetCount(user.userId),
    assetsBefore,
    "服务=mysql 事实=移除失败上传不得产生 Asset",
  );

  // 成功条目移除时同步摘掉对应 pill（Asset 持久化事实不受影响）
  const firstSuccess = page
    .locator('[data-composer-upload-status="success"]')
    .first();
  const targetAssetId = await firstSuccess.getAttribute(
    "data-composer-upload-asset",
  );
  assert.ok(targetAssetId, "服务=web 事实=成功条目应携带 assetId");
  await firstSuccess.locator("[data-composer-upload-remove]").click();
  assert.equal(
    await page
      .locator(
        `.tc-agent-composer-editor [data-mention-asset-id="${targetAssetId}"]`,
      )
      .count(),
    0,
    "服务=web 事实=移除成功条目应同步摘掉输入区 pill",
  );
  assert.equal(
    assetCount(user.userId),
    assetsBefore,
    "服务=mysql 事实=移除条目不得删除已持久化 Asset",
  );
}, 300_000);

test("已有素材「添加到聊天」只插入可移除 pill，不自动发送消息", async () => {
  const messagesBefore = messageCount(projectId);
  const pillBefore = await page
    .locator(".tc-agent-composer-editor [data-mention-asset-id]")
    .count();

  const node = page.locator(".react-flow__node").first();
  await node.click({ button: "right" });
  await page
    .locator('[data-testid="node-context-menu"] [data-action="add-to-chat"]')
    .click();

  await page.waitForFunction(
    (expected) =>
      document.querySelectorAll(
        ".tc-agent-composer-editor [data-mention-asset-id]",
      ).length === expected,
    pillBefore + 1,
    { timeout: 15_000 },
  );

  // 给任何潜在自动提交留出暴露窗口
  await page.waitForTimeout(1_500);
  assert.equal(
    messageCount(projectId),
    messagesBefore,
    "服务=mysql 事实=添加到对话不得自动发送消息",
  );
  assert.equal(
    await page.locator(".tc-agent-user-bubble").count(),
    0,
    "服务=web 事实=添加到对话不得产生消息气泡",
  );
}, 180_000);
