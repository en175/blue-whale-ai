// Node-only 全栈黑盒：PlanMessage 原子提交（IK67H6 T09，契约 §9）。
// 只经公开 HTTP、Snapshot 与只读 SQL 断言，不 import 产品源码。
//
// 覆盖 AC：单卡 image_generate 接纳 + 恢复（#1/#3/#5/#7/#8）、多卡混合（#4）、
// scene_card_replace 独占（#4）、无效引用零写入（#2/#8）、接管恢复（#8）。
// plan_card_validation_failed 的精确触发窗口（参数越界/幻觉引用）由 persistence 单元测
// 覆盖；黑盒验证可确定性的核心：提交→冻结→恢复链路与零写入不变量。
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

/** Seed image + video 能力行（commitPlanMessages 按 kind 选能力冻结参数）。 */
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
  insertedId(`
    INSERT INTO generation_model_capability (
      provider_id, model_id, capability_type, model_label, icon,
      supported_sizes, supported_aspect_ratios, supported_durations, supported_formats,
      default_size, default_format, default_aspect_ratio, default_duration,
      features, enabled, sort_order, version, is_delete
    ) VALUES (
      't09-doubao', 't09-video', 'video', 'T09 视频', NULL,
      '["1280x720"]', '["16:9"]', '[3,5,10]', '["mp4"]',
      '1280x720', NULL, '16:9', 5,
      '{}', true, 2, 0, false
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
      'private/t09/${slug}.png', '${slug.padEnd(64, "a").slice(0, 64)}',
      'https://storage.invalid/private/t09/${slug}.png', 'image/png',
      4096, 1024, 1024, 'uploaded', 'normal', false
    )
  `);
}

function insertSceneCard(projectId, title, version) {
  return insertedId(`
    INSERT INTO scene_cards (
      project_id, title, summary, content_markdown, version, is_delete
    ) VALUES (
      ${projectId}, '${title}', '${title}摘要',
      '# ${title}', ${version}, 0
    )
  `);
}

