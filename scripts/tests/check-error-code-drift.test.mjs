// check-error-code-drift.mjs 单测：diff 提取、映射解析、域匹配纯函数，
// 外加临时 git 仓库端到端（staged 改码 → 拦截 / 清理后放行 / 迁移行豁免）。
// 纯本地临时目录，不触碰任何真实仓库。跑法：node --test scripts/tests/check-error-code-drift.test.mjs
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  CONTRACT_PATH,
  domainToken,
  isDomainHit,
  parseCurrentMappings,
  parseRemovedMappings,
  scanDrift,
  splitGrepLine,
} from "../check-error-code-drift.mjs";

const SCRIPT = path.resolve(import.meta.dirname, "../check-error-code-drift.mjs");

test("parseRemovedMappings：只取删除行的映射，diff 头与上下文行不误判", () => {
  const diff = [
    "diff --git a/backend/libs/contracts/error-codes.ts b/backend/libs/contracts/error-codes.ts",
    "--- a/backend/libs/contracts/error-codes.ts",
    "+++ b/backend/libs/contracts/error-codes.ts",
    "@@ -203,2 +203,2 @@",
    "-  [ERROR_AUDIO_SPEED_FAILED]: 1051,",
    "+  [ERROR_AUDIO_SPEED_FAILED]: 1052,",
    "   [ERROR_AUDIO_MIX_FAILED]: 1051,",
  ].join("\n");
  assert.deepEqual(parseRemovedMappings(diff), [
    { name: "ERROR_AUDIO_SPEED_FAILED", oldNum: 1051 },
  ]);
});

test("parseCurrentMappings：全文映射成表", () => {
  const text = [
    "export const GENERATION_ERROR_NUMERIC_CODES = {",
    "  [ERROR_AUDIO_TRIM_FAILED]: 1048,",
    "  [ERROR_AUDIO_MIX_FAILED]: 1051,",
    "  [ERROR_AUDIO_SPEED_FAILED]: 1052,",
    "};",
  ].join("\n");
  const cur = parseCurrentMappings(text);
  assert.equal(cur.get("ERROR_AUDIO_SPEED_FAILED"), 1052);
  assert.equal(cur.size, 3);
});

test("domainToken：去 ERROR_ 前缀与 _FAILED 后缀后归一", () => {
  assert.equal(domainToken("ERROR_AUDIO_SPEED_FAILED"), "audiospeed");
  assert.equal(domainToken("ERROR_VIDEO_MATTING_FAILED"), "videomatting");
});

test("isDomainHit：行文本或文件路径含域 token 命中；其他域不命中", () => {
  const token = domainToken("ERROR_AUDIO_SPEED_FAILED");
  assert.equal(isDomainHit("audio_speed_failed（1051）兜底", "x.ts", token), true);
  assert.equal(isDomainHit("归并 1051 兜底", "AudioSpeedJobProcessor.java", token), true);
  assert.equal(isDomainHit("音频混合失败 1051", "AudioMixNote.ts", token), false);
  // 路径归一：下划线/连字符/大小写差异都算同域
  assert.equal(isDomainHit("兜底 1051", "web/audio-speed/note.ts", token), true);
});

test("splitGrepLine：拆 path:line:text，路径含冒号时以行号字段为锚", () => {
  assert.deepEqual(splitGrepLine("a/b.ts:12:兜底 1051"), {
    path: "a/b.ts",
    text: "兜底 1051",
  });
  assert.equal(splitGrepLine("noise-without-line"), null);
});

// ── 端到端：临时 git 仓库 ──────────────────────────────────────

function sh(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8" });
}

function runScript(cwd) {
  return spawnSync(process.execPath, [SCRIPT], { cwd, encoding: "utf8" });
}

function buildRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "bw-drift-"));
  sh(dir, "git", ["init", "-q"]);
  mkdirSync(path.join(dir, "backend/libs/contracts"), { recursive: true });
  mkdirSync(path.join(dir, "java/worker/src"), { recursive: true });
  writeFileSync(
    path.join(dir, CONTRACT_PATH),
    [
      "export const GENERATION_ERROR_NUMERIC_CODES = {",
      "  [ERROR_AUDIO_SPEED_FAILED]: 1051,",
      "  [ERROR_AUDIO_MIX_FAILED]: 1050,",
      "};",
    ].join("\n"),
  );
  // 调速域残留（应报）与混合域合法引用（不应报）
  writeFileSync(
    path.join(dir, "java/worker/src/AudioSpeedJobProcessor.java"),
    "/// audio_speed_failed 兜底归并 1051\n",
  );
  writeFileSync(
    path.join(dir, "java/worker/src/AudioMixJobProcessor.java"),
    "/// 音频混合失败归并 1050\n",
  );
  sh(dir, "git", ["add", "-A"]);
  // 初始提交：改码场景要求仓库有历史，staged diff 才会出现删除行
  sh(dir, "git", [
    "-c",
    "user.email=drift@test",
    "-c",
    "user.name=drift",
    "commit",
    "-q",
    "-m",
    "init",
  ]);
  return dir;
}

test("端到端：staged 改码后域内旧数值残留被拦截，其他域不误报", () => {
  const dir = buildRepo();
  try {
    writeFileSync(
      path.join(dir, CONTRACT_PATH),
      [
        "export const GENERATION_ERROR_NUMERIC_CODES = {",
        "  [ERROR_AUDIO_SPEED_FAILED]: 1052,",
        "  [ERROR_AUDIO_MIX_FAILED]: 1050,",
        "};",
      ].join("\n"),
    );
    sh(dir, "git", ["add", CONTRACT_PATH]);
    const r = runScript(dir);
    assert.equal(r.status, 1, `应拦截，输出：${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /AudioSpeedJobProcessor\.java/);
    assert.doesNotMatch(r.stderr, /AudioMixJobProcessor\.java/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("端到端：残留清理后放行（exit 0）", () => {
  const dir = buildRepo();
  try {
    writeFileSync(
      path.join(dir, CONTRACT_PATH),
      [
        "export const GENERATION_ERROR_NUMERIC_CODES = {",
        "  [ERROR_AUDIO_SPEED_FAILED]: 1052,",
        "  [ERROR_AUDIO_MIX_FAILED]: 1050,",
        "};",
      ].join("\n"),
    );
    writeFileSync(
      path.join(dir, "java/worker/src/AudioSpeedJobProcessor.java"),
      "/// audio_speed_failed 兜底归并 1052\n",
    );
    sh(dir, "git", ["add", "-A"]);
    const r = runScript(dir);
    assert.equal(r.status, 0, `应放行，输出：${r.stdout}${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("端到端：行内同时含新数值的迁移说明放行", () => {
  const dir = buildRepo();
  try {
    writeFileSync(
      path.join(dir, "java/worker/src/AudioSpeedJobProcessor.java"),
      "/// 原 1051 让号音频混合，现 1052\n",
    );
    writeFileSync(
      path.join(dir, CONTRACT_PATH),
      [
        "export const GENERATION_ERROR_NUMERIC_CODES = {",
        "  [ERROR_AUDIO_SPEED_FAILED]: 1052,",
        "  [ERROR_AUDIO_MIX_FAILED]: 1050,",
        "};",
      ].join("\n"),
    );
    sh(dir, "git", ["add", "-A"]);
    const r = runScript(dir);
    assert.equal(r.status, 0, `迁移说明应放行，输出：${r.stdout}${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("端到端：staged 不含 error-codes.ts 时不触发（exit 0）", () => {
  const dir = buildRepo();
  try {
    writeFileSync(path.join(dir, "java/worker/src/Other.java"), "/// 任意 1051\n");
    sh(dir, "git", ["add", "-A"]);
    const r = runScript(dir);
    assert.equal(r.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scanDrift：手动对账模式核心（对真实临时仓直接调用）", () => {
  const dir = buildRepo();
  try {
    const hits = scanDrift(dir, {
      name: "ERROR_AUDIO_SPEED_FAILED",
      oldNum: 1051,
      newNum: 1052,
    });
    assert.equal(hits.length, 1);
    assert.match(hits[0].path, /AudioSpeedJobProcessor\.java$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
