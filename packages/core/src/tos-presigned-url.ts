import { createHash, createHmac } from "node:crypto";

/**
 * Volcengine TOS 预签名 GET URL（TOS4-HMAC-SHA256，query 签名）—— Node 端口。
 *
 * 对齐 Java TosGenerationStorage#sign → TOSV2.preSignedURL(GET, expires)。
 * Java 走官方 SDK；Node 端无 SDK，按 TOS SigV4 预签名规范手写。
 *
 * 复用与 volcengine-signer 相同的 SigV4 派生原语（shortDate/xDate/sha256/hmac），
 * 但规范请求拼装不同（query 签名、host 唯一签名头、空 payload 哈希），
 * 故独立成模块，不复用 volcengine-signer 的拼装逻辑。
 *
 * ⚠️ 算法按 TOS 公开 SigV4 预签名规范实现并配确定性回归测试（见 tos-presigned-url.test.ts），
 * 但本环境未对接真实 TOS 做端到端校验 —— 上线前需用真实 AK/SK + TOS 对一次签名可被接受。
 */
export interface TosPresignInput {
  /** TOS endpoint，如 tos-cn-beijing.volces.com（不含 bucket、不含 scheme）。 */
  endpoint: string;
  bucket: string;
  region: string;
  ak: string;
  sk: string;
  /** 对象 key（允许含 /）。 */
  key: string;
  /** 预签名有效期（秒）。 */
  expiresInSeconds: number;
  /** 签名时刻；不传取当前时间（生产用默认，测试注入固定值）。 */
  now?: Date;
}

export interface TosPresignedUrl {
  url: string;
  /** 过期时刻（= now + expiresInSeconds），对齐 Java clock.instant().plusSeconds(ttl)。 */
  expiresAt: Date;
}

const ALGORITHM = "TOS4-HMAC-SHA256";
const SERVICE = "tos";

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Java SimpleDateFormat("yyyyMMdd'T'HHmmss'Z'") in UTC 的等价实现。 */
function formatXDate(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}` +
    `T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`
  );
}

/** RFC 3986 URI 编码。encodeSlash=false 时保留 /（用于 canonical URI 的路径分段拼接）。 */
function uriEncode(input: string, encodeSlash = true): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (
      (code >= 0x30 && code <= 0x39) || // 0-9
      (code >= 0x41 && code <= 0x5a) || // A-Z
      (code >= 0x61 && code <= 0x7a) || // a-z
      ch === "-" ||
      ch === "_" ||
      ch === "." ||
      ch === "~"
    ) {
      out += ch;
    } else if (ch === "/" && !encodeSlash) {
      out += ch;
    } else {
      const buf = Buffer.from(ch, "utf8");
      for (const b of buf) out += `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

export function buildTosPresignedGetUrl(input: TosPresignInput): TosPresignedUrl {
  const { endpoint, bucket, region, ak, sk, key, expiresInSeconds } = input;
  const now = input.now ?? new Date();
  const host = `${bucket}.${endpoint}`;
  const xDate = formatXDate(now);
  const shortDate = xDate.slice(0, 8);
  const credential = `${ak}/${shortDate}/${region}/${SERVICE}/request`;

  // canonical URI：key 每段 URI 编码，保留 / 作路径分隔。
  const canonicalUri = `/${key.split("/").map((seg) => uriEncode(seg, true)).join("/")}`;

  // canonical query string：X-Tos-* 参数按键名升序，值全量 URI 编码（含 /）。
  // 键名已按字母序给出（Algorithm < Credential < Date < Expires < SignedHeaders）。
  const queryPairs: Array<[string, string]> = [
    ["X-Tos-Algorithm", ALGORITHM],
    ["X-Tos-Credential", credential],
    ["X-Tos-Date", xDate],
    ["X-Tos-Expires", String(expiresInSeconds)],
    ["X-Tos-SignedHeaders", "host"],
  ];
  const canonicalQuery = queryPairs
    .map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`)
    .join("&");

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = "host";
  const emptyPayloadHash = sha256Hex("");

  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    emptyPayloadHash,
  ].join("\n");

  const credentialScope = `${shortDate}/${region}/${SERVICE}/request`;
  const stringToSign = [
    ALGORITHM,
    xDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmacSha256(sk, shortDate);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, SERVICE);
  const kSigning = hmacSha256(kService, "request");
  const signature = hmacSha256(kSigning, stringToSign).toString("hex");

  const queryString = `${canonicalQuery}&X-Tos-Signature=${signature}`;
  const url = `https://${host}${canonicalUri}?${queryString}`;
  const expiresAt = new Date(now.getTime() + expiresInSeconds * 1000);
  return { url, expiresAt };
}
