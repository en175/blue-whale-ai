# 长期维护可执行资产逐步收敛到 Node.js / TypeScript

- **状态**：Accepted
- **日期**：2026-08-09
- **决策者**：KimJohn（经 `grill-with-docs` 会话确认）
- **关联工单**：[IK7FI6 统一技术栈规则与 Python 存量处置决策](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IK7FI6)
- **关联决策**：[ADR-0068 产品主技术栈与专用计算边界](0068-node-typescript-product-runtime-and-specialized-compute-boundary.md)

Blue-Whale 不把 TypeScript 统一限制在产品运行时：新增长期维护的一方 Hook、工作流、验收工具与测试也必须使用 Node.js / TypeScript，现有 Python 存量按风险和维护机会逐步迁移或退役。目标是减少双工具链、同步副本与维护知识分裂，不是立即追求仓库中 `.py` 文件数量归零。

一次性脚本、未经修改的外部工具，以及 ADR-0068 已允许的专用计算组件可以保留其他语言，但必须符合后续明确的分类与例外判据。现有无关 Python 存量不得自动扩大普通功能工单的范围；具体迁移优先级、完成判据、阻塞条件与规则落位由本次 grilling 后续决策补充。

## 被否方案

- **只统一产品运行时，长期工具永久自由选语言**：会长期保留重复依赖、测试方式与维护知识，无法兑现技术栈收敛收益。
- **立即迁移或删除全部 Python 才允许继续普通功能**：会把无关基础设施债务扩张到每个功能工单，违反手术式变更原则。
