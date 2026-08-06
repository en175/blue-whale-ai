// Node-only 全栈黑盒：输出槽重试与 Canvas 放置恢复（IK67HE/T14，契约 §4.4/§4.5 / CONTEXT L97-102）。
// 复用 scene-card-generation-blackbox 的 t11- capability + 网关拓扑（已验证可产 scene_card_create）。
// 覆盖 AC：输出槽固定与四态（#1）、重试只补失败槽（#2）、重试幂等（#3）、SceneCard 同记录重试（#3）、
// 视频节点放置（#5）、放置恢复（#6）、刷新后稳定顺序（#7）。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { before, test } from "node:test";

const baseUrl = process.env.BW_ACCEPTANCE_WEB_URL ?? "http://127.0.0.1:3101";
const composeFile =
  process.env.BW_TS_COMPOSE_FILE ??
  "deploy/typescript-baseline/docker-compose.acceptance.yml";
const project =
  process.env.BW_TS_COMPOSE_PROJECT ?? "bw-ts-baseline-acceptance";

let sequence = 0;

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

function countWhere(table, where) {
  return Number(mysqlQuery(`SELECT COUNT(*) FROM ${table} WHERE ${where}`));
}

function uniqueKey(prefix) {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
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

async function fetchSnapshot(projectId, token) {
  const result = await requestJson(`/api/projects/${projectId}/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(result.body.code, 200, "Snapshot 应可读");
  return result.body.data;
}

async function putCanvas(projectId, token, canvas, nodes) {
  return requestJson(`/api/canvases/${projectId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "If-Match": canvas.version === null ? '"missing"' : `"${canvas.version}"`,
    },
    body: JSON.stringify({
      viewport: canvas.viewport,
      nodes: JSON.stringify(nodes),
    }),
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
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(
    `${message}${lastError ? `（最后错误：${lastError.message}）` : ""}`,
  );
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
  return JSON.parse(
    compose("exec", "-T", "provider-stub", "node", "-e", script),
  );
}

async function setScenarios(scenarios) {
  const result = stubFetch("/__acceptance/scenarios", {
    method: "POST",
    body: scenarios,
  });
  assert.equal(result.status, 200, "场景注入应成功");
}

function resetScenarios() {
  stubFetch("/__acceptance/scenarios", { method: "DELETE" });
  stubFetch("/__acceptance/requests", { method: "DELETE" });
}

// 复用 scene-card-generation-blackbox 的 t11- capability（已验证 Agent 能产 scene_card_create）。
function seedCapabilities() {
  mysqlQuery(
    "DELETE FROM generation_model_capability WHERE provider_id='t11-doubao'",
  );
  compose(
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
    "INSERT INTO generation_model_capability (" +
      "provider_id, model_id, capability_type, model_label, icon, " +
      "supported_sizes, supported_aspect_ratios, supported_durations, supported_formats, " +
      "default_size, default_format, default_aspect_ratio, default_duration, " +
      "features, enabled, sort_order, version, is_delete" +
      ") VALUES (" +
      "'t11-doubao', 't11-image', 'image', 'T11 图像', NULL, " +
      "'[\"1024x1024\"]', '[\"1:1\"]', NULL, '[\"png\"]', " +
      "'1024x1024', 'png', '1:1', NULL, " +
      "'{}', true, 1, 0, false" +
      "), (" +
      "'t11-doubao', 't11-video', 'video', 'T11 视频', NULL, " +
      '\'[{"id":"1280x720","label":"720p","api_value":"1280x720"}]\', \'["16:9"]\', \'[3,5,10]\', \'["mp4"]\', ' +
      "'1280x720', NULL, '16:9', 5, " +
      "'{\"quantity_max\":2}', true, 2, 0, false" +
      ")",
  );
}

async function seedGatewayRoutes() {
  compose(
    "exec",
    "-T",
    "mysql",
    "mysql",
    "-uroot",
    "-pblue_whale",
    "-N",
    "-B",
    "new_api",
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
      const health = execFileSync(
        "docker",
        ["inspect", "-f", "{{.State.Health.Status}}", containerId],
        {
          encoding: "utf8",
        },
      ).trim();
      return health === "healthy" ? true : null;
    },
    60_000,
    "服务=new-api 事实=重启后应恢复健康",
  );
}

async function postCreationMessage(projectId, token, content, mentions) {
  const key = uniqueKey("t14-msg");
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
    `Run ${agentRunId} 应进入终态`,
  );
}

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

