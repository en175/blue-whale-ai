import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 4329);
const requests = [];

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

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/health") {
    return sendJson(response, 200, { status: "ready" });
  }

  if (
    request.method === "GET" &&
    url.pathname === "/__acceptance/requests"
  ) {
    return sendJson(response, 200, { requests });
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
    return sendJson(response, 200, {
      code: "success",
      message: "",
      data: {
        task_id: videoMatch[1],
        status: "SUCCESS",
        usage_completion_tokens: 100,
        usage_total_tokens: 100,
        usage_reported: true,
        result_url: "http://provider-stub/generated-video.mp4",
        quota: 100,
      },
    });
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
