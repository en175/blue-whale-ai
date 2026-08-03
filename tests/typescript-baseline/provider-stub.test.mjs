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
