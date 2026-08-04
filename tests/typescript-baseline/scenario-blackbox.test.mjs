// Node-only 全栈黑盒场景验收（IK67G2 T01）。
// 断言纪律：只认公开 API 响应、Snapshot、SSE、provider-stub 账本与只读 SQL
// 持久化事实；不 import 产品源码，不断言私有 helper 调用。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { test } from "node:test";

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

function stubFetch(pathname, { method = "GET", body } = {}) {
  const script = `
    const response = await fetch("http://127.0.0.1:4329${pathname}", {
      method: "${method}",
      ${body !== undefined ? `body: ${JSON.stringify(JSON.stringify(body))},` : ""}
      headers: { "Content-Type": "application/json" },
    });
    process.stdout.write(JSON.stringify({
      status: response.status,
      body: await response.json(),
    }));
  `;
  const output = compose("exec", "-T", "provider-stub", "node", "-e", script);
  return JSON.parse(output);
}

async function setScenarios(scenarios) {
  const result = stubFetch("/__acceptance/scenarios", {
    method: "POST",
    body: scenarios,
  });
  assert.equal(result.status, 200, "服务=provider-stub 事实=场景注入应成功");
}

function resetScenarios() {
  const result = stubFetch("/__acceptance/scenarios", { method: "DELETE" });
  assert.equal(result.status, 200, "服务=provider-stub 事实=场景复位应成功");
}