async function applyPlan(projectId, messageId, token, idempotencyKey) {
  return postJson(
    `/api/projects/${projectId}/plan-messages/${messageId}/apply`,
    {},
    token,
    idempotencyKey,
  );
}

/** 前置 fixture：产一张已应用 SceneCard（视频路径），返回核心事实身份。 */
async function produceAppliedSceneCard(projectId, token) {
  const plan = await produceSceneCardCreatePlan(projectId, token);
  const messageId = String(plan.message_id);
  resetScenarios();
  await setScenarios({ videoSubmit: { mode: "fail" } });
  const key = uniqueKey("t14-apply");
  const applied = await applyPlan(projectId, messageId, token, key);
  assert.equal(
    applied.body.code,
    200,
    `首次应用应成功：${JSON.stringify(applied.body)}`,
  );
  return {
    plan,
    messageId,
    sceneCardId: String(applied.body.data?.scene_card_id),
    jobId: String(applied.body.data?.generation_job_id),
  };
}

async function retryJob(projectId, jobId, token, idempotencyKey) {
  return postJson(
    `/api/projects/${projectId}/generation-jobs/${jobId}/retry`,
    {},
    token,
    idempotencyKey,
  );
}

async function waitForJobTerminal(
  projectId,
  token,
  jobId,
  deadlineMs = 40_000,
) {
  return waitFor(
    async () => {
      const snapshot = await fetchSnapshot(projectId, token);
      const job = snapshot.generation_jobs?.find(
        (j) => String(j.job_id) === String(jobId),
      );
      if (!job) return null;
      if (job.status === "queued" || job.status === "processing") return null;
      return job;
    },
    deadlineMs,
    `Job ${jobId} 应进入终态`,
  );
}

let owner;
let projectId;

before(() => {
  owner = null;
  projectId = null;
});

test("setup：注册用户 + 项目 + 能力 + provider 复位", async () => {
  owner = await registerUser("t14slot");
  projectId = await createProject("T14 输出槽重试项目", owner.token);
  seedCapabilities();
  await seedGatewayRoutes();
  resetScenarios();
});

// 场景 A：输出槽固定——视频应用后 generation_output_slots 有固定槽（AC#1）。
test("输出槽固定：视频应用后生成固定槽位（AC#1）", async () => {
  const fixture = await produceAppliedSceneCard(projectId, owner.token);
  // 视频首 job 应有 1 个固定槽（scene_card_create 默认 count=1）。
  const slotCount = countWhere(
    "generation_output_slots",
    `generation_job_id=${fixture.jobId}`,
  );
  assert.ok(slotCount >= 1, `应至少 1 个固定槽，实际 ${slotCount}`);
  fixture.__slotJobId = fixture.jobId;
});

