// Node-only 全栈黑盒：scene_card_create PlanMessage 手动应用闭环（IK67H9 T11，契约 §9）。
// 只经公开 HTTP（POST /plan-messages/{messageId}/apply）、Snapshot 与只读 SQL 断言，不 import 产品源码。
//
// 覆盖 AC：原子 5 事实（#2/#3）、能力漂移零写入（#4）、Canvas 放置（#5）、CommandId 幂等（#6）、
// Snapshot 恢复与跨重启幂等（#7）。视频计划由「出两张」确定性产 image_generate + scene_card_create，
// 本测试取 scene_card_create 那条应用。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { before, test } from "node:test";

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
    "--default-character-set=utf8mb4",
    "blue_whale",
    "-e",
    sql,
  );
}

function mysqlJson(sql) {
  const raw = mysqlQuery(sql);
  return raw ? JSON.parse(raw) : null;
}

async function requestJson(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  return { response, body: await response.json() };
}

async function postJson(path, body, token, idempotencyKey) {
  return requestJson(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
}

let sequence = 0;
function uniqueKey(prefix) {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
}

async function registerUser(label) {
  const suffix = `${Date.now()}${process.pid}${sequence++}`;
  const username = `${label.slice(0, 8)}${suffix.slice(-9)}`;
  const password = `Ac${suffix.slice(-12)}!xY9`;
  const registered = await requestJson("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(registered.body.code, 200, "注册应成功");
  const token = registered.body.data?.access_token;
  const me = await requestJson("/api/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { token, userId: String(me.body.data?.user_id) };
}

async function createProject(name, token) {
  const created = await postJson("/api/projects", { name }, token);
  assert.equal(created.body.code, 200, "Project 创建应成功");
  return String(created.body.data?.id);
}

function insertedId(sql) {
  return mysqlQuery(`${sql}; SELECT LAST_INSERT_ID();`)
    .split("\n")
    .at(-1);
}

async function fetchSnapshot(projectId, token) {
  const result = await requestJson(`/api/projects/${projectId}/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(result.body.code, 200, "Snapshot 应可读");
  return result.body.data;
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
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(
    `${message}${lastError ? `（最后错误：${lastError.message}）` : ""}`,
  );
}

/** Seed image + video 能力行（worker 按 kind 选能力冻结参数）。 */
function seedCapabilities() {
  mysqlQuery(
    "DELETE FROM generation_model_capability WHERE provider_id='t11-doubao'",
  );
  insertedId(`
    INSERT INTO generation_model_capability (
      provider_id, model_id, capability_type, model_label, icon,
      supported_sizes, supported_aspect_ratios, supported_durations, supported_formats,
      default_size, default_format, default_aspect_ratio, default_duration,
      features, enabled, sort_order, version, is_delete
    ) VALUES (
      't11-doubao', 't11-image', 'image', 'T11 图像', NULL,
      '["1024x1024"]', '["1:1"]', NULL, '["png"]',
      '1024x1024', 'png', '1:1', NULL,
      '{}', true, 1, 0, false
    )
  `);
  insertedId(`
    INSERT INTO generation_model_capability (
      provider_id, model_id, capability_type, model_label, icon,
      supported_sizes, supported_aspect_ratios, supported_durations, supported_formats,
      default_size, default_format, default_aspect_ratio, default_duration,
      features, enabled, sort_order, version, is_delete
    ) VALUES (
      't11-doubao', 't11-video', 'video', 'T11 视频', NULL,
      '["1280x720"]', '["16:9"]', '[3,5,10]', '["mp4"]',
      '1280x720', NULL, '16:9', 5,
      '{}', true, 2, 0, false
    )
  `);
}

async function postCreationMessage(projectId, token, content, mentions) {
  const key = uniqueKey("t11-msg");
  const accepted = await postJson(
    `/api/projects/${projectId}/conversation/messages`,
    { client_message_id: key, content, mentions },
    token,
    key,
  );
  assert.equal(
    accepted.body.code,
    200,
    `消息接纳应成功：${JSON.stringify(accepted.body)}`,
  );
  return accepted.body.data;
}

async function waitForRun(projectId, token, agentRunId, deadlineMs = 30_000) {
  return waitFor(
    async () => {
      const snapshot = await fetchSnapshot(projectId, token);
      const run = snapshot.agent_runs?.find(
        (item) => String(item.agent_run_id) === String(agentRunId),
      );
      return run && run.status !== "running" && run.status !== "queued"
        ? run
        : null;
    },
    deadlineMs,
    `服务=agent-worker 事实=Run ${agentRunId} 应进入终态`,
  );
}

/** 取一个 scene_card_create 计划：「出两张」确定性产 image_generate + scene_card_create。 */
async function produceSceneCardCreatePlan(projectId, token) {
  const data = await postCreationMessage(
    projectId,
    token,
    "创作：主体：蓝鲸 预期：动态海报 出两张 立即出计划",
    [],
  );
  const agentRunId = String(data.agent_run_id);
  await waitForRun(projectId, token, agentRunId);
  const snapshot = await fetchSnapshot(projectId, token);
  const plan = snapshot.plan_messages
    .filter((item) => String(item.agent_run_id) === agentRunId)
    .find((item) => item.application_kind === "scene_card_create");
  assert.ok(plan, "应产 scene_card_create 计划");
  return plan;
}

async function applyPlan(projectId, messageId, token, idempotencyKey, body) {
  return postJson(
    `/api/projects/${projectId}/plan-messages/${messageId}/apply`,
    body ?? {},
    token,
    idempotencyKey,
  );
}

function countWhere(table, where) {
  return Number(
    mysqlQuery(`SELECT COUNT(*) FROM ${table} WHERE ${where}`),
  );
}

let owner;
let projectId;

before(() => {
  owner = null;
  projectId = null;
});

test("setup：注册用户 + 项目 + 能力", async () => {
  owner = await registerUser("t11apply");
  projectId = await createProject("T11 应用闭环项目", owner.token);
  seedCapabilities();
});

test("应用 scene_card_create 原子创建五条产品事实（AC#2/#3）", async () => {
  const plan = await produceSceneCardCreatePlan(projectId, owner.token);
  const messageId = String(plan.message_id);
  const key = uniqueKey("t11-apply");

  const before = {
    scene_cards: countWhere("scene_cards", `project_id=${projectId}`),
    presets: countWhere("scene_card_generation_presets", `project_id=${projectId}`),
    records: countWhere("scene_card_generation_records", `project_id=${projectId}`),
    receipts: countWhere("plan_application_receipts", `project_id=${projectId}`),
    jobs: countWhere("generation_jobs", `project_id=${projectId} AND source='plan'`),
  };

  const applied = await applyPlan(projectId, messageId, owner.token, key);
  assert.equal(
    applied.body.code,
    200,
    `应用应成功：${JSON.stringify(applied.body)}`,
  );
  assert.equal(applied.response.status, 202, "成功应回 202 Accepted");
  const sceneCardId = String(applied.body.data?.scene_card_id);
  const jobId = String(applied.body.data?.generation_job_id);
  assert.ok(sceneCardId, "应返回 scene_card_id");
  assert.ok(jobId, "应返回 generation_job_id");

  // AC#2：五条事实各 +1。
  assert.equal(
    countWhere("scene_cards", `project_id=${projectId}`),
    before.scene_cards + 1,
  );
  assert.equal(
    countWhere("scene_card_generation_presets", `project_id=${projectId}`),
    before.presets + 1,
  );
  assert.equal(
    countWhere("scene_card_generation_records", `project_id=${projectId}`),
    before.records + 1,
  );
  assert.equal(
    countWhere("plan_application_receipts", `project_id=${projectId}`),
    before.receipts + 1,
  );
  assert.equal(
    countWhere("generation_jobs", `project_id=${projectId} AND source='plan'`),
    before.jobs + 1,
  );

  // AC#3：SceneCard 权威正文 = PlanMessage 冻结正文；version=1。
  const card = mysqlJson(
    `SELECT JSON_OBJECT('title',title,'content_markdown',content_markdown,'version',version) FROM scene_cards WHERE id=${sceneCardId}`,
  );
  assert.equal(card.version, 1);
  assert.equal(card.content_markdown, plan.content_markdown);
  // 预设 1:1 绑定 scene_card；record 首次 generating；回执带 scene_card_id + job_id。
  assert.equal(
    countWhere("scene_card_generation_presets", `scene_card_id=${sceneCardId}`),
    1,
  );
  const record = mysqlJson(
    `SELECT JSON_OBJECT('summary_status',summary_status) FROM scene_card_generation_records WHERE scene_card_id=${sceneCardId}`,
  );
  assert.equal(record.summary_status, "generating");
  const receipt = mysqlJson(
    `SELECT JSON_OBJECT('application_kind',application_kind,'scene_card_id',scene_card_id,'first_generation_job_id',first_generation_job_id,'command_id',command_id) FROM plan_application_receipts WHERE message_id=${messageId}`,
  );
  assert.equal(receipt.application_kind, "scene_card_create");
  assert.equal(String(receipt.scene_card_id), sceneCardId);
  assert.equal(String(receipt.first_generation_job_id), jobId);
  assert.equal(receipt.command_id, key);
}, 90_000);

test("重复 CommandId 返回首次结果，五表不再增长（AC#6）", async () => {
  const plan = await produceSceneCardCreatePlan(projectId, owner.token);
  const messageId = String(plan.message_id);
  const key = uniqueKey("t11-replay");

  const first = await applyPlan(projectId, messageId, owner.token, key);
  assert.equal(first.body.code, 200);
  const firstCard = String(first.body.data?.scene_card_id);
  const firstJob = String(first.body.data?.generation_job_id);

  const receiptsBefore = countWhere(
    "plan_application_receipts",
    `project_id=${projectId}`,
  );
  const cardsBefore = countWhere("scene_cards", `project_id=${projectId}`);

  const second = await applyPlan(projectId, messageId, owner.token, key);
  assert.equal(second.body.code, 200, "重复 CommandId 应重放首次结果");
  assert.equal(String(second.body.data?.scene_card_id), firstCard);
  assert.equal(String(second.body.data?.generation_job_id), firstJob);

  // 五表不再增长。
  assert.equal(
    countWhere("plan_application_receipts", `project_id=${projectId}`),
    receiptsBefore,
  );
  assert.equal(
    countWhere("scene_cards", `project_id=${projectId}`),
    cardsBefore,
  );
}, 90_000);

test("同 CommandId 不同请求内容拒绝 100302（AC#6）", async () => {
  const plan = await produceSceneCardCreatePlan(projectId, owner.token);
  const messageId = String(plan.message_id);
  const key = uniqueKey("t11-conflict");

  const first = await applyPlan(projectId, messageId, owner.token, key, {});
  assert.equal(first.body.code, 200);
  // 同 key 但 body 不同 → requestHash 不同 → 冲突。
  const conflict = await applyPlan(
    projectId,
    messageId,
    owner.token,
    key,
    { different: true },
  );
  assert.equal(conflict.body.code, 100302, "同 key 不同内容应判冲突");
}, 90_000);

test("同消息不同 CommandId 已被应用 → 100404，不重复创建（CONTEXT L227）", async () => {
  const plan = await produceSceneCardCreatePlan(projectId, owner.token);
  const messageId = String(plan.message_id);
  const firstKey = uniqueKey("t11-once-1");

  const first = await applyPlan(projectId, messageId, owner.token, firstKey);
  assert.equal(first.body.code, 200);
  const firstCard = String(first.body.data?.scene_card_id);

  const cardsBefore = countWhere("scene_cards", `project_id=${projectId}`);
  const receiptsBefore = countWhere(
    "plan_application_receipts",
    `project_id=${projectId}`,
  );

  // 同一条 plan_message、新 CommandId：已成功应用过 → already_applied。
  const second = await applyPlan(
    projectId,
    messageId,
    owner.token,
    uniqueKey("t11-once-2"),
  );
  assert.equal(
    second.body.code,
    100404,
    `同消息跨 CommandId 应拒绝：${JSON.stringify(second.body)}`,
  );
  assert.equal(
    countWhere("scene_cards", `project_id=${projectId}`),
    cardsBefore,
    "已应用消息不再新建 SceneCard",
  );
  assert.equal(
    countWhere("plan_application_receipts", `project_id=${projectId}`),
    receiptsBefore,
    "已应用消息不再新建回执",
  );
  // 首次结果仍可经原 CommandId 重放（不因 already_applied 丢失）。
  const replay = await applyPlan(projectId, messageId, owner.token, firstKey);
  assert.equal(replay.body.code, 200);
  assert.equal(String(replay.body.data?.scene_card_id), firstCard);
}, 90_000);

test("能力漂移（行版本变化）零写入（AC#4）", async () => {
  const plan = await produceSceneCardCreatePlan(projectId, owner.token);
  const messageId = String(plan.message_id);
  const key = uniqueKey("t11-drift");

  const receiptsBefore = countWhere(
    "plan_application_receipts",
    `project_id=${projectId}`,
  );
  const cardsBefore = countWhere("scene_cards", `project_id=${projectId}`);

  // 应用前改能力行版本 → 冻结快照（row_version=0）与当前不一致。
  mysqlQuery(
    "UPDATE generation_model_capability SET version=version+1 WHERE provider_id='t11-doubao' AND capability_type='video'",
  );
  try {
    const result = await applyPlan(projectId, messageId, owner.token, key);
    assert.equal(
      result.body.code,
      100403,
      `能力漂移应零写入并返回 100403：${JSON.stringify(result.body)}`,
    );
    assert.equal(
      countWhere("plan_application_receipts", `project_id=${projectId}`),
      receiptsBefore,
      "漂移时回执零写入",
    );
    assert.equal(
      countWhere("scene_cards", `project_id=${projectId}`),
      cardsBefore,
      "漂移时场景卡零写入",
    );
  } finally {
    // 还原能力版本，避免污染后续测试的冻结快照。
    mysqlQuery(
      "UPDATE generation_model_capability SET version=0 WHERE provider_id='t11-doubao'",
    );
  }
}, 90_000);

test("Canvas 放置：scene_card 节点入画布且同一 SceneCard 最多一个（AC#5）", async () => {
  const plan = await produceSceneCardCreatePlan(projectId, owner.token);
  const messageId = String(plan.message_id);
  const key = uniqueKey("t11-place");

  const applied = await applyPlan(projectId, messageId, owner.token, key);
  assert.equal(applied.body.code, 200);
  const sceneCardId = String(applied.body.data?.scene_card_id);

  // 放置在 apply 路由内同步 await（最佳努力，失败不回滚）；轮询仅为兼容异步边界。
  // 现行节点契约（PR !333 起）：type="scene-card"、data.sceneCardId、无 status 字段。
  const isSceneCardNode = (node) =>
    node.type === "scene-card" &&
    String(node.data?.sceneCardId) === sceneCardId;
  const placed = await waitFor(() => {
    const nodes = mysqlJson(
      `SELECT nodes_json FROM canvas WHERE project_id=${projectId}`,
    );
    const list = Array.isArray(nodes) ? nodes : [];
    const matching = list.filter(isSceneCardNode);
    return matching.length === 1 ? matching[0] : null;
  }, 10_000, "服务=web 事实=Canvas 应放置 scene_card 节点");

  assert.ok(placed.position, "节点应带 position");

  // 再次应用同计划（新 CommandId 会 already_applied；这里直接复验节点不重复）。
  const nodesAfter = mysqlJson(
    `SELECT nodes_json FROM canvas WHERE project_id=${projectId}`,
  );
  const list = Array.isArray(nodesAfter) ? nodesAfter : [];
  const count = list.filter(isSceneCardNode).length;
  assert.equal(count, 1, "同一 SceneCard 最多一个节点");
}, 90_000);

test("Snapshot 恢复：含 scene_card 与 plan_application 回执（AC#7）", async () => {
  const plan = await produceSceneCardCreatePlan(projectId, owner.token);
  const messageId = String(plan.message_id);
  const key = uniqueKey("t11-snap");
  const applied = await applyPlan(projectId, messageId, owner.token, key);
  assert.equal(applied.body.code, 200);
  const sceneCardId = String(applied.body.data?.scene_card_id);

  const snapshot = await fetchSnapshot(projectId, owner.token);
  const card = snapshot.scene_cards?.find(
    (item) => String(item.scene_card_id) === sceneCardId,
  );
  assert.ok(card, "snapshot 应含 scene_card");
  assert.equal(card.content_markdown, plan.content_markdown);

  const receipt = snapshot.plan_applications?.find(
    (item) => String(item.message_id) === messageId,
  );
  assert.ok(receipt, "snapshot 应含 plan_application 回执");
  assert.equal(receipt.application_kind, "scene_card_create");
  assert.equal(String(receipt.scene_card_id), sceneCardId);
}, 90_000);

test("跨重启幂等：重启 agent-worker 后重放同 CommandId 仍是首次结果（AC#7）", async () => {
  const plan = await produceSceneCardCreatePlan(projectId, owner.token);
  const messageId = String(plan.message_id);
  const key = uniqueKey("t11-restart");

  const first = await applyPlan(projectId, messageId, owner.token, key);
  assert.equal(first.body.code, 200);
  const firstCard = String(first.body.data?.scene_card_id);

  // 重启 agent-worker（验证幂等结果持久化，不依赖进程内存）。
  compose("restart", "agent-worker");

  const replayed = await applyPlan(projectId, messageId, owner.token, key);
  assert.equal(replayed.body.code, 200, "重启后重放应返回首次结果");
  assert.equal(String(replayed.body.data?.scene_card_id), firstCard);
}, 120_000);
