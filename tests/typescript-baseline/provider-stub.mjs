import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 4329);
const requests = [];

// 场景脚本（IK67G2）：纯内存，进程重启即复位为默认成功。
// image/videoSubmit：{mode, status, delayMs, times}，times>0 时前 N 次按脚本执行后回落成功。
// videoPoll：{statuses:[processing|success|fail], delayMs}，按 task 消费，末项无限重复。
let scenarios = {};
const videoPollCursors = new Map();

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeOutcomeSlot(slot, modes) {
  if (slot === undefined) return undefined;
  if (typeof slot !== "object" || slot === null) return null;
  const mode = slot.mode ?? "success";
  if (!modes.includes(mode)) return null;
  const status = slot.status ?? (mode === "fail" ? 402 : 200);
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
    // 0 = 无限生效直到复位；>0 = 倒计时次数。
    remaining: times > 0 ? times : null,
  };
}

function normalizePollSlot(slot) {
  if (slot === undefined) return undefined;
  if (typeof slot !== "object" || slot === null) return null;
  const statuses = slot.statuses ?? ["success"];
  const delayMs = slot.delayMs ?? 0;
  if (
    !Array.isArray(statuses) ||
    statuses.length === 0 ||
    !statuses.every((item) =>
      ["processing", "success", "fail"].includes(item),
    ) ||
    !Number.isInteger(delayMs) ||
    delayMs < 0
  ) {
    return null;
  }
  return { statuses, delayMs };
}

function applyScenarios(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }
  const image = normalizeOutcomeSlot(input.image, ["success", "fail", "empty"]);
  const videoSubmit = normalizeOutcomeSlot(input.videoSubmit, [
    "success",
    "fail",
  ]);
  const videoPoll = normalizePollSlot(input.videoPoll);
  if (
    (input.image !== undefined && image === null) ||
    (input.videoSubmit !== undefined && videoSubmit === null) ||
    (input.videoPoll !== undefined && videoPoll === null)
  ) {
    return false;
  }
  scenarios = {};
  if (image) scenarios.image = image;
  if (videoSubmit) scenarios.videoSubmit = videoSubmit;
  if (videoPoll) scenarios.videoPoll = videoPoll;
  videoPollCursors.clear();
  return true;
}

function slotActive(slot) {
  return Boolean(slot) && (slot.mode !== "success" || slot.delayMs > 0);
}

// 返回 true 表示本次调用按脚本执行；倒计时耗尽或未配置时返回 false（回落默认成功）。
function consumeSlot(slot) {
  if (!slotActive(slot)) return false;
  if (slot.remaining !== null) {
    if (slot.remaining <= 0) return false;
    slot.remaining -= 1;
  }
  return true;
}

function injectedErrorBody(kind) {
  return {
    error: {
      message: `acceptance injected ${kind} failure`,
      type: "acceptance_error",
      code: "acceptance_injected",
    },
  };
}

function nextPollStatus(taskId) {
  const statuses = scenarios.videoPoll?.statuses ?? ["success"];
  const index = videoPollCursors.get(taskId) ?? 0;
  videoPollCursors.set(taskId, index + 1);
  return statuses[Math.min(index, statuses.length - 1)];
}

function videoPollBody(taskId, status) {
  if (status === "success") {
    return {
      code: "success",
      message: "",
      data: {
        task_id: taskId,
        status: "SUCCESS",
        usage_completion_tokens: 100,
        usage_total_tokens: 100,
        usage_reported: true,
        result_url: "http://provider-stub/generated-video.mp4",
        quota: 100,
      },
    };
  }
  if (status === "fail") {
    // 不带 error 字段：消费侧落稳定的 provider_failed 公开码。
    // FAILURE 是 new-api 任务状态枚举值（model.TaskStatusFailure），
    // 写成 FAILED 会被 new-api 内部轮询判为 unknown task status。
    return { code: "success", message: "", data: { task_id: taskId, status: "FAILURE" } };
  }
  return {
    code: "success",
    message: "",
    data: { task_id: taskId, status: "IN_PROGRESS" },
  };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/health") {
    return sendJson(response, 200, { status: "ready" });
  }

  if (url.pathname === "/__acceptance/requests") {
    if (request.method === "GET") {
      return sendJson(response, 200, { requests });
    }
    if (request.method === "DELETE") {
      requests.length = 0;
      return sendJson(response, 200, { requests });
    }
  }

  if (url.pathname === "/__acceptance/scenarios") {
    if (request.method === "GET") {
      return sendJson(response, 200, { scenarios });
    }
    if (request.method === "DELETE") {
      scenarios = {};
      videoPollCursors.clear();
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

  const videoMatch = url.pathname.match(
    /^\/v1\/video\/generations\/([^/]+)$/,
  );
  if (request.method === "GET" && videoMatch) {
    requests.push({
      method: request.method,
      pathname: url.pathname,
      model: null,
      authorized: Boolean(request.headers.authorization),
    });
    const pollSlot = scenarios.videoPoll;
    if (pollSlot?.delayMs > 0) await sleep(pollSlot.delayMs);
    return sendJson(
      response,
      200,
      videoPollBody(videoMatch[1], nextPollStatus(videoMatch[1])),
    );
  }

  if (
    request.method === "POST" &&
    ["/v1/images/generations", "/v1/images/edits"].includes(url.pathname)
  ) {
    const body = await readJson(request);
    requests.push({
      method: request.method,
      pathname: url.pathname,
      model: typeof body.model === "string" ? body.model : null,
      authorized: Boolean(request.headers.authorization),
    });
    const imageSlot = scenarios.image;
    if (consumeSlot(imageSlot)) {
      if (imageSlot.delayMs > 0) await sleep(imageSlot.delayMs);
      if (imageSlot.mode === "fail") {
        return sendJson(
          response,
          imageSlot.status,
          injectedErrorBody("image"),
        );
      }
      if (imageSlot.mode === "empty") {
        return sendJson(response, 200, { created: 1, data: [] });
      }
    }
    return sendJson(response, 200, {
      created: 1,
      data: [{ url: "http://provider-stub/generated-image.png" }],
    });
  }

  if (
    request.method === "POST" &&
    url.pathname === "/v1/video/generations"
  ) {
    const body = await readJson(request);
    requests.push({
      method: request.method,
      pathname: url.pathname,
      model: typeof body.model === "string" ? body.model : null,
      authorized: Boolean(request.headers.authorization),
    });
    const submitSlot = scenarios.videoSubmit;
    if (consumeSlot(submitSlot)) {
      if (submitSlot.delayMs > 0) await sleep(submitSlot.delayMs);
      if (submitSlot.mode === "fail") {
        return sendJson(
          response,
          submitSlot.status,
          injectedErrorBody("video submit"),
        );
      }
    }
    return sendJson(response, 200, {
      id: "acceptance-video-task",
      task_id: "acceptance-video-task",
      status: "queued",
    });
  }

  return sendJson(response, 404, { error: "not_found" });
});

server.listen(port, "0.0.0.0");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
