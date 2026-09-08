#!/usr/bin/env node
/**
 * T18 真实 canary 驱动（IK67HJ）：对本地自足开发栈执行一次真实图片 canary +
 * 真实视频 canary，并支持服务重启后的恢复验证，产出脱敏证据。
 *
 * 纯 HTTP 黑盒：不 import 任何产品源码，只打公开 API。端点与载荷形状以仓库实现为准：
 *   - 注册/登录/建项目/建生成任务：tests/typescript-baseline/ik50gb-c-smoke.test.mjs
 *   - Snapshot 形状：blue_whale_web/lib/snapshot/handle-get-snapshot.ts
 *   - 输出槽放置协议：blue_whale_web/lib/conversation/scene-card-placement.ts
 *     （pendingOutputPlacements 见 blue_whale_web/lib/project-recovery.ts:182-221）
 *   - Canvas If-Match 版本协议：blue_whale_web/app/api/canvases/[projectId]/route.ts
 *   - SSE 断线续传做法：tests/typescript-baseline/snapshot-recovery-blackbox.test.mjs:529-570
 *   - factDigest 字段：同上 :388-419
 *
 * 前置条件：
 *   1. 仓库工作树干净，本地自足栈已起；web/worker 用当前 HEAD 注入构建身份：
 *      GIT_COMMIT="$(git rev-parse HEAD)" BUILD_TIME="$(date -u +%FT%TZ)" pnpm --filter @blue-whale/web dev
 *      （compose 项目 bw-ts-dev 先由 scripts/dev-stack.sh up 启动）；
 *   2. new-api 已配真实火山引擎渠道（图片 doubao-seedream-4-0-250828 /
 *      视频 doubao-seedance-2-0-260128，种子见 backend/prisma/schema/002_seed.sql）；
 *   3. 对象存储（TOS：VOLC_ACCESS_KEY_ID / VOLC_SECRET_ACCESS_KEY / VOLC_TOS_ENDPOINT /
 *      VOLC_TOS_BUCKET / VOLC_TOS_REGION）已配到 web 与 generation-worker 进程——
 *      未配置时生成结果会直引 provider 源 URL，对象存储断言会 FAIL（这正是要验的点）。
 *
 * 用法：
 *   # 另一个终端以前置条件中的 GIT_COMMIT/BUILD_TIME 命令启动 web/worker
 *   BW_ALLOW_BILLED_CANARY=1 node scripts/run-real-canary.mjs run
 *   node scripts/run-real-canary.mjs verify-recovery
 *
 *   run              完整 canary：前置检查 → 注册 → 建项目 → 真实图片/视频生成 →
 *                    对象存储断言 → Canvas 放置 → SSE 断线续传 → 写状态文件。
 *   verify-recovery  web/worker 重启之后执行：重新登录 → 重拉 Snapshot →
 *                    重算 factDigest 与状态文件深度比对。
 *
 * 计费知情闸：run 子命令真实调用上游计费模型，必须显式设置
 *   BW_ALLOW_BILLED_CANARY=1（沿用 BW_ALLOW_BILLED_MEDIA_PROBE 先例，
 *   见 scripts/run-ik50gb-c-testsite-probe.sh）。
 *
 * 地址配置（环境变量）：
 *   BW_CANARY_WEB_URL      默认 http://localhost:3000
 *   BW_CANARY_NEW_API_URL  默认 http://127.0.0.1:3001
 *
 * 状态文件（verify-recovery 依赖）：
 *   $HOME/.cache/blue-whale-real-canary/state.json        产品事实摘要（不含凭证）
 *   $HOME/.cache/blue-whale-real-canary/credentials.json  canary 账号凭证（0600）
 * 凭证（token / 密码）绝不写 state.json、绝不打印；stdout 证据块整体过 sanitize。
 */

import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ============================== 常量 ==============================

const DEFAULT_WEB_URL = "http://localhost:3000";
const DEFAULT_NEW_API_URL = "http://127.0.0.1:3001";

const IMAGE_MODEL_ID = "doubao-seedream-4-0-250828";
const VIDEO_MODEL_ID = "doubao-seedance-2-0-260128";

// 轮询：图片 ~5 分钟、视频 ~10 分钟封顶，间隔 4s（3-5s 区间内）。
const IMAGE_JOB_TIMEOUT_MS = 5 * 60_000;
const VIDEO_JOB_TIMEOUT_MS = 10 * 60_000;
const JOB_POLL_INTERVAL_MS = 4_000;

// SSE 收窗：最后一条帧后 idle 2s 收窗；全程 30s 封顶；一条都没有时 5s 即收。
const SSE_IDLE_MS = 2_000;
const SSE_DEADLINE_MS = 30_000;
const SSE_EMPTY_DEADLINE_MS = 5_000;

// 输出节点尺寸与前端放置协议一致（scene-card-placement.ts 尾部常量）。
const IMAGE_OUTPUT_SIZE = { width: 200, height: 112 };
const VIDEO_OUTPUT_SIZE = { width: 400, height: 225 };
const OUTPUT_GAP = 10;

const STATE_DIR = join(homedir(), ".cache", "blue-whale-real-canary");
const STATE_FILE = join(STATE_DIR, "state.json");
const CREDENTIALS_FILE = join(STATE_DIR, "credentials.json");

// 候选锚定：运行服务 /build-info 必须与脚本所在仓库的干净 HEAD 一致。
// dev 模式须在启动时显式注入 GIT_COMMIT；unknown 不构成候选身份。
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function repoState() {
  try {
    const head = execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const dirty =
      execFileSync("git", ["-C", REPO_ROOT, "status", "--porcelain"], {
        encoding: "utf8",
      }).trim() !== "";
    return { head, dirty };
  } catch {
    return { head: null, dirty: null };
  }
}

