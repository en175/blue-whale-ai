#!/usr/bin/env node
/**
 * 验收失败取证日志脱敏器（IK1NS2 移植自同名 python3 版，IK67G2 Node 化）。
 *
 * 全栈验收失败时会采集 Compose 服务日志作为诊断证据。落盘前必须脱敏：
 * 不出现凭据、Token、原始敏感内容或内部异常细节（堆栈帧）；
 * 异常标题行与普通诊断行原样保留，保证仍能定位问题。
 *
 * 用法：
 *   docker compose ... logs --no-color <svc> | node scripts/lib/sanitize-acceptance-logs.mjs > <svc>.log
 */

// JWT：三段 base64url，以 eyJ 开头（JSON header {"alg"...} 的固定前缀）。
const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

// Authorization: Bearer <token>
const BEARER_RE = /(bearer\s+)[A-Za-z0-9._~+/=-]+/gi;

// key=value / "key": "value" 形式的敏感键值。键名保留以便定位，值替换。
// 键名允许大写/下划线前后缀（MYSQL_PASSWORD、JWT_SECRET、OPENAI_API_KEY 等）。
const SECRET_KV_RE =
  /\b([A-Za-z0-9_]*(?:password|passwd|secret|token|access_?key|secret_?key|api_?key)[A-Za-z0-9_]*)(\s*["']?\s*[:=]\s*["']?)([^\s,"'}\]]+)/gi;

// Java/Python 堆栈帧行（可带 docker compose 日志的「容器名 | 」前缀）。
const STACK_FRAME_RE = /^(?:\S+\s*\|\s*)?\s*at\s+[\w.$_]+\.[\w$<>]+\([^)]*\)\s*$/;
const FRAMES_OMITTED_RE =
  /^(?:\S+\s*\|\s*)?\s*\.\.\.\s+\d+\s+(?:more|common frames omitted)\s*$/;

const REDACTED = "[REDACTED]";
const REDACTED_JWT = "[REDACTED_JWT]";

export function sanitizeText(text) {
  text = text.replace(JWT_RE, REDACTED_JWT);
  text = text.replace(BEARER_RE, `$1${REDACTED}`);
  text = text.replace(SECRET_KV_RE, (_m, key, sep) => key + sep + REDACTED);
  const endsWithNewline = text.endsWith("\n");
  const lines = text.split("\n");
  const kept = lines.filter(
    (line) => !STACK_FRAME_RE.test(line) && !FRAMES_OMITTED_RE.test(line),
  );
  let result = kept.join("\n");
  if (endsWithNewline && !result.endsWith("\n")) result += "\n";
  return result;
}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
process.stdout.write(sanitizeText(Buffer.concat(chunks).toString("utf8")));
