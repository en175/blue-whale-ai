# lint 门禁单一权威：验证链路即门禁，根 eslint 降级为自助检查

## 时间

2026-10-07

## 背景

IK74V5（2026-08-07）落地「全仓 lint 制度」：根 `eslint.config.mjs` 对 backend 与 web/src 挂 `max-lines: ["error", 800]` 硬线；IK74V8 随后拆完 12 个历史巨型文件，宣布「800 行是无豁免硬线——新文件超限直接 lint fail，不再挂账」。

该制度从未接入任何机器门禁。IK74V5 提交信息宣称的「CI 拦截」在仓库中没有对应 workflow 文件；验证链路（`scripts/verification-policy.mjs`）`scoped/web` 层执行的 lint 是 `npm --prefix web run lint`（oxlint，规则集不含 max-lines）；`scoped/backend` 层与 `pnpm verify` 均无 lint。根 eslint 只能通过 `pnpm lint` 手动触发，两个月内无人执行。

IKJLPG（2026-10-07，release/2026.09.29 @ ccf1f5cc2）实测 `pnpm lint`：250 error + 1183 warning——45 个文件超 800 行（21 源码 + 24 测试，最大 `web/src/pages/CanvasPage/index.tsx` 11137 行）与 177 处 `no-explicit-any`。规模约束名存实亡，配置宣称与门禁事实脱节。

## 决策

1. **lint 门禁的单一权威是验证链路实际执行的命令**：前端（web）为 oxlint（`scoped/web` 层已内建）；backend 暂无 lint 门禁（补建属独立工单）。配置文件不自我宣称门禁地位。
2. **根 eslint 退出「门禁」角色**，定位为开发者自助检查（`pnpm lint` 手动执行），覆盖范围不变（backend + web/src）。
3. **`max-lines` 与 `@typescript-eslint/no-explicit-any` 从 error 降为 warn**：800 行「无豁免硬线」制度正式废止。规模与 `any` 信号保留在自助检查中可见，不再阻塞退出码；web/src 范围随本决策清零 error，backend 存量 error 的清偿见「后果」。

## 否决的备选

- **eslint 接入验证链路**：需先清 250 error（拆 45 个文件 + 修 177 处 `any`），远超本工单范围；先接入门禁再逐项豁免会制造「门禁内挂账违规」的中间态，违背口径对齐初衷。
- **max-lines 迁移 oxlint**：项目实际安装的 oxlint（1.78.0）含 `eslint/max-lines` 规则（restriction 类，默认关闭，可在 `web/.oxlintrc.json` 显式开启，默认上限 300 须显式传 800），技术可行；否决理由是开启即翻红——web 下 31 个超线文件（15 源码 + 16 测试，截至 2de3e860e）须先拆到线下，且 oxlint 门禁只覆盖 web，backend 超线文件不受管辖。

## 恢复硬线的路径

恢复 `max-lines` 硬线的路径有二：根 eslint 升回 error 并接入验证链路（须先清全部存量 error），或 oxlint 显式开启 `eslint/max-lines`（仅覆盖 web）。两路的共同前置：49 个超线文件全部拆到线下（截至 2de3e860e）。其中 28 个测试文件——测试用例堆叠天然偏长，800 阈值是否适用测试文件须在该工单中一并评估。属独立工程工单，本 ADR 不排期。

## 后果

- 正：门禁名实相符（验证链路 = oxlint，全绿）；`pnpm lint` 可自助使用（web/src 范围 exit 0）；规模与类型信号保留。
- 负：防文件膨胀退化为「自助信号 + 代码审查」，无机器强制；backend 在 lint 门禁中裸奔直至补建工单。
- 口径性 error（max-lines、`any`）降级清零后，实测另暴露 28 处真实存量 error（eslint 从未执行期间的积累）：web/src 4 处随本工单修复；backend 24 处（未用导入/变量与 prefer-const）由 [IKJVBH](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/tasks/list?issue=IKJVBH) 清偿，清偿完成前 `pnpm lint` 退出码非零属预期。
- generationRuntime 拆分评估（本工单第二议题）结论：采纳。切分面为四域 + 共享状态容器——提交域（submit/retry/cancel/remove）、终态收敛域（poll/converge/fanOutOutputs）、恢复域（recover/reconcile 家族）、保存接缝域（composeSaveFields/onSaveReceipt/reconcileConflictItems），14 个闭包状态（active/ledger/intents/nodeBindings 等）提为显式 state 容器；runtime.test.ts 按同域拆分。实施子单 [IKJVAB](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/tasks/list?issue=IKJVAB) 已另立，实施时机绑定下一次 generationRuntime 功能工单顺路执行。
