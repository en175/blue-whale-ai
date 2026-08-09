# IK7FI6 Python 存量分类与迁移计划

## 时间

2026-08-09

## 背景与目标

本计划承接 ADR-0070，对仓库中 20 个受版本控制的 Python 文件逐项确定迁移、退役或长期暂留去向。目标是在不制造 Hook、授权、Worktree、同步与发布保护空窗的前提下，让长期维护可执行资产逐步收敛到 Node.js / TypeScript；本计划不授权立即修改实现，也不阻塞无关普通功能。

## 分类汇总

| 去向 | 数量 | 含义 |
| --- | ---: | --- |
| 迁移 | 16 | Node 黑盒等价并切换全部入口后删除 Python 实现 |
| 退役 | 4 | 三个同步镜像改用共享实现；一个失效测试先移植有效断言再删除 |
| 长期暂留 | 0 | 迁移期间暂时存在不构成永久语言例外 |

优先级：P0 = 安全、发布、Worktree 关键路径或当前坏测试；P1 = 持续治理工具；P2 = 低频运维验收。优先级表达风险和重要性，不等于跳过兼容门槛直接先切换。

## 逐项清单

| 路径 | 去向 | 优先级 | 完成判据 |
| --- | --- | --- | --- |
| `.claude/hooks/lib/authorization.py` | 迁移 | P0 | Node 实现保持 CLI、退出码、TTL、scope digest、原子 claim/consume 与并发语义；授权黑盒全绿 |
| `.claude/hooks/lib/hook_audit.py` | 迁移 | P0 | 保持 stdin、JSONL、git common dir、轮转、并发完整性及审计失败不改变 Gate 决策 |
| `.claude/hooks/lib/pretool.py` | 迁移 | P0 | 保持全部 mode、stdout/stderr、退出码、Shell/Git alias 解析和 Codex patch 归一化 |
| `.qoder/hooks/lib/authorization.py` | 退役 | P0 | Qoder 改用共享 Node 授权器，四端授权契约全绿后删除镜像 |
| `.qoder/hooks/lib/hook_audit.py` | 退役 | P0 | Qoder 改用共享 Node 审计器，审计契约与四端等价性不变 |
| `.qoder/hooks/lib/pretool.py` | 退役 | P0 | Qoder 改用共享 Node 预处理器，禁止保留第二份策略实现 |
| `scripts/check-hook-closed-loop.py` | 迁移 | P1 | 保持四平台 fixture、correlation、审计计数、诊断与退出码 |
| `scripts/check-hook-contracts.py` | 迁移 | P1 | Node 解析 JSON/TOML 后对同一 matcher、Gate 与审计漂移失败 |
| `scripts/pr-update-evidence.py` | 迁移 | P0 | 保持快照权限/时效、identity/scope/remote、恢复标记和 PR 写回黑盒 |
| `scripts/query-hook-audit.py` | 迁移 | P1 | 保持 JSONL 顺序、过滤、损坏日志失败与无匹配诊断 |
| `scripts/start-task-worktree.py` | 迁移 | P0 | 保持分支命名、inode 守卫、同步/冲突 abort、路径与零半成品副作用 |
| `scripts/sync-task-from-origin.py` | 迁移 | P0 | 保持 recovery schema、backup ref、幂等、冲突回滚、JSON 事件与 finalize 双门槛 |
| `scripts/sync_recovery.py` | 迁移 | P0 | 保持原子替换、0600 权限、push_state 两阶段与 verified PR 字段 |
| `scripts/tests/test_publish_review_package.py` | 迁移 | P0 | 现有发布故障注入场景移植到 `node:test` 并进入标准测试入口 |
| `scripts/tests/test_query_hook_audit.py` | 迁移 | P1 | 过滤与无匹配诊断断言移植到 `node:test` 并进入标准测试入口 |
| `scripts/tests/test_run_ik50gb_c_testsite_probe.py` | 迁移 | P2 | 保留 URL/userinfo、禁 DB/删除、非计费默认、终态与 quota delta，并改为通用测试站探针命名 |
| `scripts/tests/test_sanitize_acceptance_logs.py` | 退役 | P0 | 七项有效断言移植到现行 MJS 脱敏器测试并接入标准入口后删除失效 Python 测试 |
| `scripts/tests/test_start_task_worktree.py` | 迁移 | P0 | 真实 bare remote、冲突/abort、中文分支与 Windows launcher 黑盒等价 |
| `scripts/tests/test_sync_task_from_origin.py` | 迁移 | P0 | recovery head、原子写失败、rollback 与 finalize fail-closed 黑盒等价 |
| `scripts/tests/test_tunnel_testsite_db.py` | 迁移 | P2 | SSH 参数、端口范围和占用 fail-closed 黑盒等价，禁止真实连接测试站 |

## 迁移波次

1. **测试基线与只读检查器**：移植脱敏器断言，迁移审计查询、Hook 契约检查与闭环检查；先建立 Node 测试入口和差分方法。
2. **共享 Hook 运行时**：迁移审计、授权与 PreTool，共享实现通过 Claude、Qoder、Codex、ZCode/Kimi 契约后退役三份 `.qoder` Python 镜像。
3. **Worktree 与同步事务**：迁移 Worktree 创建、rebase/recovery、rollback/finalize 及对应真实 Git 黑盒。
4. **发布与低频验收**：迁移 PR 核验证据、发布故障注入、测试站探针与 SSH 隧道黑盒。

波次必须串行解锁：后一波可以继续普通功能开发，但不得在前一波兼容门槛未通过时切换其正式入口。P0 表示风险高和保护价值高，不代表可以绕过第一波测试基础直接迁移。

## 通用迁移门槛

每个迁移域必须依次完成：冻结 Python 黑盒契约、旁路实现 Node 版本、隔离差分验证、保持稳定包装器逐域切换、全部消费者与测试通过后删除 Python。安全 Hook 的新实现异常必须 fail closed；真实授权、审计和 Git 状态禁止双写。

## 验证与关联

- 关联工单：[IK7FI6](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IK7FI6)
- 架构决策：[ADR-0070](../adr/0070-typescript-convergence-for-maintained-executable-assets.md)
- 盘点基线：`git ls-files '*.py'` 返回 20 个文件。
- 现状测试：`python3 -m unittest discover -s scripts/tests` 共 72 项，65 项通过；7 项失败全部来自已删除 Python 脱敏器的旧测试。
