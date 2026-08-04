// Node-only 全栈黑盒：MentionInputSnapshot 冻结与受限素材读取（IK67H3 T08）。
// 只经公开 HTTP、Snapshot 与只读 SQL 断言，不 import 产品源码。
//
// 三闸门（AC#5：供应商调用/结果复用/RunCommit 前按当前事实实时重查授权）与
// read_asset 授权链（AC#3/#4）由 worker-loop / agent-run-repo / read-asset-tool
// 单元测覆盖——黑盒层难以确定性构造「冻结后、闸门前的撤权窗口」。本场景验证
// 可确定性的核心交付：每次 advance 冻结本轮 mention 的受限投影（AC#1），
// 且不暴露存储身份（AC#4）。
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
  assert.equal(registered.body.code, 200, "服务=web 事实=注册应成功");
  const token = registered.body.data?.access_token;
  assert.equal(typeof token, "string", "服务=web 事实=注册应返回 token");
  const me = await requestJson("/api/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { token, userId: String(me.body.data?.user_id) };
}

async function createProject(name, token) {
  const created = await postJson("/api/projects", { name }, token);
  assert.equal(created.body.code, 200, "服务=web 事实=Project 创建应成功");
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
  assert.equal(result.body.code, 200, "服务=web 事实=Snapshot 应可读");
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

let owner;
let project;

before(async () => {
  owner = await registerUser("snapshotOwner");
  project = await createProject("快照冻结项目", owner.token);
});

test("每次 advance 冻结本轮 mention 的受限投影，且不暴露存储身份（AC#1/#4）", async () => {
  const storageKey = "private/t08/whale.png";
  const assetId = insertedId(`
    INSERT INTO assets (
      user_id, project_id, type, storage_key, content_sha256, url, mime,
      size, width, height, source, status, is_delete
    ) VALUES (
      ${owner.userId}, ${project}, 'image',
      '${storageKey}', '${"c".repeat(64)}',
      'https://storage.invalid/private/t08/whale.png', 'image/png',
      4096, 1600, 1200, 'uploaded', 'normal', false
    )
  `);
  const key = uniqueKey("t08-snapshot");
  const accepted = await postJson(
    `/api/projects/${project}/conversation/messages`,
    {
      client_message_id: key,
      content: "@[蓝鲸参考图] 请沿用",
      mentions: [
        { type: "asset", asset_id: assetId, display_name: "蓝鲸参考图" },
      ],
    },
    owner.token,
    key,
  );
  assert.equal(accepted.body.code, 200);
  const agentRunId = accepted.body.data?.agent_run_id;

  // 等待 run 终态：available mention 不触发三闸门，应正常完成。
  await waitFor(
    async () => {
      const snapshot = await fetchSnapshot(project, owner.token);
      const run = snapshot.agent_runs?.find(
        (item) => String(item.agent_run_id) === String(agentRunId),
      );
      return run?.status === "completed" ? run : null;
    },
    30_000,
    "服务=agent-worker 事实=引用可用素材的 Run 应完成",
  );

  const raw = mysqlQuery(
    `SELECT mention_input_snapshot FROM agent_advances WHERE agent_run_id=${agentRunId} ORDER BY ordinal DESC LIMIT 1`,
  );
  const snapshot = JSON.parse(raw);
  assert.equal(
    snapshot.capability_snapshot_version,
    1,
    "服务=mysql 事实=advance 应冻结 MentionInputSnapshot",
  );
  const entry = snapshot.entries.find(
    (item) => String(item.mention_id) ===
      String(accepted.body.data.mentions[0].mention_id),
  );
  assert.ok(entry, "服务=mysql 事实=快照应含本轮 mention 条目");
  assert.equal(entry.type, "asset");
  assert.equal(entry.availability, "available");
  assert.equal(entry.reason, null);
  assert.equal(entry.projection.asset_type, "image");
  assert.equal(entry.projection.mime, "image/png");
  assert.equal(entry.projection.width, 1600);
  // AC#4：受限投影不得暴露存储身份 / 公网 URL / 用户身份。
  const leaked = JSON.stringify(snapshot);
  for (const forbidden of [
    "storage_key",
    storageKey,
    "storage.invalid",
    "user_id",
    "url",
  ]) {
    assert.equal(
      leaked.includes(forbidden),
      false,
      `服务=mysql 事实=快照不得泄漏 ${forbidden}`,
    );
  }
}, 60_000);

test("无引用的消息冻结空快照，且不改写既有 advance 的快照（AC#1 独立性）", async () => {
  const key = uniqueKey("t08-no-mention");
  const accepted = await postJson(
    `/api/projects/${project}/conversation/messages`,
    { client_message_id: key, content: "无引用的普通消息" },
    owner.token,
    key,
  );
  assert.equal(accepted.body.code, 200);
  const agentRunId = accepted.body.data?.agent_run_id;
  await waitFor(
    async () => {
      const snapshot = await fetchSnapshot(project, owner.token);
      const run = snapshot.agent_runs?.find(
        (item) => String(item.agent_run_id) === String(agentRunId),
      );
      return run?.status === "completed" ? run : null;
    },
    30_000,
    "服务=agent-worker 事实=普通消息 Run 应完成",
  );
  const raw = mysqlQuery(
    `SELECT mention_input_snapshot FROM agent_advances WHERE agent_run_id=${agentRunId} ORDER BY ordinal DESC LIMIT 1`,
  );
  const snapshot = JSON.parse(raw);
  assert.deepEqual(
    snapshot.entries,
    [],
    "服务=mysql 事实=无引用消息的 advance 冻结空 entries",
  );
}, 60_000);
