# ADR-0067: issue-tracker 规则转渐进式加载——修订 ADR-0044 §3

**日期：** 2026-08-06
**状态：** 已接受
**关联：** 修订 [ADR-0044](0044-rules-progressive-loading.md) §3「文件差别对待」的 issue-tracker 行；CLAUDE.md 路由表

## 背景

ADR-0044（2026-07-25）将 `.claude/rules/issue-tracker.md` 保留为常驻，理由是「API 坑基本无 hook 兜底，漏读即错」。此后两个前提发生变化：

1. **hook 兜底已建立**：`block-issue-without-repo.sh`（缺 `project_id` 硬拦，阻断文案指路回读验证）与 `remind-issue-state.sh`（状态流转三触发点纯提醒，指路状态机）在工具调用当下送达指针，0044 的「无覆盖」判断不再成立。
2. **常驻机制只对单一平台生效**：`.claude/rules/*.md` 启动注入是 Claude Code 私有机制；本仓 Agent 矩阵（Claude Code / Codex / ZCode / Kimi / Qoder）中多数端不注入该目录。全端统一的常驻层只有 CLAUDE.md（根 AGENTS.md 强制先读）。只保护部分端的安全网不构成团队级安全网。

同时，`.claude/rules/issue-tracker.md` 与 `docs/agents/issue-tracker.md` 长期并存且内容大量重叠（回读验证、创建必传 project_id、labels 静默忽略、子 issue 继承、关单参数名均写了两遍），后者还需声明「状态机以该文件为准」——两份文件本身就是重复源。

ADR-0044 自己的分层设计已将**不可恢复的坑**（固定 ID、883843 误传 → 误导性 401、写参数静默忽略）缓存进 CLAUDE.md「Gitee ID 兜底常量」及两条 ⚠️。rules 全文独有的内容（状态 id 表、label 合并写回、子 issue 反查、PathWithNamespace 404）全部是可自恢复错误——API 报错即提示重查。

## 决策

1. **合并为单一权威源**：`.claude/rules/issue-tracker.md` 内容并入 `docs/agents/issue-tracker.md`（状态机全文、创建/合并 PR 陷阱、Triage 五标签），删除 `.claude/rules/` 与 `.qoder/rules/` 两处副本。issue-tracker 规则转为纯渐进式，与 git-workflow / code-intelligence 同一加载方式。
2. **常驻层保持 ADR-0044 分层**：CLAUDE.md 保留 ID 兜底常量、两条 ⚠️ 陷阱警告、任务状态机摘要（声明为常驻摘要，全文指针指向合并后的手册）。
3. **路由表触发词硬化**：该行标注改为「渐进式，任何 `mcp__gitee-ent__*` 调用前 Must Read」。
4. hook 阻断/提醒文案、`.kimi-code/hooks.toml`、`scripts/check-hook-contracts.py`、`docs/agents/hooks/README.md` 中的旧路径引用同步指向 `docs/agents/issue-tracker.md`。
5. 附带 CLAUDE.md 去沉积：开工入口命令串从 3 处降为「定义一次 + 术语引用」，ADR-0025/ADR-0010 例外全文归位「写入前自检」末节（红线 4 只留指针），红线 5 收回摘要层，删除与 code-intelligence.md 重复的顶部「代码理解工具」节（常驻提醒并入路由表行）。

## 后果

- Claude Code 启动注入减少约 600 token（issue-tracker.md 全文不再常驻）；其他端不变（本就靠 CLAUDE.md + 指针）。
- 漏读保护三层：CLAUDE.md 缓存（不可恢复的坑）→ hook 在调用当下指路（状态流转、缺 project_id）→ 路由表 Must Read。剩余未覆盖的坑全部可自恢复（API 报错即显形）。
- 维护面：issue-tracker 规则只剩一个文件、每处含义单一源；改参数/状态时不再双写。
- 风险：Agent 未读全文直接调写工具，可能撞上 label 覆盖写、子 issue 未反查等可恢复错误——由回读验证要求（CLAUDE.md ⚠️ 常驻）与 hook 提醒缓解。
