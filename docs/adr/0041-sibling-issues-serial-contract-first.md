# ADR-0041：同族工单串行与契约字段先行

- **状态**：Accepted
- **日期**：2026-07-22
- **决策者**：用户（与 Agent 诊断会话共同得出，触发事件：IK2QBM 与 IK2QBZ 反复合并冲突）

## 背景

工单 IK2QBM（受限资源读取闸门 ResourceGate 正式化，commit `bcabf27`）合入后，基于旧 master（`c53a508`）并行开发的 IK2QBZ（对话渐进读取）在合入时反复撞墙。用 `git merge-tree --write-tree` 干跑复现，确认 4 个文本冲突 + 1 个文本合并看不见的隐形断点：

1. `contracts.py::OrchestratorResult`：master 有 `bundle_evidence`，IK2QBZ 自造 `read_evidence`——同一条契约义务（§6.4「Worker commit 必须回传资源摘要证据」）长出两套字段。
2. `pydantic_orchestrator.py`：master 的 `ResourceGate` vs IK2QBZ 自造的 `ConversationReadGate`——同一个读取预算门，两套实现。
3. `RunCommitRequest.java`：Java 侧同样两套证据字段。
4. 隐形断点：IK2QBZ 的 `read_gate.py` 引用 `from .loader import _estimate_chars_div_4`，而 IK2QBM 已把该函数搬到 `tokens.py` 并改名——文本合并不报警，合入后直接 ImportError。

根因是三层叠加的系统性模式，不是单个工单的质量问题：

- **核心路口无隔离**：最近 14 个 worker 改动中 `pydantic_orchestrator.py` 被改 7 次（50%）、`contracts.py` 6 次——每个编排能力工单必改同一批文件。
- **基础设施后于功能工单合入**：IK2QBZ 开工时 ResourceGate 尚不存在，知情地自造平行轮子；IK2QBM 一个提交对 5 个核心文件做破坏性签名变更（`loader.load()` 返回类型、`tokens.py` 搬家、`_load_instructions` 改名），所有在飞分支全被撞断。
- **契约未定死字段名**：契约 §6.4 只规定「必须回传证据」的义务，未规定字段名与形状，Python / Java 两侧各自发明。

## 决策

### D1. 同族工单串行

实现同一契约章节的基础设施工单与功能工单不得并行开工：基础设施工单先合入本地 master，功能工单再基于新 master 创建分支。禁止并行分支各自造同构轮子。

### D2. 契约字段先定死后开工

契约条款要求跨进程交换的数据（回传字段、请求/响应形状），必须先在契约文档（`docs/specs/`）中定死字段名与形状，相关工单方可开工。字段未定死前，任何一侧不得各自发明。

### D3. 契约文件改动独立小单先行

跨服务契约文件（Worker `contracts.py`、Java `RunCommitRequest.java` 等）的改动尽量拆成独立小工单先行合入；功能工单基于已合入的契约开发，不在功能工单里夹带契约变更。

## 备选方案与不采纳理由

- **只适配 IK2QBZ 不立规**：解开本次阻塞但不防复发，下一个并行工单还会撞同一路口。
- **编排核心注册式扩展点重构**（`_build_tools` / `OrchestratorResult` 只增不改的稳定扩展面）：方向正确但工作量大，留待后续独立工单评估；本 ADR 的 D1–D3 先用调度纪律止血。

## 后果

- 正面：消除「同一概念两套字段/两套实现」的合并撞车；契约变更可追溯、可审查。
- 代价：同族工单并行度下降，排期需显式排出基础设施先行顺序。
- 操作细则维护在 `.claude/rules/git-workflow.md`「同族工单串行与契约先行」一节；CLAUDE.md 最高红线区有一行摘要。
