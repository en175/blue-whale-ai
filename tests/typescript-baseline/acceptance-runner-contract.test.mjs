import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runner = path.join(root, "scripts/run-typescript-baseline-acceptance.sh");
const fixtures = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => rm(fixture, { force: true, recursive: true })));
});

async function writeExecutable(file, contents) {
  await writeFile(file, contents);
  await chmod(file, 0o755);
}

async function createHarness() {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "bw-acceptance-runner-"));
  fixtures.push(fixture);
  const home = path.join(fixture, "home");
  const bin = path.join(fixture, "bin");
  const commandLog = path.join(fixture, "commands.log");
  await mkdir(home, { recursive: true });
  await mkdir(bin, { recursive: true });

  await writeExecutable(
    path.join(bin, "pnpm"),
    `#!/usr/bin/env bash
set -eu
if [ -n "\${BW_TEST_READY_FILE:-}" ]; then
  : > "\$BW_TEST_READY_FILE"
fi
while [ -n "\${BW_TEST_BLOCK_FILE:-}" ] && [ ! -f "\$BW_TEST_BLOCK_FILE" ]; do
  /bin/sleep 0.05
done
exit 0
`,
  );
  await writeExecutable(
    path.join(bin, "git"),
    `#!/usr/bin/env bash
set -eu
printf 'git' >> "\$BW_TEST_COMMAND_LOG"
printf ' %s' "\$@" >> "\$BW_TEST_COMMAND_LOG"
printf '\n' >> "\$BW_TEST_COMMAND_LOG"
repo=''
if [ "\${1:-}" = '-C' ]; then
  repo="\$2"
  shift 2
fi
if [ "\${1:-}" = 'fetch' ] && [ -n "\${BW_TEST_GIT_READY_FILE:-}" ]; then
  : > "\$BW_TEST_GIT_READY_FILE"
  while [ ! -f "\$BW_TEST_GIT_BLOCK_FILE" ]; do
    /bin/sleep 0.05
  done
fi
case "\${1:-}" in
  rev-parse)
    if [ "\${2:-}" = '--short' ]; then
      printf 'fixture-head\n'
    else
      printf '90f1d49992bf22938bfb19352740891a28ecad67\n'
    fi
    ;;
  init)
    mkdir -p "\$repo/.git"
    ;;
  clone)
    eval "target=\${\$#}"
    mkdir -p "\$target/.git"
    ;;
esac
`,
  );
  await writeExecutable(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
set -eu
printf 'docker' >> "\$BW_TEST_COMMAND_LOG"
printf ' %s' "\$@" >> "\$BW_TEST_COMMAND_LOG"
printf '\n' >> "\$BW_TEST_COMMAND_LOG"
exit 1
`,
  );

  return {
    fixture,
    home,
    bin,
    commandLog,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
      BW_TEST_COMMAND_LOG: commandLog,
    },
  };
}

function startScript(script, env) {
  const child = spawn("bash", [script], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  return {
    child,
    done: new Promise((resolve) => {
      child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    }),
  };
}

function startAcceptance(env) {
  return startScript(runner, env);
}

async function runAcceptance(env) {
  return startAcceptance(env).done;
}

async function runScript(script, env) {
  return startScript(script, env).done;
}

async function waitForFile(file) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await readFile(file);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`timed out waiting for ${file}`);
}

test("只复用 HOME 内的可执行普通文件", async (t) => {
  for (const fixtureCase of ["directory", "outside-home", "symlink-outside"]) {
    await t.test(fixtureCase, async () => {
      const harness = await createHarness();
      const candidate =
        fixtureCase === "directory"
          ? path.join(harness.home, "candidate-directory")
          : fixtureCase === "symlink-outside"
            ? path.join(harness.home, "linked-new-api")
          : path.join(harness.fixture, "outside-new-api");
      if (fixtureCase === "directory") {
        await mkdir(candidate);
      } else if (fixtureCase === "symlink-outside") {
        const outside = path.join(harness.fixture, "outside-new-api");
        await writeExecutable(outside, "#!/usr/bin/env sh\nexit 0\n");
        await symlink(outside, candidate);
      } else {
        await writeExecutable(candidate, "#!/usr/bin/env sh\nexit 0\n");
      }

      const result = await runAcceptance({
        ...harness.env,
        BW_NEW_API_BINARY: candidate,
      });

      assert.doesNotMatch(result.stdout, /复用预置 new-api 二进制/);
      assert.match(await readFile(harness.commandLog, "utf8"), /git .*blue-whale-api/);
    });
  }
});

test("HOME 内的可执行普通文件会跳过源码获取", async () => {
  const harness = await createHarness();
  const candidate = path.join(harness.home, "new-api");
  await writeExecutable(candidate, "#!/usr/bin/env sh\nexit 0\n");

  const result = await runAcceptance({
    ...harness.env,
    BW_NEW_API_BINARY: candidate,
  });

  assert.match(result.stdout, /复用预置 new-api 二进制/);
  assert.doesNotMatch(await readFile(harness.commandLog, "utf8"), /git .*blue-whale-api/);
});

test("同一用户不能同时启动两次基线验收", async () => {
  const harness = await createHarness();
  const candidate = path.join(harness.home, "new-api");
  const readyFile = path.join(harness.fixture, "first-ready");
  const blockFile = path.join(harness.fixture, "release-first");
  await writeExecutable(candidate, "#!/usr/bin/env sh\nexit 0\n");

  const first = startAcceptance({
    ...harness.env,
    BW_NEW_API_BINARY: candidate,
    BW_TEST_READY_FILE: readyFile,
    BW_TEST_BLOCK_FILE: blockFile,
  });
  try {
    await waitForFile(readyFile);
    const second = await runAcceptance({
      ...harness.env,
      BW_NEW_API_BINARY: candidate,
    });
    assert.notEqual(second.code, 0);
    assert.match(second.stderr, /已有 TypeScript 基线验收正在运行/);
  } finally {
    await writeFile(blockFile, "release\n");
    await first.done;
  }
});

test("验收锁尚未写入持有者信息时不能被第二进程抢占", async () => {
  const harness = await createHarness();
  const candidate = path.join(harness.home, "new-api");
  const lock = path.join(
    harness.home,
    ".cache/blue-whale-typescript-baseline-acceptance.lock",
  );
  await writeExecutable(candidate, "#!/usr/bin/env sh\nexit 0\n");
  await mkdir(lock, { recursive: true });

  const result = await runAcceptance({
    ...harness.env,
    BW_NEW_API_BINARY: candidate,
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /无法获取 TypeScript 基线验收锁/);
});

test("验收脚本不会自动抢占陈旧锁", async () => {
  const harness = await createHarness();
  const candidate = path.join(harness.home, "new-api");
  const lock = path.join(
    harness.home,
    ".cache/blue-whale-typescript-baseline-acceptance.lock",
  );
  await writeExecutable(candidate, "#!/usr/bin/env sh\nexit 0\n");
  await mkdir(lock, { recursive: true });
  await writeFile(path.join(lock, "pid"), "99999999\n");

  const result = await runAcceptance({
    ...harness.env,
    BW_NEW_API_BINARY: candidate,
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /检测到陈旧的 TypeScript 基线验收锁/);
});

test("源码获取默认固定到可追溯提交并记录实际 SHA", async () => {
  const harness = await createHarness();

  const result = await runAcceptance(harness.env);
  const commandLog = await readFile(harness.commandLog, "utf8");

  assert.match(
    commandLog,
    /fetch --depth 1 origin 90f1d49992bf22938bfb19352740891a28ecad67/,
  );
  assert.doesNotMatch(commandLog, /origin master/);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /new-api source: 90f1d49992bf22938bfb19352740891a28ecad67/,
  );
});

test("BW_NEW_API_REF 可以显式覆盖固定提交", async () => {
  const harness = await createHarness();

  await runAcceptance({
    ...harness.env,
    BW_NEW_API_REF: "release-fixture",
    BW_NEW_API_REPO_URL: "file:///fixture-blue-whale-api.git",
  });
  const commandLog = await readFile(harness.commandLog, "utf8");

  assert.match(commandLog, /fetch --depth 1 origin release-fixture/);
  assert.match(commandLog, /remote add origin file:\/\/\/fixture-blue-whale-api\.git/);
  assert.doesNotMatch(commandLog, /origin master/);
});

test("两份部署构建脚本都使用可配置的固定源码 ref", async (t) => {
  const scripts = [
    path.join(root, ".claude/skills/deploy-blue-whale-api/scripts/build.sh"),
    path.join(root, ".qoder/skills/deploy-blue-whale-api/scripts/build.sh"),
  ];

  for (const [index, script] of scripts.entries()) {
    await t.test(path.relative(root, script), async () => {
      const harness = await createHarness();
      const ref = index === 0 ? "90f1d49992bf22938bfb19352740891a28ecad67" : "deploy-fixture";
      const result = await runScript(script, {
        ...harness.env,
        BUN: "/usr/bin/true",
        ...(index === 1 ? { BW_NEW_API_REF: ref } : {}),
      });
      const commandLog = await readFile(harness.commandLog, "utf8");

      assert.match(commandLog, new RegExp(`fetch --depth 1 origin ${ref}`));
      assert.doesNotMatch(commandLog, /origin master/);
      assert.match(
        `${result.stdout}\n${result.stderr}`,
        new RegExp(`new-api source: 90f1d49992bf22938bfb19352740891a28ecad67 \\(ref: ${ref}\\)`),
      );
    });
  }
});

test("两份部署构建脚本不能同时改写共享 checkout", async () => {
  const harness = await createHarness();
  const readyFile = path.join(harness.fixture, "deploy-fetch-ready");
  const blockFile = path.join(harness.fixture, "release-deploy-fetch");
  const claudeBuild = path.join(
    root,
    ".claude/skills/deploy-blue-whale-api/scripts/build.sh",
  );
  const qoderBuild = path.join(
    root,
    ".qoder/skills/deploy-blue-whale-api/scripts/build.sh",
  );

  const first = startScript(claudeBuild, {
    ...harness.env,
    BUN: "/usr/bin/true",
    BW_TEST_GIT_READY_FILE: readyFile,
    BW_TEST_GIT_BLOCK_FILE: blockFile,
  });
  try {
    await waitForFile(readyFile);
    const second = await runScript(qoderBuild, {
      ...harness.env,
      BUN: "/usr/bin/true",
    });
    assert.notEqual(second.code, 0);
    assert.match(second.stderr, /已有 new-api 部署构建正在运行/);
  } finally {
    await writeFile(blockFile, "release\n");
    await first.done;
  }
});

test("部署构建不会自动抢占陈旧锁", async () => {
  const harness = await createHarness();
  const lock = path.join(
    harness.home,
    ".cache/blue-whale-deploy/source.lock",
  );
  const build = path.join(
    root,
    ".claude/skills/deploy-blue-whale-api/scripts/build.sh",
  );
  await mkdir(lock, { recursive: true });
  await writeFile(path.join(lock, "pid"), "99999999\n");

  const result = await runScript(build, {
    ...harness.env,
    BUN: "/usr/bin/true",
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /检测到陈旧的 new-api 部署构建锁/);
});
