// Node-only 全栈黑盒：完整 Project Snapshot/SSE 恢复（IK67HH T16，ADR-0016/ADR-0017）。
// 只经公开 HTTP（消息接纳、计划应用、停止、重试、Snapshot、Project SSE）与只读 SQL 断言，
// 不 import 产品源码。
//
// 覆盖 AC：Snapshot 完整恢复事实（#1）、排除临时事实（#2）、单一 SSE 事实序列（#3）、
// SSE 断线后游标连续续传无缺口无重复（#4）、刷新/多进程重启后产品事实一致（#5）、
// 停止态与失败可重试在恢复后仍正确（#6）、完整主链 + SSE 故障 + 多进程重启组合（#7）。
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
  return { token };
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

/** 复用 T11/T14 的 t11- capability（已验证 Agent 能产 image + scene_card_create 计划）。
 *  共享验收库可能残留 baseline/t15 等其他 image/video 能力：计划冻结能力是环境相关的，
 *  本 spec 作为套件末位且 DB 阅后即焚，收敛到 t11-* 保证模型选择确定性。 */
function seedCapabilities() {
  mysqlQuery(
    "DELETE FROM generation_model_capability WHERE provider_id='t11-doubao'",
  );
  mysqlQuery(
    "DELETE FROM generation_model_capability WHERE capability_type IN ('image','video') AND provider_id <> 't11-doubao'",
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

/** T16 专用网关通道（9015/9016），避免与其他 spec 的通道 ID 冲突。 */
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
    "DELETE FROM channels WHERE id IN (9015, 9016); " +
      "INSERT INTO channels (id, type, `key`, status, name, weight, created_time, base_url, models, `group`, priority, auto_ban, settings) VALUES " +
      "(9015, 1, 'sk-acceptance-upstream', 1, 'acceptance-t16-image', 100, UNIX_TIMESTAMP(), 'http://provider-stub:4329', 't11-image', 'default', 100, 0, '{\"disable_task_polling_sleep\":true}'), " +
      "(9016, 59, 'sk-acceptance-upstream', 1, 'acceptance-t16-video', 100, UNIX_TIMESTAMP(), 'http://provider-stub:4329', 't11-video', 'default', 100, 0, '{\"disable_task_polling_sleep\":true}'); " +
      "INSERT INTO options (`key`, `value`) VALUES ('ModelRatio', JSON_OBJECT('t11-image', 1, 't11-video', 1)) " +
      "ON DUPLICATE KEY UPDATE `value` = JSON_SET(`value`, '$.\"t11-image\"', 1, '$.\"t11-video\"', 1);",
  );
  compose("restart", "new-api");
  await waitFor(
    () => {
      const containerId = compose("ps", "-q", "new-api");
      const health = execFileSync(
        "docker",
        ["inspect", "-f", "{{.State.Health.Status}}", containerId],
        { encoding: "utf8" },
      ).trim();
      return health === "healthy" ? true : null;
    },
    60_000,
    "服务=new-api 事实=重启后应恢复健康",
  );
}

