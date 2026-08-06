// Node-only 全栈黑盒：可选 StoryboardPreview 分镜预览流程（IK67HF T15，契约 §9 / CONTEXT L43-47）。
// 只经公开 HTTP（POST /scene-cards/{id}/storyboard-preview、GET /generation/models）、Snapshot、provider-stub
// 账本与只读 SQL 断言，不 import 产品源码。
//
// 覆盖 AC：可选旁路不自动建视频 job / 不改 Preset（#2）、画格按 slot_index 升序产出（#3）、
// Snapshot 含 storyboard_previews + 事件（#6）、同 CommandId 重放 / 异内容 100302、版本冲突 100406 零写入、
// 能力上限越界零写入。
// 注：AC#4/#5（画格作视频首/尾帧参考）拆至 follow-up 工单，本套不覆盖。
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
    "exec", "-T", "mysql", "mysql", "-uroot", "-pblue_whale",
    "-N", "-B", "--default-character-set=utf8mb4", "blue_whale",
    "-e", sql,
  );
}

function mysqlJson(sql) {
  const raw = mysqlQuery(sql);
  return raw ? JSON.parse(raw) : null;
}

function insertedId(sql) {
  return mysqlQuery(`${sql}; SELECT LAST_INSERT_ID();`).split("\n").at(-1);
}

function countWhere(table, where) {
  return Number(mysqlQuery(`SELECT COUNT(*) FROM ${table} WHERE ${where}`));
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
  const me = await requestJson("/api/me", { headers: { Authorization: `Bearer ${token}` } });
  return { token, userId: String(me.body.data?.user_id) };
}

async function createProject(name, token) {
  const created = await postJson("/api/projects", { name }, token);
  assert.equal(created.body.code, 200, "Project 创建应成功");
  return String(created.body.data?.id);
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
  throw new Error(`${message}${lastError ? `（最后错误：${lastError.message}）` : ""}`);
}

function stubFetch(pathname, { method = "GET", body } = {}) {
  const script = `
    const response = await fetch("http://127.0.0.1:4329${pathname}", {
      method: "${method}",
      ${body !== undefined ? `body: ${JSON.stringify(JSON.stringify(body))},` : ""}
      headers: { "Content-Type": "application/json" },
    });
    process.stdout.write(JSON.stringify({ status: response.status, body: await response.json() }));
  `;
  return JSON.parse(compose("exec", "-T", "provider-stub", "node", "-e", script));
}

async function setScenarios(scenarios) {
  const result = stubFetch("/__acceptance/scenarios", { method: "POST", body: scenarios });
  assert.equal(result.status, 200, "服务=provider-stub 事实=场景注入应成功");
}

function resetScenarios() {
  const result = stubFetch("/__acceptance/scenarios", { method: "DELETE" });
  assert.equal(result.status, 200, "服务=provider-stub 事实=场景复位应成功");
  const ledgerReset = stubFetch("/__acceptance/requests", { method: "DELETE" });
  assert.equal(ledgerReset.status, 200, "服务=provider-stub 事实=账本复位应成功");
}

function stubLedger() {
  return stubFetch("/__acceptance/requests").body.requests;
}

/** 种子 t15-image 能力：quantity_max=2（使 count=4 越界、count=2 合法，覆盖能力门）。 */
function seedCapabilities() {
  mysqlQuery("DELETE FROM generation_model_capability WHERE provider_id='t15-doubao'");
  insertedId(`
    INSERT INTO generation_model_capability (
      provider_id, model_id, capability_type, model_label, icon,
      supported_sizes, supported_aspect_ratios, supported_durations, supported_formats,
      default_size, default_format, default_aspect_ratio, default_duration,
      features, enabled, sort_order, version, is_delete
    ) VALUES (
      't15-doubao', 't15-image', 'image', 'T15 分镜画格', NULL,
      '[{"id":"1024x1024","label":"1:1","api_value":"1024x1024"}]', '["1:1","16:9"]', NULL, '["png"]',
      '1024x1024', 'png', '1:1', NULL,
      '{"quantity_max":2}', true, 1, 0, false
    )
  `);
}

