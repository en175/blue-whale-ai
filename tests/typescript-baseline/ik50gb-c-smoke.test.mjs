import assert from "node:assert/strict";
import { test } from "node:test";

const baseUrl = process.env.BW_ACCEPTANCE_WEB_URL ?? "http://127.0.0.1:3101";

async function requestJson(path, init = {}) {
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error(`request timed out or failed: ${path}`, { cause: error });
  }
  const body = await response.json();
  return { response, body };
}

async function postJson(path, body, token, extraHeaders = {}) {
  return requestJson(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

async function waitForTerminalJobs(ids, token) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const { response, body } = await requestJson(
      `/api/jobs?ids=${ids.join(",")}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    assert.equal(response.status, 200);
    const jobs = body.data?.records ?? [];
    if (
      Array.isArray(jobs) &&
      jobs.length === ids.length &&
      jobs.every((job) => ["succeeded", "failed"].includes(job.status))
    ) {
      return jobs;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("generation jobs did not reach terminal state");
}

test("真实 new-api 账户到产品和媒体生成链路不依赖 Java", async () => {
  const suffix = `${Date.now()}${process.pid}`;
  const username = `ik${suffix.slice(-10)}`;
  const password = `Ac${suffix.slice(-12)}!xY9`;

  const registration = await postJson("/api/auth/register", {
    username,
    password,
  });
  assert.equal(registration.response.status, 200);
  assert.equal(registration.body.code, 200);
  const token = registration.body.data?.access_token;
  assert.equal(typeof token, "string");
  assert.equal(token.startsWith("sk-"), true);

  const login = await postJson("/api/auth/login", { username, password });
  assert.equal(login.response.status, 200);
  assert.equal(login.body.code, 200);
  assert.equal(login.body.data?.user_id, registration.body.data?.user_id);

  const authenticated = {
    headers: { Authorization: `Bearer ${token}` },
  };
  const me = await requestJson("/api/me", authenticated);
  assert.equal(me.response.status, 200);
  assert.equal(me.body.data?.username, username);

  const quotaBefore = await requestJson("/api/usage/token", authenticated);
  assert.equal(quotaBefore.response.status, 200);
  assert.equal(typeof quotaBefore.body.data?.quota, "number");

  const project = await postJson(
    "/api/projects",
    { name: `IK50GB ${suffix}` },
    token,
  );
  assert.equal(project.response.status, 200);
  assert.equal(project.body.code, 200);
  const projectId = String(project.body.data?.id);
  assert.match(projectId, /^[1-9][0-9]*$/);

  const conversation = await postJson(
    `/api/projects/${projectId}/conversation/messages`,
    {
      client_message_id: `acceptance-${suffix}`,
      content: "生成一张蓝鲸海报",
    },
    token,
    { "Idempotency-Key": `conversation-${suffix}` },
  );
  assert.equal(conversation.response.status, 202);

  const image = await postJson(
    `/api/projects/${projectId}/generation-jobs`,
    {
      type: "image",
      input_asset_ids: [],
      expected_output_count: 1,
      parameters: {
        prompt: "一只蓝鲸游过深蓝色海洋",
        model_id: "doubao-seedream-4-0-250828",
        aspect_ratio: "1:1",
        size: "1K",
      },
    },
    token,
    { "Idempotency-Key": `image-${suffix}` },
  );
  assert.equal(image.response.status, 200);
  assert.equal(image.body.code, 200);

  const video = await postJson(
    `/api/projects/${projectId}/generation-jobs`,
    {
      type: "video",
      input_asset_ids: [],
      expected_output_count: 1,
      parameters: {
        prompt: "蓝鲸缓慢游过海底",
        model_id: "doubao-seedance-2-0-260128",
        aspect_ratio: "16:9",
        resolution: "720p",
        duration: 5,
      },
    },
    token,
    { "Idempotency-Key": `video-${suffix}` },
  );
  assert.equal(video.response.status, 200);
  assert.equal(video.body.code, 200);

  const jobIds = [
    String(image.body.data?.generation_job_id),
    String(video.body.data?.generation_job_id),
  ];
  const terminalJobs = await waitForTerminalJobs(jobIds, token);
  assert.deepEqual(
    terminalJobs.map((job) => job.status),
    ["succeeded", "succeeded"],
  );

  const quotaAfter = await requestJson("/api/usage/token", authenticated);
  assert.equal(quotaAfter.response.status, 200);
  assert.equal(
    quotaAfter.body.data.quota <= quotaBefore.body.data.quota,
    true,
  );
});
