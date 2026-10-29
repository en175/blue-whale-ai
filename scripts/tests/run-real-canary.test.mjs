import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildOutputCanvasNode,
  canaryTimestamp,
  candidateIdentityProblems,
  checkStorageIdentity,
  computeFactDigest,
  diffFactDigests,
  evidenceVerdict,
  findPendingOutputPlacements,
  planOutputCanvasNodes,
  sanitizeEvidenceText,
  viewportAnchorPoint,
} from "../run-real-canary.mjs";

test("候选身份：运行服务 commit 必须等于干净 checkout HEAD", () => {
  const head = "a".repeat(40);
  assert.deepEqual(
    candidateIdentityProblems(
      { git_commit: head },
      { head, dirty: false },
    ),
    [],
  );
});

test("候选身份：unknown、错版、脏树或无 HEAD 均拒绝", () => {
  const head = "a".repeat(40);
  assert.equal(
    candidateIdentityProblems(
      { git_commit: "unknown" },
      { head, dirty: false },
    ).length,
    1,
  );
  assert.equal(
    candidateIdentityProblems(
      { git_commit: "b".repeat(40) },
      { head, dirty: false },
    ).length,
    1,
  );
  assert.equal(
    candidateIdentityProblems(
      { git_commit: head },
      { head, dirty: true },
    ).length,
    1,
  );
  assert.equal(
    candidateIdentityProblems(
      { git_commit: head },
      { head: null, dirty: null },
    ).length,
    1,
  );
});

test("证据结论：存在任一 FAIL 时不得输出 PASS", () => {
  assert.equal(evidenceVerdict([{ ok: true }, { ok: true }]), "PASS");
  assert.equal(evidenceVerdict([{ ok: true }, { ok: false }]), "FAIL");
});

function makeSnapshot() {
  return {
    conversation_messages: [{ message_id: "11", role: "user", sequence_no: 1 }],
    plan_messages: [
      {
        message_id: "21",
        application_kind: "image_generate",
        applied_at: "2026-08-09T00:00:00.000Z",
      },
    ],
    plan_applications: [
      {
        receipt_id: "31",
        application_kind: "image_generate",
        command_id: "cmd-1",
      },
    ],
    scene_cards: [{ scene_card_id: "41", version: 2 }],
    scene_card_generation_records: [
      { record_id: "51", summary_status: "ready" },
    ],
    generation_jobs: [
      { job_id: "101", status: "succeeded", source: "direct" },
      { job_id: "102", status: "succeeded", source: "direct" },
    ],
    assets: { 201: { asset_id: "201" }, 202: { asset_id: "202" } },
    canvas: {
      nodes: JSON.stringify([{ id: "generation-output:301" }]),
    },
  };
}

test("factDigest：同一 Snapshot 两次计算结果一致", () => {
  const snapshot = makeSnapshot();
  assert.deepEqual(computeFactDigest(snapshot), computeFactDigest(snapshot));
});

test("factDigest：数字与字符串 id 归一化后 digest 相同", () => {
  const a = makeSnapshot();
  const b = makeSnapshot();
  b.generation_jobs[0].job_id = 101;
  b.scene_cards[0].scene_card_id = 41;
  assert.deepEqual(computeFactDigest(a), computeFactDigest(b));
});

test("factDigest：字段清单与取值符合预期", () => {
  const digest = computeFactDigest(makeSnapshot());
  assert.deepEqual(digest, {
    messages: ["11:user:1"],
    sceneCards: ["41:2"],
    records: ["51:ready"],
    jobs: ["101:succeeded:direct", "102:succeeded:direct"],
    assets: ["201", "202"],
    canvasNodeIds: ["generation-output:301"],
  });
});

test("factDigest 比对：一致时返回空问题列表", () => {
  const digest = computeFactDigest(makeSnapshot());
  assert.deepEqual(
    diffFactDigests(digest, computeFactDigest(makeSnapshot())),
    [],
  );
});