async function postCreationMessage(projectId, token, content) {
  const key = uniqueKey("t16-msg");
  const accepted = await postJson(
    `/api/projects/${projectId}/conversation/messages`,
    { client_message_id: key, content, mentions: [] },
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

async function waitForRun(projectId, token, agentRunId, deadlineMs = 60_000) {
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

async function waitForJobTerminal(projectId, token, jobId, deadlineMs = 60_000) {
  return waitFor(
    async () => {
      const snapshot = await fetchSnapshot(projectId, token);
      const job = snapshot.generation_jobs?.find(
        (item) => String(item.job_id) === String(jobId),
      );
      if (!job) return null;
      if (job.status === "queued" || job.status === "processing") return null;
      return job;
    },
    deadlineMs,
    `Job ${jobId} 应进入终态`,
  );
}

/** 「出两张」确定性产 image_generate + scene_card_create 计划组。 */
async function producePlanPair(projectId, token) {
  const data = await postCreationMessage(
    projectId,
    token,
    "创作：主体：蓝鲸 预期：动态海报 出两张 立即出计划",
  );
  const agentRunId = String(data.agent_run_id);
  await waitForRun(projectId, token, agentRunId);
  const snapshot = await fetchSnapshot(projectId, token);
  const plans = snapshot.plan_messages.filter(
    (item) => String(item.agent_run_id) === agentRunId,
  );
  const imagePlan = plans.find(
    (item) => item.application_kind === "image_generate",
  );
  const videoPlan = plans.find(
    (item) => item.application_kind === "scene_card_create",
  );
  assert.ok(imagePlan, "应产 image_generate 计划");
  assert.ok(videoPlan, "应产 scene_card_create 计划");
  return { agentRunId, imagePlan, videoPlan };
}

async function applyPlan(projectId, messageId, token, idempotencyKey) {
  const applied = await postJson(
    `/api/projects/${projectId}/plan-messages/${messageId}/apply`,
    {},
    token,
    idempotencyKey,
  );
  assert.equal(
    applied.body.code,
    200,
    `应用应成功：${JSON.stringify(applied.body)}`,
  );
  return applied;
}

/** 收集 Project SSE 事件窗口：从 after 游标起读到 idleMs 内无新帧为止。 */
async function readSseWindow(projectId, token, after, { idleMs = 2_000, deadlineMs = 30_000 } = {}) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), deadlineMs);
  const events = [];
  try {
    const response = await fetch(
      `${baseUrl}/api/projects/${projectId}/events?after=${after}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      },
    );
    assert.equal(response.status, 200, "服务=web 事实=SSE 流应建立");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let lastFrameAt = Date.now();
    try {
    while (true) {
      if (Date.now() - lastFrameAt > idleMs && events.length > 0) break;
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise((resolve) =>
          setTimeout(() => resolve({ done: false, value: undefined }), 300),
        ),
      ]);
      if (done) break;
      if (value === undefined) continue;
      buffer += decoder.decode(value, { stream: true });
      let separator;
      while ((separator = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const dataLine = frame
          .split("\n")
          .find((line) => line.startsWith("data: "));
        if (!dataLine) continue;
        events.push(JSON.parse(dataLine.slice(6)));
        lastFrameAt = Date.now();
      }
    }
    } catch {
      // deadline 中止属于正常收窗：返回已收集事件。
    }
    return events;
  } finally {
    clearTimeout(deadline);
    controller.abort();
  }
}

function assertHealthyEventStream(events, projectId) {
  const seenIds = new Set();
  let previousCursor = null;
  for (const envelope of events) {
    assert.equal(
      envelope.schema_version,
      1,
      "服务=SSE 事实=事件只使用已登记 schema 版本",
    );
    assert.equal(
      String(envelope.project_id),
      String(projectId),
      "服务=SSE 事实=事件应属于当前 Project",
    );
    assert.ok(!seenIds.has(envelope.event_id), "服务=SSE 事实=事件身份不得重复");
    seenIds.add(envelope.event_id);
    // 游标为雪花 ID（非连续）：只要求严格单调递增，不要求 +1 连续。
    const cursor = BigInt(envelope.cursor);
    if (previousCursor !== null) {
      assert.ok(
        cursor > previousCursor,
        `服务=SSE 事实=游标应严格单调递增（${previousCursor} → ${cursor}）`,
      );
    }
    previousCursor = cursor;
  }
  return previousCursor;
}

/** 产品事实摘要：跨重启比较的最小稳定身份集合（不含瞬时字段）。 */
async function factDigest(projectId, token) {
  const snapshot = await fetchSnapshot(projectId, token);
  const canvasNodes = snapshot.canvas?.nodes
    ? JSON.parse(snapshot.canvas.nodes)
    : [];
  return {
    messages: (snapshot.conversation_messages ?? [])
      .map((m) => `${m.message_id}:${m.role}:${m.sequence_no}`)
      .sort(),
    plans: (snapshot.plan_messages ?? [])
      .map((p) => `${p.message_id}:${p.application_kind}:${p.applied_at ?? "unapplied"}`)
      .sort(),
    receipts: (snapshot.plan_applications ?? [])
      .map((r) => `${r.receipt_id}:${r.application_kind}:${r.command_id}`)
      .sort(),
    sceneCards: (snapshot.scene_cards ?? [])
      .map((c) => `${c.scene_card_id}:${c.version}`)
      .sort(),
    records: (snapshot.scene_card_generation_records ?? [])
      .map((r) => `${r.record_id}:${r.summary_status}`)
      .sort(),
    jobs: (snapshot.generation_jobs ?? [])
      .map((j) => `${j.job_id}:${j.status}:${j.source}`)
      .sort(),
    assets: Object.keys(snapshot.assets ?? {}).sort(),
    canvasNodeIds: canvasNodes.map((n) => String(n.id)).sort(),
    runs: (snapshot.agent_runs ?? [])
      .map((r) => `${r.agent_run_id}:${r.status}:${r.terminal_reason ?? ""}`)
      .sort(),
    highWatermark: String(snapshot.high_watermark_cursor),
  };
}

/** 等待 Snapshot 事实稳定（两次轮询摘要一致），确保放置等异步事实已收敛。 */
async function waitForStableDigest(projectId, token, deadlineMs = 60_000) {
  return waitFor(
    async () => {
      const first = await factDigest(projectId, token);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      const second = await factDigest(projectId, token);
      return JSON.stringify(first) === JSON.stringify(second) ? second : null;
    },
    deadlineMs,
    "服务=Snapshot 事实=产品事实应收敛稳定",
  );
}

const readyUrls = {
  "agent-worker": "http://127.0.0.1:4311/ready",
  "generation-worker": "http://127.0.0.1:4312/ready",
  web: "http://127.0.0.1:3101/build-info",
};

async function restartService(service) {
  compose("restart", service);
  await waitFor(
    async () => {
      const response = await fetch(readyUrls[service], {
        signal: AbortSignal.timeout(2_000),
      });
      return response.ok ? true : null;
    },
    120_000,
    `服务=${service} 事实=重启后应就绪`,
  );
}

let owner;
let projectId;

before(() => {
  owner = null;
  projectId = null;
});

test("setup：注册用户 + 项目 + 能力 + 网关 + provider 复位", async () => {
  owner = await registerUser("t16snap");
  projectId = await createProject("T16 快照恢复项目", owner.token);
  seedCapabilities();
  await seedGatewayRoutes();
  resetScenarios();
});

test("完整主链：消息接纳→计划组→图片应用成功，Snapshot/SSE 事实一致（AC#1/#3）", async () => {
  const { imagePlan } = await producePlanPair(projectId, owner.token);
  const applied = await applyPlan(
    projectId,
    String(imagePlan.message_id),
    owner.token,
    uniqueKey("t16-img-apply"),
  );
  const jobId = String(applied.body.data?.first_generation_job_id);
  assert.ok(jobId, "图片应用应返回 first_generation_job_id");
  const job = await waitForJobTerminal(projectId, owner.token, jobId);
  assert.equal(job.status, "succeeded", `图片任务应成功：${JSON.stringify(job)}`);

  // Snapshot 恢复事实完整性（AC#1）。
  const snapshot = await fetchSnapshot(projectId, owner.token);
  const plan = snapshot.plan_messages.find(
    (item) => String(item.message_id) === String(imagePlan.message_id),
  );
  assert.ok(plan.applied_at, "已应用计划应带 applied_at");
  assert.equal(String(plan.first_generation_job_id), jobId);
  assert.equal(plan.application_availability, "available");
  const receipt = snapshot.plan_applications.find(
    (item) => String(item.message_id) === String(imagePlan.message_id),
  );
  assert.ok(receipt, "Snapshot 应含应用回执");
  assert.equal(String(receipt.first_generation_job_id), jobId);
  const restoredJob = snapshot.generation_jobs.find(
    (item) => String(item.job_id) === jobId,
  );
  assert.equal(restoredJob.source, "plan_apply", "生成来源应回溯计划应用");
  assert.ok(restoredJob.output_slots.length >= 1, "应含输出槽");
  const succeededAsset = restoredJob.output_slots.find(
    (slot) => slot.status === "succeeded" && slot.asset_id,
  );
  assert.ok(succeededAsset, "成功槽应绑定 Asset");
  assert.ok(
    snapshot.assets[String(succeededAsset.asset_id)]?.access_url,
    "Asset 访问地址应可恢复",
  );

  // 单一 Project SSE 发布已接纳事实（AC#3）：从头回放应含消息/运行/应用/任务事件。
  const events = await readSseWindow(projectId, owner.token, 0);
  assertHealthyEventStream(events, projectId);
  const types = new Set(events.map((e) => e.event_type));
  for (const expected of [
    "conversation.message_accepted",
    "agent_run.created",
    "generation_job.created",
  ]) {
    assert.ok(types.has(expected), `SSE 应发布 ${expected}`);
  }
  const lastCursor = BigInt(events.at(-1).cursor);
  assert.ok(
    BigInt(snapshot.high_watermark_cursor) >= lastCursor,
    "Snapshot 高水位应不低于 SSE 已发布游标",
  );
});

test("SSE 断线续传：从断开游标接续无缺口无重复（AC#4）", async () => {
  // 先读到当前高水位并主动断开（模拟断线）。
  const beforeEvents = await readSseWindow(projectId, owner.token, 0);
  const breakCursor = assertHealthyEventStream(beforeEvents, projectId);

  // 断线期间产生新事实：应用第二组计划的视频路径。
  const { videoPlan } = await producePlanPair(projectId, owner.token);
  resetScenarios();
  await setScenarios({
    videoSubmit: { mode: "success" },
    videoPoll: { statuses: ["success"] },
  });
  const applied = await applyPlan(
    projectId,
    String(videoPlan.message_id),
    owner.token,
    uniqueKey("t16-video-apply"),
  );
  const sceneCardId = String(applied.body.data?.scene_card_id);
  const videoJobId = String(applied.body.data?.generation_job_id);
  await waitForJobTerminal(projectId, owner.token, videoJobId);

  // 从断开游标续传：首条游标必须 > 断点（雪花游标非连续），事件健康且含新事实。
  const resumed = await readSseWindow(projectId, owner.token, breakCursor);
  assert.ok(resumed.length > 0, "续传应收到断线期间的事件");
  assert.ok(
    BigInt(resumed[0].cursor) > breakCursor,
    "服务=SSE 事实=续传首条游标应晚于断点",
  );
  assertHealthyEventStream(resumed, projectId);

  // 无缺口无重复：断线前 + 续传两段的事件集合与全量回放完全一致。
  const fullReplay = await readSseWindow(projectId, owner.token, 0);
  const fullIds = fullReplay.map((e) => e.event_id).sort();
  const joinedIds = [...new Set(
    [...beforeEvents, ...resumed].map((e) => e.event_id),
  )].sort();
  assert.deepEqual(
    joinedIds,
    fullIds,
    "服务=SSE 事实=断点续传不得丢失或重复事件",
  );
  const resumedTypes = new Set(resumed.map((e) => e.event_type));
  assert.ok(
    resumedTypes.has("generation_job.created"),
    "续传应含断线期间的任务创建事件",
  );

  // 新事实经 Snapshot 权威回读一致。
  const snapshot = await fetchSnapshot(projectId, owner.token);
  assert.ok(
    snapshot.scene_cards.some(
      (card) => String(card.scene_card_id) === sceneCardId,
    ),
    "Snapshot 应含新建 SceneCard",
  );
  assert.ok(
    snapshot.scene_card_generation_records.some(
      (record) => String(record.scene_card_id) === sceneCardId,
    ),
    "Snapshot 应含生成记录",
  );
});

test("Snapshot 排除临时事实（AC#2）：无临时文本/引用输入快照/供应商原始响应", async () => {
  const snapshot = await fetchSnapshot(projectId, owner.token);
  const forbidden =
    /provisional|mention_input|uncommitted|candidate|raw_response|provider_response|chain_of_thought|reasoning_chain/i;
  const offenders = [];
  function walk(value, path) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const key of Object.keys(value)) {
        if (forbidden.test(key)) offenders.push(`${path}.${key}`);
        walk(value[key], `${path}.${key}`);
      }
    }
  }
  walk(snapshot, "snapshot");
  assert.deepEqual(offenders, [], "Snapshot 不得暴露临时/内部事实");

  // 临时交付只经 SSE 明确标识发布，不落 Snapshot（契约 §8.1/§8.6）。
  const events = await readSseWindow(projectId, owner.token, 0);
  const snapshotJson = JSON.stringify(snapshot);
  for (const eventId of new Set(
    events
      .filter((e) => e.event_type.startsWith("agent_run.provisional"))
      .map((e) => e.event_id),
  )) {
    assert.ok(!snapshotJson.includes(eventId), "临时事件身份不得进入 Snapshot");
  }
});

test("停止态恢复：停止后重启 web，cancelled 与终态原因保持（AC#5/#6）", async () => {
  const data = await postCreationMessage(
    projectId,
    owner.token,
    `停止恢复场景 fake:delay:10000 ${uniqueKey("t16-stop")}`,
  );
  const agentRunId = String(data.agent_run_id);
  await waitFor(
    async () => {
      const snapshot = await fetchSnapshot(projectId, owner.token);
      const run = snapshot.agent_runs?.find(
        (item) => String(item.agent_run_id) === agentRunId,
      );
      return run?.status === "running" ? run : null;
    },
    30_000,
    "Run 应进入 running",
  );
  const stopKey = uniqueKey("t16-stop-cmd");
  const stopped = await postJson(
    `/api/projects/${projectId}/conversation/agent-runs/${agentRunId}/stop`,
    {},
    owner.token,
    stopKey,
  );
  assert.equal(stopped.body.code, 200, "停止应被接纳");

  await restartService("web");

  const snapshot = await fetchSnapshot(projectId, owner.token);
  const run = snapshot.agent_runs.find(
    (item) => String(item.agent_run_id) === agentRunId,
  );
  assert.equal(run.status, "cancelled", "重启后停止态应保持 cancelled");
  assert.equal(run.terminal_reason, "user_requested", "终态原因应保持用户停止");
  const assistantCount = snapshot.conversation_messages.filter(
    (message) =>
      message.role === "assistant" &&
      String(message.agent_run_id) === agentRunId,
  ).length;
  assert.equal(assistantCount, 0, "停止的 Run 不得留下正式助手消息");
});

test("失败可重试恢复：失败任务经 generation-worker 重启后仍可重试成功（AC#5/#6）", async () => {
  const { imagePlan } = await producePlanPair(projectId, owner.token);
  resetScenarios();
  // 402 = 确定性失败（500 会被 worker 当瞬时错误退避重试，超时不稳）。
  await setScenarios({ image: { mode: "fail", status: 402 } });
  const applied = await applyPlan(
    projectId,
    String(imagePlan.message_id),
    owner.token,
    uniqueKey("t16-fail-apply"),
  );
  const failedJobId = String(applied.body.data?.first_generation_job_id);
  const failed = await waitForJobTerminal(
    projectId,
    owner.token,
    failedJobId,
  );
  assert.equal(failed.status, "failed", "注入失败应落 failed 终态");

  await restartService("generation-worker");

  // 恢复后失败事实与公开错误保持，重试入口仍可用（AC#6）。
  const beforeRetry = await fetchSnapshot(projectId, owner.token);
  const restoredFailed = beforeRetry.generation_jobs.find(
    (item) => String(item.job_id) === failedJobId,
  );
  assert.equal(restoredFailed.status, "failed", "重启后失败态应保持");
  assert.ok(restoredFailed.error, "重启后公开错误应保持");

  resetScenarios();
  const retried = await postJson(
    `/api/projects/${projectId}/generation-jobs/${failedJobId}/retry`,
    {},
    owner.token,
    uniqueKey("t16-retry"),
  );
  assert.equal(
    retried.body.code,
    200,
    `重启后重试应被接纳：${JSON.stringify(retried.body)}`,
  );
  const retryJobId = String(retried.body.data?.generation_job_id);
  const retryJob = await waitForJobTerminal(
    projectId,
    owner.token,
    retryJobId,
  );
  assert.equal(retryJob.status, "succeeded", "重试应补成功");
  assert.equal(String(retryJob.retry_of_job_id), failedJobId, "重试应链原任务");

  // 部分生成记录：原失败任务保持 failed，不被重试改写（AC#6）。
  const afterRetry = await fetchSnapshot(projectId, owner.token);
  const original = afterRetry.generation_jobs.find(
    (item) => String(item.job_id) === failedJobId,
  );
  assert.equal(original.status, "failed", "原失败任务终态不得被改写");
});

test("多进程重启最终一致：Web/agent-worker/generation-worker 重启后事实摘要不变（AC#5/#7）", async () => {
  const digestBefore = await waitForStableDigest(projectId, owner.token);

  for (const service of ["agent-worker", "generation-worker", "web"]) {
    await restartService(service);
  }

  const digestAfter = await waitForStableDigest(projectId, owner.token);
  assert.deepEqual(
    digestAfter,
    digestBefore,
    "服务=Snapshot 事实=多进程重启后产品事实应完全一致",
  );

  // 重启后 SSE 仍可回放全部事件且游标连续（AC#4/#7）。
  const events = await readSseWindow(projectId, owner.token, 0);
  const lastCursor = assertHealthyEventStream(events, projectId);
  assert.equal(
    String(digestAfter.highWatermark),
    String(lastCursor),
    "服务=Snapshot 事实=高水位应与事件流末端一致",
  );
});
