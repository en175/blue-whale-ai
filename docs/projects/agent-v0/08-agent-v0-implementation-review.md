# Agent v0 实现对抗性审查报告（PR !381）

## 时间

2026-08-18

## 背景 / 目标

对已合并 PR !381（Agent v0 侧边栏主链路 + 生成卡 + dock，web + backend BFF）做双轴对抗性审查：**Standards 轴**（是否合规）与 **Spec 轴**（是否忠实实现需求）。审查由两个独立 sub-agent 并行执行，分别读 diff 与需求文档，结论汇总成本报告。

- **审查范围**：`git diff baad1a3...HEAD`（合并前 master → 合并后 master），20 文件，+2281 / -36
- **提交范围**：`git log baad1a3..HEAD --oneline`，含早期素材读取接口 `67e80dc9` 与 S1-S5 主链路全部提交
- **需求来源**：`01-PRD-agent-v0.md`、`04-Agent-侧边栏内容形态与交互规范.md`、`06-agent-v0-web-ai-handoff.md`、`05-需求对齐报告.md`（`07-agent-v0-backend-bff-contract.md` 为实施方本 PR 自写，不纳入 spec 依据，避免循环论证）
- **工单**：IK9DYZ（子工单 S1-S5：IK9DZ3 / IK9DZ8 / IK9DZH / IK9DZO / IK9DZR）

---

## Standards 轴

无硬违规：仓库无 CODING_STANDARDS.md / CONTRIBUTING.md，`docs/agents/*.md` 为 git/issue 工作流规则而非代码风格，eslint/tsconfig 强制项已跳过。以下全部为 Fowler smell 判断（judgement call）。

1. **Duplicated Code + Data Clumps（最重）—— GenerationCard 形状重复声明约 5 处**。6 字段卡类型已存在为 `GenerationCardBlock`（`web/src/api/agentSessions.ts:37`），但同一形状又内联重声明于：`AssetCardNode/index.tsx` 的 `GenerationCardNodeData`、AgentPanel 的 `onApplyToDock` prop、CanvasPage 的 `handleAgentCardApply` 载荷，以及更窄的 4 字段子集（`onApplyToDock`/`onSendToAgent` 回调类型，AssetCardNode + CanvasPage 内联闭包）。**往返还丢字段**（node → dock 掉 `visual`/`timeRange`），两个不一致的形状同时存在。→ 直接 import `GenerationCardBlock` 复用。
2. **Duplicated Code — mock 卡/文案字面量**。`agentSessions.mock.ts` 中 `runRevision` 与 `runFlow` 的 confirm 分支整卡逐字重复（仅 gc-2 不同），应提为模块级卡片数组常量；同一轮次文本出现两次（`assistant.delta` 负载串与组装的 `assistantMessage` 中 `textBlock(...)`）。
3. **Repeated Switches — block 类型分发**。`AssistantMessageBody`（AgentPanel）是对 `b.type`（thinking/understanding/clarify/card）的 if 级联；`agentPhase`（useAgentSession.ts）用同组类型测试（`blocks.some(b => b.type === 'clarify'|'understanding'|'card')`）重推状态。同一 string-keyed 分发逻辑两个文件各一份。
4. **Primitive Obsession — clarify/asset 字符串**。`clarify.questions: string[]` 把结构编码进显示串，`ClarifyCard` 再 `q.split('：')`、`.split(/[、/]/)` 反解；`assetRefs: ['@保温杯主图']` 名称嵌在字符串里。→ 应为 `{ label, options }` / `{ name }` 结构化类型。
5. **Speculative Generality / 双真相源风险 — mock 是第二真相源**。`agentSessions.mock.ts`（545 行）生长出后端必须重实现的产品逻辑：分流正则 `/(图片|插画|海报|产品图|照片|图像|一张|个图)/` 与 `nextTurn` 状态机；hook 又从输出反推 `agentPhase`——"当前处于哪一阶段"存在两个真相源。`AgentPhase` 声明 `applying`/`applied` 但推导永不产出（死状态）。`runRevision` 无论用户改哪张卡都硬编码"镜头 2"，原型不跟踪用户输入。
6. **Minor — proxy 注释与实现不一致**。`agent-v1-proxy.controller.ts` 头注释写"连不上 → 503"，catch 实际返回 502；`@Headers("authorization")` 参数重复设置了转发循环已带的头（Middle Man 倾向）。
7. **大文件（判断）** — AgentPanel 现 407 行 + 396 行 CSS（聊天、拖拽、模型选择、技能、生成卡）；mock 545 行。两者都因多个无关原因在变。

---

## Spec 轴

### a. 需求缺失 / 部分

