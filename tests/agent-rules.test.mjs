import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function read(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

test("routes verification work to the progressive testing strategy", () => {
  const rootRules = read("CLAUDE.md");

  assert.match(rootRules, /测试验证.*docs\/agents\/testing-strategy\.md/);
  assert.match(rootRules, /同一 HEAD.*复用/);
});

test("documents every required branch of the testing strategy", () => {
  const strategy = read("docs/agents/testing-strategy.md");

  for (const heading of ["验证层级", "验收范围", "凭证复用", "失败与重试", "耗时治理"]) {
    assert.match(strategy, new RegExp(`## ${heading}`));
  }
  assert.match(strategy, /UNCLASSIFIED_PATH/);
  assert.match(strategy, /新增脚本未命中分类.*不运行全量/);
  assert.match(strategy, /禁止.*降级/);
  assert.match(strategy, /输入指纹/);
  assert.match(strategy, /分阶段耗时/);
  assert.match(strategy, /低层级凭证.*不得覆盖/);
  assert.match(strategy, /--retry-kind.*(?:infrastructure|known-flaky)/);
  assert.doesNotMatch(strategy, /--retry-infrastructure/);
});

test("project skills delegate final verification to the repository strategy", () => {
  const skillPaths = [
    ".claude/skills/implement/SKILL.md",
    ".superpowers/skills/dispatching-parallel-agents/SKILL.md",
    ".superpowers/skills/finishing-a-development-branch/SKILL.md",
    ".superpowers/skills/subagent-driven-development/implementer-prompt.md",
  ];

  for (const path of skillPaths) {
    const content = read(path);
    assert.doesNotMatch(content, /full (?:test )?suite|project's test suite/i, path);
    assert.match(content, /repository-selected verification|repository testing strategy/i, path);
  }
});

test("frontend Bugfix workflow extracts sparse Issue details instead of gating on a template", () => {
  const workflow = read(".claude/skills/frontend-delivery/references/bugfix.md");

  assert.match(workflow, /not\W+an entry gate/);
  assert.match(workflow, /`confirmed`.*`inferred`.*`unknown`/s);
  assert.match(workflow, /Do not require the Issue author to rewrite a terse requirement into a template/);
  assert.match(workflow, /two or more materially different safe fixes/);
  assert.doesNotMatch(workflow, /If a required field is absent, stop/);
  assert.doesNotMatch(workflow, /已终止前端 Bugfix 流程/);
});

test("frontend-delivery auto-loads for web work and routes new fetches to TanStack Query", () => {
  const rootRules = read("CLAUDE.md");
  const skill = read(".claude/skills/frontend-delivery/SKILL.md");
  const request = read(".claude/skills/frontend-delivery/references/request.md");
  const policy = read(".claude/skills/frontend-delivery/agents/openai.yaml");

  assert.doesNotMatch(rootRules, /仅明确调用 `frontend-delivery`/);
  assert.match(rootRules, /frontend-delivery\/SKILL\.md/);
  assert.match(rootRules, /references\/request\.md/);
  assert.match(skill, /^description: Use when.*web\//m);
  assert.match(skill, /Load this skill for any `web\/` product work/);
  assert.match(skill, /references\/request\.md/);
  assert.match(policy, /allow_implicit_invocation: true/);
  assert.match(request, /@tanstack\/react-query/);
  assert.match(request, /queryOptions/);
  assert.match(request, /silent: true/);
  assert.match(request, /Do not migrate existing `useEffect`/);
  assert.match(request, /refetchOnWindowFocus: false/);
});

test("frontend delivery progressively routes scroll compositing guidance to frontend styling", () => {
  const delivery = read(".claude/skills/frontend-delivery/SKILL.md");
  const styling = read(".claude/skills/frontend-styling/SKILL.md");
  const scrolling = read(".claude/skills/frontend-styling/references/scroll-compositing.md");
  const policy = read(".claude/skills/frontend-styling/agents/openai.yaml");

  assert.match(delivery, /\[frontend-styling\]\(\.\.\/frontend-styling\/SKILL\.md\)/);
  assert.match(styling, /This skill supplements `frontend-delivery`/);
  assert.match(styling, /references\/scroll-compositing\.md/);
  assert.match(policy, /allow_implicit_invocation: true/);
  assert.match(scrolling, /must not declare `backdrop-filter` or `-webkit-backdrop-filter`/);
  assert.match(scrolling, /including a `none` value/);
  assert.match(scrolling, /the scrolling container/);
  assert.match(scrolling, /repeated items/);
  assert.match(scrolling, /list skeletons/);
  assert.match(scrolling, /thumbnail\/media overlays/);
  assert.match(scrolling, /persistent controls inside an item/);
});

test("frontend-delivery routes explicit feat work to its reference", () => {
  const skill = read(".claude/skills/frontend-delivery/SKILL.md");
  const workflow = read(".claude/skills/frontend-delivery/references/feature.md");

  assert.match(skill, /Explicit frontend \*\*feat\*\* workflow/);
  assert.match(skill, /references\/feature\.md/);
  assert.match(skill, /only when the user explicitly says/);
  assert.match(workflow, /A Gitee Issue is optional context, not an entry condition/);
  assert.match(workflow, /--no-issue/);
  assert.match(workflow, /Do not create a worktree, write code, install dependencies, or start services before/);
  assert.match(workflow, /`npm run dev:test`/);
  assert.match(workflow, /Without an explicit human pass, do not claim completion/);
});

test("tracked skill mirrors match their authoritative sources", () => {
  assert.equal(read(".zcode/skills/implement/SKILL.md"), read(".claude/skills/implement/SKILL.md"));

  for (const skill of [
    "dispatching-parallel-agents/SKILL.md",
    "finishing-a-development-branch/SKILL.md",
    "subagent-driven-development/implementer-prompt.md",
  ]) {
    const authority = read(`.superpowers/skills/${skill}`);
    assert.equal(read(`.claude/skills/${skill}`), authority, skill);
    assert.equal(read(`.zcode/skills/${skill}`), authority, skill);
  }
});

test("PR template requests the readable verification receipt summary", () => {
  const template = read(".gitee/PULL_REQUEST_TEMPLATE.md");

  for (const field of ["验证层级", "验证 HEAD", "验证结果", "总耗时", "验证命令"]) {
    assert.match(template, new RegExp(field));
  }
});

test("pr skill keeps its body scaffolding in Chinese", () => {
  const skill = read(".claude/skills/pr/SKILL.md");
  const mirror = read(".zcode/skills/pr/SKILL.md");
  const workflow = read("docs/agents/git-workflow.md");

  assert.equal(mirror, skill);

  for (const heading of ["## 概要", "## 验证证据", "## 合并风险", "**变更前：**", "**变更后：**", "**可逆性：**", "**影响半径：**"]) {
    assert.ok(skill.includes(heading), heading);
  }
  for (const legacy of ["## Summary", "## Evidence", "## Merge Danger", "**Before:**", "**After:**", "**Door:**", "**Blast Radius:**"]) {
    assert.ok(!skill.includes(legacy), legacy);
  }
  assert.match(skill, /localization: "中文语言定制/);
  assert.doesNotMatch(workflow, /Summary 图示|Merge Danger/);
});

test("commit review rules link to the PR template instead of duplicating it", () => {
  const reviewRules = read("docs/agents/commit-and-review.md");

  assert.match(reviewRules, /权威模板.*\.gitee\/PULL_REQUEST_TEMPLATE\.md/);
  assert.doesNotMatch(reviewRules, /```markdown[\s\S]*## 对应开发分支/);
});

test("typecheck generates the Prisma client before compiling a fresh worktree", () => {
  const packageJson = JSON.parse(read("package.json"));

  assert.match(
    packageJson.scripts.typecheck,
    /^pnpm --filter @blue-whale\/backend exec prisma generate && /,
  );
});

test("CBM exploration has one policy before worktree creation", () => {
  assert.match(read('CLAUDE.md'), /agent-rules\/code-discovery.md/);
  assert.match(read('AGENTS.md'), /agent-rules\/code-discovery.md/);
  for (const path of ['CLAUDE.md', 'AGENTS.md']) {
    assert.doesNotMatch(read(path), /first run `graphify/);
  }
  assert.doesNotMatch(read('docs/agents/worktree-workflow.md'), /MCP 不可用或索引失败时，必须停止/);
});
