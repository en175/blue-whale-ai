// Node-only 全栈黑盒：SceneCard 生成编辑器再生成闭环（IK67HB T13，契约 §9 / CONTEXT L49-63/84-89）。
// 只经公开 HTTP（POST /scene-cards/{id}/generate、GET .../generation-preset）、Snapshot、provider-stub
// 账本与只读 SQL 断言，不 import 产品源码。
//
// 覆盖 AC：成功提交原子更新 Preset+Record+Job（#4）、参数属新记录不伪装重试（#5）、版本冲突零写入（#6）、
// 关闭不保存、能力限制零写入（#1/#4）、历史不可变（#5）、跨重启幂等。
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

// provider-stub 账本（仿 scenario-blackbox）：在 provider-stub 容器内 fetch 注入/复位/查询。
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
      '[{"id":"1280x720","label":"720p","api_value":"1280x720"}]', '["16:9"]', '[3,5,10]', '["mp4"]',
      '1280x720', NULL, '16:9', 5,
      '{"quantity_max":2}', true, 2, 0, false
    )
  `);
}

/** 给种子模型在 new-api 网关注册路由（指向 provider-stub）+ 计费，
 *  否则再生成任务冻结的 t11-* 模型无通道可走，provider-stub 收不到请求。 */
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
  // 网关启动时加载通道缓存，注册后必须重启才生效。
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
  const key = uniqueKey("t13-msg");
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

async function produceSceneCardCreatePlan(projectId, token) {
  const data = await postCreationMessage(projectId, token, "创作：主体：蓝鲸 预期：动态海报 出两张 立即出计划", []);
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
  return postJson(`/api/projects/${projectId}/plan-messages/${messageId}/apply`, body ?? {}, token, idempotencyKey);
}

async function fetchGenerationPreset(projectId, sceneCardId, token) {
  const result = await requestJson(`/api/projects/${projectId}/scene-cards/${sceneCardId}/generation-preset`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(result.body.code, 200, `Preset 只读端点应成功：${JSON.stringify(result.body)}`);
  return result.body.data;
}

async function generateSceneCard(projectId, sceneCardId, body, token, idempotencyKey) {
  return postJson(`/api/projects/${projectId}/scene-cards/${sceneCardId}/generate`, body, token, idempotencyKey);
}

/** 前置 fixture：产一张已应用 SceneCard，记首次事实身份供后续场景断言。 */
async function produceAppliedSceneCard(projectId, token) {
  const plan = await produceSceneCardCreatePlan(projectId, token);
  const messageId = String(plan.message_id);
  const key = uniqueKey("t13-apply");
  const applied = await applyPlan(projectId, messageId, token, key);
  assert.equal(applied.body.code, 200, `首次应用应成功：${JSON.stringify(applied.body)}`);
  const sceneCardId = String(applied.body.data?.scene_card_id);
  const firstJobId = String(applied.body.data?.generation_job_id);
  const firstReceipt = mysqlJson(
    `SELECT JSON_OBJECT('id',id,'message_id',message_id) FROM plan_application_receipts WHERE message_id=${messageId}`,
  );
  const firstRecord = mysqlJson(
    `SELECT JSON_OBJECT('id',id) FROM scene_card_generation_records WHERE scene_card_id=${sceneCardId} ORDER BY id ASC LIMIT 1`,
  );
  const firstPresetVersion = Number(
    mysqlQuery(`SELECT version FROM scene_card_generation_presets WHERE scene_card_id=${sceneCardId}`),
  );
  return {
    plan,
    sceneCardId,
    firstJobId,
    firstPlanMessageId: messageId,
    firstReceiptId: String(firstReceipt.id),
    firstRecordId: String(firstRecord.id),
    firstPresetVersion,
  };
}

/** 从只读端点读当前 preset，构造一份改 duration 的 generate body（保持其余参数与 snapshot）。 */
async function buildGenerateBody(projectId, fixture, token, overrides) {
  const preset = await fetchGenerationPreset(projectId, fixture.sceneCardId, token);
  const parameters = preset.preset.parameters;
  return {
    scene_card_id: fixture.sceneCardId,
    base_scene_card_version: preset.scene_card.version,
    base_preset_version: preset.preset.version,
    parameters: { ...parameters, count: 1, ...(overrides?.parameters ?? { duration: 10 }) },
    reference_mode: preset.preset.reference_mode,
    reference_assets: preset.preset.reference_assets,
    capability_snapshot_version: preset.preset.capability_snapshot_version,
  };
}

let owner;
let projectId;

before(() => {
  owner = null;
  projectId = null;
});

test("setup：注册用户 + 项目 + 能力 + provider 复位", async () => {
  owner = await registerUser("t13regen");
  projectId = await createProject("T13 再生成闭环项目", owner.token);
  seedCapabilities();
  await seedGatewayRoutes();
  resetScenarios();
});

test("成功提交：原子更新 Preset(version+1) + 新 Record + 新 Job（AC#4）", async () => {
  const fixture = await produceAppliedSceneCard(projectId, owner.token);
  resetScenarios();
  await setScenarios({ video: { mode: "success" } });
  const body = await buildGenerateBody(projectId, fixture, owner.token);
  const key = uniqueKey("t13-gen");

  const before = {
    records: countWhere("scene_card_generation_records", `scene_card_id=${fixture.sceneCardId}`),
    jobs: countWhere("generation_jobs", `project_id=${projectId} AND source='scene_card'`),
    cards: countWhere("scene_cards", `project_id=${projectId}`),
    receipts: countWhere("plan_application_receipts", `project_id=${projectId}`),
    plans: countWhere("plan_messages", `project_id=${projectId}`),
  };

  const result = await generateSceneCard(projectId, fixture.sceneCardId, body, owner.token, key);
  assert.equal(result.body.code, 200, `再生成应成功：${JSON.stringify(result.body)}`);
  assert.equal(result.response.status, 202, "成功应回 202");
  const newJobId = String(result.body.data?.generation_job_id);
  const newRecordId = String(result.body.data?.record_id);
  assert.ok(newJobId, "应返回 generation_job_id");
  assert.ok(newRecordId, "应返回 record_id");

  // 新 Record + 新 Job；Preset version+1；历史三表计数不变。
  assert.equal(countWhere("scene_card_generation_records", `scene_card_id=${fixture.sceneCardId}`), before.records + 1);
  assert.equal(countWhere("generation_jobs", `project_id=${projectId} AND source='scene_card'`), before.jobs + 1);
  assert.equal(
    Number(mysqlQuery(`SELECT version FROM scene_card_generation_presets WHERE scene_card_id=${fixture.sceneCardId}`)),
    fixture.firstPresetVersion + 1,
    "Preset version 应 +1",
  );
  assert.equal(countWhere("scene_cards", `project_id=${projectId}`), before.cards);
  assert.equal(countWhere("plan_application_receipts", `project_id=${projectId}`), before.receipts);
  assert.equal(countWhere("plan_messages", `project_id=${projectId}`), before.plans);

  // 新 Record 绑同 scene_card_id + 首次 plan_message_id + 首次 receipt_id + 新 job。
  const newRecord = mysqlJson(
    `SELECT JSON_OBJECT('summary_status',summary_status,'plan_message_id',plan_message_id,'application_receipt_id',application_receipt_id,'first_generation_job_id',first_generation_job_id) FROM scene_card_generation_records WHERE id=${newRecordId}`,
  );
  assert.equal(newRecord.summary_status, "generating");
  assert.equal(String(newRecord.plan_message_id), fixture.firstPlanMessageId);
  assert.equal(String(newRecord.application_receipt_id), fixture.firstReceiptId);
  assert.equal(String(newRecord.first_generation_job_id), newJobId);

  // provider-stub 收到新视频请求。
  await waitFor(() => {
    const ledger = stubLedger();
    return ledger.some(
      (req) => req.method === "POST" && req.pathname === "/v1/video/generations",
    )
      ? ledger
      : null;
  }, 15_000, "服务=provider-stub 事实=应收到新视频请求");

  // 同 CommandId 重放返回同结果且表不增。
  const replayBefore = countWhere("scene_card_generation_records", `scene_card_id=${fixture.sceneCardId}`);
  const replay = await generateSceneCard(projectId, fixture.sceneCardId, body, owner.token, key);
  assert.equal(replay.body.code, 200, "同 CommandId 应重放");
  assert.equal(String(replay.body.data?.generation_job_id), newJobId);
  assert.equal(countWhere("scene_card_generation_records", `scene_card_id=${fixture.sceneCardId}`), replayBefore);
  resetScenarios();
}, 120_000);

test("关闭不保存：只读 GET preset 多次，不发 generate → 全表不变 + provider 无请求（AC#3）", async () => {
  const fixture = await produceAppliedSceneCard(projectId, owner.token);
  resetScenarios();
  const before = {
    records: countWhere("scene_card_generation_records", `scene_card_id=${fixture.sceneCardId}`),
    jobs: countWhere("generation_jobs", `project_id=${projectId}`),
    presetVersion: Number(mysqlQuery(`SELECT version FROM scene_card_generation_presets WHERE scene_card_id=${fixture.sceneCardId}`)),
  };
  for (let i = 0; i < 3; i += 1) {
    await fetchGenerationPreset(projectId, fixture.sceneCardId, owner.token);
  }
  assert.equal(countWhere("scene_card_generation_records", `scene_card_id=${fixture.sceneCardId}`), before.records);
  assert.equal(countWhere("generation_jobs", `project_id=${projectId}`), before.jobs);
  assert.equal(Number(mysqlQuery(`SELECT version FROM scene_card_generation_presets WHERE scene_card_id=${fixture.sceneCardId}`)), before.presetVersion);
  assert.equal(stubLedger().length, 0, "只读不应触发 provider 请求");
}, 90_000);

test("能力限制：越界参数零写入（AC#1/#4）", async () => {
  const fixture = await produceAppliedSceneCard(projectId, owner.token);
  resetScenarios();
  const body = await buildGenerateBody(projectId, fixture, owner.token, {
    parameters: { aspect_ratio: "4:3" },
  });
  const before = countWhere("scene_card_generation_records", `scene_card_id=${fixture.sceneCardId}`);
  const presetVersionBefore = Number(mysqlQuery(`SELECT version FROM scene_card_generation_presets WHERE scene_card_id=${fixture.sceneCardId}`));

  const result = await generateSceneCard(projectId, fixture.sceneCardId, body, owner.token, uniqueKey("t13-limit"));
  assert.equal(result.body.code, 400, `越界参数应拒绝：${JSON.stringify(result.body)}`);
  assert.equal(countWhere("scene_card_generation_records", `scene_card_id=${fixture.sceneCardId}`), before, "越界零写入");
  assert.equal(Number(mysqlQuery(`SELECT version FROM scene_card_generation_presets WHERE scene_card_id=${fixture.sceneCardId}`)), presetVersionBefore, "preset 版本不变");
  assert.equal(stubLedger().length, 0, "越界不应触发 provider 请求");
}, 90_000);

test("版本冲突：旧 base 提交零写入并返回 100405（AC#6）", async () => {
  const fixture = await produceAppliedSceneCard(projectId, owner.token);
  resetScenarios();
  const body = await buildGenerateBody(projectId, fixture, owner.token);
  // 模拟另一处更新了 preset 版本 → 编辑器带的 base 已过期。
  mysqlQuery(`UPDATE scene_card_generation_presets SET version=version+1 WHERE scene_card_id=${fixture.sceneCardId}`);
  const before = countWhere("scene_card_generation_records", `scene_card_id=${fixture.sceneCardId}`);

  const result = await generateSceneCard(projectId, fixture.sceneCardId, body, owner.token, uniqueKey("t13-conflict"));
  assert.equal(result.body.code, 100405, `版本冲突应返回 100405：${JSON.stringify(result.body)}`);
  assert.equal(countWhere("scene_card_generation_records", `scene_card_id=${fixture.sceneCardId}`), before, "冲突零写入");
  assert.equal(stubLedger().length, 0, "冲突不应触发 provider 请求");
}, 90_000);

test("历史不可变：参数变化新生成后，首条事实全字段未变（AC#5）", async () => {
  const fixture = await produceAppliedSceneCard(projectId, owner.token);
  resetScenarios();
  await setScenarios({ video: { mode: "success" } });
  // 冻结首条事实快照。
  const firstPlan = mysqlJson(`SELECT JSON_OBJECT('content_markdown',content_markdown,'application_kind',application_kind,'frozen_generation_parameters',frozen_generation_parameters) FROM plan_messages WHERE message_id=${fixture.firstPlanMessageId}`);
  const firstJobInput = mysqlQuery(`SELECT input FROM generation_jobs WHERE id=${fixture.firstJobId}`);
  const firstReceiptJson = mysqlJson(`SELECT JSON_OBJECT('application_kind',application_kind,'scene_card_id',scene_card_id,'first_generation_job_id',first_generation_job_id,'command_id',command_id) FROM plan_application_receipts WHERE id=${fixture.firstReceiptId}`);
  const firstRecordJson = mysqlJson(`SELECT JSON_OBJECT('summary_status',summary_status,'plan_message_id',plan_message_id,'application_receipt_id',application_receipt_id,'first_generation_job_id',first_generation_job_id) FROM scene_card_generation_records WHERE id=${fixture.firstRecordId}`);

  const body = await buildGenerateBody(projectId, fixture, owner.token, { parameters: { duration: 10 } });
  const result = await generateSceneCard(projectId, fixture.sceneCardId, body, owner.token, uniqueKey("t13-imm"));
  assert.equal(result.body.code, 200);
  const newJobId = String(result.body.data?.generation_job_id);

  // 首条 plan_messages / generation_jobs.input / receipt / record 全字段未变。
  assert.deepEqual(
    mysqlJson(`SELECT JSON_OBJECT('content_markdown',content_markdown,'application_kind',application_kind,'frozen_generation_parameters',frozen_generation_parameters) FROM plan_messages WHERE message_id=${fixture.firstPlanMessageId}`),
    firstPlan,
  );
  assert.equal(mysqlQuery(`SELECT input FROM generation_jobs WHERE id=${fixture.firstJobId}`), firstJobInput);
  assert.deepEqual(
    mysqlJson(`SELECT JSON_OBJECT('application_kind',application_kind,'scene_card_id',scene_card_id,'first_generation_job_id',first_generation_job_id,'command_id',command_id) FROM plan_application_receipts WHERE id=${fixture.firstReceiptId}`),
    firstReceiptJson,
  );
  assert.deepEqual(
    mysqlJson(`SELECT JSON_OBJECT('summary_status',summary_status,'plan_message_id',plan_message_id,'application_receipt_id',application_receipt_id,'first_generation_job_id',first_generation_job_id) FROM scene_card_generation_records WHERE id=${fixture.firstRecordId}`),
    firstRecordJson,
  );

  // 新 Job 不伪装重试：retry_of_job_id 为 null，action_identity 是新 CommandId。
  const newJob = mysqlJson(`SELECT JSON_OBJECT('retry_of_job_id',retry_of_job_id,'action_identity',action_identity,'source',source) FROM generation_jobs WHERE id=${newJobId}`);
  assert.equal(newJob.retry_of_job_id, null, "新 Job 不得指向历史 job（AC#5 不伪装重试）");
  assert.equal(newJob.source, "scene_card");
  assert.ok(newJob.action_identity, "新 Job 应有独立 action_identity");
  resetScenarios();
}, 120_000);

test("跨重启幂等：重启 generation-worker 后重放同 CommandId 仍是首次结果（AC#7）", async () => {
  const fixture = await produceAppliedSceneCard(projectId, owner.token);
  resetScenarios();
  await setScenarios({ video: { mode: "success" } });
  const body = await buildGenerateBody(projectId, fixture, owner.token);
  const key = uniqueKey("t13-restart");

  const first = await generateSceneCard(projectId, fixture.sceneCardId, body, owner.token, key);
  assert.equal(first.body.code, 200);
  const firstJobId = String(first.body.data?.generation_job_id);

  compose("restart", "generation-worker");

  const replayBefore = countWhere("scene_card_generation_records", `scene_card_id=${fixture.sceneCardId}`);
  const replay = await generateSceneCard(projectId, fixture.sceneCardId, body, owner.token, key);
  assert.equal(replay.body.code, 200, "重启后重放应返回首次结果");
  assert.equal(String(replay.body.data?.generation_job_id), firstJobId);
  assert.equal(countWhere("scene_card_generation_records", `scene_card_id=${fixture.sceneCardId}`), replayBefore, "重启重放不增表");
  resetScenarios();
}, 150_000);
