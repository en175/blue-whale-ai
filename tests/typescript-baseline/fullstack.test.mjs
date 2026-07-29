import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const composeFile =
  process.env.BW_TS_COMPOSE_FILE ??
  "deploy/typescript-baseline/docker-compose.acceptance.yml";
const project = process.env.BW_TS_COMPOSE_PROJECT ?? "bw-ts-baseline-acceptance";

const endpoints = {
  web: "http://127.0.0.1:3101/build-info",
  "product-api": "http://127.0.0.1:4310/ready",
  "agent-worker": "http://127.0.0.1:4311/ready",
  "generation-worker": "http://127.0.0.1:4312/ready",
};

function compose(...args) {
  return execFileSync(
    "docker",
    ["compose", "-p", project, "-f", composeFile, ...args],
    { encoding: "utf8" },
  ).trim();
}

async function readJson(url) {
  const response = await fetch(url);
  assert.equal(response.status, 200, `${url} should return 200`);
  return response.json();
}

async function waitUntilReady(url) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      return await readJson(url);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`${url} did not become ready within 60 seconds`);
}

test("验收拓扑包含 Web、三个 Node 入口、fresh MySQL 与 BullMQ Redis", () => {
  assert.deepEqual(compose("config", "--services").split("\n").sort(), [
    "agent-worker",
    "generation-worker",
    "mysql",
    "product-api",
    "redis",
    "web",
  ]);
});

test("Web 与 BullMQ generation worker 由同一镜像启动为两个进程", () => {
  const config = JSON.parse(compose("config", "--format", "json"));
  const web = config.services.web;
  const generationWorker = config.services["generation-worker"];

  assert.equal(generationWorker.image, web.image);
  assert.deepEqual(generationWorker.command, [
    "pnpm",
    "--filter",
    "blue_whale",
    "start:worker",
  ]);
  assert.equal(generationWorker.environment.REDIS_HOST, "redis");
  assert.ok(generationWorker.depends_on.redis);
});

test("fresh MySQL 只包含新 baseline 表与最小 capability/provider 种子", () => {
  const tables = compose(
    "exec",
    "-T",
    "mysql",
    "mysql",
    "-uroot",
    "-pblue_whale",
    "-N",
    "-B",
    "blue_whale",
    "-e",
    "SHOW TABLES",
  )
    .split("\n")
    .filter(Boolean)
    .sort();

  assert.deepEqual(tables, [
    "agent_runs",
    "assets",
    "canvas_layouts",
    "command_receipts",
    "conversation_messages",
    "conversations",
    "generation_jobs",
    "generation_model_capabilities",
    "generation_output_slots",
    "generation_providers",
    "node_items",
    "project_events",
    "projects",
  ]);

  assert.equal(
    compose(
      "exec",
      "-T",
      "mysql",
      "mysql",
      "-uroot",
      "-pblue_whale",
      "-N",
      "-B",
      "blue_whale",
      "-e",
      "SELECT CONCAT((SELECT COUNT(*) FROM generation_providers), ':', (SELECT COUNT(*) FROM generation_model_capabilities))",
    ),
    "1:2",
  );
});

test("Web 与三个 Node 入口就绪", async () => {
  const product = await readJson(endpoints["product-api"]);
  const agent = await readJson(endpoints["agent-worker"]);
  const generation = await readJson(endpoints["generation-worker"]);
  const web = await readJson(endpoints.web);
  const proxiedProduct = await readJson("http://127.0.0.1:3101/api/ready");

  assert.equal(product.status, "ready");
  assert.deepEqual(
    product.dependencies.map(({ name }) => name),
    ["mysql"],
  );
  assert.deepEqual(
    agent.dependencies.map(({ name }) => name),
    ["mysql", "fake-agent-runtime"],
  );
  assert.equal(generation.status, "ready");
  assert.equal(proxiedProduct.service, "product-api");
  assert.equal(typeof web.git_commit, "string");
});

test("三个 Node 进程均可独立重启、停止并恢复", async () => {
  for (const service of ["product-api", "agent-worker", "generation-worker"]) {
    compose("restart", service);
    await waitUntilReady(endpoints[service]);

    compose("stop", service);
    await assert.rejects(fetch(endpoints[service]));

    compose("start", service);
    await waitUntilReady(endpoints[service]);
  }
});
