import { createHash } from "node:crypto";

export const MAX_FIELD_CHARS = 512;

export const MAX_BODY_CHARS = 4096;

const SECRET_KEY_PATTERNS = [
  "password",
  "passwd",
  "secret",
  "token",
  "credential",
  "authorization",
  "apikey",
  "api_key",
  "access_key",
  "private_key",
  "signature",
  "session_key",
];

const CONTENT_KEYS = new Set([
  "text",
  "content",
  "prompt",
  "reply",
  "answer",
  "reasoning",
  "transcript",
  "message_text",
  "user_text",
  "assistant_text",
  "brief",
]);

const REDACTED = "[redacted]";

const URL_IN_TEXT = /\bhttps?:\/\/[^\s"'<>\\]+/gi;

export function redactLogValue(
  key: string,
  value: string | number,
): string | number {
  if (isSecretKey(key)) return REDACTED;
  if (typeof value === "number") return value;
  if (CONTENT_KEYS.has(key)) return summarize(value);
  return truncate(
    stripUrlQueries(value),
    key === "error_stack" ? MAX_BODY_CHARS : MAX_FIELD_CHARS,
  );
}

export function redactLogBody(body: string): string {
  return truncate(stripUrlQueries(body), MAX_BODY_CHARS);
}

export function stripUrlQueries(text: string): string {
  if (typeof text !== "string" || text.length === 0) return text;
  if (!text.includes("://")) return text;
  return text.replace(URL_IN_TEXT, (match) => {
    const cut = match.search(/[?#]/);
    return cut === -1 ? match : `${match.slice(0, cut)}?…`;
  });
}

function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
}

function summarize(text: string): string {
  if (!text) return "chars=0";
  return `chars=${text.length} sha256=${createHash("sha256").update(text).digest("hex").slice(0, 8)}`;
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…[+${text.length - limit} chars]`;
}
