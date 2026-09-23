#!/usr/bin/env node
// check-error-code-drift.mjs — 错误码改码注释对账
//
// 背景：error-codes.ts 数值表改码（让号/迁移）时，行为与测试断言改了、
// 注释层的旧数值容易漏改（实证：!831 音频调速 1051→1052 残留约 30 处、
// !820 抠像 1049→1050 同类）。本脚本在改码提交时 grep 旧数值在该错误域
// 的代码注释与测试名残留，命中即拦截。
//
// 触发：.githooks/pre-commit 第 3 节（staged 含 error-codes.ts 时调用；
// 无 node 环境跳过，主链路仍零依赖）。
// 手动：node scripts/check-error-code-drift.mjs --name ERROR_AUDIO_SPEED_FAILED --from 1051 [--repo <path>]
// 退出码：0 无残留/未触发；1 发现残留；2 参数或环境错误。
//
// 域匹配口径：从注册名派生归一 token（ERROR_AUDIO_SPEED_FAILED → audiospeed），
// 命中行文本或文件路径（大小写与分隔符归一后）含 token 才算该域——旧数值
// 已合法归属其他域（如 1051 归音频混合）的文件不会被误报；行内同时含新数值
// 视为迁移说明放行；error-codes.ts 自身与 *.md（历史记录合法提及）不扫。

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CONTRACT_PATH = "backend/libs/contracts/error-codes.ts";

const MAPPING_RE = /\[(ERROR_[A-Z0-9_]+)\]\s*:\s*(\d+)/g;

/** 从 error-codes.ts 的 staged diff 提取被删除行里的数值映射（改码项候选）。 */
export function parseRemovedMappings(diffText) {
  const out = [];
  for (const line of diffText.split("\n")) {
    if (!line.startsWith("-") || line.startsWith("---")) continue;
    for (const m of line.slice(1).matchAll(MAPPING_RE)) {
      out.push({ name: m[1], oldNum: Number(m[2]) });
    }
  }
  return out;
}

/** 解析当前 error-codes.ts 全文的 name → 数值映射。 */
export function parseCurrentMappings(fileText) {
  const map = new Map();
  for (const m of fileText.matchAll(MAPPING_RE)) {
    map.set(m[1], Number(m[2]));
  }
  return map;
}

/** 注册名 → 归一域 token：ERROR_AUDIO_SPEED_FAILED → "audiospeed"。 */
export function domainToken(name) {
  const core = name.replace(/^ERROR_/, "").replace(/_FAILED$/, "");
  return core.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** 大小写与分隔符归一，用于域 token 子串匹配。 */
export function normalizeForDomainMatch(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** 命中行是否属于该错误域：行文本或文件路径含域 token。 */
export function isDomainHit(lineText, filePath, token) {
  return (
    normalizeForDomainMatch(lineText).includes(token) ||
    normalizeForDomainMatch(filePath).includes(token)
  );
}

/** 解析 `git grep -n` 的 `path:line:text` 输出行（路径含冒号时 line 起首数字段）。 */
export function splitGrepLine(raw) {
  const m = raw.match(/^(.+?):(\d+):(.*)$/);
  return m ? { path: m[1], text: m[3] } : null;
}

function git(args, repo) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * 对一个改码项全仓扫描旧数值残留。
 * 返回违规清单：[{ path, text }]。
 */
export function scanDrift(repo, { name, oldNum, newNum }) {
  const token = domainToken(name);
  let raw = "";
  try {
    raw = git(
      [
        "grep",
        "-n",
        "-w",
        "-e",
        String(oldNum),
        "--",
        "*.ts",
        "*.tsx",
        "*.js",
        "*.mjs",
        "*.java",
      ],
      repo,
    );
  } catch (err) {
    // git grep 无命中时退出码 1，属正常
    if (err.status === 1) return [];
    throw err;
  }
  const hits = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const parsed = splitGrepLine(line);
    if (!parsed) continue;
    if (path.normalize(parsed.path) === path.normalize(CONTRACT_PATH)) continue;
    if (!isDomainHit(parsed.text, parsed.path, token)) continue;
    // 行内同时含新数值 = 迁移说明（如「原 1051 现 1052」），放行
    if (newNum !== undefined && new RegExp(`\\b${newNum}\\b`).test(parsed.text)) {
      continue;
    }
    hits.push(parsed);
  }
  return hits;
}

function main() {
  const argv = process.argv.slice(2);
  const repo = path.resolve(
    argv.includes("--repo") ? argv[argv.indexOf("--repo") + 1] : process.cwd(),
  );
  const contractAbs = path.join(repo, CONTRACT_PATH);

  let checks;
  if (argv.includes("--name")) {
    // 手动对账模式：--name ERROR_X --from 旧数值
    const name = argv[argv.indexOf("--name") + 1];
    const from = Number(argv[argv.indexOf("--from") + 1]);
    if (!name || !from) {
      console.error("用法: --name ERROR_XXX --from <旧数值> [--repo <path>]");
      process.exit(2);
    }
    const cur = parseCurrentMappings(readFileSync(contractAbs, "utf8"));
    if (!cur.has(name)) {
      console.error(`❌ ${name} 不在 ${CONTRACT_PATH} 数值表中`);
      process.exit(2);
    }
    checks = [{ name, oldNum: from, newNum: cur.get(name) }];
  } else {
    // pre-commit 模式：staged 含 error-codes.ts 才对账
    const staged = git(["diff", "--cached", "--name-only"], repo);
    if (!staged.split("\n").includes(CONTRACT_PATH)) process.exit(0);
    const diff = git(["diff", "--cached", "-U0", "--", CONTRACT_PATH], repo);
    const cur = parseCurrentMappings(readFileSync(contractAbs, "utf8"));
    checks = parseRemovedMappings(diff)
      .filter((r) => cur.has(r.name) && cur.get(r.name) !== r.oldNum)
      .map((r) => ({ ...r, newNum: cur.get(r.name) }));
    if (checks.length === 0) {
      console.log("check-error-code-drift: 未检测到改码（删除映射与现值一致或纯新增），跳过。");
      process.exit(0);
    }
  }

  let total = 0;
  for (const check of checks) {
    const hits = scanDrift(repo, check);
    if (hits.length === 0) continue;
    total += hits.length;
    console.error(
      `\n❌ ${check.name}: ${check.oldNum} → ${check.newNum}，旧数值 ${check.oldNum} 在该错误域残留 ${hits.length} 处：`,
    );
    for (const h of hits) {
      console.error(`  ${h.path}: ${h.text.trim()}`);
    }
  }
  if (total > 0) {
    console.error(
      "\n改码须同步清理注释与测试名中的旧数值（含 @DisplayName / it() 描述）；" +
        "旧数值已合法归属其他错误域的文件不受影响，命中清单按域过滤。" +
        "清理后重新 git add 并提交。",
    );
    process.exit(1);
  }
  console.log(`check-error-code-drift: ${checks.map((c) => `${c.name} ${c.oldNum}→${c.newNum}`).join("、")} 对账通过，无旧数值残留。`);
  process.exit(0);
}

// 被 import 时不执行主流程（供测试）
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
