#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { arch, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  buildVerificationPlan,
  classifyChanges,
  validateReceipt,
} from "./verification-policy.mjs";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function valueAfter(args, option, fallback) {
  const index = args.indexOf(option);
  if (index === -1) return fallback;
  if (!args[index + 1]) throw new Error(`${option} requires a value`);
  return args[index + 1];
}

function currentScope({ baseRef, risk }) {
  const head = git("rev-parse", "HEAD");
  const base = git("merge-base", baseRef, head);
  const changedFiles = git("diff", "--name-only", `${base}...${head}`)
    .split("\n")
    .filter(Boolean)
    .sort();
  const changedFilesHash = createHash("sha256")
    .update(changedFiles.join("\0"))
    .digest("hex");
  const classification = classifyChanges(changedFiles, { risk });
  const commands = buildVerificationPlan(classification, { base });
  const environment = verificationEnvironment(classification);
  const inputHash = createHash("sha256")
    .update(JSON.stringify(environment))
    .digest("hex");
  return {
    head,
    base,
    changedFiles,
    changedFilesHash,
    classification,
    commands,
    environment,
    inputHash,
  };
}

function verificationEnvironment(classification) {
  const environment = {
    node: process.version,
    platform: process.platform,
    arch: arch(),
  };
  if (classification.tier !== "full") return environment;

  const binaryPath = process.env.BW_NEW_API_BINARY;
  let newApiBinaryDigest;
  if (binaryPath && existsSync(binaryPath)) {
    newApiBinaryDigest = createHash("sha256").update(readFileSync(binaryPath)).digest("hex");
  }
  environment.cache = {
    skipImageBuild: process.env.BW_TS_SKIP_IMAGE_BUILD === "true",
    newApiBinaryPreset: Boolean(binaryPath),
    ...(newApiBinaryDigest ? { newApiBinaryDigest } : {}),
    newApiRef: process.env.BW_NEW_API_REF ?? null,
  };
  return environment;
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
  const recordsStages = command.length === 2 && command[0] === "pnpm" && command[1] === "verify";
  const stageDirectory = recordsStages
    ? mkdtempSync(join(tmpdir(), "blue-whale-verification-stages-"))
    : null;
  const stageLog = stageDirectory ? join(stageDirectory, "stages.jsonl") : null;
  const result = spawnSync(command[0], command.slice(1), {
    encoding: "utf8",
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

function loadRetryableReceipt(scope) {
  const path = receiptPath(scope.head);
  if (!existsSync(path)) {
    throw new Error("retry requires a failed receipt for the current scope");
  }
  const receipt = JSON.parse(readFileSync(path, "utf8"));
  const sameScope =
    receipt.version === 1 &&
    receipt.status === "failed" &&
    receipt.head === scope.head &&
    receipt.base === scope.base &&
    receipt.changedFilesHash === scope.changedFilesHash &&
    receipt.inputHash === scope.inputHash &&
    JSON.stringify(receipt.classification) === JSON.stringify(scope.classification) &&
    JSON.stringify(receipt.commands) === JSON.stringify(scope.commands);
  if (!sameScope) {
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
  const args = process.argv.slice(2);
  const command = args[0];
  if (!["plan", "run", "check", "summary"].includes(command)) {
    throw new Error("usage: verify-change-scope.mjs <plan|run|check|summary> [--base REF] [--risk high] [--retry-kind KIND --retry-reason REASON] [--json]");
  }
  const baseRef = valueAfter(args, "--base", "origin/master");
  const risk = valueAfter(args, "--risk", "auto");
  const retryKind = valueAfter(args, "--retry-kind", null);
  const retryReason = valueAfter(args, "--retry-reason", null);
  if (retryKind && retryKind !== "infrastructure" && retryKind !== "known-flaky") {
    throw new Error("retry kind must be infrastructure or known-flaky");
  }
  if (Boolean(retryKind) !== Boolean(retryReason)) {
    throw new Error("--retry-kind and --retry-reason must be provided together");
  }
  const retry = retryKind ? { kind: retryKind, reason: retryReason } : null;
  const asJson = args.includes("--json");
  if (git("status", "--porcelain")) {
    emit(
      { status: "DIRTY_WORKTREE", reason: "verification requires a clean worktree" },
      asJson,
    );
    process.exitCode = 3;
    return;
  }
  const scope = currentScope({ baseRef, risk });
  if (command === "plan") {
    if (asJson) {
      process.stdout.write(`${JSON.stringify(scope)}\n`);
      return;
    }
    process.stdout.write(`${scope.classification.tier}: ${scope.changedFiles.join(", ")}\n`);
    return;
  }

  if (command === "run") {
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
