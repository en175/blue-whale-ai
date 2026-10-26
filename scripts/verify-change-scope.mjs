#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { arch, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildVerificationPlan,
  classifyChanges,
  requiresFrontendBuild,
  validateReceipt,
} from "./verification-policy.mjs";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function gitSucceeds(...args) {
  return spawnSync("git", args, { stdio: "ignore" }).status === 0;
}

function taskBaseline() {
  const script = join(dirname(fileURLToPath(import.meta.url)), "lib", "task_metadata.py");
  const candidates = process.platform === "win32"
    ? [["py", "-3"], ["python3"], ["python"]]
    : [["python3"], ["python"]];
  for (const [command, ...prefix] of candidates) {
    try {
      return JSON.parse(execFileSync(command, [...prefix, script, "read", "--json"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw new Error(error.stderr?.toString().trim() || error.message);
    }
  }
  throw new Error("读取任务起点需要可用的 Python 3");
}

function remoteTargetSha(targetBranch) {
  const line = git("ls-remote", "--heads", "origin", `refs/heads/${targetBranch}`);
  if (!line) throw new Error(`远端目标 origin/${targetBranch} 不存在`);
  return line.split(/\s/)[0];
}

function valueAfter(args, option, fallback) {
  const index = args.indexOf(option);
  if (index === -1) return fallback;
  if (!args[index + 1]) throw new Error(`${option} requires a value`);
  return args[index + 1];
}

function dockerfileSemantics(content) {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .join("\n");
}

function documentationOnlyFiles(files, base, head) {
  return files.filter((file) => {
    if (!/(?:^|\/)Dockerfile[^/]*$/.test(file)) return false;
    try {
      return dockerfileSemantics(git("show", `${base}:${file}`)) ===
        dockerfileSemantics(git("show", `${head}:${file}`));
    } catch {
      return false;
    }
  });
}

function pythonForVerification() {
  const candidates = process.platform === "win32"
    ? [["py", "-3.12"], ["py", "-3.11"], ["python3"], ["python"]]
    : [["python3.12"], ["python3.11"], ["python3"], ["python"]];
  for (const command of candidates) {
    const result = spawnSync(command[0], [
      ...command.slice(1), "-c", "import sys, tomllib; print(sys.version.split()[0])",
    ], { encoding: "utf8" });
    if (result.status === 0) return { command, version: result.stdout.trim() };
  }
  throw new Error("脚本验证需要 Python 3.11+；请安装后重试。");
}

function currentScope({ baseRef, targetBranch, risk, stage, requireTargetSync = false, frontendPushOnly = false }) {
  const head = git("rev-parse", "HEAD");
  const metadata = taskBaseline();
  const startSha = metadata.start_sha;
  const ownBaseSha = metadata.inherited_sha ?? startSha;
  if (baseRef && git("rev-parse", "--verify", `${baseRef}^{commit}`) !== ownBaseSha) {
    const label = metadata.inherited_sha ? "任务继承提交" : "任务起点";
    throw new Error(`显式基线 ${baseRef} 与${label} ${ownBaseSha} 不一致`);
  }
  targetBranch = targetBranch ?? metadata.target_branch;
  const targetSha = remoteTargetSha(targetBranch);
  const base = metadata.inherited_sha ?? (gitSucceeds("merge-base", "--is-ancestor", startSha, targetSha) &&
    gitSucceeds("merge-base", "--is-ancestor", targetSha, head)
    ? targetSha
    : startSha);
  const changedFiles = git("diff", "--name-only", "-z", `${base}...${head}`)
    .split("\0")
    .filter(Boolean)
    .sort();
  const changedFilesHash = createHash("sha256")
    .update(changedFiles.join("\0"))
    .digest("hex");
  const documentation = documentationOnlyFiles(changedFiles, base, head);
  if (frontendPushOnly && !requiresFrontendBuild(changedFiles, documentation)) {
    return { head, base, changedFiles, frontendBuildRequired: false };
  }
  if (requireTargetSync && stage === "pr" &&
      !gitSucceeds("merge-base", "--is-ancestor", targetSha, head)) {
    throw new Error(`PR_TARGET_NOT_SYNCED: HEAD 尚未包含 origin/${targetBranch} 的 ${targetSha}；先运行 scripts/sync-task-from-origin.sh sync --target-branch ${targetBranch} --json`);
  }
  const classification = classifyChanges(changedFiles, {
    risk,
    stage,
    documentationOnlyFiles: documentation,
  });
  const plannedCommands = buildVerificationPlan(classification, { base });
  const python = plannedCommands.some((command) => command[0] === "python3")
    ? pythonForVerification()
    : null;
  const commands = buildVerificationPlan(classification, {
    base,
    pythonCommand: python?.command,
  });
  const environment = verificationEnvironment(python, classification.areas?.includes("web"));
  const inputHash = createHash("sha256")
    .update(JSON.stringify(environment))
    .digest("hex");
  return {
    head,
    base,
    startSha,
    targetBranch,
    targetSha,
    changedFiles,
    changedFilesHash,
    classification,
    commands,
    pythonCommand: python?.command,
    environment,
    inputHash,
  };
}

function frontendBuildInputs() {
  const files = [
    "web/.env", "web/.env.local", "web/.env.test", "web/.env.test.local",
    "web/.env.release", "web/.env.release.local",
    "web/node_modules/.package-lock.json", "node_modules/.pnpm/lock.yaml",
    "web/node_modules/typescript/package.json", "web/node_modules/vite/package.json",
    "backend/node_modules/zod/package.json", "node_modules/zod/package.json",
  ];
  return createHash("sha256").update(JSON.stringify({
    files: files.map((file) => [file, existsSync(file)
      ? createHash("sha256").update(readFileSync(file)).digest("hex") : null]),
    variables: Object.entries(process.env)
      .filter(([name]) => name.startsWith("VITE_") || name === "NODE_ENV" || name === "NODE_OPTIONS")
      .sort(([left], [right]) => left.localeCompare(right)),
  })).digest("hex");
}

function verificationEnvironment(python, frontend = false) {
  return {
    node: process.version,
    platform: process.platform,
    arch: arch(),
    ...(python ? { python: python.version } : {}),
    ...(frontend ? { frontendBuildInputs: frontendBuildInputs() } : {}),
  };
}

function receiptPath(head) {
  const root = git("rev-parse", "--show-toplevel");
  const common = git("rev-parse", "--git-common-dir");
  const commonDirectory = isAbsolute(common) ? common : resolve(root, common);
  return join(commonDirectory, "blue-whale", "verification", `${head}.json`);
}

function emit(payload, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  process.stdout.write(`${payload.status}: ${payload.reason ?? payload.tier ?? "ok"}\n`);
}

function emitSummary(receipt) {
  const totalDurationMs = receipt.results.reduce(
    (total, result) => total + result.durationMs,
    0,
  );
  const lines = [
    `- 验证层级：\`${receipt.classification.tier}\``,
    `- 验证 HEAD：\`${receipt.head}\``,
    `- 验证结果：\`${receipt.status}\``,
    `- 总耗时：\`${totalDurationMs} ms\``,
    ...(receipt.retry
      ? [`- 重试：\`${receipt.retry.kind}\` — ${receipt.retry.reason}`]
      : []),
    "- 验证命令：",
    ...receipt.results.flatMap((result) => {
      const lines = [`  - \`${result.command.join(" ")}\` — ${result.durationMs} ms`];
      const stages = result.attempts.at(-1)?.stages ?? [];
      lines.push(...stages.map((stage) => `    - ${stage.name} — ${stage.durationMs} ms`));
      return lines;
    }),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

function execute(command, { asJson }) {
  const startedAt = Date.now();
  const recordsStages = command[0] === "pnpm" && command[1] === "verify";
  const stageDirectory = recordsStages
    ? mkdtempSync(join(tmpdir(), "blue-whale-verification-stages-"))
    : null;
  const stageLog = stageDirectory ? join(stageDirectory, "stages.jsonl") : null;
  const webBuild = command[0] === "node" && command[1] === "web/node_modules/vite/bin/vite.js";
  const arguments_ = webBuild ? [resolve(command[1]), ...command.slice(2)] : command.slice(1);
  const result = spawnSync(command[0], arguments_, {
    cwd: webBuild ? resolve("web") : undefined,
    shell: process.platform === "win32" && command[0] !== "node",
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: stageLog
      ? { ...process.env, BW_VERIFICATION_STAGE_LOG: stageLog }
      : process.env,
  });
  const durationMs = Date.now() - startedAt;
  const stages =
    stageLog && existsSync(stageLog)
      ? readFileSync(stageLog, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
  if (stageDirectory) rmSync(stageDirectory, { recursive: true, force: true });
  if (!asJson || result.status !== 0) {
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  return {
    command,
    exitCode: result.status ?? 1,
    durationMs,
    attempts: [
      {
        exitCode: result.status ?? 1,
        durationMs,
        ...(stages.length > 0 ? { stages } : {}),
      },
    ],
  };
}

function writeReceipt(path, receipt) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
}

function matchesReceiptInputs(receipt, scope) {
  return receipt?.version === 1 &&
    receipt.head === scope.head &&
    receipt.base === scope.base &&
    receipt.startSha === scope.startSha &&
    receipt.targetBranch === scope.targetBranch &&
    receipt.targetSha === scope.targetSha &&
    receipt.changedFilesHash === scope.changedFilesHash &&
    receipt.inputHash === scope.inputHash;
}

function matchesReceiptScope(receipt, scope) {
  return matchesReceiptInputs(receipt, scope) &&
    JSON.stringify(receipt.classification) === JSON.stringify(scope.classification) &&
    JSON.stringify(receipt.commands) === JSON.stringify(scope.commands);
}

function loadRetryableReceipt(scope) {
  const path = receiptPath(scope.head);
  if (!existsSync(path)) {
    throw new Error("retry requires a failed receipt for the current scope");
  }
  const receipt = JSON.parse(readFileSync(path, "utf8"));
  if (receipt.status !== "failed" || !matchesReceiptScope(receipt, scope)) {
    throw new Error("retry requires a failed receipt for the current scope");
  }
  if (receipt.retry) {
    throw new Error("failed verification has already used its one retry");
  }
  const results = receipt.results;
  const failedIndex = Array.isArray(results) ? results.length - 1 : -1;
  const failedResult = results?.[failedIndex];
  const resultsAreRetryable =
    failedIndex >= 0 &&
    failedIndex < scope.commands.length &&
    results.slice(0, failedIndex).every((result) => result.exitCode === 0) &&
    failedResult.exitCode !== 0 &&
    failedResult.attempts?.length === 1 &&
    JSON.stringify(failedResult.command) === JSON.stringify(scope.commands[failedIndex]);
  if (!resultsAreRetryable) {
    throw new Error("failed receipt does not contain one retryable command failure");
  }
  return { path, receipt, failedIndex };
}

function main() {
  process.chdir(git("rev-parse", "--show-toplevel"));
  const args = process.argv.slice(2);
  const command = args[0];
  if (!["plan", "run", "ensure", "check", "check-push", "summary"].includes(command)) {
    throw new Error("usage: verify-change-scope.mjs <plan|run|ensure|check|check-push|summary> [--head SHA] [--base REF] [--target-branch BRANCH] [--stage completion|pr] [--risk high] [--retry-kind KIND --retry-reason REASON] [--json]");
  }
  const baseRef = valueAfter(args, "--base", null);
  const targetBranchArg = valueAfter(args, "--target-branch", null);
  const risk = valueAfter(args, "--risk", "auto");
  const stage = command === "check-push" ? "pr" : valueAfter(args, "--stage", "completion");
  const retryKind = valueAfter(args, "--retry-kind", null);
  const retryReason = valueAfter(args, "--retry-reason", null);
  if (retryKind && retryKind !== "infrastructure" && retryKind !== "known-flaky") {
    throw new Error("retry kind must be infrastructure or known-flaky");
  }
  if (Boolean(retryKind) !== Boolean(retryReason)) {
    throw new Error("--retry-kind and --retry-reason must be provided together");
  }
  const retry = retryKind ? { kind: retryKind, reason: retryReason } : null;
  if (command === "ensure" && retry) {
    throw new Error("explicit verification retries must use run");
  }
  const asJson = args.includes("--json");
  if (command === "check-push") {
    const pushedHead = valueAfter(args, "--head", null);
    if (!pushedHead || pushedHead !== git("rev-parse", "HEAD")) {
      emit({ status: "PUSH_HEAD_MISMATCH", reason: "请在待推送分支的工作树中验证并推送，不能复用其他提交的凭证。" }, asJson);
      process.exitCode = 4;
      return;
    }
    const treeFiles = git("ls-tree", "-r", "--name-only", pushedHead).split("\n");
    if (!requiresFrontendBuild(treeFiles) &&
        !requiresFrontendBuild(git("log", "--format=", "--name-only", pushedHead).split("\n"))) {
      emit({ status: "BUILD_NOT_REQUIRED", reason: "仓库历史中不含前端构建输入。" }, asJson);
      return;
    }
  }
  const scope = currentScope({ baseRef, targetBranch: targetBranchArg, risk, stage,
    requireTargetSync: ["plan", "run", "ensure", "check-push"].includes(command),
    frontendPushOnly: command === "check-push" });
  if (command === "check-push" && scope.frontendBuildRequired === false) {
    emit({ status: "BUILD_NOT_REQUIRED", reason: "本次推送不影响前端构建。" }, asJson);
    return;
  }
  if (git("status", "--porcelain")) {
    emit(
      { status: "DIRTY_WORKTREE", reason: "verification requires a clean worktree" },
      asJson,
    );
    process.exitCode = 3;
    return;
  }
  if (command === "plan") {
    if (asJson) {
      process.stdout.write(`${JSON.stringify(scope)}\n`);
      return;
    }
    process.stdout.write(`${scope.classification.tier}: ${scope.changedFiles.join(", ")}\n`);
    return;
  }

  if (command === "ensure") {
    const path = receiptPath(scope.head);
    const receipt = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
    if (validateReceipt(receipt, scope).valid) {
      emit({ status: "VERIFIED", tier: receipt.classification.tier, receipt: path, reused: true }, asJson);
      return;
    }
    if (receipt?.status === "failed" && matchesReceiptInputs(receipt, scope)) {
      emit({ status: "VERIFICATION_FAILED", reason: "当前提交已有失败结果；修复后重新验证，或按测试策略显式重试。" }, asJson);
      process.exitCode = 5;
      return;
    }
  }

  if (command === "run" || command === "ensure") {
    const retryState = retry ? loadRetryableReceipt(scope) : null;
    const startedAt = retryState?.receipt.startedAt ?? new Date().toISOString();
    const results = retryState
      ? structuredClone(retryState.receipt.results)
      : [];
    const firstCommandIndex = retryState?.failedIndex ?? 0;
    for (let index = firstCommandIndex; index < scope.commands.length; index += 1) {
      const result = execute(scope.commands[index], { asJson });
      if (retryState && index === retryState.failedIndex) {
        const failedResult = results[index];
        failedResult.attempts.push(...result.attempts);
        failedResult.exitCode = result.exitCode;
        failedResult.durationMs += result.durationMs;
      } else {
        results.push(result);
      }
      if (result.exitCode !== 0) break;
    }
    const passed = results.every((result) => result.exitCode === 0);
    const receipt = {
      version: 1,
      status: passed ? "passed" : "failed",
      ...scope,
      startedAt,
      finishedAt: new Date().toISOString(),
      retry,
      results,
    };
    const path = receiptPath(scope.head);
    writeReceipt(path, receipt);
    if (!passed) {
      emit({ status: "VERIFICATION_FAILED", tier: scope.classification.tier }, asJson);
      process.exitCode = 5;
      return;
    }
    emit({ status: "VERIFIED", tier: scope.classification.tier, receipt: path }, asJson);
    return;
  }

  const path = receiptPath(scope.head);
  const receipt = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  const validation = validateReceipt(receipt, scope);
  if (!validation.valid) {
    emit({ status: "VERIFICATION_REQUIRED", reason: validation.reason }, asJson);
    process.exitCode = 4;
    return;
  }
  if (command === "summary" && !asJson) {
    emitSummary(receipt);
    return;
  }
  emit({ status: "VERIFIED", tier: receipt.classification.tier }, asJson);
}

try {
  main();
} catch (error) {
  process.stderr.write(`verify-change-scope: ${error.message}\n`);
  process.exitCode = 2;
}
