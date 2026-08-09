# IK7FI6 Python 存量处置清单

## 时间

2026-08-09

## 边界

本清单盘点 `git ls-files '*.py'` 返回的 20 个受版本控制 Python 文件。它们均属于 Hook、Worktree、Git/发布、运维验收或对应测试，不是产品运行时。产品采用 TypeScript、Next.js 与 Node.js Workers 不构成迁移这些文件的理由。

## 分类汇总

| 去向 | 数量 | 含义 |
| --- | ---: | --- |
| 迁移 | 0 | 不因产品技术栈改写工程协作控制面 |
| 保留 | 19 | 继续按现有语言和行为维护，不设语言迁移期限 |
| 退役 | 1 | 失效测试在有效断言转入现行 MJS 测试后删除 |

保留项没有迁移优先级。唯一待处理项是失效测试，优先级 P1；它是现状测试缺陷，不是技术栈迁移任务。

## 逐项清单

| 路径 | 去向 | 依据或完成判据 |
| --- | --- | --- |
| `.claude/hooks/lib/authorization.py` | 保留 | Agent 授权控制面；保持现有原子 claim/consume 与并发语义 |
| `.claude/hooks/lib/hook_audit.py` | 保留 | Hook 审计控制面；保持审计失败不改变既有 Gate 决策 |
| `.claude/hooks/lib/pretool.py` | 保留 | Hook 输入解析与安全决策辅助；按现有宿主契约维护 |
| `.qoder/hooks/lib/authorization.py` | 保留 | Qoder 协作配置的现行实现；是否合并副本由独立维护需求决定 |
| `.qoder/hooks/lib/hook_audit.py` | 保留 | Qoder 协作配置的现行实现；不因语言统一退役 |
| `.qoder/hooks/lib/pretool.py` | 保留 | Qoder 协作配置的现行实现；不因语言统一退役 |
| `scripts/check-hook-closed-loop.py` | 保留 | Hook 闭环治理工具 |
| `scripts/check-hook-contracts.py` | 保留 | Hook 宿主契约治理工具 |
| `scripts/pr-update-evidence.py` | 保留 | PR 更新与恢复证据控制面 |
| `scripts/query-hook-audit.py` | 保留 | Hook 审计查询工具 |
| `scripts/start-task-worktree.py` | 保留 | Worktree 协作事务入口 |
| `scripts/sync-task-from-origin.py` | 保留 | Git 同步与恢复事务入口 |
| `scripts/sync_recovery.py` | 保留 | Git/PR 恢复状态工具 |
| `scripts/tests/test_publish_review_package.py` | 保留 | 发布控制面黑盒测试 |
| `scripts/tests/test_query_hook_audit.py` | 保留 | Hook 审计工具测试 |
| `scripts/tests/test_run_ik50gb_c_testsite_probe.py` | 保留 | 运维验收探针测试；重命名等维护另行处理 |
| `scripts/tests/test_sanitize_acceptance_logs.py` | 退役（P1） | 被测 Python 实现已不存在；七项有效断言转入现行 MJS 脱敏器测试并进入标准测试入口后删除 |
| `scripts/tests/test_start_task_worktree.py` | 保留 | Worktree 事务黑盒测试 |
| `scripts/tests/test_sync_task_from_origin.py` | 保留 | Git 同步/恢复黑盒测试 |
| `scripts/tests/test_tunnel_testsite_db.py` | 保留 | 测试站 SSH 隧道验收测试 |

## 后续触发条件

保留项只有在自身出现缺陷、安全、兼容或维护需求时才进入对应工单；是否继续使用 Python 由该问题的实际约束决定。普通产品功能即使会经过 Hook、Worktree 或发布流程，也不因此触发工具迁移。

Shell 内嵌 Python、`python3-command.sh` 和其他 Python 调用方属于同一工程协作控制面，不是本决策下的迁移遗漏。若将来改写某个工具，必须按该工具现有契约验证，但 IK7FI6 不预设 Node.js 目标或迁移波次。

## 执行顺序与验收

| 去向 | 进入条件 | 执行顺序 | 完成验收 |
| --- | --- | --- | --- |
| 迁移 | 当前无迁移项；未来仅在已接纳决策或工具自身的独立工单明确要求改写时进入 | 先冻结现有调用契约和安全语义，再替换实现，最后移除旧入口 | 原调用方切换完成；替代实现通过原契约的范围化测试与标准测试入口；旧实现和失效引用均已删除 |
| 保留（工单所称“暂时保留”） | 当前 19 项继续维护且不设迁移期限；只有自身出现缺陷、安全、兼容或维护需求时另开工单评估 | 普通产品功能不排入迁移队列；触发独立维护工单后按该工单风险排序 | 未触发维护时以逐项清单与 `git ls-files '*.py'` 一致为准；触发维护时以该工具既有契约测试通过为准 |
| 退役 | 仅 `scripts/tests/test_sanitize_acceptance_logs.py`；被测 Python 实现已不存在 | 先把七项有效断言转入现行 MJS 脱敏器测试并纳入标准测试入口，再删除旧 Python 测试 | MJS 脱敏器测试与标准测试入口通过；旧测试不再被 Python 测试发现；受版本控制 Python 清单由 20 项变为 19 项并与本清单一致 |

上述顺序只定义处置完成判据，不授权 IK7FI7 实施迁移或退役；对应代码改动必须进入独立工单。

## 验证与关联

- 关联工单：[IK7FI6](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IK7FI6)
- 架构决策：[ADR-0070](../adr/0070-product-runtime-stack-does-not-govern-engineering-control-plane.md)
- 盘点基线：`git ls-files '*.py'` 返回 20 个文件。
- 现状测试：`python3 -m unittest discover -s scripts/tests` 共 72 项，65 项通过；7 项失败全部来自已删除 Python 脱敏器的旧测试。