// 场景 B：视频失败 → 槽标 failed → 重试只补失败槽，不新建 SceneCard/预设/Receipt（AC#2/#3）。
test("SceneCard 同记录重试：失败后重试不新建 SceneCard/预设/Receipt（AC#2/#3）", async () => {
  const fixture = await produceAppliedSceneCard(projectId, owner.token);
  // 等首 job 失败（videoSubmit=fail）。
  await waitForJobTerminal(projectId, owner.token, fixture.jobId);

  const sceneCardsBefore = countWhere(
    "scene_cards",
    `id=${fixture.sceneCardId}`,
  );
  const receiptsBefore = countWhere(
    "plan_application_receipts",
    `message_id=${fixture.messageId}`,
  );
  const presetsBefore = countWhere(
    "scene_card_generation_presets",
    `scene_card_id=${fixture.sceneCardId}`,
  );
  const recordsBefore = countWhere(
    "scene_card_generation_records",
    `scene_card_id=${fixture.sceneCardId}`,
  );
  const summaryEventsBefore = countWhere(
    "project_events",
    `project_id=${projectId} AND event_type='scene_card_generation_record.summary_changed' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.summary_status'))='generating'`,
  );

  resetScenarios();
  await setScenarios({
    videoSubmit: { mode: "success" },
    videoPoll: { statuses: ["success"] },
  });
  const retryKey = uniqueKey("t14-retry");
  const retry = await retryJob(projectId, fixture.jobId, owner.token, retryKey);
  assert.equal(
    retry.body.code,
    200,
    `重试应成功：${JSON.stringify(retry.body)}`,
  );
  const newJobId = String(retry.body.data?.generation_job_id);

  // 重试后核心事实数量不变（同记录，不新建）。
  assert.equal(
    countWhere("scene_cards", `id=${fixture.sceneCardId}`),
    sceneCardsBefore,
    "重试不应新建 SceneCard",
  );
  assert.equal(
    countWhere("plan_application_receipts", `message_id=${fixture.messageId}`),
    receiptsBefore,
    "重试不应新建 Receipt",
  );
  assert.equal(
    countWhere(
      "scene_card_generation_presets",
      `scene_card_id=${fixture.sceneCardId}`,
    ),
    presetsBefore,
    "重试不应新建 Preset",
  );
  assert.equal(
    countWhere(
      "scene_card_generation_records",
      `scene_card_id=${fixture.sceneCardId}`,
    ),
    recordsBefore,
    "重试不应新建 Record",
  );
  assert.equal(
    countWhere(
      "project_events",
      `project_id=${projectId} AND event_type='scene_card_generation_record.summary_changed' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.summary_status'))='generating'`,
    ),
    summaryEventsBefore + 1,
    "重试应发布 Record generating 状态事件",
  );

  // 重试 job 的槽应链 retry_of_slot_id 指向原失败槽。
  const retrySlots = mysqlJson(
    `SELECT JSON_ARRAYAGG(JSON_OBJECT('slot_index',slot_index,'status',status,'retry_of_slot_id',retry_of_slot_id)) FROM generation_output_slots WHERE generation_job_id=${newJobId}`,
  );
  const slotList = Array.isArray(retrySlots) ? retrySlots : [];
  assert.ok(slotList.length >= 1, "重试 job 应有槽");
  for (const s of slotList) {
    assert.ok(s.retry_of_slot_id, "重试槽应链 retry_of_slot_id 指向原失败槽");
  }

  const retryTerminal = await waitForJobTerminal(
    projectId,
    owner.token,
    newJobId,
  );
  assert.equal(
    retryTerminal.status,
    "succeeded",
    `首次重试应补槽成功：${JSON.stringify(retryTerminal)}`,
  );
  const retryChainSlots = mysqlJson(
    `SELECT JSON_ARRAYAGG(JSON_OBJECT('id',id,'job_id',generation_job_id,'slot_index',slot_index,'status',status,'retry_of_slot_id',retry_of_slot_id)) FROM generation_output_slots WHERE generation_job_id IN (${fixture.jobId},${newJobId})`,
  );
  const retriesAfterSuccess = countWhere(
    "generation_jobs",
    `retry_of_job_id=${fixture.jobId}`,
  );
  const duplicate = await retryJob(
    projectId,
    fixture.jobId,
    owner.token,
    uniqueKey("t14-retry-again"),
  );
  assert.notEqual(
    duplicate.body.code,
    200,
    `逻辑槽已补成功后不应再次接纳根 Job 重试：${JSON.stringify(retryChainSlots)}`,
  );
  assert.equal(
    countWhere("generation_jobs", `retry_of_job_id=${fixture.jobId}`),
    retriesAfterSuccess,
    "多轮重试不应重复创建已补成功逻辑槽的 Job",
  );
});

// 场景 C：重复请求幂等——同 Idempotency-Key 重放返回首次结果，无新 job（AC#3）。
test("重复请求幂等：同 Idempotency-Key 重放返回首次结果（AC#3）", async () => {
  const fixture = await produceAppliedSceneCard(projectId, owner.token);
  await waitForJobTerminal(projectId, owner.token, fixture.jobId);
  resetScenarios();
  await setScenarios({
    videoSubmit: { mode: "success" },
    videoPoll: { statuses: ["success"] },
  });
  const key = uniqueKey("t14-idem");
  const first = await retryJob(projectId, fixture.jobId, owner.token, key);
  assert.equal(first.body.code, 200, "首次重试应成功");
  const firstJobId = first.body.data?.generation_job_id;
  const jobsAfterFirst = countWhere(
    "generation_jobs",
    `retry_of_job_id=${fixture.jobId}`,
  );

  // 同 Key 重放。
  const replay = await retryJob(projectId, fixture.jobId, owner.token, key);
  assert.equal(replay.body.code, 200, "重放应成功");
  assert.equal(
    replay.body.data?.generation_job_id,
    firstJobId,
    "应返回首次 job id",
  );
  assert.equal(
    countWhere("generation_jobs", `retry_of_job_id=${fixture.jobId}`),
    jobsAfterFirst,
    "重放不应创建新 job",
  );
});