function stubLedger() {
  return stubFetch("/__acceptance/requests").body.requests;
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

async function registerAndCreateProject(label) {
  const suffix = `${Date.now()}${process.pid}`;
  // new-api 用户名上限 20 字符，label 截断到 8 位。
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
  assert.equal(typeof token, "string", "服务=web 事实=注册应返回 sk token");

  const created = await postJson(
    "/api/projects",
    { name: `${label} ${suffix}` },
    token,
  );
  assert.equal(
    created.response.status,
    200,
    "服务=web 事实=创建 Project 应成功",
  );
  return { token, projectId: String(created.body.data?.id), suffix };
}

async function sendMessage(
  projectId,
  token,
  content,
  suffix,
  { forcedCreativeSkillId, replyToInputRequestId } = {},
) {
  const key = uniqueKey(`scenario-${suffix}`);
  const response = await postJson(
    `/api/projects/${projectId}/conversation/messages`,
    {
      client_message_id: key,
      content,
      ...(forcedCreativeSkillId
        ? { forced_creative_skill_id: forcedCreativeSkillId }
        : {}),
      ...(replyToInputRequestId
        ? { reply_to_input_request_id: replyToInputRequestId }
        : {}),
    },
    token,
    { "Idempotency-Key": key },
  );
  assert.equal(
    response.response.status,
    202,
    "服务=web 事实=会话消息应被接纳（202）",
  );
  return response.body.data;
}

async function fetchSnapshot(projectId, token) {
  const { response, body } = await requestJson(
    `/api/projects/${projectId}/snapshot`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  assert.equal(response.status, 200, "服务=web 事实=Snapshot 应可读");
  return body.data;
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

async function waitForAgentRunStatus(projectId, token, statuses, deadlineMs) {
  return waitFor(
    async () => {
      const snapshot = await fetchSnapshot(projectId, token);
      const run = snapshot.agent_runs?.at(-1);
      if (run && statuses.includes(run.status)) return run;
      return null;
    },
    deadlineMs,
    `服务=agent-worker 事实=AgentRun 应到达 ${statuses.join("/")}`,
  );
}

async function waitForJobStatus(jobId, token, statuses, deadlineMs) {
  return waitFor(
    async () => {
      const { response, body } = await requestJson(`/api/jobs?ids=${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(response.status, 200, "服务=web 事实=任务查询应成功");
      const job = body.data?.records?.[0];
      if (job && statuses.includes(job.status)) return job;
      return null;
    },
    deadlineMs,
    `服务=generation 事实=Job ${jobId} 应到达 ${statuses.join("/")}`,
  );
}

async function createGenerationJob(projectId, token, body, suffix) {
  const created = await postJson(
    `/api/projects/${projectId}/generation-jobs`,
    body,
    token,
    { "Idempotency-Key": uniqueKey(`scenario-${suffix}`) },
  );
  assert.equal(
    created.response.status,
    200,
    "服务=web 事实=生成任务应被接纳",
  );
  return String(created.body.data?.generation_job_id);
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

async function assistantMessages(projectId, token) {
  const snapshot = await fetchSnapshot(projectId, token);
  return (snapshot.conversation_messages ?? []).filter(
    (message) => message.role === "assistant",
  );
}

async function readSseUntil(projectId, token, predicate, deadlineMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  try {
    const response = await fetch(
      `${baseUrl}/api/projects/${projectId}/events?after=0`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      },
    );
    assert.equal(response.status, 200, "服务=web 事实=SSE 流应建立");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let separator;
      while ((separator = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const eventLine = frame
          .split("\n")
          .find((line) => line.startsWith("event: "));
        const dataLine = frame
          .split("\n")
          .find((line) => line.startsWith("data: "));
        if (!eventLine || !dataLine) continue;
        const found = predicate(eventLine.slice(7), JSON.parse(dataLine.slice(6)));
        if (found) return found;
      }
    }
    throw new Error("SSE 流提前结束");
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function serviceRestart(service) {
  compose("restart", service);
}

function serviceStop(service) {
  compose("stop", service);
}

function serviceStart(service) {
  compose("start", service);
}

const readyUrls = {
  "agent-worker": "http://127.0.0.1:4311/ready",
  "generation-worker": "http://127.0.0.1:4312/ready",
  web: "http://127.0.0.1:3101/build-info",
};

async function waitServiceReady(service) {
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

const IMAGE_MODEL = "doubao-seedream-4-0-250828";
const VIDEO_MODEL = "doubao-seedance-2-0-260128";

let sequence = 0;
function uniqueKey(prefix) {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
}

function imageJobBody(prompt) {
  return {
    type: "image",
    input_asset_ids: [],
    expected_output_count: 1,
    parameters: {
      prompt,
      model_id: IMAGE_MODEL,
      aspect_ratio: "1:1",
      size: "1K",
    },
  };
}

function videoJobBody(prompt) {
  return {
    type: "video",
    input_asset_ids: [],
    expected_output_count: 1,
    parameters: {
      prompt,
      model_id: VIDEO_MODEL,
      aspect_ratio: "16:9",
      resolution: "720p",
      duration: 5,
    },
  };
}

test("agent 成功：SSE 收到终态事件且 Snapshot 回显确定性哈希", async () => {
  resetScenarios();
  const { token, projectId, suffix } = await registerAndCreateProject("agentsucc");
  const prompt = `黑盒成功场景 ${suffix}`;

  const ssePromise = readSseUntil(
    projectId,
    token,
    (eventType, data) =>
      eventType === "agent_run.status_changed" &&
      data.payload?.status === "completed"
        ? data.payload
        : null,
    60_000,
  );
  await sendMessage(projectId, token, prompt, suffix);
  const event = await ssePromise;
  assert.equal(
    event.status,
    "completed",
    "服务=SSE 事实=agent_run.status_changed 应为 completed",
  );

  const run = await waitForAgentRunStatus(
    projectId,
    token,
    ["completed"],
    30_000,
  );
  assert.equal(run.status, "completed", "服务=agent-worker 事实=终态应完成");
  const assistants = await assistantMessages(projectId, token);
  assert.equal(
    assistants.length,
    1,
    "服务=agent-worker 事实=应恰有一条 assistant 消息",
  );
  assert.equal(
    assistants[0].content,
    fakeAgentEcho(prompt),
    "服务=agent-worker 事实=回显应为确定性哈希",
  );
});

test("forced 个人 Skill：首版立即激活，完整回复与安全投影原子提交", async () => {
  resetScenarios();
  const { token, projectId, suffix } = await registerAndCreateProject("agentforce");
  const privateBody = `PRIVATE_FORCED_SKILL_BODY_${suffix}`;
  const created = await postJson(
    "/api/agent/skills/personal",
    {
      content: `---\nname: Forced ${suffix}\ndescription: acceptance\n---\n${privateBody}`,
    },
    token,
  );
  assert.equal(created.response.status, 200);
  assert.equal(created.body.code, 200);
  const creativeSkillId = created.body.data?.creative_skill_id;
  assert.equal(typeof creativeSkillId, "string");
  const prompt = `强制技能消息 ${suffix}`;
  const resourceDigest = `sha256:${createHash("sha256")
    .update(privateBody)
    .digest("hex")}`;

  const completedEvent = readSseUntil(
    projectId,
    token,
    (eventType, data) =>
      eventType === "agent_run.status_changed" &&
      data.payload?.status === "completed"
        ? data.payload
        : null,
    60_000,
  );
  const accepted = await sendMessage(projectId, token, prompt, suffix, {
    forcedCreativeSkillId: creativeSkillId,
  });
  const event = await completedEvent;
  const snapshot = await waitFor(
    async () => {
      const current = await fetchSnapshot(projectId, token);
      return current.agent_runs?.at(-1)?.status === "completed" ? current : null;
    },
    60_000,
    "服务=agent-worker 事实=forced Run 应完成",
  );
  const run = snapshot.agent_runs.at(-1);
  assert.deepEqual(run.activated_creative_skill_versions, [
    {
      creative_skill_id: creativeSkillId,
      creative_skill_version_id:
        run.activated_creative_skill_versions[0].creative_skill_version_id,
      name: `Forced ${suffix}`,
      display_version: "1.0.0",
      resource_digest: resourceDigest,
      source: "forced_use",
      reason: { type: "user_use" },
    },
  ]);
  assert.equal(run.reasoning_summary, `已使用「Forced ${suffix}」完成回答。`);
  assert.deepEqual(
    event.activated_creative_skill_versions,
    run.activated_creative_skill_versions,
  );
  assert.equal(event.reasoning_summary, run.reasoning_summary);
  assert.equal(
    (await assistantMessages(projectId, token))[0].content,
    fakeAgentEcho(prompt, resourceDigest),
  );

  const publicJson = JSON.stringify({ snapshot, event });
  for (const forbidden of [privateBody, '"run_pin"', '"body"', "runtimeInstructions"]) {
    assert.equal(publicJson.includes(forbidden), false, `公开投影不得包含 ${forbidden}`);
  }
  assert.equal(
    mysqlQuery(
      `SELECT JSON_UNQUOTE(JSON_EXTRACT(run_pin, '$.creative_skill_resources[0].body')) FROM agent_runs WHERE id=${accepted.agent_run_id}`,
    ),
    privateBody,
    "服务=mysql 事实=私有 RunPin 应保存完整 Skill 正文",
  );
  assert.equal(
    mysqlQuery(
      `SELECT CONCAT((SELECT COUNT(*) FROM agent_advances WHERE agent_run_id=${accepted.agent_run_id}), ':', (SELECT COUNT(*) FROM run_commits WHERE agent_run_id=${accepted.agent_run_id}), ':', (SELECT COUNT(*) FROM conversation_messages WHERE agent_run_id=${accepted.agent_run_id} AND role='assistant'))`,
    ),
    "1:1:1",
    "服务=mysql 事实=Advance、RunCommit 与 assistant 应各一条",
  );
});

test("auto 官方 Skill 与 RunPin 不漂移：发布新版后旧 Run 仍用冻结版本", async () => {
  resetScenarios();
  const { token, projectId, suffix } = await registerAndCreateProject("agentauto");
  const added = await postJson(
    "/api/agent/skills/library/acceptance_poster/add",
    {},
    token,
  );
  assert.equal(added.body.code, 200);
  const enabled = await requestJson(
    "/api/agent/skills/mine/acceptance_poster",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ auto: true }),
    },
  );
  assert.equal(enabled.body.code, 200);

  serviceStop("agent-worker");
  const prompt = "Acceptance Poster";
  const v1Digest =
    "sha256:131c6997ea0d081f4553e613a65ba7b047a33124784f51c5c4017cdfb9fe258b";
  let accepted;
  try {
    accepted = await sendMessage(projectId, token, prompt, suffix);
    assert.equal(
      mysqlQuery(`SELECT status FROM agent_runs WHERE id=${accepted.agent_run_id}`),
      "queued",
    );
    assert.equal(
      mysqlQuery(
        `SELECT JSON_UNQUOTE(JSON_EXTRACT(run_pin, '$.auto_creative_skill_candidates[0].resource_digest')) FROM agent_runs WHERE id=${accepted.agent_run_id}`,
      ),
      v1Digest,
      "服务=mysql 事实=Run 创建时应冻结 v1 候选摘要",
    );

    const v2Body = "# Acceptance Poster v2\n\nNew rules published after Run creation.";
    const v2Digest = `sha256:${createHash("sha256").update(v2Body).digest("hex")}`;
    mysqlQuery(
      `INSERT INTO creative_skill_version (creative_skill_version_id, creative_skill_id, display_version, body, content_digest, resource_digest) VALUES ('acceptance-poster-v2', 'acceptance_poster', '2.0.0', '${v2Body}', '${v2Digest}', '${v2Digest}'); UPDATE creative_skill SET active_version_id='acceptance-poster-v2' WHERE creative_skill_id='acceptance_poster'`,
    );
  } finally {
    serviceStart("agent-worker");
    await waitServiceReady("agent-worker");
  }

  const run = await waitForAgentRunStatus(projectId, token, ["completed"], 90_000);
  assert.equal(run.activated_creative_skill_versions.length, 1);
  assert.equal(run.activated_creative_skill_versions[0].source, "auto");
  assert.equal(run.activated_creative_skill_versions[0].creative_skill_version_id, "acceptance-poster-v1");
  assert.equal(run.activated_creative_skill_versions[0].resource_digest, v1Digest);
  assert.deepEqual(run.activated_creative_skill_versions[0].reason, {
    type: "agent_match",
    detail: { matched_fields: ["conversation_messages"] },
  });
  assert.equal(
    (await assistantMessages(projectId, token))[0].content,
    fakeAgentEcho(prompt, v1Digest),
    "服务=agent-worker 事实=新版发布后旧 Run 仍必须使用冻结 v1",
  );

  const nextPrompt = `同一 Conversation 的后续普通消息 ${suffix}`;
  await sendMessage(projectId, token, nextPrompt, suffix);
  await waitFor(
    async () => {
      const current = await fetchSnapshot(projectId, token);
      return current.agent_runs?.length === 2 &&
        current.agent_runs.at(-1)?.status === "completed"
        ? current
        : null;
    },
    90_000,
    "服务=agent-worker 事实=同一 Conversation 应顺序产生第二个 AgentRun",
  );
  assert.equal(
    mysqlQuery(
      `SELECT CONCAT(COUNT(DISTINCT ar.id), ':', COUNT(DISTINCT aa.id), ':', COUNT(DISTINCT rc.id)) FROM agent_runs ar LEFT JOIN agent_advances aa ON aa.agent_run_id=ar.id LEFT JOIN run_commits rc ON rc.agent_run_id=ar.id WHERE ar.project_id=${projectId}`,
    ),
    "2:2:2",
    "服务=mysql 事实=同一 Conversation 的两个 Run 各有一个 Advance 与 RunCommit",
  );
});

test("agent 明确失败：落 failed 终态、无 assistant、后续消息可新开 run", async () => {
  resetScenarios();
  const { token, projectId, suffix } = await registerAndCreateProject("agentfail");

  await sendMessage(projectId, token, `请失败 fake:failure ${suffix}`, suffix);
  await waitForAgentRunStatus(projectId, token, ["failed"], 60_000);
  assert.equal(
    (await assistantMessages(projectId, token)).length,
    0,
    "服务=agent-worker 事实=失败 run 不应产生 assistant 消息",
  );

  const recoveryPrompt = `失败后恢复 ${suffix}`;
  await sendMessage(projectId, token, recoveryPrompt, suffix);
  await waitForAgentRunStatus(projectId, token, ["completed"], 60_000);
  const assistants = await assistantMessages(projectId, token);
  assert.equal(
    assistants.length,
    1,
    "服务=agent-worker 事实=失败后会话应能继续并恰有一条 assistant",
  );
  assert.equal(assistants[0].content, fakeAgentEcho(recoveryPrompt));
});

test("agent 延迟：回显不早于注入延迟出现", async () => {
  resetScenarios();
  const { token, projectId, suffix } = await registerAndCreateProject("agentdelay");
  const prompt = `慢一点 fake:delay:5000 ${suffix}`;

  const started = Date.now();
  await sendMessage(projectId, token, prompt, suffix);
  await waitForAgentRunStatus(projectId, token, ["completed"], 90_000);
  assert.ok(
    Date.now() - started >= 5_000,
    "服务=agent-worker 事实=回显不应早于 5s 延迟出现",
  );
  const assistants = await assistantMessages(projectId, token);
  assert.equal(assistants[0].content, fakeAgentEcho(prompt));
});

test("agent 进程重启：恢复后 assistant 消息恰一条", async () => {
  resetScenarios();
  const { token, projectId, suffix } = await registerAndCreateProject("agentrestart");
  const prompt = `重启场景 fake:delay:15000 ${suffix}`;

  await sendMessage(projectId, token, prompt, suffix);
  await waitForAgentRunStatus(projectId, token, ["running"], 30_000);
  serviceRestart("agent-worker");
  await waitServiceReady("agent-worker");
  await waitForAgentRunStatus(projectId, token, ["completed"], 120_000);

  const count = mysqlQuery(
    `SELECT COUNT(*) FROM conversation_messages WHERE role='assistant' AND project_id=${projectId}`,
  );
  assert.equal(
    count,
    "1",
    "服务=agent-worker 事实=重启恢复后 assistant 消息应恰一条（fence 防双写）",
  );
});

test("agent 结果未知窗与租约接管：旧 worker 迟到写入被拒，接管后恰一条 assistant", async () => {
  resetScenarios();
  const { token, projectId, suffix } = await registerAndCreateProject("agenttake");
  const prompt = `接管场景 fake:delay:30000 ${suffix}`;

  await sendMessage(projectId, token, prompt, suffix);
  const running = await waitForAgentRunStatus(
    projectId,
    token,
    ["running"],
    30_000,
  );
  const fenceBefore = mysqlQuery(
    `SELECT fencing_token FROM agent_runs WHERE id=${running.agent_run_id}`,
  );

  await new Promise((resolve) => setTimeout(resolve, 3_000));
  serviceStop("agent-worker");
  try {
    await new Promise((resolve) => setTimeout(resolve, 12_000));
    const mid = await fetchSnapshot(projectId, token);
    const run = mid.agent_runs?.at(-1);
    assert.equal(
      run.status,
      "running",
      "服务=agent-worker 事实=结果未知窗内应保持 running 无终态",
    );
    assert.equal(
      (await assistantMessages(projectId, token)).length,
      0,
      "服务=agent-worker 事实=未知窗内不应出现 assistant 消息",
    );
  } finally {
    serviceStart("agent-worker");
    await waitServiceReady("agent-worker");
  }

  await waitForAgentRunStatus(projectId, token, ["completed"], 120_000);
  const fenceAfter = mysqlQuery(
    `SELECT fencing_token FROM agent_runs WHERE id=${running.agent_run_id}`,
  );
  assert.ok(
    Number(fenceAfter) >= Number(fenceBefore) + 1,
    `服务=agent-worker 事实=停 worker 后应发生新的接管认领（fence ${fenceBefore}→${fenceAfter}）`,
  );
  const count = mysqlQuery(
    `SELECT COUNT(*) FROM conversation_messages WHERE role='assistant' AND project_id=${projectId}`,
  );
  assert.equal(
    count,
    "1",
    "服务=agent-worker 事实=接管完成后 assistant 消息应恰一条",
  );
});

test("image 成功加延迟：注入延迟后任务成功且供应商请求入账本", async () => {
  resetScenarios();
  const { token, projectId, suffix } = await registerAndCreateProject("imgdelay");
  const ledgerBefore = stubLedger().filter(
    (item) => item.pathname === "/v1/images/generations",
  ).length;

  await setScenarios({ image: { mode: "success", delayMs: 3_000 } });
  const jobId = await createGenerationJob(
    projectId,
    token,
    imageJobBody(`延迟出图 ${suffix}`),
    suffix,
  );
  const started = Date.now();
  const job = await waitForJobStatus(jobId, token, ["succeeded"], 120_000);
  assert.equal(job.status, "succeeded", "服务=web 事实=图片任务应成功");
  assert.ok(
    Date.now() - started >= 3_000,
    "服务=provider-stub 事实=出图不应早于注入延迟完成",
  );
  const ledgerAfter = stubLedger().filter(
    (item) => item.pathname === "/v1/images/generations",
  ).length;
  assert.equal(
    ledgerAfter,
    ledgerBefore + 1,
    "服务=provider-stub 事实=账本应新增一条图片请求",
  );
});

test("image 明确失败：任务 failed、公开错误码稳定、无输出 asset", async () => {
  resetScenarios();
  const { token, projectId, suffix } = await registerAndCreateProject("imgfail");
  await setScenarios({ image: { mode: "fail", status: 402 } });

  const jobId = await createGenerationJob(
    projectId,
    token,
    imageJobBody(`必败出图 ${suffix}`),
    suffix,
  );
  const job = await waitForJobStatus(jobId, token, ["failed"], 120_000);
  assert.equal(
    job.error?.code,
    "image_generation_failed",
    "服务=web 事实=失败公开错误码应稳定",
  );
  const snapshot = await fetchSnapshot(projectId, token);
  const outputs = (snapshot.generation_jobs ?? [])
    .find((item) => String(item.job_id) === jobId)
    ?.output_asset_ids;
  assert.deepEqual(
    outputs ?? [],
    [],
    "服务=web 事实=失败任务不应产生输出 asset",
  );
});

test("image 瞬时失败后重试成功：DB retry_count 增加", async () => {
  resetScenarios();
  const { token, projectId, suffix } = await registerAndCreateProject("imgretry");
  await setScenarios({ image: { mode: "fail", status: 500, times: 1 } });

  const jobId = await createGenerationJob(
    projectId,
    token,
    imageJobBody(`瞬时失败出图 ${suffix}`),
    suffix,
  );
  const job = await waitForJobStatus(jobId, token, ["succeeded"], 180_000);
  assert.equal(job.status, "succeeded", "服务=web 事实=重试后任务应成功");
  const retryCount = mysqlQuery(
    `SELECT retry_count FROM generation_jobs WHERE id=${jobId}`,
  );
  assert.ok(
    Number(retryCount) >= 1,
    `服务=web 事实=retry_count 应至少 1（实际 ${retryCount}）`,
  );
});

test("image 进程重启接管：孤儿任务租约过期后被重领成功", async () => {
  resetScenarios();
  const { token, projectId, suffix } = await registerAndCreateProject("imgrestart");
  await setScenarios({ image: { mode: "success", delayMs: 10_000 } });
  const ledgerBefore = stubLedger().filter(
    (item) => item.pathname === "/v1/images/generations",
  ).length;

  const jobId = await createGenerationJob(
    projectId,
    token,
    imageJobBody(`重启出图 ${suffix}`),
    suffix,
  );
  await waitFor(
    async () => {
      const count = stubLedger().filter(
        (item) => item.pathname === "/v1/images/generations",
      ).length;
      return count > ledgerBefore ? count : null;
    },
    60_000,
    "服务=provider-stub 事实=重启前图片请求应已到达",
  );

  serviceRestart("web");
  await waitServiceReady("web");
  const job = await waitForJobStatus(jobId, token, ["succeeded"], 180_000);
  assert.equal(
    job.status,
    "succeeded",
    "服务=web 事实=重启后孤儿图片任务应被重领并成功",
  );
  const ledgerAfter = stubLedger().filter(
    (item) => item.pathname === "/v1/images/generations",
  ).length;
  assert.ok(
    ledgerAfter >= ledgerBefore + 2,
    `服务=provider-stub 事实=重启应触发重新执行（账本 ${ledgerBefore}→${ledgerAfter}）`,
  );
});

test("video 明确失败：轮询 FAILED 后任务 failed、公开错误码 provider_failed", async () => {
  resetScenarios();
  const { token, projectId, suffix } = await registerAndCreateProject("vidfail");
  await setScenarios({ videoPoll: { statuses: ["fail"] } });

  const jobId = await createGenerationJob(
    projectId,
    token,
    videoJobBody(`必败视频 ${suffix}`),
    suffix,
  );
  const job = await waitForJobStatus(jobId, token, ["failed"], 120_000);
  assert.equal(
    job.error?.code,
    "provider_failed",
    "服务=generation-worker 事实=视频失败公开错误码应为 provider_failed",
  );
});

test("video 结果未知后复位收敛：永不终态观察窗后 DELETE 场景收敛成功", async () => {
  resetScenarios();
  const { token, projectId, suffix } = await registerAndCreateProject("vidunknown");
  await setScenarios({ videoPoll: { statuses: ["processing"] } });

  const jobId = await createGenerationJob(
    projectId,
    token,
    videoJobBody(`未知视频 ${suffix}`),
    suffix,
  );
  const pollCountBefore = await waitFor(
    async () => {
      const count = stubLedger().filter((item) =>
        item.pathname.startsWith("/v1/video/generations/"),
      ).length;
      return count >= 3 ? count : null;
    },
    60_000,
    "服务=provider-stub 事实=未知窗内应持续轮询",
  );
  const midJob = await waitForJobStatus(
    jobId,
    token,
    ["queued", "processing"],
    5_000,
  ).catch(() => null);
  assert.ok(
    midJob !== null,
    "服务=generation-worker 事实=未知窗内任务应保持非终态",
  );

  resetScenarios();
  const job = await waitForJobStatus(jobId, token, ["succeeded"], 120_000);
  assert.equal(job.status, "succeeded", "服务=generation-worker 事实=复位后应收敛成功");
  const pollCountAfter = stubLedger().filter((item) =>
    item.pathname.startsWith("/v1/video/generations/"),
  ).length;
  assert.ok(
    pollCountAfter > pollCountBefore,
    "服务=provider-stub 事实=收敛应经过新的轮询",
  );
});

test("video 进程重启接管：停 worker 后恢复并成功，轮询跨越重启", async () => {
  resetScenarios();
  const { token, projectId, suffix } = await registerAndCreateProject("vidrestart");
  await setScenarios({
    videoPoll: { statuses: ["processing", "processing", "processing", "processing", "success"] },
  });

  const jobId = await createGenerationJob(
    projectId,
    token,
    videoJobBody(`重启视频 ${suffix}`),
    suffix,
  );
  await waitFor(
    async () => {
      const count = stubLedger().filter((item) =>
        item.pathname.startsWith("/v1/video/generations/"),
      ).length;
      return count >= 2 ? count : null;
    },
    60_000,
    "服务=provider-stub 事实=重启前应已发生轮询",
  );
  const pollsBefore = stubLedger().filter((item) =>
    item.pathname.startsWith("/v1/video/generations/"),
  ).length;

  serviceStop("generation-worker");
  await new Promise((resolve) => setTimeout(resolve, 8_000));
  serviceStart("generation-worker");
  await waitServiceReady("generation-worker");

  const job = await waitForJobStatus(jobId, token, ["succeeded"], 180_000);
  assert.equal(job.status, "succeeded", "服务=generation-worker 事实=重启接管后应成功");
  const pollsAfter = stubLedger().filter((item) =>
    item.pathname.startsWith("/v1/video/generations/"),
  ).length;
  assert.ok(
    pollsAfter > pollsBefore,
    "服务=provider-stub 事实=轮询应跨越重启继续",
  );
});

// ── IK67GY T06：多 AgentAdvance 的 PlanPhase 对齐流程 ─────────────────────

const SUBJECT_QUESTION = "请告诉我这次创作的主体是什么？";
const OUTCOME_QUESTION = "请告诉我你期望的结果是什么？";
const TARGET_QUESTION = "请告诉我这次修改的目标是什么？";
const CONFIRM_QUESTION = "确认以上需求并正式提交计划吗？";

async function awaitClarification(projectId, token, suffix) {
  return waitFor(
    async () => {
      const snapshot = await fetchSnapshot(projectId, token);
      const run = snapshot.agent_runs?.at(-1);
      if (run?.status !== "awaiting_input") return null;
      const request = run.active_input_request;
      if (!request || request.status !== "pending") return null;
      return { run, request };
    },
    30_000,
    `服务=agent-worker 事实=澄清请求应到达（${suffix}）`,
  );
}

test("普通问答保持普通 Conversation，不进入 PlanPhase（IK67GY）", async () => {
  const { token, projectId, suffix } = await registerAndCreateProject("plainqa");
  const prompt = `普通问答 ${suffix}`;

  await sendMessage(projectId, token, prompt, suffix);
  const run = await waitForAgentRunStatus(projectId, token, ["completed"], 30_000);
  assert.equal(run.status, "completed", "服务=agent-worker 事实=普通问答应完成");

  const assistants = await assistantMessages(projectId, token);
  assert.equal(assistants.length, 1, "服务=agent-worker 事实=应恰有一条助手消息");
  assert.equal(
    assistants[0].content,
    fakeAgentEcho(prompt),
    "服务=agent-worker 事实=普通问答应保持确定性回显",
  );

  const requestCount = mysqlQuery(
    `SELECT COUNT(*) FROM user_input_requests WHERE project_id = ${projectId};`,
  ).trim();
  assert.equal(requestCount, "0", "服务=持久化事实=普通问答不得创建澄清请求");
  const advanceCount = mysqlQuery(
    `SELECT COUNT(*) FROM agent_advances WHERE agent_run_id = ${run.agent_run_id};`,
  ).trim();
  assert.equal(advanceCount, "1", "服务=持久化事实=普通问答只应有一个推进");
});

test("创作对齐：逐问澄清→复述确认→同意完成，同一 Run 多个 Advance（IK67GY）", async () => {
  const { token, projectId, suffix } = await registerAndCreateProject("alignflow");

  const first = await sendMessage(projectId, token, "创作：一张海报", suffix);
  const runId = first.agent_run_id;

  const subject = await awaitClarification(projectId, token, "主体");
  assert.equal(subject.run.agent_run_id, runId, "服务=持久化事实=应沿用同一 Run");
  assert.equal(subject.run.stage, "alignment", "服务=Snapshot 事实=澄清阶段应为 alignment");
  assert.equal(subject.request.question, SUBJECT_QUESTION, "服务=Snapshot 事实=应先问主体");

  await sendMessage(projectId, token, "主体：蓝鲸", suffix, {
    replyToInputRequestId: subject.request.input_request_id,
  });
  const outcome = await awaitClarification(projectId, token, "预期");
  assert.equal(outcome.run.agent_run_id, runId, "服务=持久化事实=回答应继续同一 Run");
  assert.equal(outcome.request.question, OUTCOME_QUESTION, "服务=Snapshot 事实=第二问应为预期");

  await sendMessage(projectId, token, "预期：极简海报", suffix, {
    replyToInputRequestId: outcome.request.input_request_id,
  });
  const confirm = await awaitClarification(projectId, token, "确认");
  assert.equal(
    confirm.run.stage,
    "awaiting_final_confirmation",
    "服务=Snapshot 事实=复述后应等待最终确认",
  );
  assert.equal(confirm.request.question, CONFIRM_QUESTION, "服务=Snapshot 事实=应请求最终同意");
  const confirmAssistant = await assistantMessages(projectId, token);
  assert.ok(
    confirmAssistant.at(-1)?.content.startsWith("需求复述：主体「蓝鲸」，预期「极简海报」"),
    "服务=agent-worker 事实=提交前必须复述已对齐需求",
  );

  await sendMessage(projectId, token, "立即出计划", suffix, {
    replyToInputRequestId: confirm.request.input_request_id,
  });
  const stillConfirm = await awaitClarification(projectId, token, "不绕过确认");
  assert.equal(
    stillConfirm.run.stage,
    "awaiting_final_confirmation",
    "服务=agent-worker 事实=立即出计划不得绕过最终确认",
  );

  await sendMessage(projectId, token, "同意", suffix, {
    replyToInputRequestId: stillConfirm.request.input_request_id,
  });
  const run = await waitForAgentRunStatus(projectId, token, ["completed"], 30_000);
  assert.equal(run.agent_run_id, runId, "服务=持久化事实=完成仍应是同一 Run");
  const assistants = await assistantMessages(projectId, token);
  assert.equal(
    assistants.at(-1)?.content,
    "已完成需求对齐：主体「蓝鲸」，预期「极简海报」。",
    "服务=agent-worker 事实=同意后应完成对齐",
  );

  const ordinals = mysqlQuery(
    `SELECT ordinal FROM agent_advances WHERE agent_run_id = ${runId} ORDER BY ordinal;`,
  ).trim().split("\n");
  assert.deepEqual(ordinals, ["1", "2", "3", "4", "5"], "服务=持久化事实=应按序创建多个推进");
  const commitCount = mysqlQuery(
    `SELECT COUNT(*) FROM run_commits WHERE agent_run_id = ${runId};`,
  ).trim();
  assert.equal(commitCount, "5", "服务=持久化事实=RunCommit 唯一性按 AgentAdvance 生效");
});

test("你决定补默认值，不受支持的要求继续澄清而不静默降级（IK67GY）", async () => {
  const { token, projectId, suffix } = await registerAndCreateProject("decideflow");

  const first = await sendMessage(projectId, token, "创作：一张海报", suffix);
  const runId = first.agent_run_id;

  const subject = await awaitClarification(projectId, token, "主体");
  await sendMessage(projectId, token, "你决定", suffix, {
    replyToInputRequestId: subject.request.input_request_id,
  });
  const outcome = await awaitClarification(projectId, token, "预期");
  assert.equal(outcome.run.agent_run_id, runId, "服务=持久化事实=你决定后应继续同一 Run");
  assert.equal(outcome.request.question, OUTCOME_QUESTION, "服务=agent-worker 事实=你决定后应推进到下一缺失项");

  await sendMessage(
    projectId,
    token,
    "预期：动态效果，不支持：立体渲染",
    suffix,
    { replyToInputRequestId: outcome.request.input_request_id },
  );
  const unsupported = await awaitClarification(projectId, token, "不支持");
  assert.equal(unsupported.run.stage, "alignment", "服务=Snapshot 事实=不受支持应回到澄清");
  assert.ok(
    unsupported.request.question.includes("立体渲染」目前不受支持"),
    "服务=agent-worker 事实=不受支持的要求必须继续澄清",
  );

  await sendMessage(projectId, token, "你决定", suffix, {
    replyToInputRequestId: unsupported.request.input_request_id,
  });
  const stillUnsupported = await awaitClarification(projectId, token, "你决定不降级");
  assert.ok(
    stillUnsupported.request.question.includes("立体渲染」目前不受支持"),
    "服务=agent-worker 事实=你决定不得移除不受支持的要求",
  );

  await sendMessage(projectId, token, "预期：动态海报", suffix, {
    replyToInputRequestId: stillUnsupported.request.input_request_id,
  });
  const confirm = await awaitClarification(projectId, token, "改要求后确认");
  assert.equal(
    confirm.run.stage,
    "awaiting_final_confirmation",
    "服务=Snapshot 事实=重新给出受支持要求后应进入最终确认",
  );
  assert.ok(
    confirm.request.question === CONFIRM_QUESTION,
    "服务=Snapshot 事实=应请求最终同意",
  );

  await sendMessage(projectId, token, "同意", suffix, {
    replyToInputRequestId: confirm.request.input_request_id,
  });
  const run = await waitForAgentRunStatus(projectId, token, ["completed"], 30_000);
  const assistants = await assistantMessages(projectId, token);
  assert.equal(
    assistants.at(-1)?.content,
    "已完成需求对齐：主体「由系统选择的默认主体」，预期「动态海报」。",
    "服务=agent-worker 事实=默认值与修订后的要求应进入对齐结果",
  );
  assert.equal(run.agent_run_id, runId, "服务=持久化事实=完成仍应是同一 Run");
});

test("修改请求必须明确目标与变化（IK67GY）", async () => {
  const { token, projectId, suffix } = await registerAndCreateProject("modifyflow");

  await sendMessage(projectId, token, "修改：海报", suffix);
  const target = await awaitClarification(projectId, token, "目标");
  assert.equal(target.run.stage, "alignment", "服务=Snapshot 事实=修改请求应进入澄清");
  assert.equal(target.request.question, TARGET_QUESTION, "服务=agent-worker 事实=修改应先问目标");
});

test("继续讨论回到对齐，不要创建计划与停止取消当前 Run（IK67GY）", async () => {
  const { token, projectId, suffix } = await registerAndCreateProject("controlflow");

  const first = await sendMessage(
    projectId,
    token,
    "创作：一张海报，主体：蓝鲸，预期：极简海报",
    suffix,
  );
  const runId = first.agent_run_id;
  const confirm = await awaitClarification(projectId, token, "确认");
  assert.equal(confirm.run.stage, "awaiting_final_confirmation", "服务=Snapshot 事实=应先到最终确认");

  await sendMessage(projectId, token, "继续讨论", suffix, {
    replyToInputRequestId: confirm.request.input_request_id,
  });
  const discuss = await awaitClarification(projectId, token, "继续讨论");
  assert.equal(discuss.run.stage, "alignment", "服务=Snapshot 事实=继续讨论应回到对齐阶段");
  assert.equal(discuss.run.agent_run_id, runId, "服务=持久化事实=继续讨论应仍是同一 Run");

  await sendMessage(projectId, token, "不要创建计划", suffix, {
    replyToInputRequestId: discuss.request.input_request_id,
  });
  const cancelled = await waitForAgentRunStatus(projectId, token, ["cancelled"], 30_000);
  assert.equal(cancelled.stage, "cancelled", "服务=Snapshot 事实=取消后阶段应可从 Snapshot 恢复");

  const second = await sendMessage(projectId, token, "创作：另一张海报", `${suffix}b`);
  const stopAsk = await awaitClarification(projectId, token, "停止前澄清");
  assert.notEqual(second.agent_run_id, runId, "服务=持久化事实=取消后新目标应开新 Run");
  assert.equal(
    stopAsk.request.question,
    SUBJECT_QUESTION,
    "服务=agent-worker 事实=取消后新创作目标应重新澄清而不继承旧取值",
  );
  await sendMessage(projectId, token, "停止", `${suffix}b`, {
    replyToInputRequestId: stopAsk.request.input_request_id,
  });
  await waitForAgentRunStatus(projectId, token, ["cancelled"], 30_000);
});

test("对齐中途 web 重启后从 Snapshot 恢复并可继续回答（IK67GY）", async () => {
  const { token, projectId, suffix } = await registerAndCreateProject("recoverflow");

  const first = await sendMessage(projectId, token, "创作：一张海报", suffix);
  const runId = first.agent_run_id;
  const subject = await awaitClarification(projectId, token, "重启前澄清");

  serviceRestart("web");
  await waitServiceReady("web");

  const recovered = await awaitClarification(projectId, token, "重启后恢复");
  assert.equal(recovered.run.agent_run_id, runId, "服务=Snapshot 事实=重启后应恢复同一 Run");
  assert.equal(recovered.run.stage, "alignment", "服务=Snapshot 事实=重启后阶段应恢复");
  assert.equal(
    recovered.request.input_request_id,
    subject.request.input_request_id,
    "服务=Snapshot 事实=重启后应恢复同一澄清请求",
  );

  await sendMessage(projectId, token, "主体：蓝鲸", suffix, {
    replyToInputRequestId: recovered.request.input_request_id,
  });
  const outcome = await awaitClarification(projectId, token, "恢复后继续");
  assert.equal(outcome.request.question, OUTCOME_QUESTION, "服务=agent-worker 事实=恢复后回答应继续推进");
});
