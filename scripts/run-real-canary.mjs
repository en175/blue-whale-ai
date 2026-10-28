#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";


const DEFAULT_WEB_URL = "http://localhost:3000";
const DEFAULT_NEW_API_URL = "http://127.0.0.1:3001";

const IMAGE_MODEL_ID = "doubao-seedream-4-0-250828";
const VIDEO_MODEL_ID = "doubao-seedance-2-0-260128";

const IMAGE_JOB_TIMEOUT_MS = 5 * 60_000;
const VIDEO_JOB_TIMEOUT_MS = 10 * 60_000;
const JOB_POLL_INTERVAL_MS = 4_000;


const IMAGE_OUTPUT_SIZE = { width: 200, height: 112 };
const VIDEO_OUTPUT_SIZE = { width: 400, height: 225 };
const OUTPUT_GAP = 10;

const STATE_DIR = join(homedir(), ".cache", "blue-whale-real-canary");
const STATE_FILE = join(STATE_DIR, "state.json");
const CREDENTIALS_FILE = join(STATE_DIR, "credentials.json");

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

export function evidenceVerdict(items) {
  return items.every((item) => item?.ok === true) ? "PASS" : "FAIL";
}


const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const BEARER_RE = /(bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const SK_TOKEN_RE = /sk-[A-Za-z0-9][A-Za-z0-9_-]{4,}/g;
const SECRET_KV_RE =
  /\b([A-Za-z0-9_]*(?:password|passwd|secret|token|access_?key|secret_?key|api_?key|credential|cookie)[A-Za-z0-9_]*)(\s*["']?\s*[:=]\s*["']?)([^\s,"'}\]]+)/gi;
const STACK_FRAME_RE = /^\s*at\s+[\w.$_]+\.[\w$<>]+\([^)]*\)\s*$/;

const REDACTED = "[REDACTED]";
const REDACTED_JWT = "[REDACTED_JWT]";

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


export function computeFactDigest(snapshot) {
  const canvasNodes = snapshot?.canvas?.nodes
    ? JSON.parse(snapshot.canvas.nodes)
    : [];
  return {
    messages: (snapshot?.conversation_messages ?? [])
      .map((m) => `${m.message_id}:${m.role}:${m.sequence_no}`)
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
  };
}

export function diffFactDigests(expected, actual) {
  const problems = [];
  const fields = [
    "messages",
    "sceneCards",
    "records",
    "jobs",
    "assets",
    "canvasNodeIds",
  ];
  for (const field of fields) {
    const before = expected?.[field];
    const after = actual?.[field];
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
  return { x: anchor.x, y: anchor.y };
}

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

const evidence = [];

function record(ok, label, detail = "") {
  evidence.push({ ok, label, detail });
  const line = `${ok ? "PASS" : "FAIL"}  ${label}${detail ? `：${detail}` : ""}`;
  process.stdout.write(`${sanitizeEvidenceText(line)}\n`);
}

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


function pad2(n) {
  return String(n).padStart(2, "0");
}

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


async function preflight() {
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
  const username = `t18-${timestamp.slice(4)}`;
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
  void password;

  const quotaBefore = await readQuota(token);
  const { projectId, projectName } = await createCanaryProject(
    timestamp,
    token,
  );

  const image = await createGenerationJob(projectId, token, "image", timestamp);
  const video = await createGenerationJob(projectId, token, "video", timestamp);

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