// 场景 D：视频结果在 SceneCardNode 下方稳定放置（AC#5）。
test("视频输出槽固定 + SceneCardNode 放置（AC#1/#5）", async () => {
  // 产一张 SceneCard 计划并应用：验证输出槽固定 + record 绑定 + SceneCardNode 放置。
  resetScenarios();
  const plan = await produceSceneCardCreatePlan(projectId, owner.token);
  resetScenarios();
  await setScenarios({
    videoSubmit: { mode: "success" },
    videoPoll: { statuses: ["success"] },
  });
  const applyKey = uniqueKey("t14-d-apply");
  const applied = await applyPlan(
    projectId,
    String(plan.message_id),
    owner.token,
    applyKey,
  );
  assert.equal(
    applied.body.code,
    200,
    `应用应成功：${JSON.stringify(applied.body)}`,
  );
  const sceneCardId = String(applied.body.data?.scene_card_id);
  const jobId = String(applied.body.data?.generation_job_id);

  // AC#1：视频 job 应有固定输出槽，且槽绑定 record（用于聚合 + 放置溯源）。
  const slotCount = countWhere(
    "generation_output_slots",
    `generation_job_id=${jobId}`,
  );
  assert.equal(slotCount, 1, `视频 job 固定为单槽，实际 ${slotCount}`);
  const boundSlot = mysqlJson(
    `SELECT JSON_OBJECT('record_id',scene_card_generation_record_id) FROM generation_output_slots WHERE generation_job_id=${jobId} LIMIT 1`,
  );
  assert.ok(
    boundSlot?.record_id,
    "首个视频槽应绑定 scene_card_generation_record_id",
  );

  // AC#5：SceneCardNode 应已放置（apply 路由 placeSceneCardNode）。
  await waitFor(
    () => {
      const canvasNodes = mysqlJson(
        `SELECT nodes_json FROM canvas WHERE project_id=${projectId}`,
      );
      const nodes =
        typeof canvasNodes === "string" ? JSON.parse(canvasNodes) : canvasNodes;
      const list = nodes ?? [];
      const sceneCardNode = list.find(
        (n) =>
          n.type === "scene_card" && String(n.scene_card_id) === sceneCardId,
      );
      return sceneCardNode ? sceneCardNode : null;
    },
    30_000,
    "应出现 SceneCardNode",
  );

  // Worker 只提交生成事实；浏览器随后用 Canvas If-Match 完整 PUT 完成首次放置。
  const jobTerminal = await waitForJobTerminal(
    projectId,
    owner.token,
    jobId,
    60_000,
  );
  if (jobTerminal.status === "succeeded") {
    const outputSlots = jobTerminal.output_slots ?? [];
    assert.equal(outputSlots.length, 1, "成功视频应保留唯一逻辑槽");
    assert.equal(outputSlots[0].status, "succeeded");
    assert.equal(
      outputSlots[0].initial_placement_status,
      "pending",
      "浏览器完整 PUT 前首次放置应保持 pending",
    );
  }
  // 视频 job 失败时（异步时序），输出槽应标 failed + record 汇总为 failed。
  if (jobTerminal.status === "failed") {
    const failedSlots = countWhere(
      "generation_output_slots",
      `generation_job_id=${jobId} AND status='failed'`,
    );
    assert.ok(failedSlots >= 1, "失败视频 job 的槽应标 failed");
  }
});

