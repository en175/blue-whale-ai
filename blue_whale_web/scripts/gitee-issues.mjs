#!/usr/bin/env node
/**
 * 直连 Gitee REST API 的 issue 列表小工具。
 *
 * 为什么存在：绕过 @gitee/mcp-gitee native binary 在 `state="open"` 上的 404 bug。
 * 详见仓库根 CLAUDE.md "协作：用 Gitee，不用 GitHub" 一节的已知 bug 条目。
 *
 * 用法：
 *   node blue_whale/scripts/gitee-issues.mjs list [open|closed|progressing|rejected|all]
 *
 * 必需环境变量（已配在 ~/.zshenv，不需要重复 export）：
 *   GITEE_ACCESS_TOKEN  Gitee 个人访问令牌
 *   GITEE_API_BASE      默认 https://gitee.com/api/v5
 *   GITEE_OWNER         企业/用户路径，例如 hangzhou-xuanfu_1
 *   GITEE_REPO          仓库名，例如 blue-whale-ai
 */

const TOKEN = process.env.GITEE_ACCESS_TOKEN;
const BASE = process.env.GITEE_API_BASE ?? "https://gitee.com/api/v5";
const OWNER = process.env.GITEE_OWNER;
const REPO = process.env.GITEE_REPO;

const [, , cmd, ...rest] = process.argv;

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function requireEnv() {
  for (const [k, v] of [
    ["GITEE_ACCESS_TOKEN", TOKEN],
    ["GITEE_OWNER", OWNER],
    ["GITEE_REPO", REPO],
  ]) {
    if (!v) die(`missing env ${k}`);
  }
}

/**
 * 拉一页 issue。state 参数透传给 Gitee（不会出现 MCP 那种 bug，因为是直连）。
 */
async function fetchIssuesPage(state, page = 1, perPage = 50) {
  const url = new URL(`${BASE}/repos/${OWNER}/${REPO}/issues`);
  url.searchParams.set("access_token", TOKEN);
  url.searchParams.set("state", state);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text();
    die(`GET ${url.pathname} → HTTP ${res.status}\n${body.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Gitee 直连对 "open" 已经能返回正确结果，但这里统一只请求 state=all，
 * 然后客户端过滤想要的状态 —— 一处兜底，避免任何 API 行为差异。
 */
async function listIssues(filterState) {
  const all = await fetchIssuesPage("all", 1, 100);
  if (filterState === "all") return all;
  return all.filter((i) => i.state === filterState);
}

function formatIssue(i) {
  const labels = (i.labels ?? []).map((l) => l.name).join(",");
  return [
    `#${i.number}`,
    `[${i.state}]`,
    labels ? `{${labels}}` : "",
    i.title,
    `— ${i.user?.login ?? "?"}`,
  ]
    .filter(Boolean)
    .join(" ");
}

async function main() {
  requireEnv();

  if (cmd !== "list") {
    die(
      `unknown command: ${cmd ?? "(none)"}\nusage: gitee-issues.mjs list [open|closed|progressing|rejected|all]`,
    );
  }

  const filterState = rest[0] ?? "all";
  const valid = ["open", "closed", "progressing", "rejected", "all"];
  if (!valid.includes(filterState)) {
    die(`invalid state: ${filterState}\nallowed: ${valid.join(", ")}`);
  }

  const issues = await listIssues(filterState);
  console.log(
    `# ${issues.length} issue(s) with state=${filterState} in ${OWNER}/${REPO}`,
  );
  for (const i of issues) console.log(formatIssue(i));
}

main().catch((e) => die(e.stack ?? String(e)));
