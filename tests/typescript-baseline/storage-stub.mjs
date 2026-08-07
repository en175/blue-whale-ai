import { createHmac } from "node:crypto";
import { createServer } from "node:http";

// 确定性对象存储 stub（IK67GX T03）：替代验收拓扑中缺失的火山 TOS。
// 与 blue_whale_web/lib/assets/s3-compat-storage.ts 的轻量 HMAC 预签名方案对齐：
//   sig = HMAC-SHA256(secret, `${METHOD}\n${storageKey}\n${expires}`) hex
//   query: bw-auth=direct&bw-expires=<unix>&bw-signature=<hex>
// 场景注入（仿 provider-stub）：POST /__acceptance/scenarios {put:{mode:"fail",status,times}}
// 使前 N 次 PUT 按脚本失败后回落成功，用于上传失败/重试黑盒用例。

const port = Number(process.env.PORT ?? 4330);
const secret = process.env.ASSET_UPLOAD_SECRET ?? "acceptance-storage-secret";

const objects = new Map();
const requests = [];
let scenarios = {};

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

function normalizePutSlot(slot) {
  if (slot === undefined) return undefined;
  if (typeof slot !== "object" || slot === null) return null;
  const mode = slot.mode ?? "success";
  if (mode !== "success" && mode !== "fail") return null;
  const status = slot.status ?? (mode === "fail" ? 500 : 200);
  const delayMs = slot.delayMs ?? 0;
  const times = slot.times ?? 0;
  if (
    !Number.isInteger(status) ||
    status < 200 ||
    status > 599 ||
    !Number.isInteger(delayMs) ||
    delayMs < 0 ||
    !Number.isInteger(times) ||
    times < 0
  ) {
    return null;
  }
  return {
    mode,
    status,
    delayMs,
    // times=0 表示无限生效直到复位；>0 为倒计时次数（延迟与失败共享同一窗口）。
    remaining: times > 0 ? times : null,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function applyScenarios(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }
  const put = normalizePutSlot(input.put);
  if (input.put !== undefined && put === null) return false;
  scenarios = {};
  if (put && (put.mode === "fail" || put.delayMs > 0)) {
    scenarios.put = put;
  }
  return true;
}

// 返回本次 PUT 应遵循的脚本槽；倒计时耗尽或未配置时返回 null（回落默认成功）。
function consumePutSlot() {
  const slot = scenarios.put;
  if (!slot) return null;
  if (slot.remaining !== null) {
    if (slot.remaining <= 0) return null;
    slot.remaining -= 1;
  }
  return slot;
}

function storageKeyOf(pathname) {
  const match = /^\/objects\/(.+)$/.exec(pathname);
  if (!match) return null;
  return match[1].split("/").map(decodeURIComponent).join("/");
}

function expectedSignature(method, storageKey, expires) {
  return createHmac("sha256", secret)
    .update(`${method}\n${storageKey}\n${expires}`)
    .digest("hex");
}

// 验签失败返回错误码；通过返回 null。
function authorize(request, url, method, storageKey) {
  if (url.searchParams.get("bw-auth") !== "direct") return "missing_auth";
  const expires = Number(url.searchParams.get("bw-expires"));
  const signature = url.searchParams.get("bw-signature");
  if (!Number.isInteger(expires) || !signature) return "malformed";
  if (expires < Math.floor(Date.now() / 1000)) return "expired";
  if (signature !== expectedSignature(method, storageKey, expires)) {
    return "bad_signature";
  }
  return null;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  // 浏览器直传 PUT 带 Content-Type 触发 CORS 预检。
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, PUT",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Expose-Headers": "Content-Length, Content-Type",
    });
    return response.end();
  }

  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "Content-Length, Content-Type",
  };

  if (request.method === "GET" && url.pathname === "/health") {
    return sendJson(response, 200, { status: "ready" });
  }

  if (request.method === "GET" && url.pathname === "/__acceptance/requests") {
    return sendJson(response, 200, { requests });
  }

  if (url.pathname === "/__acceptance/scenarios") {
    if (request.method === "GET") {
      return sendJson(response, 200, { scenarios });
    }
    if (request.method === "DELETE") {
      scenarios = {};
      return sendJson(response, 200, { scenarios });
    }
    if (request.method === "POST") {
      const body = await readJson(request);
      if (!applyScenarios(body)) {
        return sendJson(response, 400, { error: "invalid_scenario_config" });
      }
      return sendJson(response, 200, { scenarios });
    }
  }

  const storageKey = storageKeyOf(url.pathname);
  if (!storageKey) return sendJson(response, 404, { error: "not_found" });

  requests.push({ method: request.method, storageKey });

  if (request.method === "PUT") {
    const denied = authorize(request, url, "PUT", storageKey);
    if (denied) return sendJson(response, 403, { error: denied });
    const slot = consumePutSlot();
    if (slot?.delayMs > 0) await sleep(slot.delayMs);
    if (slot?.mode === "fail") {
      // 失败注入：不接收 body 内容，直接按脚本状态返回。
      for await (const _chunk of request) {
        // drain
      }
      return sendJson(response, slot.status, {
        error: "acceptance_injected_put_failure",
      });
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    objects.set(storageKey, {
      bytes: Buffer.concat(chunks),
      contentType: request.headers["content-type"] ?? null,
    });
    response.writeHead(200, cors);
    return response.end();
  }

  if (request.method === "HEAD" || request.method === "GET") {
    const denied = authorize(request, url, request.method, storageKey);
    if (denied) {
      response.writeHead(403, cors);
      return response.end();
    }
    const object = objects.get(storageKey);
    if (!object) {
      response.writeHead(404, cors);
      return response.end();
    }
    response.writeHead(200, {
      ...cors,
      "Content-Length": String(object.bytes.byteLength),
      ...(object.contentType ? { "Content-Type": object.contentType } : {}),
    });
    if (request.method === "HEAD") return response.end();
    return response.end(object.bytes);
  }

  return sendJson(response, 405, { error: "method_not_allowed" });
});

server.listen(port, () => {
  console.log(`storage-stub listening on ${port}`);
});