/** t15-image 在 new-api 网关注册路由（指向 provider-stub），否则图片任务无通道。 */
async function seedGatewayRoutes() {
  compose(
    "exec", "-T", "mysql", "mysql", "-uroot", "-pblue_whale",
    "-N", "-B", "new_api",
    "-e",
    "DELETE FROM channels WHERE id = 9015; " +
      "INSERT INTO channels (id, type, `key`, status, name, weight, created_time, base_url, models, `group`, priority, auto_ban, settings) VALUES " +
      "(9015, 1, 'sk-acceptance-upstream', 1, 'acceptance-t15-image', 100, UNIX_TIMESTAMP(), 'http://provider-stub:4329', 't15-image', 'default', 100, 0, '{\"disable_task_polling_sleep\":true}'); " +
      "UPDATE options SET value = JSON_SET(value, '$.\"t15-image\"', 1) WHERE `key` = 'ModelRatio';",
  );
  compose("restart", "new-api");
  await waitFor(
    () => {
      const containerId = compose("ps", "-q", "new-api");
      const health = execFileSync("docker", ["inspect", "-f", "{{.State.Health.Status}}", containerId], {
        encoding: "utf8",
      }).trim();
      return health === "healthy" ? true : null;
    },
    60_000,
    "服务=new-api 事实=重启后应恢复健康",
  );
}

async function postCreationMessage(projectId, token, content, mentions) {
  const key = uniqueKey("t15-msg");
  const accepted = await postJson(
    `/api/projects/${projectId}/conversation/messages`,
    { client_message_id: key, content, mentions }, token, key,
  );
  assert.equal(accepted.body.code, 200, `消息接纳应成功：${JSON.stringify(accepted.body)}`);
  return accepted.body.data;
}

async function waitForRun(projectId, token, agentRunId, deadlineMs = 30_000) {
  return waitFor(
    async () => {
      const snapshot = await fetchSnapshot(projectId, token);
      const run = snapshot.agent_runs?.find((item) => String(item.agent_run_id) === String(agentRunId));
      return run && run.status !== "running" && run.status !== "queued" ? run : null;
    },
    deadlineMs,
    `服务=agent-worker 事实=Run ${agentRunId} 应进入终态`,
  );
}

/** 产一张已应用 SceneCard（视频路径），作为分镜预览的触发来源。 */
async function produceAppliedSceneCard(projectId, token) {
  const data = await postCreationMessage(projectId, token, "创作：主体：蓝鲸 预期：动态海报 出两张 立即出计划", []);
  const agentRunId = String(data.agent_run_id);
  await waitForRun(projectId, token, agentRunId);
  const snapshot = await fetchSnapshot(projectId, token);
  const plan = snapshot.plan_messages
    .filter((item) => String(item.agent_run_id) === agentRunId)
    .find((item) => item.application_kind === "scene_card_create");
  assert.ok(plan, "应产 scene_card_create 计划");
  const messageId = String(plan.message_id);
  const key = uniqueKey("t15-apply");
  const applied = await postJson(
    `/api/projects/${projectId}/plan-messages/${messageId}/apply`, {}, token, key,
  );
  assert.equal(applied.body.code, 200, `首次应用应成功：${JSON.stringify(applied.body)}`);
  const sceneCardId = String(applied.body.data?.scene_card_id);
  return { sceneCardId };
}

