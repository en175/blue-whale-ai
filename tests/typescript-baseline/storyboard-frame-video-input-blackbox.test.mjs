// Node-only 全栈黑盒：StoryboardPreview 画格接入视频首/尾帧/参考图（IK70LQ，契约 §9 / CONTEXT L53-57）。
// 只经公开 HTTP（POST /scene-cards/{id}/storyboard-preview、POST /scene-cards/{id}/generate、
// GET .../generation-preset）、Snapshot、provider-stub 账本与只读 SQL 断言，不 import 产品源码。
//
// 覆盖 AC：画格作首帧经稳定 asset_id 进入 job.input 扁平字段并触发视频供应商（#3/#4）、
// 未选画格不成为输入（#5）、模型不支持首帧组合在任何副作用前零写入（#4/#5）、刷新后 preset 回显画格角色（#6）。
// 注：provider-stub 的 video POST 不记录请求 body（仅 method/pathname/model），故 firstFrameImage 传输由
// 「job.input.first_frame_asset_id 命中画格 asset_id + provider 收到 video POST」间接证明——worker
// buildSubmitRequest 读 first_frame_asset_id → resolveInputAssets → firstFrameImage 是代码必然。
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

/** 种子 t11-image（画格通道，quantity_max=2）+ t11-video（视频通道，声明首帧/首尾帧能力）。
 *  features 不进 digest（capability-digest 仅 8 字段），故后续用例 UPDATE features 不触发 drift。 */
function seedCapabilities() {
  mysqlQuery("DELETE FROM generation_model_capability WHERE provider_id='t11-doubao'");
  insertedId(`
    INSERT INTO generation_model_capability (
      provider_id, model_id, capability_type, model_label, icon,
      supported_sizes, supported_aspect_ratios, supported_durations, supported_formats,
      default_size, default_format, default_aspect_ratio, default_duration,
      features, enabled, sort_order, version, is_delete
    ) VALUES (
      't11-doubao', 't11-image', 'image', 'T11 图像', NULL,
      '[{"id":"1024x1024","label":"1:1","api_value":"1024x1024"}]', '["1:1"]', NULL, '["png"]',
      '1024x1024', 'png', '1:1', NULL,
      '{"quantity_max":2}', true, 1, 0, false
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
      '[{"id":"1280x720","label":"720p","api_value":"1280x720"}]', '["16:9"]', '[3,5,10]', '["mp4"]',
      '1280x720', NULL, '16:9', 5,
      '{"quantity_max":2,"first_frame":true,"first_last_frame":true}', true, 2, 0, false
    )
  `);
}

/** 视频能力 features 临时切换（digest 不含 features，不改漂移基准）。 */
function setVideoFeatures(features) {
  mysqlQuery(
    `UPDATE generation_model_capability SET features='${JSON.stringify(features)}' WHERE model_id='t11-video'`,
  );
}