/** 候选身份问题列表：空数组表示运行服务与干净 checkout 精确一致。 */
export function candidateIdentityProblems(buildInfo, repo) {
  if (typeof repo?.head !== "string" || repo.head.length === 0) {
    return ["无法解析脚本所在仓库 HEAD"];
  }
  if (repo.dirty !== false) {
    return [`仓库工作树不是干净状态（dirty=${repo.dirty}）`];
  }
  const serviceCommit = buildInfo?.git_commit;
  if (
    typeof serviceCommit !== "string" ||
    serviceCommit.length === 0 ||
    serviceCommit === "unknown"
  ) {
    return ["运行服务 /build-info.git_commit 未提供真实 commit"];
  }
  if (serviceCommit !== repo.head) {
    return [
      `运行服务 commit=${serviceCommit} 与仓库 HEAD=${repo.head} 不一致`,
    ];
  }
  return [];
}

/** 证据中只要出现一项失败，最终结论就必须是 FAIL。 */
export function evidenceVerdict(items) {
  return items.every((item) => item?.ok === true) ? "PASS" : "FAIL";
}

// ============================== 脱敏（纯函数） ==============================
// 内联自 scripts/lib/sanitize-acceptance-logs.mjs:14-27，另补 sk- 直出、credential/cookie 键。

// JWT：三段 base64url，以 eyJ 开头。
const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
// Authorization: Bearer <token>
const BEARER_RE = /(bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
// new-api sk- 令牌直出形态。
const SK_TOKEN_RE = /sk-[A-Za-z0-9][A-Za-z0-9_-]{4,}/g;
// key=value / "key": "value" 形式的敏感键值（键名保留，值替换）。
const SECRET_KV_RE =
  /\b([A-Za-z0-9_]*(?:password|passwd|secret|token|access_?key|secret_?key|api_?key|credential|cookie)[A-Za-z0-9_]*)(\s*["']?\s*[:=]\s*["']?)([^\s,"'}\]]+)/gi;
// 堆栈帧行（异常诊断落盘前剥掉帧细节）。
const STACK_FRAME_RE = /^\s*at\s+[\w.$_]+\.[\w$<>]+\([^)]*\)\s*$/;

const REDACTED = "[REDACTED]";
const REDACTED_JWT = "[REDACTED_JWT]";

/** 证据文本脱敏：token/sk-/JWT/敏感键值/堆栈帧一律替换或剥除。 */
export function sanitizeEvidenceText(text) {
  let out = String(text);
  out = out.replace(JWT_RE, REDACTED_JWT);
  out = out.replace(BEARER_RE, `$1${REDACTED}`);
  out = out.replace(SK_TOKEN_RE, REDACTED);
  out = out.replace(SECRET_KV_RE, (_m, key, sep) => key + sep + REDACTED);
  const endsWithNewline = out.endsWith("\n");
  const lines = out.split("\n").filter((line) => !STACK_FRAME_RE.test(line));
  out = lines.join("\n");
  if (endsWithNewline && !out.endsWith("\n")) out += "\n";
  return out;
}

// ============================== factDigest（纯函数） ==============================
// 字段选取对齐 snapshot-recovery-blackbox.test.mjs:388-419：跨重启比较的最小稳定身份集合。

/** 产品事实摘要：跨重启比较的最小稳定身份集合（不含瞬时字段）。 */
export function computeFactDigest(snapshot) {
  const canvasNodes = snapshot?.canvas?.nodes
    ? JSON.parse(snapshot.canvas.nodes)
    : [];
  return {
    messages: (snapshot?.conversation_messages ?? [])
      .map((m) => `${m.message_id}:${m.role}:${m.sequence_no}`)
      .sort(),
    plans: (snapshot?.plan_messages ?? [])
      .map(
        (p) =>
          `${p.message_id}:${p.application_kind}:${p.applied_at ?? "unapplied"}`,
      )
      .sort(),
    receipts: (snapshot?.plan_applications ?? [])
      .map((r) => `${r.receipt_id}:${r.application_kind}:${r.command_id}`)
      .sort(),
    sceneCards: (snapshot?.scene_cards ?? [])
      .map((c) => `${c.scene_card_id}:${c.version}`)
      .sort(),
    records: (snapshot?.scene_card_generation_records ?? [])
      .map((r) => `${r.record_id}:${r.summary_status}`)
      .sort(),
    jobs: (snapshot?.generation_jobs ?? [])
      .map((j) => `${j.job_id}:${j.status}:${j.source}`)
      .sort(),
    assets: Object.keys(snapshot?.assets ?? {}).sort(),
    canvasNodeIds: canvasNodes.map((n) => String(n.id)).sort(),
    highWatermark: String(snapshot?.high_watermark_cursor ?? "0"),
  };
}

/** digest 深度比对：返回中文不一致项列表（空数组 = 一致）。 */
export function diffFactDigests(expected, actual) {
  const problems = [];
  const fields = [
    "messages",
    "plans",
    "receipts",
    "sceneCards",
    "records",
    "jobs",
    "assets",
    "canvasNodeIds",
    "highWatermark",
  ];
  for (const field of fields) {
    const before = expected?.[field];
    const after = actual?.[field];
    if (field === "highWatermark") {
      if (String(before) !== String(after)) {
        problems.push(
          `字段 highWatermark 不一致：期望 ${before}，实际 ${after}`,
        );
      }
      continue;
    }
    const beforeList = Array.isArray(before) ? before.map(String) : [];
    const afterList = Array.isArray(after) ? after.map(String) : [];
    const missing = beforeList.filter((item) => !afterList.includes(item));
    const extra = afterList.filter((item) => !beforeList.includes(item));
    if (missing.length > 0 || extra.length > 0) {
      const parts = [];
      if (missing.length > 0) parts.push(`缺失 [${missing.join(", ")}]`);
      if (extra.length > 0) parts.push(`多出 [${extra.join(", ")}]`);
      problems.push(`字段 ${field} 不一致：${parts.join("；")}`);
    }
  }
  return problems;
}

// ============================== SSE（纯函数） ==============================

