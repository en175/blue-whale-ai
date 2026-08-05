// Node-only 全栈黑盒：PlanMessage 手动应用闭环（IK67H8 T10，契约 §9）。
// 只经公开 HTTP、Snapshot 与只读 SQL 断言，不 import 产品源码。
//
// 覆盖：apply→receipt+job+applied_at 落库；出图→Asset；同键 replay；同键异内容 conflict；
// 换键 at-most-once；软删素材→requires_new_plan 零写入；Snapshot availability；重启恢复。
// 余额耗尽（retryable_blocked）由 persistence 单元测覆盖（黑盒需 new-api quota 控制，略）；
// canvas 放置由前端组件单测覆盖（黑盒验证后端事实）。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { before, test } from "node:test";

const baseUrl = process.env.BW_ACCEPTANCE_WEB_URL ?? "http://127.0.0.1:3101";
const composeFile =
  process.env.BW_TS_COMPOSE_FILE ??
  "deploy/typescript-baseline/docker-compose.acceptance.yml";
const project =
  process.env.BW_TS_COMPOSE_PROJECT ?? "bw-ts-baseline-acceptance";

const CODE_OK = 200;
const CODE_RESOURCE_NOT_FOUND = 100301;
const CODE_IDEMPOTENCY_REUSED = 100302;

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
  ).trim();
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
    body: JSON.stringify(body),
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
  assert.equal(registered.body.code, CODE_OK, "注册应成功");
  const token = registered.body.data?.access_token;
  const me = await requestJson("/api/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { token, userId: String(me.body.data?.user_id) };
}

async function createProject(name, token) {
  const created = await postJson("/api/projects", { name }, token);
  assert.equal(created.body.code, CODE_OK, "Project 创建应成功");
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
  assert.equal(result.body.code, CODE_OK, "Snapshot 应可读");
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

function seedCapabilities() {
  mysqlQuery(
    "DELETE FROM generation_model_capability WHERE provider_id='t09-doubao'",
  );
  insertedId(`
    INSERT INTO generation_model_capability (
      provider_id, model_id, capability_type, model_label, icon,
      supported_sizes, supported_aspect_ratios, supported_durations, supported_formats,
      default_size, default_format, default_aspect_ratio, default_duration,
      features, enabled, sort_order, version, is_delete
    ) VALUES (
      't09-doubao', 't09-image', 'image', 'T09 图像', NULL,
      '["1024x1024","1280x720"]', '["1:1","16:9"]', NULL, '["png","jpg"]',
      '1024x1024', 'png', '1:1', NULL,
      '{}', true, 1, 0, false
    )
  `);
}

function insertAsset(userId, projectId, slug) {
  return insertedId(`
    INSERT INTO assets (
      user_id, project_id, type, storage_key, content_sha256, url, mime,
      size, width, height, source, status, is_delete
    ) VALUES (
      ${userId}, ${projectId}, 'image',
      'private/t10/${slug}.png', '${slug.padEnd(64, "a").slice(0, 64)}',
      'https://storage.invalid/private/t10/${slug}.png', 'image/png',
      4096, 1024, 1024, 'uploaded', 'normal', false
    )
  `);
}

async function postCreationMessage(projectId, token, content, mentions) {
  const key = uniqueKey("t10-msg");
  const accepted = await postJson(
    `/api/projects/${projectId}/conversation/messages`,
    { client_message_id: key, content, mentions },
    token,
    key,
  );
  assert.equal(
    accepted.body.code,
    CODE_OK,
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
    `Run ${agentRunId} 应进入终态`,
  );
}

/** 触发一次 image_generate 计划并等 Run 终态，返回首张 image_generate plan。 */
async function seedImagePlan(projectId, token, userId, slug, mentionAssetId) {
  const assetId = mentionAssetId ?? insertAsset(userId, projectId, slug);
  const data = await postCreationMessage(
    projectId,
    token,
    "@[参考图] 创作：主体：蓝鲸 预期：极简海报 立即出计划",
    [{ type: "asset", asset_id: assetId, display_name: "参考图" }],
  );
  const agentRunId = String(data.agent_run_id);
  await waitForRun(projectId, token, agentRunId);
  const snapshot = await fetchSnapshot(projectId, token);
  const plan = snapshot.plan_messages
    .filter(
      (item) =>
        String(item.agent_run_id) === agentRunId &&
        item.application_kind === "image_generate",
    )
    .at(0);
  assert.ok(plan, "应接纳 1 条 image_generate plan_message");
  return { plan, assetId, agentRunId };
}

async function applyPlan(projectId, planMessageId, token, idempotencyKey) {
  return requestJson(
    `/api/projects/${projectId}/plan-messages/${planMessageId}/apply`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": idempotencyKey,
      },
    },
  );
}

