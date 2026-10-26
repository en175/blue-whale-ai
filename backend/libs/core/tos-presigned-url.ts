import { createHash, createHmac } from "node:crypto";

export interface TosPresignInput {
  endpoint: string;
  bucket: string;
  region: string;
  ak: string;
  sk: string;
  key: string;
  expiresInSeconds: number;
  now?: Date;
}

export interface TosPresignedUrl {
  url: string;
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

function formatXDate(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}` +
    `T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`
  );
}

function uriEncode(input: string, encodeSlash = true): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
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

  const canonicalUri = `/${key.split("/").map((seg) => uriEncode(seg, true)).join("/")}`;

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