test("factDigest 比对：job 状态漂移/画布节点缺失逐项列出", () => {
  const before = computeFactDigest(makeSnapshot());
  const afterSnapshot = makeSnapshot();
  afterSnapshot.generation_jobs[1].status = "failed";
  afterSnapshot.canvas.nodes = JSON.stringify([]);
  const problems = diffFactDigests(before, computeFactDigest(afterSnapshot));
  assert.equal(problems.length, 2);
  assert.ok(problems[0].includes("jobs"), "应报 jobs 字段");
  assert.ok(problems[0].includes("102:failed:direct"), "应列出多出项");
  assert.ok(problems[1].includes("canvasNodeIds"), "应报 canvasNodeIds 字段");
  assert.ok(problems[1].includes("generation-output:301"), "应列出缺失节点");
});

test("脱敏：sk-/Bearer/JWT/敏感键值/堆栈帧全部替换或剥除", () => {
  const jwt = `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c`;
  const raw = [
    "Authorization: Bearer sk-abc123def456",
    `token=${jwt}`,
    'password: "Ac123456789012!xY9"',
    "provider_credential=9f8e7d6c5b4a",
    "Cookie: session=xyz123; theme=dark",
    "普通诊断行保留",
    "\tat com.example.Foo.bar(Foo.java:42)",
  ].join("\n");
  const out = sanitizeEvidenceText(raw);
  assert.ok(!out.includes("sk-abc123def456"), "sk- 令牌不得出现");
  assert.ok(!out.includes("Ac123456789012"), "密码不得出现");
  assert.ok(!out.includes("9f8e7d6c5b4a"), "密封凭证不得出现");
  assert.ok(!out.includes("eyJhbGciOiJIUzI1NiJ9"), "JWT 不得出现");
  assert.ok(!out.includes("session=xyz123"), "Cookie 值不得出现");
  assert.ok(!out.includes("at com.example"), "堆栈帧应剥除");
  assert.ok(out.includes("普通诊断行保留"), "普通行保留");
  assert.ok(out.includes("[REDACTED]"), "替换标记应出现");
});

test("脱敏：export 出去的错误对象 JSON 中的 token 键值也被替换", () => {
  const out = sanitizeEvidenceText(
    JSON.stringify({ access_token: "sk-live-999888", quota: 10 }),
  );
  assert.ok(!out.includes("sk-live-999888"));
  assert.ok(out.includes('"quota":10'), "非敏感字段原样保留");
});

test("对象存储身份：TOS 转存 URL 通过，provider 直引 URL 不通过", () => {
  const ok = checkStorageIdentity(
    "https://bw-bucket.tos-cn-beijing.volces.com/uploads/42/image/abc.png",
    "42",
    "image",
  );
  assert.equal(ok.ok, true);

  const videoRelay = checkStorageIdentity(
    "https://bw-bucket.tos-cn-beijing.volces.com/generated/42/video/abc.mp4",
    "42",
    "video",
  );
  assert.equal(videoRelay.ok, true);

  const provider = checkStorageIdentity(
    "https://ark-content-generation.cn-beijing.volces.com/doubao/xyz.png?sig=1",
    "42",
    "image",
  );
  assert.equal(provider.ok, false);
  assert.ok(provider.reason.includes("对象存储前缀"));

  const wrongType = checkStorageIdentity(
    "https://bw-bucket.tos-cn-beijing.volces.com/uploads/42/video/abc.mp4",
    "42",
    "image",
  );
  assert.equal(wrongType.ok, false);

  assert.equal(checkStorageIdentity("not-a-url", "42", "image").ok, false);
  assert.equal(checkStorageIdentity("", "42", "image").ok, false);
});

function makePlacementSnapshot() {
  return {
    generation_jobs: [
      {
        job_id: "101",
        type: "image",
        input: { prompt: "p", model_id: "m" },
        output_slots: [
          {
            slot_id: "301",
            slot_index: 0,
            status: "succeeded",
            asset_id: "201",
            retry_of_slot_id: null,
            initial_placement_status: "pending",
          },
        ],
      },
      {
        job_id: "102",
        type: "video",
        input: { prompt: "p", model_id: "m" },
        output_slots: [
          {
            slot_id: "302",
            slot_index: 0,
            status: "succeeded",
            asset_id: "202",
            retry_of_slot_id: null,
            initial_placement_status: "pending",
          },
        ],
      },
    ],
  };
}