/** SSE 窗口健康检查：schema 版本、项目归属、事件身份唯一、游标严格单调递增。
 *  返回问题列表（空数组 = 健康）。对齐 snapshot-recovery-blackbox.test.mjs:358-385。 */
export function checkSseWindowHealth(events, projectId) {
  const problems = [];
  const seenIds = new Set();
  let previousCursor = null;
  for (const envelope of events) {
    if (envelope?.schema_version !== 1) {
      problems.push(`事件 ${envelope?.event_id} schema_version 非 1`);
    }
    if (String(envelope?.project_id) !== String(projectId)) {
      problems.push(`事件 ${envelope?.event_id} 不属于项目 ${projectId}`);
    }
    const eventId = String(envelope?.event_id);
    if (seenIds.has(eventId)) {
      problems.push(`事件身份重复：${eventId}`);
    }
    seenIds.add(eventId);
    // 游标为雪花 ID（非连续）：只要求严格单调递增。
    const cursor = BigInt(envelope?.cursor ?? 0);
    if (previousCursor !== null && cursor <= previousCursor) {
      problems.push(`游标未严格递增（${previousCursor} → ${cursor}）`);
    }
    previousCursor = cursor;
  }
  return problems;
}

/** 断线前窗口 + 断点续传窗口合并：按 event_id 去重、排序后的身份列表。 */
export function mergeSseEventIds(...windows) {
  const ids = new Set();
  for (const window of windows) {
    for (const envelope of window ?? []) {
      ids.add(String(envelope?.event_id));
    }
  }
  return [...ids].sort();
}

// ============================== 对象存储身份（纯函数） ==============================

/** 对象存储身份判定：生成产物转存 TOS 后 URL 形态为
 *  https://{bucket}.{endpoint}/uploads/{userId}/{type}/{uuid}.{ext}
 *  （tos-storage.ts prepareUpload/inspectObject 的 publicUrl）。
 *  未配存储时 worker 直引 provider 源 URL（generation-worker.ts persistProviderMedia
 *  storage=null 分支），此时该断言必须 FAIL。
 *  返回 { ok, reason, safeUrl }；safeUrl 已剥 query，可进证据。 */
export function checkStorageIdentity(accessUrl, userId, type) {
  if (typeof accessUrl !== "string" || accessUrl === "") {
    return { ok: false, reason: "access_url 为空", safeUrl: "(empty)" };
  }
  let parsed;
  try {
    parsed = new URL(accessUrl);
  } catch {
    return {
      ok: false,
      reason: `access_url 非合法 URL：${accessUrl}`,
      safeUrl: "(invalid)",
    };
  }
  const safeUrl = `${parsed.origin}${parsed.pathname}`;
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      ok: false,
      reason: `access_url 协议异常：${parsed.protocol}`,
      safeUrl,
    };
  }
  // 对象存储两种 key Scheme：用户上传/图片转存走 uploads/（tos-storage.ts:160），
  // 视频媒体 relay 走 generated/（tos-video-media-relay.ts:96），均为合法对象存储身份。
  const prefixes = [`/uploads/${userId}/${type}/`, `/generated/${userId}/${type}/`];
  if (!prefixes.some((prefix) => parsed.pathname.startsWith(prefix))) {
    return {
      ok: false,
      reason: `access_url 路径未命中对象存储前缀 ${prefixes.join(" 或 ")}（疑似 provider 源 URL 直引）`,
      safeUrl,
    };
  }
  return { ok: true, reason: "", safeUrl };
}

// ============================== Canvas 放置（纯函数） ==============================

function outputNodeId(slotId, isStoryboardFrame) {
  return isStoryboardFrame
    ? `storyboard-frame:${slotId}`
    : `generation-output:${slotId}`;
}

function isWireInteger(value) {
  return (
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ||
    (typeof value === "string" && /^[0-9]+$/.test(value))
  );
}

/** 从 Snapshot 提取待放置输出槽：对齐 project-recovery.ts 的 pendingOutputPlacements
 *  （succeeded + initial_placement_status=pending + 有 asset_id）。 */
export function findPendingOutputPlacements(snapshot) {
  const pending = [];
  for (const job of snapshot?.generation_jobs ?? []) {
    if (job?.type !== "image" && job?.type !== "video") continue;
    const input =
      job.input && typeof job.input === "object" && !Array.isArray(job.input)
        ? job.input
        : {};
    const isStoryboardFrame = input.storyboard_preview === true;
    for (const slot of Array.isArray(job.output_slots)
      ? job.output_slots
      : []) {
      if (!slot || typeof slot !== "object") continue;
      if (
        slot.status !== "succeeded" ||
        slot.initial_placement_status !== "pending" ||
        !isWireInteger(slot.slot_id) ||
        !isWireInteger(slot.asset_id) ||
        typeof slot.slot_index !== "number"
      ) {
        continue;
      }
      pending.push({
        slot_id: String(slot.slot_id),
        generation_job_id: String(job.job_id),
        slot_index: slot.slot_index,
        asset_id: String(slot.asset_id),
        type: job.type,
        is_storyboard_frame: isStoryboardFrame,
        scene_card_id: isWireInteger(input.scene_card_id)
          ? String(input.scene_card_id)
          : null,
        placement_anchor: placementAnchor(input),
      });
    }
  }
  return pending;
}

function placementAnchor(input) {
  const anchor = input?.placement_anchor;
  if (!anchor || typeof anchor !== "object" || Array.isArray(anchor))
    return null;
  const { x, y, width, height } = anchor;
  return [x, y, width, height].every((v) => typeof v === "number")
    ? { x, y, width, height }
    : null;
}

function sceneCardIdOf(node) {
  if (node?.sceneCardId) return String(node.sceneCardId);
  if (node?.scene_card_id != null) return String(node.scene_card_id);
  const data = node?.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    if (data.sceneCardId != null) return String(data.sceneCardId);
  }
  return null;
}