async function postCreationMessage(projectId, token, content, mentions) {
  const key = uniqueKey("t09-msg");
  const accepted = await postJson(
    `/api/projects/${projectId}/conversation/messages`,
    { client_message_id: key, content, mentions },
    token,
    key,
  );
  assert.equal(accepted.body.code, 200, `消息接纳应成功：${JSON.stringify(accepted.body)}`);
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

let owner;
let projectId;

before(async () => {
  owner = await registerUser("planOwner");
  projectId = await createProject("计划卡提交项目", owner.token);
  seedCapabilities();
});

test("单卡 image_generate 原子接纳并恢复，prompt_text 等于权威 Markdown（AC#1/#3/#5/#7/#8）", async () => {
  const assetId = insertAsset(owner.userId, projectId, "scenario1");
  const data = await postCreationMessage(projectId,
    owner.token,
    "@[蓝鲸参考图] 创作：主体：蓝鲸 预期：极简海报 立即出计划",
    [{ type: "asset", asset_id: assetId, display_name: "蓝鲸参考图" }],
  );
  const agentRunId = String(data.agent_run_id);
  const run = await waitForRun(projectId, owner.token, agentRunId);
  assert.equal(run.status, "completed", `服务=worker 事实=单卡 Run 应完成`);

  const snapshot = await fetchSnapshot(projectId, owner.token);
  const plans = snapshot.plan_messages.filter(
    (item) => String(item.agent_run_id) === agentRunId,
  );
  assert.equal(plans.length, 1, "服务=mysql 事实=应接纳 1 条 plan_message");
  const plan = plans[0];
  assert.equal(plan.application_kind, "image_generate");
  assert.equal(plan.ordinal, 1);
  assert.equal(plan.total_in_batch, 1);
  assert.equal(plan.sequence_label, null, "单卡 sequence_label 为空");
  assert.equal(plan.target_scene_card_mention_id, null);
  // AC#5：去重后的稳定素材引用。
  assert.equal(plan.derived_references.length, 1);
  assert.equal(plan.derived_references[0].type, "asset");
  assert.equal(
    plan.derived_references[0].mention_id,
    String(data.mentions[0].mention_id),
  );
  // 冻结参数来自能力默认（未指定项）+ 能力版本快照。
  assert.equal(plan.frozen_generation_parameters.capability_type, "image");
  assert.equal(plan.frozen_generation_parameters.size, "1024x1024");
  assert.equal(plan.capability_snapshot_version.schema_version, 1);
  assert.equal(plan.capability_snapshot_version.capability_type, "image");
  // AC#7：ProviderPromptProjection 由权威 Markdown 确定性派生，不改写正文。
  assert.equal(
    plan.provider_prompt_projection.prompt_text,
    plan.content_markdown,
  );
  // content_type=plan_message 出现在对话消息投影。
  const planMessage = snapshot.conversation_messages.find(
    (item) => String(item.message_id) === String(plan.message_id),
  );
  assert.equal(planMessage?.content_type, "plan_message");
}, 60_000);

test("出两张标记产 2 卡混合 image_generate + scene_card_create 并带分镜序号（AC#4）", async () => {
  const data = await postCreationMessage(projectId,
    owner.token,
    "创作：主体：蓝鲸 预期：动态海报 出两张 立即出计划",
    [],
  );
  const agentRunId = String(data.agent_run_id);
  const run = await waitForRun(projectId, owner.token, agentRunId);
  assert.equal(run.status, "completed");

  const snapshot = await fetchSnapshot(projectId, owner.token);
  const plans = snapshot.plan_messages
    .filter((item) => String(item.agent_run_id) === agentRunId)
    .sort((a, b) => a.ordinal - b.ordinal);
  assert.equal(plans.length, 2, "服务=mysql 事实=应接纳 2 条 plan_message");
  assert.equal(plans[0].application_kind, "image_generate");
  assert.equal(plans[1].application_kind, "scene_card_create");
  for (const [index, plan] of plans.entries()) {
    assert.equal(plan.ordinal, index + 1);
    assert.equal(plan.total_in_batch, 2);
    assert.equal(plan.sequence_label, "分镜", "多卡应持久化分镜名词");
  }
}, 60_000);

test("覆盖场景卡标记产独占 scene_card_replace 并绑定本轮场景卡句柄（AC#4）", async () => {
  const sceneCardId = insertSceneCard(projectId, "覆盖目标分镜", 3);
  const data = await postCreationMessage(projectId,
    owner.token,
    "@[目标分镜] 修改：目标：分镜 变化：变明亮 覆盖场景卡 立即出计划",
    [
      {
        type: "scene_card",
        scene_card_id: sceneCardId,
        scene_card_version: 3,
        display_name: "目标分镜",
      },
    ],
  );
  const agentRunId = String(data.agent_run_id);
  const run = await waitForRun(projectId, owner.token, agentRunId);
  assert.equal(run.status, "completed");

  const snapshot = await fetchSnapshot(projectId, owner.token);
  const plans = snapshot.plan_messages.filter(
    (item) => String(item.agent_run_id) === agentRunId,
  );
  assert.equal(plans.length, 1, "服务=mysql 事实=replace 独占单卡");
  const plan = plans[0];
  assert.equal(plan.application_kind, "scene_card_replace");
  assert.equal(
    plan.target_scene_card_mention_id,
    String(data.mentions[0].mention_id),
  );
  // base_scene_card_version 由 Product API 从 mention.target_version 解析（=3）。
  assert.equal(plan.base_scene_card_version, 3);
}, 60_000);

test("引用素材失效时零 plan 写入，Run 进入终态（AC#2/#8）", async () => {
  const assetId = insertAsset(owner.userId, projectId, "scenario4");
  const data = await postCreationMessage(projectId,
    owner.token,
    "@[失效素材] 创作：主体：蓝鲸 预期：海报 立即出计划",
    [{ type: "asset", asset_id: assetId, display_name: "失效素材" }],
  );
  const agentRunId = String(data.agent_run_id);
  // 接纳后、Worker claim 前软删素材：快照冻结为 unavailable，闸门拦截 → Run failed，零 plan。
  mysqlQuery(`UPDATE assets SET is_delete=true WHERE id=${assetId}`);
  const run = await waitForRun(projectId, owner.token, agentRunId);
  assert.notEqual(run.status, "completed", "服务=worker 事实=失效引用不得完成");
  assert.equal(run.failure_code, "mention_input_unavailable");

  const snapshot = await fetchSnapshot(projectId, owner.token);
  const plans = snapshot.plan_messages.filter(
    (item) => String(item.agent_run_id) === agentRunId,
  );
  assert.equal(plans.length, 0, "服务=mysql 事实=失效 Run 不得产生任何 plan_message");
  const planMessageRows = snapshot.conversation_messages.filter(
    (item) =>
      String(item.agent_run_id) === agentRunId &&
      item.content_type === "plan_message",
  );
  assert.equal(planMessageRows.length, 0);
}, 60_000);

test("Worker 重启后 plan_messages 完整、无重复、无临时候选（AC#8）", async () => {
  const snapshotBefore = await fetchSnapshot(projectId, owner.token);
  const plansBefore = snapshotBefore.plan_messages.length;
  assert.ok(plansBefore > 0, "前置：已完成场景应留下计划卡");

  compose("restart", "-t", "5", "agent-worker");
  // 等待 worker 恢复并稳定（重新领取空队列即就绪）。
  await new Promise((resolve) => setTimeout(resolve, 4000));

  const snapshotAfter = await fetchSnapshot(projectId, owner.token);
  assert.equal(
    snapshotAfter.plan_messages.length,
    plansBefore,
    "服务=worker 事实=重启后 plan_messages 数量不变（无重复、无丢失）",
  );
  // 临时候选永不进入 Snapshot 的 plan_messages。
  assert.ok(
    snapshotAfter.plan_messages.every(
      (item) => typeof item.message_id === "string",
    ),
  );
}, 90_000);
