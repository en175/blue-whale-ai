import { createHash, createHmac } from "node:crypto";

export interface SignVolcengineRequestInput {
  method: string;
  body: string;
  date: Date;
  action: string;
  version: string;
  region: string;
  service: string;
  host: string;
  path: string;
  ak: string;
  sk: string;
}

export interface SignedRequest {
  xDate: string;
  contentHash: string;
  authorization: string;
}

const ALGORITHM = "HMAC-SHA256";

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function hmacSha256(key: Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function formatXDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

export function signVolcengineRequest(
  input: SignVolcengineRequestInput,
): SignedRequest {
  const { method, body, date, action, version, region, service, host, path, ak, sk } = input;

  const xDate = formatXDate(date);
  const shortDate = xDate.slice(0, 8);

  const contentHash = sha256Hex(body);
  const canonicalQuery = `Action=${action}&Version=${version}`;
  const signedHeaders = "content-type;host;x-content-sha256;x-date";
  const contentType = "application/json";
  const canonicalHeaders =
    [
      `content-type:${contentType}`,
      `host:${host}`,
      `x-content-sha256:${contentHash}`,
      `x-date:${xDate}`,
    ].join("\n") + "\n";
  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    contentHash,
  ].join("\n");

  const credentialScope = `${shortDate}/${region}/${service}/request`;
  const stringToSign = [
    ALGORITHM,
    xDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kSecret = Buffer.from(sk, "utf8");
  const kDate = hmacSha256(kSecret, shortDate);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const signingKey = hmacSha256(kService, "request");
  const signature = hmacSha256(signingKey, stringToSign).toString("hex");

  const authorization = `${ALGORITHM} Credential=${ak}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { xDate, contentHash, authorization };
}