test("放置规划：提取 pending 槽并构造 generation-output 节点", () => {
  const pending = findPendingOutputPlacements(makePlacementSnapshot());
  assert.equal(pending.length, 2);
  assert.deepEqual(
    pending.map((p) => p.slot_id),
    ["301", "302"],
  );

  const additions = planOutputCanvasNodes([], pending, null);
  assert.equal(additions.length, 2);
  const [imageNode, videoNode] = additions;
  assert.equal(imageNode.id, "generation-output:301");
  assert.equal(imageNode.type, "image");
  assert.equal(imageNode.assetId, "201");
  assert.equal(imageNode.taskId, "101");
  assert.equal(imageNode.width, 200);
  assert.equal(imageNode.height, 112);
  assert.equal(imageNode.status, "placed");
  assert.equal(videoNode.id, "generation-output:302");
  assert.equal(videoNode.width, 400);
  assert.equal(videoNode.height, 225);
  const overlap =
    imageNode.position.x < videoNode.position.x + videoNode.width &&
    videoNode.position.x < imageNode.position.x + imageNode.width &&
    imageNode.position.y < videoNode.position.y + videoNode.height &&
    videoNode.position.y < imageNode.position.y + imageNode.height;
  assert.equal(overlap, false);
});

test("放置规划：幂等——已有同 id 节点不重复追加", () => {
  const pending = findPendingOutputPlacements(makePlacementSnapshot());
  const existing = [buildOutputCanvasNode(pending[0], { x: 0, y: 0 })];
  const additions = planOutputCanvasNodes(existing, pending, null);
  assert.equal(additions.length, 1);
  assert.equal(additions[0].id, "generation-output:302");
});

test("放置规划：避开既有节点占位", () => {
  const pending = findPendingOutputPlacements(makePlacementSnapshot());
  const blocker = {
    id: "scene_card_9",
    type: "scene_card",
    scene_card_id: "9",
    position: { x: 0, y: 0 },
    width: 400,
    height: 1080,
    status: "placed",
  };
  const additions = planOutputCanvasNodes([blocker], [pending[0]], null);
  assert.equal(additions.length, 1);
  const rect = {
    ...additions[0].position,
    width: additions[0].width,
    height: additions[0].height,
  };
  const blocked = { x: 0, y: 0, width: 400, height: 1080 };
  const overlap =
    rect.x < blocked.x + blocked.width &&
    blocked.x < rect.x + rect.width &&
    rect.y < blocked.y + blocked.height &&
    blocked.y < rect.y + rect.height;
  assert.equal(overlap, false, "新节点不得与既有 SceneCard 重叠");
});

test("放置规划：视频槽带 SceneCard 时挂到卡下方", () => {
  const snapshot = makePlacementSnapshot();
  snapshot.generation_jobs[1].input.scene_card_id = "9";
  const pending = findPendingOutputPlacements(snapshot);
  const card = {
    id: "scene_card_9",
    type: "scene_card",
    scene_card_id: "9",
    position: { x: 500, y: 500 },
    width: 400,
    height: 300,
    status: "placed",
  };
  const additions = planOutputCanvasNodes([card], [pending[1]], null);
  assert.equal(additions[0].sceneCardId, "9");
  assert.equal(additions[0].position.x, 500);
  assert.ok(additions[0].position.y >= 500 + 300, "应位于 SceneCard 下方");
});

test("视口锚点：{x,y,zoom} 反投，非法输入回退原点", () => {
  assert.deepEqual(
    viewportAnchorPoint(JSON.stringify({ x: -100, y: 50, zoom: 2 })),
    {
      x: 50,
      y: -25,
    },
  );
  assert.deepEqual(viewportAnchorPoint(null), { x: 0, y: 0 });
  assert.deepEqual(viewportAnchorPoint("not-json"), { x: 0, y: 0 });
});

test("canary 时间戳：yyyymmddhhmmss 14 位数字", () => {
  const ts = canaryTimestamp(new Date(2026, 7, 9, 4, 5, 6));
  assert.equal(ts, "20260809040506");
});
