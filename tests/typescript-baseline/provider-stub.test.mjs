import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";

const port = 4329;
const baseUrl = `http://127.0.0.1:${port}`;

async function waitUntilReady() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // Process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("provider stub did not become ready");
}

test("provider stub covers image/video contracts without retaining credentials", async () => {
  const child = spawn(
    process.execPath,
    ["tests/typescript-baseline/provider-stub.mjs"],
    {
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  try {
    await waitUntilReady();
    const headers = {
      Authorization: "Bearer sk-acceptance-secret",
      "Content-Type": "application/json",
    };

    const image = await fetch(`${baseUrl}/v1/images/generations`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: "acceptance-image", prompt: "blue whale" }),
    });
    assert.equal(image.status, 200);
    assert.match((await image.json()).data[0].url, /generated-image/);

    const edit = await fetch(`${baseUrl}/v1/images/edits`, {
      method: "POST",
      headers: { Authorization: headers.Authorization },
      body: new FormData(),
    });
    assert.equal(edit.status, 200);

    const videoSubmit = await fetch(`${baseUrl}/v1/video/generations`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: "acceptance-video", prompt: "ocean" }),
    });
    assert.equal(videoSubmit.status, 200);
    const submitted = await videoSubmit.json();

    const videoPoll = await fetch(
      `${baseUrl}/v1/video/generations/${submitted.id}`,
      { headers: { Authorization: headers.Authorization } },
    );
    assert.equal(videoPoll.status, 200);
    const polled = await videoPoll.json();
    assert.equal(polled.code, "success");
    assert.equal(polled.data.status, "SUCCESS");
    assert.match(polled.data.result_url, /generated-video/);

    const ledger = await fetch(`${baseUrl}/__acceptance/requests`);
    const ledgerText = JSON.stringify(await ledger.json());
    assert.equal(ledgerText.includes("Bearer "), false);
    assert.equal(ledgerText.includes("sk-acceptance-secret"), false);
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
  }
});

test("provider stub scenario control plane injects deterministic outcomes", async () => {
  const scenarioPort = 4330;
  const scenarioBase = `http://127.0.0.1:${scenarioPort}`;
  const child = spawn(
    process.execPath,
    ["tests/typescript-baseline/provider-stub.mjs"],
    {
      env: { ...process.env, PORT: String(scenarioPort) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const setScenarios = (body) =>
    fetch(`${scenarioBase}/__acceptance/scenarios`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const postImage = () =>
    fetch(`${scenarioBase}/v1/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "acceptance-image", prompt: "x" }),
    });
  const pollVideo = () =>
    fetch(`${scenarioBase}/v1/video/generations/acceptance-video-task`);

  try {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${scenarioBase}/health`);
        if (response.ok) break;
      } catch {
        // Process may still be starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const invalid = await setScenarios({ image: { mode: "explode" } });
    assert.equal(invalid.status, 400);

    assert.equal((await setScenarios({ image: { mode: "fail" } })).status, 200);
    const failed = await postImage();
    assert.equal(failed.status, 402);
    assert.ok((await failed.json()).error.message.includes("acceptance"));

    await setScenarios({ image: { mode: "empty" } });
    const empty = await postImage();
    assert.equal(empty.status, 200);
    assert.deepEqual((await empty.json()).data, []);

    await setScenarios({ image: { mode: "fail", times: 1 } });
    assert.equal((await postImage()).status, 402);
    assert.equal((await postImage()).status, 200);

    const delayedStart = Date.now();
    await setScenarios({ image: { mode: "success", delayMs: 300 } });
    assert.equal((await postImage()).status, 200);
    assert.ok(Date.now() - delayedStart >= 300);

    await setScenarios({ videoPoll: { statuses: ["processing", "processing", "fail"] } });
    assert.equal((await (await pollVideo()).json()).data.status, "IN_PROGRESS");
    assert.equal((await (await pollVideo()).json()).data.status, "IN_PROGRESS");
    const failedPoll = await (await pollVideo()).json();
    assert.equal(failedPoll.data.status, "FAILURE");
    assert.equal(failedPoll.data.error, undefined);
    assert.equal((await (await pollVideo()).json()).data.status, "FAILURE");

    await setScenarios({ videoPoll: { statuses: ["processing"] } });
    const resetResponse = await fetch(`${scenarioBase}/__acceptance/scenarios`, {
      method: "DELETE",
    });
    assert.equal(resetResponse.status, 200);
    const afterReset = await (await pollVideo()).json();
    assert.equal(afterReset.data.status, "SUCCESS");
    assert.match(afterReset.data.result_url, /generated-video/);
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
  }
});
