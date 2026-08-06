// Node-only 全栈黑盒：显式引用原子接纳与授权边界（IK67H2 T04）。
// 只经过公开 HTTP、Snapshot 与只读 SQL 断言，不 import 产品源码。
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

async function fetchSnapshot(projectId, token) {
  const result = await requestJson(`/api/projects/${projectId}/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(result.body.code, 200, "服务=web 事实=Snapshot 应可读");
  return result.body.data;
}

async function readAcceptedMessageEvent(projectId, token, messageId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(
      `${baseUrl}/api/projects/${projectId}/events?after=0`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      },
    );
    assert.equal(response.status, 200, "服务=web 事实=SSE 应可读取");
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
        const eventType = frame
          .split("\n")
          .find((line) => line.startsWith("event: "))
          ?.slice(7);
        const dataLine = frame
          .split("\n")
          .find((line) => line.startsWith("data: "));
        if (eventType !== "conversation.message_accepted" || !dataLine) {
          continue;
        }
        const data = JSON.parse(dataLine.slice(6));
        if (String(data.payload?.message_id) === String(messageId)) return data;
      }
    }
    throw new Error("服务=SSE 事实=未找到 conversation.message_accepted");
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function insertedId(sql) {
  return mysqlQuery(`${sql}; SELECT LAST_INSERT_ID();`).split("\n").at(-1);
}

function writeFingerprint(projectId) {
  return mysqlQuery(`
    SELECT CONCAT(
      (SELECT COUNT(*) FROM conversations WHERE project_id=${projectId}), ':',
      (SELECT COUNT(*) FROM conversation_messages WHERE project_id=${projectId}), ':',
      (SELECT COUNT(*) FROM conversation_message_mentions WHERE project_id=${projectId}), ':',
      (SELECT COUNT(*) FROM agent_runs WHERE project_id=${projectId}), ':',
      (SELECT COUNT(*) FROM project_events WHERE project_id=${projectId}), ':',
      (SELECT COUNT(*) FROM command_idempotency WHERE project_id=${projectId})
    )
  `);
}

let owner;
let other;
let successProject;
let failureProject;
let otherProject;

before(async () => {
  owner = await registerUser("mentionowner");
  other = await registerUser("mentionother");
  successProject = await createProject("引用成功项目", owner.token);
  failureProject = await createProject("引用失败项目", owner.token);
  otherProject = await createProject("其他用户项目", other.token);
});

test("AssetMention 与既有 SceneCardMention 同单成功，重放返回同一组服务身份", async () => {
  const assetId = insertedId(`
    INSERT INTO assets (
      user_id, project_id, type, storage_key, content_sha256, url, mime,
      size, width, height, source, status, is_delete
    ) VALUES (
      ${owner.userId}, ${successProject}, 'image',
      'private/mention/success.png', '${"a".repeat(64)}',
      'https://storage.invalid/private/mention/success.png', 'image/png',
      1024, 1200, 800, 'uploaded', 'normal', false
    )
  `);
  const sceneCardId = insertedId(`
    INSERT INTO scene_cards (
      project_id, title, summary, content_markdown, version, is_delete
    ) VALUES (
      ${successProject}, '开场分镜', '蓝鲸跃出水面',
      '# 开场\\n\\n蓝鲸跃出水面。', 3, 0
    )
  `);
  const key = uniqueKey("mention-success");
  const body = {
    client_message_id: key,
    content: "@[蓝鲸参考图] @[开场分镜] 请沿用",
    mentions: [
      { type: "asset", asset_id: assetId, display_name: "蓝鲸参考图" },
      {
        type: "scene_card",
        scene_card_id: sceneCardId,
        scene_card_version: 3,
        display_name: "开场分镜",
      },
    ],
  };

  const accepted = await postJson(
    `/api/projects/${successProject}/conversation/messages`,
    body,
    owner.token,
    key,
  );
  assert.equal(accepted.response.status, 202);
  assert.equal(accepted.body.code, 200);
  assert.deepEqual(
    accepted.body.data?.mentions?.map(({ index, type }) => ({ index, type })),
    [
      { index: 0, type: "asset" },
      { index: 1, type: "scene_card" },
    ],
    "服务=web 事实=接纳结果应保留完整跨类型顺序",
  );
  const firstMentionIds = accepted.body.data.mentions.map((item) =>
    String(item.mention_id),
  );

  const replay = await postJson(
    `/api/projects/${successProject}/conversation/messages`,
    body,
    owner.token,
    key,
  );
  assert.equal(replay.body.code, 200);
  assert.equal(replay.body.data.message_id, accepted.body.data.message_id);
  assert.equal(replay.body.data.agent_run_id, accepted.body.data.agent_run_id);
  assert.deepEqual(
    replay.body.data.mentions.map((item) => String(item.mention_id)),
    firstMentionIds,
    "服务=mysql 事实=同一 CommandId 重放应返回同一组 mention 身份",
  );

  const facts = mysqlQuery(`
    SELECT mention_seq, mention_type, target_id, COALESCE(target_version, 0), display_name
    FROM conversation_message_mentions
    WHERE message_id=${accepted.body.data.message_id}
    ORDER BY mention_seq
  `)
    .split("\n")
    .map((line) => line.split("\t"));
  assert.deepEqual(facts, [
    ["0", "asset", assetId, "0", "蓝鲸参考图"],
    ["1", "scene_card", sceneCardId, "3", "开场分镜"],
  ]);
  const factDigest = mysqlQuery(`
    SELECT SHA2(GROUP_CONCAT(CAST(snapshot AS CHAR) ORDER BY mention_seq SEPARATOR '|'), 256)
    FROM conversation_message_mentions
    WHERE message_id=${accepted.body.data.message_id}
  `);

  const snapshot = await fetchSnapshot(successProject, owner.token);
  const message = snapshot.conversation_messages.find(
    (item) => String(item.message_id) === String(accepted.body.data.message_id),
  );
  assert.deepEqual(
    message.mentions.map(({ index, type, availability, reason }) => ({
      index,
      type,
      availability,
      reason,
    })),
    [
      { index: 0, type: "asset", availability: "available", reason: null },
      {
        index: 1,
        type: "scene_card",
        availability: "available",
        reason: null,
      },
    ],
  );

  mysqlQuery(
    `UPDATE assets SET user_id=${other.userId} WHERE id=${assetId}; UPDATE scene_cards SET version=4 WHERE id=${sceneCardId}`,
  );
  const withdrawn = await fetchSnapshot(successProject, owner.token);
  const historical = withdrawn.conversation_messages.find(
    (item) => String(item.message_id) === String(accepted.body.data.message_id),
  );
  assert.deepEqual(
    historical.mentions.map(
      ({ index, type, availability, reason, snapshot: frozen }) => ({
        index,
        type,
        availability,
        reason,
        has_snapshot: frozen !== undefined,
      }),
    ),
    [
      {
        index: 0,
        type: "asset",
        availability: "unavailable",
        reason: "permission_lost",
        has_snapshot: false,
      },
      {
        index: 1,
        type: "scene_card",
        availability: "stale",
        reason: "stale",
        has_snapshot: true,
      },
    ],
    "服务=web 事实=当前可用性重算，但 stale 仍保留冻结历史内容",
  );
  assert.equal(
    JSON.stringify(historical.mentions[0]).includes("private/mention"),
    false,
    "服务=web 事实=授权撤回后不得暴露内容或存储身份",
  );
  assert.equal(
    JSON.stringify(withdrawn).includes("storage.invalid/private/mention"),
    false,
    "服务=web 事实=跨 User Asset 不得从 Snapshot assets 侧路泄漏",
  );
  assert.equal(
    mysqlQuery(`
      SELECT SHA2(GROUP_CONCAT(CAST(snapshot AS CHAR) ORDER BY mention_seq SEPARATOR '|'), 256)
      FROM conversation_message_mentions
      WHERE message_id=${accepted.body.data.message_id}
    `),
    factDigest,
    "服务=mysql 事实=可用性变化不得改写历史 mention 快照",
  );
  const replayedEvent = await readAcceptedMessageEvent(
    successProject,
    owner.token,
    accepted.body.data.message_id,
  );
  assert.equal(
    JSON.stringify(replayedEvent).includes("snapshot"),
    false,
    "服务=SSE 事实=撤权后重放公共事件不得旁路暴露冻结快照",
  );

  const replayAfterWithdrawal = await postJson(
    `/api/projects/${successProject}/conversation/messages`,
    body,
    owner.token,
    key,
  );
  assert.equal(replayAfterWithdrawal.body.code, 200);
  assert.deepEqual(
    replayAfterWithdrawal.body.data.mentions.map((item) =>
      String(item.mention_id),
    ),
    firstMentionIds,
    "服务=mysql 事实=已接纳命令在授权撤回后仍幂等重放原结果",
  );
}, 120_000);

test("混合失效引用整体零写入，并返回不泄漏目标身份的可修复原因", async () => {
  const validAssetId = insertedId(`
    INSERT INTO assets (user_id, project_id, type, url, source, status, is_delete)
    VALUES (${owner.userId}, ${failureProject}, 'image', 'https://storage.invalid/valid.png', 'uploaded', 'normal', false)
  `);
  const foreignAssetId = insertedId(`
    INSERT INTO assets (user_id, project_id, type, storage_key, url, source, status, is_delete)
    VALUES (${other.userId}, ${failureProject}, 'image', 'private/foreign.png', 'https://storage.invalid/foreign.png', 'uploaded', 'normal', false)
  `);
  const staleSceneId = insertedId(`
    INSERT INTO scene_cards (project_id, title, summary, content_markdown, version, is_delete)
    VALUES (${failureProject}, '当前分镜', 'CURRENT_SECRET', '# CURRENT_SECRET', 4, 0)
  `);
  const wrongProjectSceneId = insertedId(`
    INSERT INTO scene_cards (project_id, title, summary, content_markdown, version, is_delete)
    VALUES (${otherProject}, '其他项目分镜', 'OTHER_SECRET', '# OTHER_SECRET', 1, 0)
  `);
  const deletedSceneId = insertedId(`
    INSERT INTO scene_cards (project_id, title, summary, content_markdown, version, is_delete)
    VALUES (${failureProject}, '已删除分镜', 'DELETED_SECRET', '# DELETED_SECRET', 1, 1)
  `);
  const beforeFingerprint = writeFingerprint(failureProject);
  const key = uniqueKey("mention-mixed-failure");
  const rejected = await postJson(
    `/api/projects/${failureProject}/conversation/messages`,
    {
      client_message_id: key,
      content: "混合引用应整体失败",
      mentions: [
        { type: "asset", asset_id: validAssetId, display_name: "有效素材" },
        {
          type: "asset",
          asset_id: foreignAssetId,
          display_name: "他人素材",
        },
        {
          type: "scene_card",
          scene_card_id: staleSceneId,
          scene_card_version: 3,
          display_name: "旧版分镜",
        },
        {
          type: "scene_card",
          scene_card_id: wrongProjectSceneId,
          scene_card_version: 1,
          display_name: "其他项目分镜",
        },
        {
          type: "scene_card",
          scene_card_id: deletedSceneId,
          scene_card_version: 1,
          display_name: "已删除分镜",
        },
      ],
    },
    owner.token,
    key,
  );

  assert.equal(rejected.response.status, 200);
  assert.equal(rejected.body.code, 100202);
  assert.equal(rejected.body.data?.code, "mention.unavailable");
  assert.deepEqual(rejected.body.data?.mentions, [
    { index: 1, type: "asset", reason: "permission_lost" },
    { index: 2, type: "scene_card", reason: "stale" },
    { index: 3, type: "scene_card", reason: "wrong_project" },
    { index: 4, type: "scene_card", reason: "deleted" },
  ]);
  assert.equal(
    writeFingerprint(failureProject),
    beforeFingerprint,
    "服务=mysql 事实=任一引用失效时消息/mention/Run/事件/回执全部零增量",
  );
  const publicFailure = JSON.stringify(rejected.body);
  for (const forbidden of [
    "asset_id",
    "scene_card_id",
    "target_id",
    "private/foreign.png",
    "CURRENT_SECRET",
    "OTHER_SECRET",
    "DELETED_SECRET",
    "owner_id",
    "user_id",
  ]) {
    assert.equal(
      publicFailure.includes(forbidden),
      false,
      `服务=web 事实=失败响应不得泄漏 ${forbidden}`,
    );
  }
}, 120_000);
