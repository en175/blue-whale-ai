#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CONTRACT_PATH = "backend/libs/contracts/error-codes.ts";

const MAPPING_RE = /\[(ERROR_[A-Z0-9_]+)\]\s*:\s*(\d+)/g;

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

export function parseCurrentMappings(fileText) {
  const map = new Map();
  for (const m of fileText.matchAll(MAPPING_RE)) {
    map.set(m[1], Number(m[2]));
  }
  return map;
}

export function domainToken(name) {
  const core = name.replace(/^ERROR_/, "").replace(/_FAILED$/, "");
  return core.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normalizeForDomainMatch(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isDomainHit(lineText, filePath, token) {
  return (
    normalizeForDomainMatch(lineText).includes(token) ||
    normalizeForDomainMatch(filePath).includes(token)
  );
}

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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
