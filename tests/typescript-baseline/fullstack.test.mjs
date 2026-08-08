import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const composeFile =
  process.env.BW_TS_COMPOSE_FILE ??
  "deploy/typescript-baseline/docker-compose.acceptance.yml";
const project =
  process.env.BW_TS_COMPOSE_PROJECT ?? "bw-ts-baseline-acceptance";

const endpoints = {
  web: "http://127.0.0.1:3101/build-info",
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

test("验收拓扑包含 Web、两个 Node worker、fresh MySQL 与 BullMQ Redis", () => {
  assert.deepEqual(compose("config", "--services").split("\n").sort(), [
    "agent-worker",
    "generation-worker",
    "mysql",
    "new-api",
    "provider-stub",
    "redis",
    "storage-stub",
    "web",
  ]);

  const serialized = JSON.stringify(
    JSON.parse(compose("config", "--format", "json")),
  );
  for (const forbidden of [
    "blue_whale_server",
    "blue-whale-gateway",
    "blue-whale-user",
    "blue-whale-product",
    "GATEWAY_URL",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
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
  assert.equal(generationWorker.environment.NODE_ENV, "test");
  assert.equal(
    generationWorker.environment.GENERATION_MEDIA_RELAY_MODE,
    "passthrough",
  );
  assert.ok(generationWorker.depends_on.redis);
  assert.equal(web.environment.REDIS_HOST, "redis");
  assert.ok(web.depends_on.redis);
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
    "admin_operation_logs",
    "agent_advances",
    "agent_provider_calls",
    "agent_provisional_chunks",
    "agent_provisional_deliveries",
    "agent_runs",
    "api_key",
    "api_key_usage",
    "assets",
    "canvas",
    "captcha_challenges",
    "command_idempotency",
    "conversation_message_mentions",
    "conversation_messages",
    "conversations",
    "cost_reservations",
    "creative_skill",
    "creative_skill_activation",
    "creative_skill_version",
    "generation_job_logs",
    "generation_jobs",
    "generation_model_capability",
    "generation_output_slots",
    "plan_application_receipts",
    "plan_messages",
    "project",
    "project_event_stream",
    "project_events",
    "run_commits",
    "scene_card_generation_presets",
    "scene_card_generation_records",
    "scene_cards",
    "skill",
    "skill_summarize_session",
    "storyboard_previews",
    "template_card",
    "template_card_image",
    "template_tag",
    "topup_tiers",
    "user_input_requests",
    "user_skill",
    "users",
    "verification_codes",
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
      "SELECT CONCAT(1, ':', (SELECT COUNT(*) FROM generation_model_capability WHERE enabled = 1))",
    ),
    "1:3",
  );

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
      "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'blue_whale' AND table_name = 'assets' AND column_name = 'duration_ms'",
    ),
    "1",
  );
});

test("Web 与两个 Node worker 就绪（业务 API 由 Web 承载，ADR-0059）", async () => {
  const agent = await readJson(endpoints["agent-worker"]);
  const generation = await readJson(endpoints["generation-worker"]);
  const web = await readJson(endpoints.web);

  assert.deepEqual(
    agent.dependencies.map(({ name }) => name),
    ["mysql", "fake-agent-runtime"],
  );
  assert.equal(generation.status, "ready");
  assert.equal(typeof web.git_commit, "string");
});

test("两个 Node worker 均可独立重启、停止并恢复", async () => {
  for (const service of ["agent-worker", "generation-worker"]) {
    compose("restart", service);
    await waitUntilReady(endpoints[service]);

    compose("stop", service);
    await assert.rejects(fetch(endpoints[service]));

    compose("start", service);
    await waitUntilReady(endpoints[service]);
  }
});
