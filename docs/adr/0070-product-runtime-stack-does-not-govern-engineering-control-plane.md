# 产品运行时技术栈不约束工程协作控制面

- **状态**：Accepted
- **日期**：2026-08-09
- **决策者**：KimJohn（经 `grill-with-docs` 会话最终确认）
- **关联工单**：[IK7FI6 统一技术栈规则与 Python 存量处置决策](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IK7FI6)
- **关联决策**：[ADR-0068 产品主技术栈与专用计算边界](0068-node-typescript-product-runtime-and-specialized-compute-boundary.md)、[ADR-0069 核心基础设施选型](0069-core-infrastructure-selection-and-authority-boundaries.md)
- **后续实施**：[IK7FI7 落地技术栈规则与 Python 迁移策略](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IK7FI7)

产品技术栈与工程协作控制面解决不同问题，不能因为它们位于同一仓库就采用同一语言约束。产品实现遵循 ADR-0068：TypeScript 是实现语言，Next.js App Router / Route Handlers 承载 Web 与浏览器业务 API，后台任务由独立 Node.js LTS Workers 执行，共享领域、契约和持久化能力位于 TypeScript packages。

Hook、Worktree、Git/PR/发布、Agent 授权与审计属于工程协作控制面。它们服务团队治理，不承载用户产品能力或产品事实，其语言选择以稳定、兼容和维护成本为准。现有 Python、Shell 或其他实现不因为产品主栈选择而形成迁移债务；产品测试、构建脚本和数据库维护工具可以优先沿用 TypeScript 生态，但不受全仓语言禁令。

专用计算组件仍按 ADR-0068 管理：只有在 Node.js 不适合且边界清晰时采用其他运行时，并保持产品事实和 Product API 的单一权威。

## Python 存量处置

本次盘点的 20 个受版本控制 Python 文件中，0 个因产品技术栈迁移，19 个保留，1 个失效测试退役。Shell 内嵌 Python 与 Python 调用方同属工程协作控制面，不在本决策下迁移。逐文件结论见 [IK7FI6 Python 存量处置清单](../specs/2026-08-09-ik7fi6-python-inventory-disposition.md)。

保留项不设置语言迁移期限，也不阻塞普通产品功能。以后只有对应工具自身出现缺陷、安全、兼容或维护需求时，才按独立工单决定是否修改或改写；不得以产品技术栈统一为理由扩大范围。

## 规则落位与工单边界

最终规则采用“短主规则 + 渐进式细节”：主规则常驻产品实现的 TypeScript、Next.js 与 Node.js Workers 边界，并明确排除工程协作控制面；技术选型理由、Python 清单和低频细节留在 ADR 与渐进式文档。

IK7FI6 只完成决策、术语和存量分类，不修改权威主规则。`CLAUDE.md` 与渐进式规则的实施属于 IK7FI7；IK7FI7 必须基于本 ADR 落位，不得恢复“仓库所有长期可执行资产统一 TypeScript”或 Python 迁移计划。

## 官方规则文档依据

- [OpenAI Codex AGENTS.md 指南](https://developers.openai.com/codex/guides/agents-md) 与 [AGENTS.md 开放规范](https://agents.md/)支持根规则保存通用期望、专用规则按目录或场景分层。
- [Anthropic CLAUDE.md best practices](https://code.claude.com/docs/en/best-practices) 与 [memory / rules 指南](https://code.claude.com/docs/en/memory)要求主规则简洁、广泛适用，多步或局部流程按需加载；确定性硬约束不能只依靠提示词。
- 本轮同时查阅用户级 `~/.claude/agent-rules/rule-placement-protocol.md` 与 `rule-document-specifications.md`；两者不进入版本库，项目内以 [ADR-0044](0044-rules-progressive-loading.md) 作为可审计的落位依据。

## 被否方案

- **仓库内所有长期维护可执行资产统一 TypeScript**：把团队治理工具误当产品运行时，收益与兼容风险不匹配。
- **为语言统一迁移现有 Hook、Worktree 与发布脚本**：不改变用户产品能力，却可能造成拦截、授权、审计或 Git 事务保护空窗。
- **全仓禁止新增 Python**：工程协作控制面和一次性工具可能合理使用 Python，硬禁令超出产品技术栈边界。
- **产品运行时自由选择语言和框架**：会重新引入并行业务后端、重复领域规则和部署复杂度。
- **在 IK7FI6 直接修改主规则**：违反 IK7FI6 决策票与 IK7FI7 实施票的依赖边界。
