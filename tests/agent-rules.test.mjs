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
  assert.doesNotMatch(skill, /only when the user explicitly/);
  assert.match(skill, /references\/request\.md/);
  assert.match(policy, /allow_implicit_invocation: true/);
  assert.match(request, /@tanstack\/react-query/);
  assert.match(request, /queryOptions/);
  assert.match(request, /silent: true/);
  assert.match(request, /Do not migrate existing `useEffect`/);
  assert.match(request, /refetchOnWindowFocus: false/);
});

test("feat delivery is explicit, accepts no Issue, and requires human regression", () => {
  const workflow = read(".claude/skills/feat-delivery/SKILL.md");
  const policy = read(".claude/skills/feat-delivery/agents/openai.yaml");

  assert.match(workflow, /^description: Use when.*explicitly requests the feat workflow/m);
  assert.match(workflow, /disable-model-invocation: true/);
  assert.match(policy, /allow_implicit_invocation: false/);
  assert.match(workflow, /工单是可选上下文，不是入口条件/);
  assert.match(workflow, /--no-issue/);
  assert.match(workflow, /未获用户对“前端可执行需求”的明确确认，不创建 worktree、不写代码/s);
  assert.match(workflow, /`npm run dev:test`/);
  assert.match(workflow, /没有用户明确的通过结论，不得宣称功能完成/s);
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

test("commit review rules link to the PR template instead of duplicating it", () => {
  const reviewRules = read("docs/agents/commit-and-review.md");

  assert.match(reviewRules, /权威模板.*\.gitee\/PULL_REQUEST_TEMPLATE\.md/);
  assert.doesNotMatch(reviewRules, /```markdown[\s\S]*## 对应开发分支/);
});

test("typecheck generates the Prisma client before compiling a fresh worktree", () => {
  const packageJson = JSON.parse(read("package.json"));

  assert.match(
    packageJson.scripts.typecheck,
    /^pnpm --filter @blue-whale\/persistence exec prisma generate && /,
  );
});