let owner;
let projectId;
let firstPlan;
let firstKey;
let firstJobId;
let firstReceiptId;

before(async () => {
  owner = await registerUser("planApplyOwner");
  projectId = await createProject("计划卡应用项目", owner.token);
  seedCapabilities();
});

test("apply 成功：receipt + 首图 job(source=plan_apply) + plan_messages.applied_at 落库", async () => {
  firstPlan = (await seedImagePlan(projectId, owner.token, owner.userId, "apply1")).plan;
  const planMessageId = String(firstPlan.message_id);
  firstKey = uniqueKey("apply");

  const { response, body } = await applyPlan(
    projectId,
    planMessageId,
    owner.token,
    firstKey,
  );
  assert.equal(response.status, 202, "apply 成功应回 202");
  assert.equal(body.code, CODE_OK, `apply 应成功：${JSON.stringify(body)}`);
  firstJobId = body.data?.first_generation_job_id;
  firstReceiptId = body.data?.receipt?.receipt_id;
  assert.ok(firstJobId, "应返回首图 job id");
  assert.ok(firstReceiptId, "应返回 receipt id");
  assert.equal(body.data.receipt.application_kind, "image_generate");
  assert.equal(body.data.receipt.scene_card_id, null);

  // 持久化事实
  assert.equal(
    mysqlQuery(`SELECT COUNT(*) FROM plan_application_receipts WHERE plan_message_id=${planMessageId}`),
    "1",
    "服务=mysql 事实=应建 1 条 receipt",
  );
  assert.equal(
    mysqlQuery(`SELECT source FROM generation_jobs WHERE id=${firstJobId}`),
    "plan_apply",
    "服务=mysql 事实=job source 应为 plan_apply",
  );
  const appliedAt = mysqlQuery(
    `SELECT applied_at FROM plan_messages WHERE message_id=${planMessageId}`,
  );
  assert.ok(appliedAt && appliedAt !== "NULL", "plan_messages.applied_at 应落库");
}, 90_000);

test("provider-stub 出图 → 首图 job 成功 + Asset 发布", async () => {
  assert.ok(firstJobId, "前置：先成功 apply");
  await waitFor(
    () => {
      const status = mysqlQuery(
        `SELECT status FROM generation_jobs WHERE id=${firstJobId}`,
      );
      return status === "succeeded" ? status : null;
    },
    30_000,
    `服务=worker 事实=首图 job ${firstJobId} 应成功`,
  );
  const assetCount = Number(
    mysqlQuery(
      `SELECT COUNT(*) FROM assets WHERE generation_job_id=${firstJobId} AND is_delete=false`,
    ),
  );
  assert.ok(assetCount >= 1, "出图后应发布至少 1 个 Asset");
}, 60_000);

test("同 CommandId + 同请求 → replay 首次 receipt/job，generation_jobs 不重复", async () => {
  const planMessageId = String(firstPlan.message_id);
  const { response, body } = await applyPlan(
    projectId,
    planMessageId,
    owner.token,
    firstKey,
  );
  assert.equal(response.status, 202);
  assert.equal(body.code, CODE_OK);
  assert.equal(body.data?.receipt?.receipt_id, firstReceiptId, "回首次 receipt");
  assert.equal(
    body.data?.first_generation_job_id,
    firstJobId,
    "回首次 job",
  );
  const planApplyJobCount = Number(
    mysqlQuery(
      `SELECT COUNT(*) FROM generation_jobs WHERE source='plan_apply' AND project_id=${projectId}`,
    ),
  );
  assert.equal(planApplyJobCount, 1, "不重复生成（at-most-once + 同键 replay）");
}, 30_000);