/** 从公开能力端点取 t15-image 的 version+digest，构造 capability_snapshot_version（漂移检测基准）。 */
async function fetchImageCapabilitySnapshot(token) {
  const result = await requestJson("/api/generation/models?capability=image", {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(result.body.code, 200, `能力端点应成功：${JSON.stringify(result.body)}`);
  const model = result.body.data?.find?.((m) => m.model_id === "t15-image");
  assert.ok(model, "应暴露 t15-image 能力");
  return {
    schema_version: 1,
    capability_type: "image",
    model_id: model.model_id,
    provider_id: model.provider_id,
    row_version: model.version,
    digest: model.digest,
  };
}

async function createStoryboardPreview(projectId, sceneCardId, body, token, idempotencyKey) {
  return postJson(
    `/api/projects/${projectId}/scene-cards/${sceneCardId}/storyboard-preview`,
    body, token, idempotencyKey,
  );
}

function buildPreviewBody(sceneCardId, sceneCardVersion, capabilitySnapshot, count = 2) {
  return {
    scene_card_id: sceneCardId,
    base_scene_card_version: sceneCardVersion,
    parameters: {
      model_id: "t15-image",
      size: "1024x1024",
      aspect_ratio: "1:1",
      count,
    },
    capability_snapshot_version: capabilitySnapshot,
  };
}

let owner;
let projectId;
let capabilitySnapshot;

before(() => {
  owner = null;
  projectId = null;
  capabilitySnapshot = null;
});

test("setup：注册用户 + 项目 + 分镜画格能力 + 网关 + provider 复位", async () => {
  owner = await registerUser("t15prev");
  projectId = await createProject("T15 分镜预览项目", owner.token);
  seedCapabilities();
  await seedGatewayRoutes();
  resetScenarios();
  capabilitySnapshot = await fetchImageCapabilitySnapshot(owner.token);
}, 120_000);

test("可选旁路：建 image job + 画格槽，不建视频 job、不改 Preset（AC#2）", async () => {
  const fixture = await produceAppliedSceneCard(projectId, owner.token);
  resetScenarios();
  await setScenarios({ image: { mode: "success" } });
  const snapshot = await fetchSnapshot(projectId, owner.token);
  const sceneCard = snapshot.scene_cards.find((c) => String(c.scene_card_id) === fixture.sceneCardId);
  const body = buildPreviewBody(fixture.sceneCardId, sceneCard.version, capabilitySnapshot, 2);

  const before = {
    videoJobs: countWhere("generation_jobs", `project_id=${projectId} AND type='video'`),
    imageJobs: countWhere("generation_jobs", `project_id=${projectId} AND type='image'`),
    presetVersion: Number(mysqlQuery(`SELECT version FROM scene_card_generation_presets WHERE scene_card_id=${fixture.sceneCardId}`)),
    presets: countWhere("scene_card_generation_presets", `scene_card_id=${fixture.sceneCardId}`),
    previews: countWhere("storyboard_previews", `scene_card_id=${fixture.sceneCardId}`),
  };

  const result = await createStoryboardPreview(projectId, fixture.sceneCardId, body, owner.token, uniqueKey("t15-create"));
  assert.equal(result.body.code, 200, `分镜预览应成功：${JSON.stringify(result.body)}`);
  assert.equal(result.response.status, 202, "成功应回 202");
  const previewId = String(result.body.data?.preview_id);
  const jobId = String(result.body.data?.generation_job_id);
  assert.ok(previewId, "应返回 preview_id");
  assert.ok(jobId, "应返回 generation_job_id");

  // 建 image job（source=storyboard_preview，expected_output_count=count）；视频 job 计数不变。
  const job = mysqlJson(
    `SELECT JSON_OBJECT('type',type,'source',source,'expected_output_count',expected_output_count) FROM generation_jobs WHERE id=${jobId}`,
  );
  assert.equal(job.type, "image", "画格 job 类型应为 image");
  assert.equal(job.source, "storyboard_preview");
  assert.equal(job.expected_output_count, 2);
  assert.equal(countWhere("generation_jobs", `project_id=${projectId} AND type='video'`), before.videoJobs, "不得自动建视频 job");
  assert.equal(countWhere("generation_jobs", `project_id=${projectId} AND type='image'`), before.imageJobs + 1);

  // Preset 不变（媒体类型仍视频、版本不变、行数不变）—— AC#2 不切媒体类型 / 不改 Preset。
  assert.equal(Number(mysqlQuery(`SELECT version FROM scene_card_generation_presets WHERE scene_card_id=${fixture.sceneCardId}`)), before.presetVersion, "Preset 版本不变");
  assert.equal(countWhere("scene_card_generation_presets", `scene_card_id=${fixture.sceneCardId}`), before.presets, "Preset 行数不变");

  // 聚合根 + N 个有序画格槽（slot_index 0..count-1，status=pending）。
  assert.equal(countWhere("storyboard_previews", `scene_card_id=${fixture.sceneCardId}`), before.previews + 1);
  const preview = mysqlJson(
    `SELECT JSON_OBJECT('summary_status',summary_status,'first_generation_job_id',first_generation_job_id) FROM storyboard_previews WHERE id=${previewId}`,
  );
  assert.equal(preview.summary_status, "generating");
  assert.equal(String(preview.first_generation_job_id), jobId);
  const slots = mysqlJson(
    `SELECT JSON_ARRAYAGG(JSON_OBJECT('slot_index',slot_index,'status',status)) FROM generation_output_slots WHERE generation_job_id=${jobId}`,
  );
  const slotIndexes = slots.map((s) => s.slot_index).sort((a, b) => a - b);
  assert.deepEqual(slotIndexes, [0, 1], "画格槽 slot_index 应为 0..count-1");
  assert.ok(slots.every((s) => s.status === "pending"), "新画格槽应为 pending");
  resetScenarios();
}, 150_000);

test("Snapshot 含 storyboard_previews + project_events 发 storyboard_preview.created（AC#6）", async () => {
  const fixture = await produceAppliedSceneCard(projectId, owner.token);
  resetScenarios();
  const snapshot = await fetchSnapshot(projectId, owner.token);
  const sceneCard = snapshot.scene_cards.find((c) => String(c.scene_card_id) === fixture.sceneCardId);
  const body = buildPreviewBody(fixture.sceneCardId, sceneCard.version, capabilitySnapshot, 2);
  const key = uniqueKey("t15-snap");

  const result = await createStoryboardPreview(projectId, fixture.sceneCardId, body, owner.token, key);
  assert.equal(result.body.code, 200);
  const previewId = String(result.body.data?.preview_id);

  const after = await fetchSnapshot(projectId, owner.token);
  const previewView = after.storyboard_previews?.find((p) => String(p.preview_id) === previewId);
  assert.ok(previewView, "Snapshot 应含 storyboard_previews");
  assert.equal(String(previewView.scene_card_id), fixture.sceneCardId);
  assert.equal(String(previewView.first_generation_job_id), String(result.body.data?.generation_job_id));

  const event = mysqlJson(
    `SELECT JSON_OBJECT('event_type',event_type,'aggregate_type',aggregate_type) FROM project_events WHERE event_type='storyboard_preview.created' AND aggregate_id='${previewId}' ORDER BY cursor DESC LIMIT 1`,
  );
  assert.ok(event, "project_events 应发 storyboard_preview.created");
  assert.equal(event.aggregate_type, "storyboard_preview");
}, 120_000);

test("同 CommandId + 同请求 → 重放首次结果，不增表；同 Key 异内容 → 100302", async () => {
  const fixture = await produceAppliedSceneCard(projectId, owner.token);
  resetScenarios();
  const snapshot = await fetchSnapshot(projectId, owner.token);
  const sceneCard = snapshot.scene_cards.find((c) => String(c.scene_card_id) === fixture.sceneCardId);
  const body = buildPreviewBody(fixture.sceneCardId, sceneCard.version, capabilitySnapshot, 2);
  const key = uniqueKey("t15-idem");

  const first = await createStoryboardPreview(projectId, fixture.sceneCardId, body, owner.token, key);
  assert.equal(first.body.code, 200);
  const firstPreviewId = String(first.body.data?.preview_id);
  const previewsBefore = countWhere("storyboard_previews", `scene_card_id=${fixture.sceneCardId}`);

  const replay = await createStoryboardPreview(projectId, fixture.sceneCardId, body, owner.token, key);
  assert.equal(replay.body.code, 200, "同 CommandId 应重放");
  assert.equal(String(replay.body.data?.preview_id), firstPreviewId, "重放应返回首次 preview_id");
  assert.equal(countWhere("storyboard_previews", `scene_card_id=${fixture.sceneCardId}`), previewsBefore, "重放不增表");

  const conflictBody = buildPreviewBody(fixture.sceneCardId, sceneCard.version, capabilitySnapshot, 1);
  const conflict = await createStoryboardPreview(projectId, fixture.sceneCardId, conflictBody, owner.token, key);
  assert.equal(conflict.body.code, 100302, `同 Key 异内容应 100302：${JSON.stringify(conflict.body)}`);
  assert.equal(countWhere("storyboard_previews", `scene_card_id=${fixture.sceneCardId}`), previewsBefore, "冲突不增表");
}, 120_000);

test("版本冲突：旧 base 提交零写入并返回 100406", async () => {
  const fixture = await produceAppliedSceneCard(projectId, owner.token);
  resetScenarios();
  const snapshot = await fetchSnapshot(projectId, owner.token);
  const sceneCard = snapshot.scene_cards.find((c) => String(c.scene_card_id) === fixture.sceneCardId);
  const body = buildPreviewBody(fixture.sceneCardId, sceneCard.version, capabilitySnapshot, 2);
  // 模拟 SceneCard 已被改版 → 编辑器带的 base 已过期。
  mysqlQuery(`UPDATE scene_cards SET version=version+1 WHERE id=${fixture.sceneCardId}`);
  const previewsBefore = countWhere("storyboard_previews", `scene_card_id=${fixture.sceneCardId}`);

  const result = await createStoryboardPreview(projectId, fixture.sceneCardId, body, owner.token, uniqueKey("t15-conf"));
  assert.equal(result.body.code, 100406, `版本冲突应返回 100406：${JSON.stringify(result.body)}`);
  assert.equal(countWhere("storyboard_previews", `scene_card_id=${fixture.sceneCardId}`), previewsBefore, "冲突零写入");
}, 90_000);

test("能力上限：count 越过 quantity_max 零写入并返回 400", async () => {
  const fixture = await produceAppliedSceneCard(projectId, owner.token);
  resetScenarios();
  const snapshot = await fetchSnapshot(projectId, owner.token);
  const sceneCard = snapshot.scene_cards.find((c) => String(c.scene_card_id) === fixture.sceneCardId);
  // quantity_max=2；count=4 越界（但仍在 schema 1..4 内，故走 capability_limit 而非参数校验）。
  const body = buildPreviewBody(fixture.sceneCardId, sceneCard.version, capabilitySnapshot, 4);
  const previewsBefore = countWhere("storyboard_previews", `scene_card_id=${fixture.sceneCardId}`);

  const result = await createStoryboardPreview(projectId, fixture.sceneCardId, body, owner.token, uniqueKey("t15-limit"));
  assert.equal(result.body.code, 400, `越界 count 应拒绝：${JSON.stringify(result.body)}`);
  assert.equal(countWhere("storyboard_previews", `scene_card_id=${fixture.sceneCardId}`), previewsBefore, "越界零写入");
  assert.equal(stubLedger().length, 0, "越界不应触发 provider 请求");
}, 90_000);

test("画格产出：job 成功后按 slot_index 升序发布 Asset（AC#3）", async () => {
  const fixture = await produceAppliedSceneCard(projectId, owner.token);
  resetScenarios();
  await setScenarios({ image: { mode: "success" } });
  const snapshot = await fetchSnapshot(projectId, owner.token);
  const sceneCard = snapshot.scene_cards.find((c) => String(c.scene_card_id) === fixture.sceneCardId);
  const body = buildPreviewBody(fixture.sceneCardId, sceneCard.version, capabilitySnapshot, 2);

  const result = await createStoryboardPreview(projectId, fixture.sceneCardId, body, owner.token, uniqueKey("t15-gen"));
  assert.equal(result.body.code, 200);
  const jobId = String(result.body.data?.generation_job_id);

  await waitFor(
    () => {
      const status = mysqlQuery(`SELECT status FROM generation_jobs WHERE id=${jobId}`);
      return status === "succeeded" ? status : null;
    },
    30_000,
    `服务=worker 事实=画格 job ${jobId} 应成功`,
  );
  // 每个 slot 都发布 Asset、status=succeeded，slot_index 升序覆盖 0..count-1。
  const slots = mysqlJson(
    `SELECT JSON_ARRAYAGG(JSON_OBJECT('slot_index',slot_index,'status',status,'asset_id',asset_id)) FROM generation_output_slots WHERE generation_job_id=${jobId}`,
  );
  const ordered = slots.sort((a, b) => a.slot_index - b.slot_index);
  assert.equal(ordered.length, 2, "应有 2 个画格槽");
  assert.deepEqual(ordered.map((s) => s.slot_index), [0, 1], "slot_index 升序");
  assert.ok(ordered.every((s) => s.status === "succeeded" && s.asset_id != null), "每格应成功并发布 Asset");

  // summary_status 收敛：worker 完成后预览汇总态应从 generating 推进到 success（不永久停留）。
  const previewId = String(result.body.data?.preview_id);
  await waitFor(
    () => {
      const status = mysqlQuery(`SELECT summary_status FROM storyboard_previews WHERE id=${previewId}`);
      return status === "success" ? status : null;
    },
    10_000,
    "服务=worker 事实=预览 summary_status 应收敛为 success",
  );
  resetScenarios();
}, 150_000);
