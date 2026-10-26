#!/usr/bin/env node

const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

const BEARER_RE = /(bearer\s+)[A-Za-z0-9._~+/=-]+/gi;

const SECRET_KV_RE =
  /\b([A-Za-z0-9_]*(?:password|passwd|secret|token|access_?key|secret_?key|api_?key)[A-Za-z0-9_]*)(\s*["']?\s*[:=]\s*["']?)([^\s,"'}\]]+)/gi;

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