test("同 CommandId + 不同请求 → IDEMPOTENCY_KEY_REUSED", async () => {
  // 第二个 plan，用已消费的 firstKey → requestHash 不同 → conflict。
  const second = await seedImagePlan(
    projectId,
    owner.token,
    owner.userId,
    "apply2",
  );
  const { body } = await applyPlan(
    projectId,
    String(second.plan.message_id),
    owner.token,
    firstKey,
  );
  assert.equal(body.code, CODE_IDEMPOTENCY_REUSED, "同键异内容应拒绝");
}, 60_000);

test("换 CommandId 重复应用 → at-most-once 回首次，不重复计费/生成", async () => {
  const planMessageId = String(firstPlan.message_id);
  const { body } = await applyPlan(
    projectId,
    planMessageId,
    owner.token,
    uniqueKey("apply-other"),
  );
  assert.equal(body.code, CODE_OK);
  assert.equal(body.data?.receipt?.receipt_id, firstReceiptId, "换键仍回首次");
  const planApplyJobCount = Number(
    mysqlQuery(
      `SELECT COUNT(*) FROM generation_jobs WHERE source='plan_apply' AND project_id=${projectId}`,
    ),
  );
  assert.equal(planApplyJobCount, 1, "换键不重复生成");
}, 30_000);

test("软删素材后应用 → requires_new_plan(409) 零写入", async () => {
  const seeded = await seedImagePlan(
    projectId,
    owner.token,
    owner.userId,
    "apply3",
  );
  const planMessageId = String(seeded.plan.message_id);
  // 应用前软删引用素材 → mention 重验 unavailable。
  mysqlQuery(`UPDATE assets SET is_delete=true WHERE id=${seeded.assetId}`);
  const { response, body } = await applyPlan(
    projectId,
    planMessageId,
    owner.token,
    uniqueKey("apply-stale"),
  );
  assert.notEqual(response.status, 202, "硬失败不应回 202");
  assert.equal(body.code, 409, "素材失效应回 requires_new_plan(409)");

  // 零写入不变量（事务原子：预检失败 → 无 receipt / applied_at / job / 幂等行）
  assert.equal(
    mysqlQuery(`SELECT COUNT(*) FROM plan_application_receipts WHERE plan_message_id=${planMessageId}`),
    "0",
    "零写入：无 receipt",
  );
  const appliedAt = mysqlQuery(
    `SELECT applied_at FROM plan_messages WHERE message_id=${planMessageId}`,
  );
  assert.equal(appliedAt, "NULL", "零写入：applied_at 仍 NULL");
}, 60_000);

test("Snapshot application_availability 反映素材/能力状态（available / requires_new_plan）", async () => {
  const snapshot = await fetchSnapshot(projectId, owner.token);
  // firstPlan 已应用且素材正常 → available
  const applied = snapshot.plan_messages.find(
    (item) => String(item.message_id) === String(firstPlan.message_id),
  );
  assert.ok(applied?.applied_at, "已应用 plan 应有 applied_at");
  assert.equal(applied.application_availability, "available");
  assert.ok(applied.first_generation_job_id);

  // 任意失效素材 plan → requires_new_plan（snapshot 不查余额，无 retryable_blocked）
  const stale = snapshot.plan_messages.find(
    (item) => item.application_availability === "requires_new_plan",
  );
  // 上一轮软删素材的 plan 若仍在 snapshot，应判 requires_new_plan。
  assert.ok(stale, "失效素材 plan 应投影 requires_new_plan");
}, 30_000);

test("compose restart agent-worker → plan_messages.applied_at 恢复不变", async () => {
  const before = mysqlQuery(
    `SELECT applied_at FROM plan_messages WHERE message_id=${firstPlan.message_id}`,
  );
  compose("restart", "-t", "5", "agent-worker");
  await new Promise((resolve) => setTimeout(resolve, 4000));
  const after = mysqlQuery(
    `SELECT applied_at FROM plan_messages WHERE message_id=${firstPlan.message_id}`,
  );
  assert.equal(after, before, "重启后 applied_at 应恢复（不变）");
}, 90_000);
