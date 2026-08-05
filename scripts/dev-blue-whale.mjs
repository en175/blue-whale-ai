import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = resolve(root, "blue_whale_web");
const lan = process.argv.includes("--lan");
const children = [];
let stopping = false;

// 强制以根 .env 为准：node --env-file 不覆盖已存在的 shell 环境变量，
// 旧导出（如指向测试站的 DATABASE_URL）会静默压过 .env，导致连库卡死。
try {
  for (const line of readFileSync(resolve(root, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trimStart().startsWith("#")) continue;
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[m[1]] = value;
  }
} catch {
  // .env 不存在时沿用进程环境
}

function start(command, args, cwd, env = process.env) {
  const child = spawn(command, args, { cwd, env, stdio: "inherit" });
  children.push(child);
  return child;
}

function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => stop(signal));
}

const worker = start(
  process.execPath,
  [".worker-dist/generation-worker.js"],
  webDir,
  {
    ...process.env,
    PORT: process.env.GENERATION_WORKER_PORT ?? "4002",
  },
);
const next = start(
  process.execPath,
  [
    resolve(webDir, "node_modules/next/dist/bin/next"),
    "dev",
    ...(lan ? ["-H", "0.0.0.0"] : []),
  ],
  webDir,
);

const exitCode = await new Promise((resolveExit) => {
  for (const child of [worker, next]) {
    child.once("exit", (code, signal) => {
      stop();
      resolveExit(code ?? (signal ? 1 : 0));
    });
  }
});

process.exitCode = exitCode;