1. **分镜总览缺失** — PRD AC-18 要求 Agent 先用自然语言展示整组分镜总览（方向、节奏、镜头数量、素材使用），随后展示多张单镜头生成卡。mock 确认/修改只回一句"下面按视频时间顺序展示 4 张…"，无方向/节奏/镜头数量/素材使用总览。04 §5 同样要求。
2. **生成卡动作缺「手动应用整组」与「取消/不使用」** — 04 §5.2 用户动作列：自然语言修改 / 手动应用单张 / 手动应用整组 / 取消；卡上只有「自然语言修改」+「手动应用到 dock」。需求理解总结（04 §4）同样缺「取消」动作。
3. **追踪要求未落地** — PRD V0-15 / AC-30、§5.2 追踪约束、04 §9。确认动作只是文本消息 `'确认需求理解，生成分镜提示词卡'`，无结构化确认事件；手动应用只存内存 `appliedCardIds` Set；后端无「生成卡 → dock 端点」（S4 明确列出，06 §5），应用动作不持久化。C4 / A8 缺口仍在。
4. **S5 状态机部分** — 04 §7 的「生成卡应用中」「生成卡已应用」在 `agentPhase` 推导里永不返回（useMemo 只产出 failed / generating_cards / processing / awaiting_* / cards_ready / idle），全局状态条不显示 applying / applied。
5. **S5 / E2 / E3 — 事件层不完整** — 消费了 `reasoning_trace.updated.v1`，但 06 §6 点名的 `prompt_card.revision_committed.v1` 及确认事件未消费；生成卡 / 确认全走消息 content block，无独立事件层。
6. **AC-3 素材引用记录** — 无引用关系记录，assetRefs 在 mock 中硬编码。

### b. 越界（scope creep）

1. **「生成卡先落画布节点（kind='generation'）再点『引用到 dock / 给 Agent』」是新设计** — PRD 7.2.6 / AC-21 明确"手动应用后，该卡内容自动带到 Canvas 的 dock 栏中"，无中间画布节点；「给 Agent」动作在 02/03/04/05/06 无任何来源。
2. **复活旧 resolve 端点** — 本 PR 新增 `POST /api/internal/agent-assets/resolve`，但 05 §4 明示旧 resolve 端点"重构后已不存在，新流程是 `/api/agent/assets/presign`"，方向是向新契约对齐；本 PR 反向复活旧契约（仅加了 AGENT_SERVICE_TOKEN 头）。

### c. 实现了但实现错

1. **mock 确认门是死代码** — `nextTurn` 只返回 intent / summary / revision，永不返回 `'confirm'`（agentSessions.mock.ts:452-458），`runFlow(...'confirm')` 不可达。用户点「确认需求理解」→ 走 `runRevision` → 卡片被框成"已按你的修改要求更新镜头 2"（mock:388-389），与 AC-16 / AC-22 确认后生成的口径不符。
2. **素材读取授权范围过宽** — PRD 5.2 素材约束："Agent 只能读取当前会话明确引用或授权的素材"、4.2 "不开放未授权素材读取"。`resolveAgentAsset` 仅用 `findAccessible(projectId, assetId, userId)` 校验项目 + 用户归属（agent-asset-resolver.ts:83），无 session grant / 引用级授权（05 D3 ⚠️ 设计未落地）——项目内任意资产均可读，非"当前会话明确引用"。版本指纹与最小必要（单资产、不扫画布）符合 PRD。

---

## 分级建议（结合已定范围重评）

> 对抗性审查默认严格，未感知本 PR 已定范围——**前端优先、后端随后，前端默认 mock 分流**。因此 Spec 轴相当一部分"缺失"实为"按约定未做"，非缺陷。以下按当前决策重分级，供处置参考。

### 真问题，值得改

1. **Spec-c1 mock 确认门口径错** — 用户点「确认需求理解」走修改分支，显示"已按修改要求更新镜头 2"，与确认后生成口径不符；死代码（`nextTurn` 永不返回 confirm）。用户可见交互错位。
2. **Spec-c2 素材读取授权只到项目级** — 未到 PRD 4.2"当前会话明确引用"级。安全面，非体验问题。
3. **Standards-1 GenerationCard 类型重复 5 处、字段往返丢失** — 已现实漂移（node → dock 掉 `visual`/`timeRange`）。低成本，防后续漂移。

### 不算问题——范围或决策已定

- **Spec-b1 画布节点新设计**：用户已拍板"先落画布再选引用 dock / Agent"，PRD 无此形态但以用户决策为准，不算越界。
- **Spec-a3 / a4 / a5 事件层、状态机 applying/applied、持久化**：属"后端随后 + 接真实数据"部分，当前 mock 阶段按约定未做。
- **Standards-5 mock 双真相源**：mock 为 dev-only 脚手架，后端迟早重实现，预期内。

### 低成本顺手

- **Standards-6** 注释 503 / 实际 502 不一致（一行）。
- **Standards-4** `clarify.questions` 字符串反解 → 结构化 `{ label, options }`。
- **Standards-2** mock 卡片 / 文案重复 → 模块级常量。
- **Standards-3** 两处 block 分发——可读性范围内，可不动。

### 忽略（噪音）

- Standards-7 大文件、Spec-a1（分镜总览）、Spec-a2（手动应用整组 / 取消）——属 v0 简化，要补另行拍板。

---

## 验证 / 关联

- **PR**：!381，`shuggg/feature/Agent素材读取接口` → master，2026-08-18 合并（merge 提交 `31df670e`）
- **验证**：发布门禁通过（628 测试用例 + typescript-baseline），验证层级 full
- **工单**：IK9DYZ（S1-S5）
- **关联文档**：本目录 01 / 04 / 05 / 06 / 07
- **评审方法**：code-review 技能（Standards + Spec 双轴并行 sub-agent，各自独立读 diff 与需求文档后汇总）