async function seedGatewayRoutes() {
  compose(
    "exec", "-T", "mysql", "mysql", "-uroot", "-pblue_whale",
    "-N", "-B", "new_api",
    "-e",
    "DELETE FROM channels WHERE id IN (9013, 9014); " +
      "INSERT INTO channels (id, type, `key`, status, name, weight, created_time, base_url, models, `group`, priority, auto_ban, settings) VALUES " +
      "(9013, 1, 'sk-acceptance-upstream', 1, 'acceptance-t11-image', 100, UNIX_TIMESTAMP(), 'http://provider-stub:4329', 't11-image', 'default', 100, 0, '{\"disable_task_polling_sleep\":true}'), " +
      "(9014, 59, 'sk-acceptance-upstream', 1, 'acceptance-t11-video', 100, UNIX_TIMESTAMP(), 'http://provider-stub:4329', 't11-video', 'default', 100, 0, '{\"disable_task_polling_sleep\":true}'); " +
      "UPDATE options SET value = JSON_SET(value, '$.\"t11-image\"', 1, '$.\"t11-video\"', 1) WHERE `key` = 'ModelRatio';",
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
  const key = uniqueKey("ik70lq-msg");
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
  const applied = await postJson(
    `/api/projects/${projectId}/plan-messages/${messageId}/apply`, {}, token, uniqueKey("ik70lq-apply"),
  );
  assert.equal(applied.body.code, 200, `首次应用应成功：${JSON.stringify(applied.body)}`);
  return { sceneCardId: String(applied.body.data?.scene_card_id) };
}

async function fetchGenerationPreset(projectId, sceneCardId, token) {
  const result = await requestJson(`/api/projects/${projectId}/scene-cards/${sceneCardId}/generation-preset`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(result.body.code, 200, `Preset 只读端点应成功：${JSON.stringify(result.body)}`);
  return result.body.data;
}

async function buildGenerateBody(projectId, sceneCardId, token, overrides = {}) {
  const preset = await fetchGenerationPreset(projectId, sceneCardId, token);
  return {
    scene_card_id: sceneCardId,
    base_scene_card_version: preset.scene_card.version,
    base_preset_version: preset.preset.version,
    parameters: { ...preset.preset.parameters, count: 1, ...(overrides.parameters ?? { duration: 5 }) },
    reference_mode: overrides.reference_mode ?? preset.preset.reference_mode,
    reference_assets: overrides.reference_assets ?? preset.preset.reference_assets,
    capability_snapshot_version: preset.preset.capability_snapshot_version,
  };
}

async function generateSceneCard(projectId, sceneCardId, body, token, idempotencyKey) {
  return postJson(`/api/projects/${projectId}/scene-cards/${sceneCardId}/generate`, body, token, idempotencyKey);
}

async function fetchImageCapabilitySnapshot(token) {
  const result = await requestJson("/api/generation/models?capability=image", {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(result.body.code, 200, `能力端点应成功：${JSON.stringify(result.body)}`);
  const model = result.body.data?.find?.((m) => m.model_id === "t11-image");
  assert.ok(model, "应暴露 t11-image 能力");
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
    parameters: { model_id: "t11-image", size: "1024x1024", aspect_ratio: "1:1", count },
    capability_snapshot_version: capabilitySnapshot,
  };
}

/** 建分镜预览并等画格 succeeded，返回 [{slot_id, asset_id, slot_index}]（slot_index 升序）。 */
async function produceSucceededFrames(projectId, sceneCardId, token, count = 2) {
  await setScenarios({ image: { mode: "success" } });
  const imageSnapshot = await fetchImageCapabilitySnapshot(token);
  const snapshot = await fetchSnapshot(projectId, token);
  const sceneCard = snapshot.scene_cards.find((c) => String(c.scene_card_id) === sceneCardId);
  const body = buildPreviewBody(sceneCardId, sceneCard.version, imageSnapshot, count);
  const result = await createStoryboardPreview(projectId, sceneCardId, body, token, uniqueKey("ik70lq-frame"));
  assert.equal(result.body.code, 200, `分镜预览应成功：${JSON.stringify(result.body)}`);
  const jobId = String(result.body.data?.generation_job_id);
  await waitFor(
    () => {
      const status = mysqlQuery(`SELECT status FROM generation_jobs WHERE id=${jobId}`);
      return status === "succeeded" ? status : null;
    },
    30_000,
    `服务=worker 事实=画格 job ${jobId} 应成功`,
  );
  const slots = mysqlJson(
    `SELECT JSON_ARRAYAGG(JSON_OBJECT('slot_id',id,'asset_id',asset_id,'slot_index',slot_index)) FROM generation_output_slots WHERE generation_job_id=${jobId}`,
  );
  resetScenarios();
  return slots
    .filter((s) => s.asset_id !== null)
    .sort((a, b) => a.slot_index - b.slot_index);
}

let owner;
let projectId;

before(() => {
  owner = null;
  projectId = null;
});

test("setup：注册用户 + 项目 + 画格/视频能力 + 网关 + provider 复位", async () => {
  owner = await registerUser("ik70lq");
  projectId = await createProject("IK70LQ 画格接入视频项目", owner.token);
  seedCapabilities();
  await seedGatewayRoutes();
  resetScenarios();
}, 120_000);

test("AC4 显式选择：画格作首帧经 asset_id 进入 job.input 并触发视频供应商", async () => {
  const fixture = await produceAppliedSceneCard(projectId, owner.token);
  const frames = await produceSucceededFrames(projectId, fixture.sceneCardId, owner.token, 2);
  assert.ok(frames.length >= 1, "应至少产 1 张 succeeded 画格");
  const firstFrame = frames[0];

  resetScenarios();
  await setScenarios({ video: { mode: "success" } });
  const body = await buildGenerateBody(projectId, fixture.sceneCardId, owner.token, {
    reference_mode: "first_frame",
    reference_assets: [
      { slot_id: String(firstFrame.slot_id), type: "storyboard_frame", role: "first_frame" },
    ],
  });
  const result = await generateSceneCard(projectId, fixture.sceneCardId, body, owner.token, uniqueKey("ik70lq-gen"));
  assert.equal(result.body.code, 200, `画格首帧再生成应成功：${JSON.stringify(result.body)}`);
  const jobId = String(result.body.data?.generation_job_id);

  // 桥接铁证：job.input.first_frame_asset_id 命中画格 asset_id（worker buildSubmitRequest 据此取 firstFrameImage）。
  const jobInput = mysqlJson(`SELECT input FROM generation_jobs WHERE id=${jobId}`);
  assert.equal(
    String(jobInput.first_frame_asset_id),
    String(firstFrame.asset_id),
    "job.input.first_frame_asset_id 应等于画格 asset_id",
  );
  // worker 据扁平字段调供应商：provider-stub 收到 video POST。
  await waitFor(
    () => {
      const ledger = stubLedger();
      return ledger.some((req) => req.method === "POST" && req.pathname === "/v1/video/generations")
        ? ledger
        : null;
    },
    15_000,
    "服务=provider-stub 事实=应收到画格首帧的视频请求",
  );
  resetScenarios();
}, 180_000);

test("AC5 未选不输入：不选画格生成时 job.input 无画格字段", async () => {
  const fixture = await produceAppliedSceneCard(projectId, owner.token);
  await produceSucceededFrames(projectId, fixture.sceneCardId, owner.token, 2);

  resetScenarios();
  await setScenarios({ video: { mode: "success" } });
  const body = await buildGenerateBody(projectId, fixture.sceneCardId, owner.token);
  const result = await generateSceneCard(projectId, fixture.sceneCardId, body, owner.token, uniqueKey("ik70lq-none"));
  assert.equal(result.body.code, 200, `未选画格再生成应成功：${JSON.stringify(result.body)}`);
  const jobId = String(result.body.data?.generation_job_id);

  const jobInput = mysqlJson(`SELECT input FROM generation_jobs WHERE id=${jobId}`);
  assert.equal(jobInput.first_frame_asset_id ?? null, null, "未选画格不应有 first_frame_asset_id");
  assert.equal(jobInput.last_frame_asset_id ?? null, null, "未选画格不应有 last_frame_asset_id");
  assert.equal(jobInput.reference_asset_ids ?? null, null, "未选画格不应有 reference_asset_ids");
  resetScenarios();
}, 180_000);

test("AC5 不支持组合零写入：模型不支持首帧时画格作首帧 capability_limit + 表行不变 + 账本空", async () => {
  // 临时去掉 t11-video 的首帧能力（features 不进 digest，不触发 drift）。
  setVideoFeatures({ quantity_max: 2 });
  const fixture = await produceAppliedSceneCard(projectId, owner.token);
  const frames = await produceSucceededFrames(projectId, fixture.sceneCardId, owner.token, 2);
  const firstFrame = frames[0];

  resetScenarios();
  const body = await buildGenerateBody(projectId, fixture.sceneCardId, owner.token, {
    reference_mode: "first_frame",
    reference_assets: [
      { slot_id: String(firstFrame.slot_id), type: "storyboard_frame", role: "first_frame" },
    ],
  });
  const presetsBefore = countWhere("scene_card_generation_presets", `scene_card_id=${fixture.sceneCardId}`);
  const jobsBefore = countWhere("generation_jobs", `project_id=${projectId} AND source='scene_card'`);

  const result = await generateSceneCard(projectId, fixture.sceneCardId, body, owner.token, uniqueKey("ik70lq-limit"));
  assert.equal(result.body.code, 400, `模型不支持首帧应 400：${JSON.stringify(result.body)}`);
  assert.equal(result.body.msg, "当前模型不支持首帧参考模式", "应提示模型不支持首帧参考模式");

  assert.equal(countWhere("scene_card_generation_presets", `scene_card_id=${fixture.sceneCardId}`), presetsBefore, "零写入：Preset 行数不变");
  assert.equal(countWhere("generation_jobs", `project_id=${projectId} AND source='scene_card'`), jobsBefore, "零写入：视频 job 不增");
  assert.equal(stubLedger().length, 0, "零写入：不应触发 provider 请求");

  // 恢复首帧能力，避免影响后续用例。
  setVideoFeatures({ quantity_max: 2, first_frame: true, first_last_frame: true });
  resetScenarios();
}, 180_000);

test("AC5 组合不支持零写入：只选尾帧不选首帧 400 + 表行不变 + 账本空", async () => {
  const fixture = await produceAppliedSceneCard(projectId, owner.token);
  const frames = await produceSucceededFrames(projectId, fixture.sceneCardId, owner.token, 2);
  const lastFrame = frames[1];

  resetScenarios();
  const body = await buildGenerateBody(projectId, fixture.sceneCardId, owner.token, {
    reference_mode: "last_frame",
    reference_assets: [
      { slot_id: String(lastFrame.slot_id), type: "storyboard_frame", role: "last_frame" },
    ],
  });
  const presetsBefore = countWhere("scene_card_generation_presets", `scene_card_id=${fixture.sceneCardId}`);
  const jobsBefore = countWhere("generation_jobs", `project_id=${projectId} AND source='scene_card'`);

  const result = await generateSceneCard(projectId, fixture.sceneCardId, body, owner.token, uniqueKey("ik70lq-combo"));
  assert.equal(result.body.code, 400, `只选尾帧应 400：${JSON.stringify(result.body)}`);

  assert.equal(countWhere("scene_card_generation_presets", `scene_card_id=${fixture.sceneCardId}`), presetsBefore, "零写入：Preset 行数不变");
  assert.equal(countWhere("generation_jobs", `project_id=${projectId} AND source='scene_card'`), jobsBefore, "零写入：视频 job 不增");
  assert.equal(stubLedger().length, 0, "零写入：不应触发 provider 请求");
  resetScenarios();
}, 180_000);

test("AC6 刷新恢复：生成后 GET preset 含 storyboard_frame 角色（编辑器据此回显）", async () => {
  const fixture = await produceAppliedSceneCard(projectId, owner.token);
  const frames = await produceSucceededFrames(projectId, fixture.sceneCardId, owner.token, 2);
  const firstFrame = frames[0];

  resetScenarios();
  await setScenarios({ video: { mode: "success" } });
  const body = await buildGenerateBody(projectId, fixture.sceneCardId, owner.token, {
    reference_mode: "first_frame",
    reference_assets: [
      { slot_id: String(firstFrame.slot_id), type: "storyboard_frame", role: "first_frame" },
    ],
  });
  const result = await generateSceneCard(projectId, fixture.sceneCardId, body, owner.token, uniqueKey("ik70lq-restore"));
  assert.equal(result.body.code, 200, `画格首帧再生成应成功：${JSON.stringify(result.body)}`);

  // 刷新页面 → 编辑器打开时 GET preset，reference_assets 应含 storyboard_frame 条目（角色绑定持久）。
  const preset = await fetchGenerationPreset(projectId, fixture.sceneCardId, owner.token);
  const frameEntry = preset.preset.reference_assets.find(
    (a) => a.type === "storyboard_frame" && a.role === "first_frame",
  );
  assert.ok(frameEntry, "preset.reference_assets 应含 storyboard_frame 首帧条目");
  assert.equal(String(frameEntry.slot_id), String(firstFrame.slot_id), "回显的 slot_id 应与所选画格一致");
  resetScenarios();
}, 180_000);
