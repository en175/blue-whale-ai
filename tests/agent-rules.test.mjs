import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test("Gitee work uses one MCP-only channel rule and preserves unknown-outcome handling", () => {
  const policy = read("agent-rules/gitee-mcp-only.md");
  assert.match(read("CLAUDE.md"), /工单与 PR 全部读写仅使用 Gitee MCP/);
  assert.match(read("docs/agents/issue-tracker.md"), /agent-rules\/gitee-mcp-only\.md/);
  assert.doesNotMatch(read("docs/agents/issue-tracker.md"), /MCP → REST|直接转 REST|回退次序固定/);
  assert.match(policy, /结果未知/);
  assert.match(policy, /明确未执行的临时失败最多重试一次/);
  assert.match(policy, /禁止重放 create、merge 或评论/);
  assert.match(policy, /历史记忆.*不能覆盖本规则/);
});

function read(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

test("routes verification work to the progressive testing strategy", () => {
  const rootRules = read("CLAUDE.md");

  assert.match(rootRules, /测试验证.*docs\/agents\/testing-strategy\.md/);
  assert.match(read("docs/agents/testing-strategy.md"), /同一 HEAD.*复用/);
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

test("official implement keeps complete final testing while repository rules define its scope", () => {
  const content = read(".agents/skills/implement/SKILL.md");
  assert.match(content, /full test suite once at the end/);
  assert.match(content, /pre-agreed seams/);
  assert.doesNotMatch(content, /repository-selected verification|Repository code discovery/);
  assert.match(read("CLAUDE.md"), /测试验证.*docs\/agents\/testing-strategy\.md/);
  assert.match(read("AGENTS.md"), /开始任务前完整读取根目录.*CLAUDE\.md/);
  const strategy = read("docs/agents/testing-strategy.md");
  assert.match(strategy, /受影响应用.*完整测试集/);
  for (const condition of ["鉴权与权限", "计费与额度", "数据库迁移", "跨服务契约", "队列重试与幂等"]) {
    assert.ok(strategy.includes(condition), condition);
  }
  assert.match(strategy, /相关必验项.*跳过.*未完成/);
  assert.match(strategy, /无关.*跳过.*原因/);
  assert.match(strategy, /VERIFIED.*命令/);
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
  const frontendWeb = read("agent-rules/frontend-web.md");

  assert.doesNotMatch(rootRules, /仅明确调用 `frontend-delivery`/);
  assert.match(rootRules, /agent-rules\/frontend-web\.md/);
  assert.match(rootRules, /frontend-delivery\/SKILL\.md/);
  assert.match(rootRules, /references\/request\.md/);
  assert.match(skill, /^description: Use when.*web\//m);
  assert.match(skill, /Load this skill for any `web\/` product work/);
  assert.match(skill, /agent-rules\/frontend-web\.md/);
  assert.match(skill, /Do not expand the task to retrofit existing violations/);
  assert.match(skill, /references\/request\.md/);
  assert.match(skill, /web\/src\/shared\/api\/http\.ts/);
  assert.match(frontendWeb, /新加和本任务改到的代码/);
  assert.match(frontendWeb, /存量不合格处不要求立刻改/);
  assert.doesNotMatch(frontendWeb, /console\.log/);
  assert.match(frontendWeb, /### 12\.1 CanvasPage/);
  assert.match(frontendWeb, /禁止写入根 `index\.tsx`/);
  assert.match(frontendWeb, /tool-runtime/);
  assert.match(frontendWeb, /generation\//);
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

test("Claude and Agent skill paths read the same package", () => {
  for (const skill of ["implement/SKILL.md", "receiving-code-review/SKILL.md", "requesting-code-review/SKILL.md"]) {
    assert.equal(read(`.claude/skills/${skill}`), read(`.agents/skills/${skill}`), skill);
  }
});

test("testing strategy requests the readable verification receipt summary", () => {
  assert.match(read("docs/agents/testing-strategy.md"), /verify-change-scope\.mjs summary/);
});

test("verification separates release prerequisites, engineering delivery and post-deployment acceptance", () => {
  const strategy = read("docs/agents/testing-strategy.md");
  for (const field of ["适用环境", "所需证据", "执行责任", "推进条件"]) {
    assert.ok(strategy.includes(field), field);
  }
  for (const phase of ["发布前工程必验", "任务工程交付", "部署后验收"]) {
    assert.ok(strategy.includes(`| ${phase} |`), phase);
  }
  assert.match(strategy, /免业务测试.*工程检查/);
  assert.match(strategy, /工程交付完成不代表.*部署.*业务验收/);
  assert.match(strategy, /业务验收.*NOT_RUN/);
  assert.match(strategy, /环境不足.*不得.*改列.*部署后/);
});

test("ordinary PRs preserve post-deployment NOT_RUN while drafts require a recorded basis", () => {
  const workflow = read("docs/agents/git-workflow.md");
  assert.match(workflow, /默认.*普通 PR.*draft=false/);
  assert.match(workflow, /用户明确要求.*已确认规则.*规格/);
  assert.match(workflow, /--draft-reason/);
  assert.match(workflow, /仅部署后验收.*NOT_RUN.*普通 PR/);
  assert.match(workflow, /回读.*draft.*依据/);
  assert.match(workflow, /草稿.*不能绕过.*发布前/);
  const review = read("docs/agents/commit-and-review.md");
  assert.match(review, /阶段.*环境.*证据.*责任.*结果.*缺失原因/);
  assert.match(review, /PR 和工单.*NOT_RUN/);
});

test("pr skill keeps its template scaffolding in Chinese while guidance stays upstream English", () => {
  const skill = read(".claude/skills/pr/SKILL.md");
  const authority = read(".agents/skills/pr/SKILL.md");
  const workflow = read("docs/agents/git-workflow.md");

  assert.equal(authority, skill);

  for (const heading of ["## 概要", "## 验证证据", "## 合并风险", "**变更前：**", "**变更后：**", "**可逆性：**", "**影响半径：**"]) {
    assert.ok(skill.includes(heading), heading);
  }
  assert.doesNotMatch(skill, /(?<!#)## (Summary|Evidence|Merge Danger)/m);
  for (const legacy of ["**Before:**", "**After:**", "**Door:**", "**Blast Radius:**"]) {
    assert.ok(!skill.includes(legacy), legacy);
  }
  assert.match(skill, /^description: "Use when writing a PR body\."$/m);
  assert.match(skill, /## Sections\n\nSkip all preambles/);
  assert.match(skill, /localization: "模板骨架中文化/);
  assert.doesNotMatch(workflow, /Summary 图示|Merge Danger/);
});

test("commit review rules link to the pr skill instead of duplicating its template", () => {
  const reviewRules = read("docs/agents/commit-and-review.md");

  assert.match(reviewRules, /唯一权威.*\.agents\/skills\/pr\/SKILL\.md/);
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
  assert.match(read('CLAUDE.md'), /代码理解.*agent-rules\/code-discovery\.md/);
  assert.match(read('AGENTS.md'), /开始任务前.*CLAUDE\.md.*按其路由表/);
  for (const path of ['CLAUDE.md', 'AGENTS.md']) {
    assert.doesNotMatch(read(path), /first run `graphify/);
  }
  assert.doesNotMatch(read('docs/agents/worktree-workflow.md'), /MCP 不可用或索引失败时，必须停止/);
});

test("Gitee lifecycle routes to one state authority without executable retired IDs", () => {
  const root = read("CLAUDE.md");
  const authority = read("docs/agents/gitee-workflow-agent.md");
  const tracker = read("docs/agents/issue-tracker.md");
  assert.match(root, /开工、恢复、返工、部署确认、提测、生产验证与收口.*gitee-workflow-agent\.md/);
  assert.match(tracker, /\[Agent 工作流手册\]\(gitee-workflow-agent\.md\)/);
  for (const path of ["docs/agents/issue-tracker.md", "docs/agents/integration-branch-workflow.md",
    ".agents/skills/setup-matt-pocock-skills/issue-tracker-gitee.md"]) {
    assert.ok(read(path).includes("gitee-workflow-agent.md"), path);
    assert.doesNotMatch(read(path), /4501158|4336306|4336307|4336302|4445125/, path);
  }
  assert.match(authority, /状态池只证明 ID 有效，不证明具备流转条件/);
  assert.match(authority, /规划发布和拆单不借 C 完成产品父单/);
  assert.match(tracker, /状态更新不携带 `description`/);
  assert.match(tracker, /open、progressing、closed、rejected 的全部分页/);
  assert.doesNotMatch(tracker, /state == "closed"/);
  assert.equal(read(".agents/skills/setup-matt-pocock-skills/issue-tracker-gitee.md"),
    read(".claude/skills/setup-matt-pocock-skills/issue-tracker-gitee.md"));
});