/** 视口 {x,y,zoom} → 近似世界锚点（屏幕原点反投）；缺省 {0,0}。 */
export function viewportAnchorPoint(viewport) {
  if (!viewport) return { x: 0, y: 0 };
  try {
    const parsed = JSON.parse(viewport);
    const zoom =
      typeof parsed?.zoom === "number" && parsed.zoom > 0 ? parsed.zoom : 1;
    return {
      x: -(typeof parsed?.x === "number" ? parsed.x : 0) / zoom,
      y: -(typeof parsed?.y === "number" ? parsed.y : 0) / zoom,
    };
  } catch {
    return { x: 0, y: 0 };
  }
}

function rectsIntersect(a, b) {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function nodeRect(node) {
  return {
    x: node?.position?.x ?? 0,
    y: node?.position?.y ?? 0,
    width: node?.width ?? 200,
    height: node?.height ?? 200,
  };
}

/** 简易网格落位：从锚点起向右排，与既有节点重叠则换行下移。
 *  服务端不校验坐标（只按节点 id 回写 placed），该实现只需确定、不重叠。 */
function findFreePosition(occupied, anchor, dims) {
  let candidate = { x: anchor.x, y: anchor.y };
  const rowLimit = anchor.x + 4 * (dims.width + OUTPUT_GAP);
  for (let guard = 0; guard < 500; guard += 1) {
    if (!occupied.some((r) => rectsIntersect(r, { ...candidate, ...dims }))) {
      return candidate;
    }
    candidate = { x: candidate.x + dims.width + OUTPUT_GAP, y: candidate.y };
    if (candidate.x >= rowLimit) {
      candidate = { x: anchor.x, y: candidate.y + dims.height + OUTPUT_GAP };
    }
  }
  // canary 规模不会走到；兜底硬放锚点，宁可重叠也不失节点。
  return { x: anchor.x, y: anchor.y };
}

/** 构造输出 Canvas 节点：节点 id 形如 generation-output:<slotId>
 *  （canvas-repo.ts 据此正则回写 initial_placement_status=placed）。 */
export function buildOutputCanvasNode(output, position) {
  const dims = output.type === "video" ? VIDEO_OUTPUT_SIZE : IMAGE_OUTPUT_SIZE;
  return {
    id: outputNodeId(output.slot_id, output.is_storyboard_frame === true),
    type: output.type,
    assetId: String(output.asset_id),
    taskId: String(output.generation_job_id),
    slotIndex: output.slot_index,
    ...(output.is_storyboard_frame === true ? { storyboardFrame: true } : {}),
    ...(output.scene_card_id ? { sceneCardId: output.scene_card_id } : {}),
    position,
    width: dims.width,
    height: dims.height,
    status: "placed",
  };
}

/** 规划待追加节点：幂等（已有同 id 节点跳过）；
 *  有 SceneCard 时挂卡下方，否则按视口/声明锚点走网格。 */
export function planOutputCanvasNodes(existingNodes, pendingOutputs, viewport) {
  const nodes = Array.isArray(existingNodes) ? existingNodes : [];
  const occupied = nodes.map(nodeRect);
  const additions = [];
  for (const output of pendingOutputs) {
    const nodeId = outputNodeId(
      output.slot_id,
      output.is_storyboard_frame === true,
    );
    if (
      nodes.some((n) => n?.id === nodeId) ||
      additions.some((n) => n.id === nodeId)
    ) {
      continue;
    }
    const dims =
      output.type === "video" ? VIDEO_OUTPUT_SIZE : IMAGE_OUTPUT_SIZE;
    let base = null;
    if (output.scene_card_id) {
      const card = [...nodes, ...additions].find(
        (n) =>
          n?.type === "scene_card" && sceneCardIdOf(n) === output.scene_card_id,
      );
      if (card) {
        const rect = nodeRect(card);
        base = { x: rect.x, y: rect.y + rect.height + OUTPUT_GAP };
      }
    }
    if (!base && output.placement_anchor) {
      base = {
        x: output.placement_anchor.x,
        y:
          output.placement_anchor.y +
          output.placement_anchor.height +
          OUTPUT_GAP,
      };
    }
    if (!base) base = viewportAnchorPoint(viewport);
    const position = findFreePosition(occupied, base, dims);
    const node = buildOutputCanvasNode(output, position);
    additions.push(node);
    occupied.push(nodeRect(node));
  }
  return additions;
}

// ============================== HTTP 层 ==============================

const WEB_URL = (process.env.BW_CANARY_WEB_URL ?? DEFAULT_WEB_URL).replace(
  /\/$/,
  "",
);
const NEW_API_URL = (
  process.env.BW_CANARY_NEW_API_URL ?? DEFAULT_NEW_API_URL
).replace(/\/$/, "");

async function requestJson(path, init = {}) {
  let response;
  try {
    response = await fetch(`${WEB_URL}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new Error(`请求失败或超时：${path}`, { cause: error });
  }
  const body = await response.json().catch(() => null);
  return { response, body };
}

function postJson(path, body, token, idempotencyKey) {
  return requestJson(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
}

function authGet(path, token) {
  return requestJson(path, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function login(username, password) {
  const result = await postJson("/api/auth/login", { username, password });
  if (result.response.status !== 200 || result.body?.code !== 200) {
    throw new Error(`登录失败：HTTP ${result.response.status}`);
  }
  const token = result.body?.data?.access_token;
  if (typeof token !== "string" || !token.startsWith("sk-")) {
    throw new Error("登录响应缺少 sk- access_token");
  }
  return token;
}

async function fetchSnapshot(projectId, token) {
  const result = await authGet(`/api/projects/${projectId}/snapshot`, token);
  if (result.body?.code !== 200 || !result.body?.data) {
    throw new Error(`Snapshot 读取失败：code=${result.body?.code}`);
  }
  return result.body.data;
}

/** 收集 Project SSE 事件窗口：从 after 游标起读到 idleMs 内无新帧为止。
 *  对齐 snapshot-recovery-blackbox.test.mjs:306-356 的 readSseWindow。 */
async function readSseWindow(
  projectId,
  token,
  after,
  { idleMs = SSE_IDLE_MS, deadlineMs = SSE_DEADLINE_MS } = {},
) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), deadlineMs);
  const startedAt = Date.now();
  const events = [];
  try {
    const response = await fetch(
      `${WEB_URL}/api/projects/${projectId}/events?after=${after}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      },
    );
    if (response.status !== 200 || !response.body) {
      throw new Error(`SSE 流建立失败：HTTP ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let lastFrameAt = Date.now();
    try {
      while (true) {
        const idleFor = Date.now() - lastFrameAt;
        if (events.length > 0 && idleFor > idleMs) break;
        if (
          events.length === 0 &&
          Date.now() - startedAt > SSE_EMPTY_DEADLINE_MS
        ) {
          break;
        }
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

// ============================== 证据块 ==============================

const evidence = [];

function record(ok, label, detail = "") {
  evidence.push({ ok, label, detail });
  const line = `${ok ? "PASS" : "FAIL"}  ${label}${detail ? `：${detail}` : ""}`;
  process.stdout.write(`${sanitizeEvidenceText(line)}\n`);
}

/** 断言失败：记 FAIL、打印汇总证据块、非零退出。 */
function abort(step, expected, actual) {
  record(false, step, `期望 ${expected}，实际 ${actual}`);
  printEvidenceSummary();
  process.exit(1);
}

function printEvidenceSummary() {
  const passed = evidence.filter((e) => e.ok).length;
  const failed = evidence.length - passed;
  const block = [
    "-------------------- T18 真实 Canary 证据汇总（已脱敏） --------------------",
    ...evidence.map(
      (e) =>
        `${e.ok ? "PASS" : "FAIL"}  ${e.label}${e.detail ? `：${e.detail}` : ""}`,
    ),
    `TOTAL: ${passed} PASS / ${failed} FAIL`,
    `VERDICT: ${evidenceVerdict(evidence)}`,
    "--------------------------------------------------------------------------",
  ].join("\n");
  process.stdout.write(`${sanitizeEvidenceText(block)}\n`);
}

// ============================== 小工具 ==============================

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** yyyymmddhhmmss 本地时间戳（canary 用户名/项目名用）。 */
export function canaryTimestamp(date = new Date()) {
  return (
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}` +
    `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureStateDir() {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
}

function writeCredentials(username, password) {
  ensureStateDir();
  writeFileSync(CREDENTIALS_FILE, JSON.stringify({ username, password }), {
    mode: 0o600,
  });
  chmodSync(CREDENTIALS_FILE, 0o600);
}

function writeState(state) {
  ensureStateDir();
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function readJsonFile(path, label) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`${label}不存在：${path}（请先执行 run 子命令）`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label}不是合法 JSON：${path}`);
  }
}

// ============================== canary 步骤 ==============================

async function preflight() {
  // web 健康：/build-info 200 且含 git_commit 字段。
  let buildInfo;
  try {
    const response = await fetch(`${WEB_URL}/build-info`, {
      signal: AbortSignal.timeout(10_000),
    });
    buildInfo = await response.json().catch(() => null);
    if (response.status !== 200) {
      abort(
        "前置检查 web /build-info",
        "HTTP 200",
        `HTTP ${response.status}（web 未起？先 scripts/dev-stack.sh up + pnpm dev）`,
      );
    }
  } catch (error) {
    abort("前置检查 web /build-info", "可连接", `${error.message}`);
  }
  if (
    typeof buildInfo?.git_commit !== "string" ||
    buildInfo.git_commit === ""
  ) {
    abort(
      "前置检查 web /build-info",
      "响应含 git_commit 字段",
      JSON.stringify(buildInfo),
    );
  }
  record(
    true,
    "前置检查 web /build-info",
    `git_commit=${buildInfo.git_commit}`,
  );

  // new-api 健康：/api/status 返回成功（{success:true,...}）。
  let status;
  try {
    const response = await fetch(`${NEW_API_URL}/api/status`, {
      signal: AbortSignal.timeout(10_000),
    });
    status = await response.json().catch(() => null);
    if (response.status !== 200 || status?.success !== true) {
      abort(
        "前置检查 new-api /api/status",
        "HTTP 200 且 success=true",
        `HTTP ${response.status} body=${JSON.stringify(status)?.slice(0, 200)}`,
      );
    }
  } catch (error) {
    abort("前置检查 new-api /api/status", "可连接", `${error.message}`);
  }
  record(true, "前置检查 new-api /api/status", "success=true");
  return buildInfo;
}

async function registerCanaryUser(timestamp) {
  // new-api 用户名上限 20 字符（超限 BFF 502）：t18- 前缀 + 时间戳后 10 位（DDHHMMSSss）。
  const username = `t18-${timestamp.slice(4)}`;
  // 复杂度对齐 smoke 测试口令形态：大小写 + 数字 + 特殊字符，12 位随机数字。
  let digits = "";
  for (let i = 0; i < 12; i += 1) digits += String(randomInt(0, 10));
  const password = `Ac${digits}!xY9`;

  const registered = await postJson("/api/auth/register", {
    username,
    password,
  });
  if (registered.response.status !== 200 || registered.body?.code !== 200) {
    abort(
      "注册 canary 用户",
      "HTTP 200 且 code=200",
      `HTTP ${registered.response.status} code=${registered.body?.code}`,
    );
  }
  const token = registered.body?.data?.access_token;
  const userId = registered.body?.data?.user_id;
  if (typeof token !== "string" || !token.startsWith("sk-")) {
    abort("注册 canary 用户", "响应含 sk- access_token", "缺失");
  }
  // 凭证只落 credentials.json（0600），证据里只出现用户名与数字 user_id。
  writeCredentials(username, password);
  record(true, "注册 canary 用户", `username=${username} user_id=${userId}`);
  return { username, password, token, userId: String(userId) };
}

async function readQuota(token) {
  const result = await authGet("/api/usage/token", token);
  if (result.response.status !== 200 || result.body?.code !== 200) {
    abort("读取 quota", "HTTP 200 且 code=200", `code=${result.body?.code}`);
  }
  const quota = result.body?.data?.quota;
  if (typeof quota !== "number" || !Number.isFinite(quota)) {
    abort("读取 quota", "data.quota 为数字", JSON.stringify(result.body?.data));
  }
  return quota;
}

async function createCanaryProject(timestamp, token) {
  const name = `T18-REAL-CANARY-${timestamp}`;
  const created = await postJson("/api/projects", { name }, token);
  if (created.response.status !== 200 || created.body?.code !== 200) {
    abort(
      "创建项目",
      "HTTP 200 且 code=200",
      `HTTP ${created.response.status} code=${created.body?.code}`,
    );
  }
  const projectId = String(created.body?.data?.id);
  if (!/^[1-9][0-9]*$/.test(projectId)) {
    abort("创建项目", "数字项目 id", JSON.stringify(created.body?.data));
  }
  record(true, "创建项目", `name=${name} id=${projectId}`);
  return { projectId, projectName: name };
}

async function createGenerationJob(projectId, token, type, timestamp) {
  const parameters =
    type === "image"
      ? {
          prompt: "纯白背景中央一个蓝色圆点，极简",
          model_id: IMAGE_MODEL_ID,
          aspect_ratio: "1:1",
          size: "1K",
        }
      : {
          prompt: "蓝色圆点缓慢放大",
          model_id: VIDEO_MODEL_ID,
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
        };
  const created = await postJson(
    `/api/projects/${projectId}/generation-jobs`,
    {
      type,
      input_asset_ids: [],
      expected_output_count: 1,
      parameters,
    },
    token,
    `canary-t18-${type}-${timestamp}`,
  );
  const modelId = type === "image" ? IMAGE_MODEL_ID : VIDEO_MODEL_ID;
  if (created.response.status !== 200 || created.body?.code !== 200) {
    abort(
      `创建${type === "image" ? "图片" : "视频"} canary 任务`,
      "HTTP 200 且 code=200",
      `HTTP ${created.response.status} code=${created.body?.code} msg=${created.body?.msg ?? ""}`,
    );
  }
  const jobId = String(created.body?.data?.generation_job_id);
  if (!/^[1-9][0-9]*$/.test(jobId)) {
    abort(
      `创建${type === "image" ? "图片" : "视频"} canary 任务`,
      "数字 generation_job_id",
      JSON.stringify(created.body?.data),
    );
  }
  record(
    true,
    `创建${type === "image" ? "图片" : "视频"} canary 任务`,
    `job_id=${jobId} model=${modelId}`,
  );
  return { jobId, modelId };
}

/** 轮询任务到终态：succeeded/failed(/cancelled)。打进度点，状态变化时打一行。 */
async function waitJobTerminal(projectId, token, jobId, type, timeoutMs) {
  const label = type === "image" ? "图片" : "视频";
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "";
  while (Date.now() < deadline) {
    const result = await authGet(`/api/jobs?ids=${jobId}`, token);
    if (result.body?.code !== 200) {
      abort(`轮询${label}任务`, "code=200", `code=${result.body?.code}`);
    }
    const job = (result.body?.data?.records ?? []).find(
      (item) => String(item?.job_id) === String(jobId),
    );
    if (job) {
      if (job.status !== lastStatus) {
        process.stdout.write(
          sanitizeEvidenceText(
            `\n[${label} job=${jobId}] ${lastStatus || "(created)"} → ${job.status} progress=${job.progress}\n`,
          ),
        );
        lastStatus = job.status;
      } else {
        process.stdout.write(".");
      }
      if (
        ["succeeded", "failed", "cancelled", "canceled"].includes(job.status)
      ) {
        process.stdout.write("\n");
        if (job.status !== "succeeded") {
          abort(
            `${label} canary 终态`,
            "succeeded",
            `${job.status} error=${JSON.stringify(job.error)}`,
          );
        }
        record(
          true,
          `${label} canary 终态`,
          `job_id=${jobId} status=succeeded progress=${job.progress}`,
        );
        return job;
      }
    }
    await delay(JOB_POLL_INTERVAL_MS);
  }
  abort(`${label} canary 终态`, `${timeoutMs / 1000}s 内进入终态`, "超时");
}

async function assertStorageIdentity(projectId, token, userId, jobs) {
  const snapshot = await fetchSnapshot(projectId, token);
  for (const { jobId, type } of jobs) {
    const label = type === "image" ? "图片" : "视频";
    const job = (snapshot.generation_jobs ?? []).find(
      (item) => String(item?.job_id) === String(jobId),
    );
    if (!job) {
      abort(`${label}对象存储断言`, "Snapshot 含该 job", "缺失");
    }
    const succeededSlot = (job.output_slots ?? []).find(
      (slot) => slot?.status === "succeeded" && slot.asset_id != null,
    );
    if (!succeededSlot) {
      abort(
        `${label}对象存储断言`,
        "成功输出槽绑定 Asset",
        JSON.stringify(job.output_slots),
      );
    }
    const assetId = String(succeededSlot.asset_id);
    const asset = snapshot.assets?.[assetId];
    if (!asset?.access_url) {
      abort(`${label}对象存储断言`, `assets[${assetId}] 含 access_url`, "缺失");
    }
    const check = checkStorageIdentity(asset.access_url, userId, type);
    if (!check.ok) {
      abort(
        `${label}对象存储断言`,
        "对象存储身份（storage key 路径）",
        check.reason,
      );
    }
    record(
      true,
      `${label}对象存储断言`,
      `asset_id=${assetId} slot_id=${succeededSlot.slot_id} url=${check.safeUrl}`,
    );
  }
  return snapshot;
}

async function placeOutputsOnCanvas(projectId, token, snapshot) {
  const pending = findPendingOutputPlacements(snapshot);
  if (pending.length === 0) {
    abort("Canvas 放置", "至少 1 个 pending 输出槽", "0");
  }
  // If-Match CAS：412 时重读快照重算，最多 3 次（对齐前端 recoverPlacements 循环）。
  let current = snapshot;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existingNodes = current.canvas?.nodes
      ? JSON.parse(current.canvas.nodes)
      : [];
    const additions = planOutputCanvasNodes(
      existingNodes,
      findPendingOutputPlacements(current),
      current.canvas?.viewport ?? null,
    );
    if (additions.length === 0) break;
    const version = current.canvas?.version ?? null;
    const put = await requestJson(`/api/canvases/${projectId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "If-Match": version === null ? '"missing"' : `"${version}"`,
      },
      body: JSON.stringify({
        viewport: current.canvas?.viewport ?? null,
        nodes: JSON.stringify([...existingNodes, ...additions]),
      }),
    });
    if (put.response.status === 412 || put.body?.code === 412) {
      current = await fetchSnapshot(projectId, token);
      continue;
    }
    if (put.response.status !== 200 || put.body?.code !== 200) {
      abort(
        "Canvas 放置",
        "HTTP 200 且 code=200",
        `HTTP ${put.response.status} code=${put.body?.code}`,
      );
    }
    break;
  }

  // 重拉快照断言：槽转 placed、节点存在且带对 assetId。
  const after = await fetchSnapshot(projectId, token);
  const afterNodes = after.canvas?.nodes ? JSON.parse(after.canvas.nodes) : [];
  for (const output of pending) {
    const nodeId = outputNodeId(
      output.slot_id,
      output.is_storyboard_frame === true,
    );
    const job = (after.generation_jobs ?? []).find(
      (item) => String(item?.job_id) === output.generation_job_id,
    );
    const slot = (job?.output_slots ?? []).find(
      (item) => String(item?.slot_id) === output.slot_id,
    );
    if (slot?.initial_placement_status !== "placed") {
      abort(
        "Canvas 放置",
        `槽 ${output.slot_id} initial_placement_status=placed`,
        slot?.initial_placement_status ?? "槽缺失",
      );
    }
    const node = afterNodes.find((item) => item?.id === nodeId);
    if (!node || String(node.assetId) !== output.asset_id) {
      abort(
        "Canvas 放置",
        `节点 ${nodeId} 存在且 assetId=${output.asset_id}`,
        JSON.stringify(node ?? null),
      );
    }
    record(
      true,
      "Canvas 放置",
      `节点 ${nodeId} placed（assetId=${output.asset_id}）`,
    );
  }
  return after;
}

async function verifySseResume(projectId, token, beforeWindow, breakCursor) {
  const resumed = await readSseWindow(projectId, token, breakCursor);
  if (resumed.length === 0) {
    abort("SSE 断线续传", "续传窗口含断线期间事件", "空窗口");
  }
  if (BigInt(resumed[0].cursor) <= BigInt(breakCursor)) {
    abort(
      "SSE 断线续传",
      `续传首条游标 > 断点 ${breakCursor}`,
      `${resumed[0].cursor}`,
    );
  }
  for (const [name, window] of [
    ["断点前", beforeWindow],
    ["续传", resumed],
  ]) {
    const problems = checkSseWindowHealth(window, projectId);
    if (problems.length > 0) {
      abort("SSE 断线续传", `${name}窗口健康`, problems.join("；"));
    }
  }
  // 无缺口无重复：断线前 + 续传两段的事件集合与全量回放完全一致。
  const fullReplay = await readSseWindow(projectId, token, 0);
  const fullIds = mergeSseEventIds(fullReplay);
  const joinedIds = mergeSseEventIds(beforeWindow, resumed);
  if (JSON.stringify(joinedIds) !== JSON.stringify(fullIds)) {
    const missing = fullIds.filter((id) => !joinedIds.includes(id));
    const extra = joinedIds.filter((id) => !fullIds.includes(id));
    abort(
      "SSE 断线续传",
      "断点前+续传 == 全量回放",
      `缺失 [${missing.join(", ")}] 多出 [${extra.join(", ")}]`,
    );
  }
  record(
    true,
    "SSE 断线续传",
    `断点前 ${beforeWindow.length} 条 + 续传 ${resumed.length} 条 == 全量 ${fullReplay.length} 条，无缺口无重复`,
  );
  return fullReplay;
}

// ============================== 子命令 ==============================

async function cmdRun() {
  if (process.env.BW_ALLOW_BILLED_CANARY !== "1") {
    process.stderr.write(
      [
        "拒绝执行：run 子命令会真实调用上游计费模型（火山引擎，经 new-api 扣 quota）。",
        "确认已获得授权后，显式设置 BW_ALLOW_BILLED_CANARY=1 重跑：",
        "  BW_ALLOW_BILLED_CANARY=1 node scripts/run-real-canary.mjs run",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  const timestamp = canaryTimestamp();
  const buildInfo = await preflight();
  const repo = repoState();
  const candidateProblems = candidateIdentityProblems(buildInfo, repo);
  if (candidateProblems.length > 0) {
    abort(
      "候选锚定",
      "运行服务 commit 等于干净仓库 HEAD",
      candidateProblems.join("；"),
    );
  }
  record(
    true,
    "候选锚定",
    `service commit=${buildInfo.git_commit} repo HEAD=${repo.head} dirty=false`,
  );
  const { username, password, token, userId } =
    await registerCanaryUser(timestamp);
  void password; // 已写入 credentials.json；此后只用 token。

  const quotaBefore = await readQuota(token);
  const { projectId, projectName } = await createCanaryProject(
    timestamp,
    token,
  );

  const image = await createGenerationJob(projectId, token, "image", timestamp);
  const video = await createGenerationJob(projectId, token, "video", timestamp);

  // SSE 断点前窗口：任务创建事件已同步落库，直接收窗；末条游标即断点。
  const beforeWindow = await readSseWindow(projectId, token, 0);
  if (beforeWindow.length === 0) {
    abort(
      "SSE 断点记录",
      "断点前窗口至少含 generation_job.created 事件",
      "空窗口",
    );
  }
  const breakCursor = beforeWindow.reduce(
    (max, e) => (BigInt(e.cursor) > max ? BigInt(e.cursor) : max),
    0n,
  );
  record(
    true,
    "SSE 断点记录",
    `断点前 ${beforeWindow.length} 条事件，断点游标 ${breakCursor}`,
  );

  await waitJobTerminal(
    projectId,
    token,
    image.jobId,
    "image",
    IMAGE_JOB_TIMEOUT_MS,
  );
  await waitJobTerminal(
    projectId,
    token,
    video.jobId,
    "video",
    VIDEO_JOB_TIMEOUT_MS,
  );

  // quota 差值（脱敏：只输出差值，不输出绝对余额）。
  const quotaAfter = await readQuota(token);
  if (quotaAfter > quotaBefore) {
    abort(
      "quota 差值",
      "canary 后 quota 不增",
      `before-after=${quotaBefore - quotaAfter}`,
    );
  }
  record(true, "quota 差值", `消耗 ${quotaBefore - quotaAfter}`);

  const snapshot = await assertStorageIdentity(projectId, token, userId, [
    { jobId: image.jobId, type: "image" },
    { jobId: video.jobId, type: "video" },
  ]);

  const placedSnapshot = await placeOutputsOnCanvas(projectId, token, snapshot);

  const fullReplay = await verifySseResume(
    projectId,
    token,
    beforeWindow,
    breakCursor,
  );

  // 事实摘要 + 状态文件（不含任何凭证）。
  const factDigest = computeFactDigest(placedSnapshot);
  writeState({
    version: 1,
    kind: "t18-real-canary",
    createdAt: new Date().toISOString(),
    webUrl: WEB_URL,
    newApiUrl: NEW_API_URL,
    gitCommit: buildInfo.git_commit,
    buildTime: buildInfo.build_time,
    repoHead: repo.head,
    repoDirty: repo.dirty,
    projectId,
    projectName,
    username,
    userId,
    jobs: {
      image: {
        jobId: image.jobId,
        modelId: image.modelId,
        status: "succeeded",
      },
      video: {
        jobId: video.jobId,
        modelId: video.modelId,
        status: "succeeded",
      },
    },
    quotaDelta: quotaBefore - quotaAfter,
    factDigest,
    sseFullEventIds: mergeSseEventIds(fullReplay),
  });
  record(
    true,
    "状态文件",
    `已写入 ${STATE_FILE}（凭证在 credentials.json，0600）`,
  );

  printEvidenceSummary();
}

async function cmdVerifyRecovery() {
  const state = readJsonFile(STATE_FILE, "状态文件");
  const credentials = readJsonFile(CREDENTIALS_FILE, "凭证文件");
  if (!state.projectId || !state.factDigest) {
    process.stderr.write("状态文件缺少 projectId/factDigest，无法验证恢复\n");
    process.exit(1);
  }
  const buildInfo = await preflight();
  const repo = repoState();
  const candidateProblems = candidateIdentityProblems(buildInfo, repo);
  if (candidateProblems.length > 0) {
    abort(
      "候选版本对照",
      "当前运行服务 commit 等于干净仓库 HEAD",
      candidateProblems.join("；"),
    );
  }
  const sameCandidate =
    state.repoHead === repo.head &&
    state.repoDirty === false &&
    state.gitCommit === state.repoHead;
  if (!sameCandidate) {
    abort(
      "候选版本对照",
      "run/recovery 使用同一干净 commit",
      `run service=${state.gitCommit} HEAD=${state.repoHead} dirty=${state.repoDirty}；当前 service=${buildInfo.git_commit} HEAD=${repo.head} dirty=${repo.dirty}`,
    );
  }
  record(
    true,
    "候选版本对照",
    `run/recovery service commit 与 repo HEAD 均为 ${repo.head}（dirty=false）`,
  );

  const token = await login(credentials.username, credentials.password).catch(
    (error) => {
      abort("恢复验证重新登录", "登录成功", error.message);
    },
  );
  record(true, "恢复验证重新登录", `username=${credentials.username}`);

  const snapshot = await fetchSnapshot(state.projectId, token);
  const actualDigest = computeFactDigest(snapshot);
  const problems = diffFactDigests(state.factDigest, actualDigest);
  if (problems.length > 0) {
    for (const problem of problems) {
      record(false, "恢复后事实摘要比对", problem);
    }
    printEvidenceSummary();
    process.exit(1);
  }
  const counts = Object.entries(state.factDigest)
    .map(([key, value]) =>
      Array.isArray(value) ? `${key}=${value.length}` : `${key}=${value}`,
    )
    .join(" ");
  record(true, "恢复后事实摘要比对", `与 run 时 digest 深度一致（${counts}）`);
  printEvidenceSummary();
}

// ============================== 入口 ==============================

async function main() {
  const command = process.argv[2];
  if (command === "run") {
    await cmdRun();
    return;
  }
  if (command === "verify-recovery") {
    await cmdVerifyRecovery();
    return;
  }
  process.stderr.write(
    [
      "用法：",
      "  BW_ALLOW_BILLED_CANARY=1 node scripts/run-real-canary.mjs run",
      "  node scripts/run-real-canary.mjs verify-recovery",
      "",
    ].join("\n"),
  );
  process.exit(2);
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    process.stderr.write(
      sanitizeEvidenceText(`canary 执行异常：${error?.message ?? error}\n`),
    );
    process.exit(1);
  });
}
