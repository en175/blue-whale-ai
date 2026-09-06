# 技能资产验证 Implementation Plan

**Goal:** 修复三个技能资产无法进入整体验证的问题。

**Architecture:** 在既有分类器中精确映射skill-assets，追加真实资产检查命令，保留原有未知路径与full策略。

**Tech Stack:** Node.js node:test、Bash、现有验证选择器。

## Global Constraints

不修改产品代码及技能内容；未知脚本继续拦截；不发布、不自动合并。方案见同目录2026-09-06-skill-asset-verification.md。

### Task 1: 分类与真实验证

Files: scripts/verification-policy.mjs、tests/verification-policy.test.mjs、tests/skill-assets.test.mjs。

Interfaces: classifyChanges(files,options)返回包含skill-assets的areas；buildVerificationPlan(classification,{base})生成命令。

- [ ] 添加分类、实际命令和未知路径负向测试；运行node --test --test-name-pattern="skill assets" tests/verification-policy.test.mjs，确认旧实现因UNCLASSIFIED_PATH失败。
- [ ] sourceArea精确识别三个.zcode路径与tests/skill-assets.test.mjs，返回skill-assets；appendAreaCommands追加下列检查。

```js
["bash", ".zcode/skills/deploy-blue-whale-api/tests/test-tag-propagation.sh"]
["bash", "-n", ".zcode/skills/wizard/template.sh"]
["node", "--check", ".zcode/skills/setup-ts-deep-modules/dependency-cruiser.config.cjs"]
["node", "--test", "tests/skill-assets.test.mjs"]
```

- [ ] 配置行为测试读取真实导出，检查跨模块内部禁止、公开入口放行、本模块内部调用允许及测试目录边界。
- [ ] 运行node --test tests/verification-policy.test.mjs tests/skill-assets.test.mjs tests/agent-rules.test.mjs及三个资产检查，预期全通过。
- [ ] 使用scripts/commit-task-for-review.sh提交；run/check --base 4fcd986307d265a06e41d77a6c2ff6ed0a9c9c48取得整体收口凭证，审查后交付。
