/**
 * 日志截断与脱敏（IKB29O 决策 D9）。
 *
 * 决策把这件事放在统一入口而不是各调用点：「不依赖调用方自觉」。每一个写日志的地方都是一个
 * 有人会忘的地方，而忘掉的代价在接入火山 TLS 之后变了——那个 topic 是全企业可检索的，
 * 而这条链上跑的正是用户创作正文和带签名的素材地址（签名就在 query 里）。
 *
 * 三条规则：按键名整段抹掉凭证；把字符串里**任何位置**的 URL 去掉 query 与 fragment；
 * 创作正文换成长度与摘要。其余一律截断并记下原长——被截掉的字段要说自己被截了，
 * 而不是看上去又完整又短。
 *
 * **它不等于日志可以公开。**它删掉的是决策点名的那几类，手写的 body 仍可以说任何话。
 * 这是地板，不是证明。与 blue-whale-agent 的 `src/observability/redact.ts` 是同一套规则，
 * 改一边就要改另一边。
 */
import { createHash } from "node:crypto";

/** 普通字段保留的最大长度。 */
export const MAX_FIELD_CHARS = 512;

/** body 的预算。比字段大，因为 body 是给人读的那句话。 */
export const MAX_BODY_CHARS = 4096;

/**
 * 值是凭证的键名。按**子串**、不分大小写匹配——它们以 `authorization`、`x_api_key`、
 * `serviceToken`、`refresh_token` 等各种形状出现。
 *
 * 故意不含 `key`：它和太多正常词撞（`idempotency_key`、`scope_key`、`cache_key`），
 * 会把人用来定位的标识抹掉。`apikey` / `api_key` / `access_key` / `secret_key` 覆盖真实情况。
 */
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

/**
 * 值是用户写的或模型写的正文的键名。
 *
 * 精确匹配而不是子串：`text` 不能连 `text_chars` 一起吃掉，`content` 不能吃掉 `content_type`。
 */
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

/** 一个字段值按三条规则处理后的样子。 */
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

/** body —— 同样的 URL 规则，自己的长度预算。 */
export function redactLogBody(body: string): string {
  return truncate(stripUrlQueries(body), MAX_BODY_CHARS);
}

/**
 * 去掉字符串里每个 URL 的 query 与 fragment。
 *
 * 不能只按「整串是不是一个 URL」判断：它们总是引在上游报错句子中间到达，不是单独一个值。
 * path 保留——那是素材的身份；`?` 与 `#` 之后才是预签名凭证。
 */
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

/** `chars=1832 sha256=8f14e45f` —— 够比对两轮是不是同一段输入，不够读回原文。 */
function summarize(text: string): string {
  if (!text) return "chars=0";
  return `chars=${text.length} sha256=${createHash("sha256").update(text).digest("hex").slice(0, 8)}`;
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…[+${text.length - limit} chars]`;
}
