# 验证脚本显式分类设计

## 目标

消除“未知路径自动升级整栈验收”的误拦，同时保留发布前的 fail-closed 边界。验证强度由改动的实际影响面决定，不由文件位于 `scripts/`、Hook 或规则目录这一事实决定。

## 分类规则

`scripts/` 下每个脚本必须命中一个显式类别：

- `governance/control-plane`：Hook、Git、worktree、PR、授权、审计、规则和技能同步。运行治理规则测试、Hook 契约测试及对应脚本单测，不运行产品整栈验收。
- `build/runtime/database/acceptance`：产品构建、运行环境、数据库初始化与迁移、整栈验收入口。PR 阶段升级为 `full` 并包含 acceptance。
- `operations/one-off`：探针、隧道、一次性修复和维护工具。运行语法检查及已有定向测试；只有显式 `--risk high` 才升级为 `full`。

`.claude/hooks/`、`.codex/hooks/`、`.githooks/` 属于 `governance/control-plane`，不再因路径本身触发产品整栈验收。

## 未分类路径

任何未命中分类的新脚本或可执行路径返回 `UNCLASSIFIED_PATH` 并阻止生成验证凭证。它是分类配置错误，不自动执行 `pnpm verify`，也不静默降级为 scoped。维护者必须先补分类和对应测试。

普通未知 Markdown 继续由文档/技能规则判断；本次只收紧可执行路径，避免把散文文档维护变成分类登记工作。

## 测试与文档

- 分类器单测覆盖三类脚本、Hook 路径和未知脚本。
- CLI 单测确认未知路径快速失败且不会调用 `pnpm verify`。
- 发布门禁仍拒绝缺失或无效凭证。
- `docs/agents/testing-strategy.md` 作为唯一策略说明源；其他工作流文档只链接，不复制分类表。

## 非目标

- 不降低显式 `--risk high` 的 full + acceptance 行为。
- 不改变产品运行、数据库、部署或整栈验收路径的高风险等级。
- 不在本次重构各脚本自身业务逻辑。