// 场景 E：放置恢复——真实制造 412，重读后用完整 PUT 补位并原子终结槽状态（AC#6）。
test("放置恢复：Canvas If-Match 冲突后重读完整 PUT（AC#6）", async () => {
  resetScenarios();
  await setScenarios({ image: { mode: "success" } });
  const created = await postJson(
    `/api/projects/${projectId}/generation-jobs`,
    {
      type: "image",
      input_asset_ids: [],
      expected_output_count: 1,
      parameters: {
        prompt: "一只蓝鲸游过深蓝色海洋",
        model_id: "t11-image",
        aspect_ratio: "1:1",
        size: "1024x1024",
      },
    },
    owner.token,
    uniqueKey("t14-cas-image"),
  );
  assert.equal(
    created.body.code,
    200,
    `图片任务应成功接纳：${JSON.stringify(created.body)}`,
  );
  const jobId = String(created.body.data?.generation_job_id);
  const terminal = await waitForJobTerminal(
    projectId,
    owner.token,
    jobId,
    60_000,
  );
  assert.equal(terminal.status, "succeeded", "CAS 验收需要成功输出槽");
  const slot = terminal.output_slots?.[0];
  assert.ok(
    slot?.slot_id && slot?.asset_id,
    "成功槽应带稳定 slot_id 与 asset_id",
  );

  const before = await fetchSnapshot(projectId, owner.token);
  const originalNodes = before.canvas.nodes
    ? JSON.parse(before.canvas.nodes)
    : [];
  const probeNode = {
    id: uniqueKey("cas-probe"),
    type: "group",
    position: { x: -1000, y: -1000 },
    width: 1,
    height: 1,
    status: "placed",
  };
  const concurrent = await putCanvas(projectId, owner.token, before.canvas, [
    ...originalNodes,
    probeNode,
  ]);
  assert.equal(concurrent.body.code, 200, "并发 Canvas 写入应成功");

  const outputNode = {
    id: `generation-output:${slot.slot_id}`,
    type: "image",
    assetId: String(slot.asset_id),
    taskId: jobId,
    slotIndex: slot.slot_index,
    position: { x: 20, y: 20 },
    width: 200,
    height: 112,
    status: "placed",
  };
  const stale = await putCanvas(projectId, owner.token, before.canvas, [
    ...originalNodes,
    outputNode,
  ]);
  assert.equal(stale.response.status, 412, "旧 Canvas 版本必须返回 412");
  assert.equal(stale.body.code, 412);

  const latest = await fetchSnapshot(projectId, owner.token);
  const latestNodes = latest.canvas.nodes
    ? JSON.parse(latest.canvas.nodes)
    : [];
  const recovered = await putCanvas(projectId, owner.token, latest.canvas, [
    ...latestNodes,
    outputNode,
  ]);
  assert.equal(recovered.body.code, 200, "重读最新 Canvas 后完整 PUT 应成功");
  const after = await fetchSnapshot(projectId, owner.token);
  const recoveredJob = after.generation_jobs.find(
    (job) => String(job.job_id) === jobId,
  );
  assert.equal(
    recoveredJob.output_slots[0].initial_placement_status,
    "placed",
    "Canvas 与首次放置终态必须同一提交落盘",
  );
  const savedNodes = after.canvas.nodes ? JSON.parse(after.canvas.nodes) : [];
  assert.ok(
    savedNodes.some(
      (node) =>
        node.id === `generation-output:${slot.slot_id}` &&
        node.assetId === String(slot.asset_id) &&
        node.width === 200 &&
        node.height === 112,
    ),
    "恢复节点应使用槽身份、camelCase Asset 字段和图片尺寸",
  );
});

// 场景 F：刷新后稳定顺序——snapshot 输出槽按 slot_index 升序（AC#7）。
test("刷新后稳定顺序：snapshot 输出槽按 slot_index 升序（AC#7）", async () => {
  const snapshot = await fetchSnapshot(projectId, owner.token);
  for (const job of snapshot.generation_jobs ?? []) {
    if (!job.output_slots || job.output_slots.length === 0) continue;
    for (let i = 1; i < job.output_slots.length; i += 1) {
      assert.ok(
        job.output_slots[i].slot_index >= job.output_slots[i - 1].slot_index,
        "output_slots 应按 slot_index 升序",
      );
    }
  }
  // record 投影也应带 output_slots。
  for (const record of snapshot.scene_card_generation_records ?? []) {
    assert.ok(
      Array.isArray(record.output_slots),
      "record 应投影 output_slots 数组",
    );
  }
});
