# Agent v0 — web/ai 侧开发交接文档

> 日期：2026-08-18 ｜ 交接人：李述（agent 侧）→ web/ai 侧新负责人
> 目的：让 web/ai 侧可在不了解 agent 侧实现的情况下，**并行**完成 Agent v0 的对外交互（前端优先，后端可 mock）。
> 工单：web/ai 总工单 **IK9DYZ**（子工单 S1–S5）；agent 侧并行工单 **IK9DWX**。

---

## 1. 交接概述

Blue Whale 要做一个 **Agent 侧边栏 v0**：用户在侧边栏输入创作需求 → Agent 展示**可折叠思考过程** → 信息不足**追问** → 信息充分**总结需求理解并等确认** → 用户确认后**直接产出多张单镜头分镜提示词生成卡**（按视频时间顺序）→ 用户**自然语言修改**或**手动应用** → 生成卡进 **Canvas dock** → 侧边栏只提示"已进入 dock"。

**本交接文档只讲 web/ai 侧（Canvas + BFF）要做的。** agent 侧（独立 blue-whale-agent 服务）由另一人并行开发，通过「消息契约 + 生成卡产物协议」衔接，不阻塞前端交互先行。

## 2. 需求文档（本目录，必读）

| 文件 | 优先级 | 内容 |
|---|---|---|
| `01-PRD-agent-v0.md` | ⭐ 必读 | 产品 PRD：v0 范围、20 条 V0 验收、32 条 AC、4 阶段 |
| `02-Agent-Workflow-Skill-编排说明.md` | 选读 | AgentRun 内编排（意图路由/workflow/skill），理解生成卡从哪来 |
| `03-Agent-流程图及说明.md` | ⭐ 必读 | 系统链路与边界（BFF→Session→Run→生成卡→dock） |
| `04-Agent-侧边栏内容形态与交互规范.md` | ⭐ 必读 | 侧边栏内容形态、生成卡字段、状态机、**v0 不做清单** |
| `05-需求对齐报告.md` | ⭐ 必读 | 2026-08-18 与现有实现逐条对齐（哪些已做/部分/未做） |
| `prototype/index.html` | ⭐ 交互基准 | **可点击原型**（视频 4 张镜头卡 / 图片 1 张卡），浏览器打开对照 |
| `06-本文件` | 开发入口 | 你现在读的 |

原始需求来源（如要看 video-director 参考实现）：`~/Downloads/AGENT编排V0修改/`（含 `video-director-local` Skill 包 + 原型源码）。

## 3. v0 主链路（验收口径）

```
用户输入需求(文本/图片/视频/画布引用)
  → 思考过程(可折叠小字)
  → 信息不足? → 追问 → 用户补充 → 回到理解
  → 信息充分 → 需求理解总结(创作目标/素材/方向/规格/不确定点)
  → 用户确认 / 修改 / 补充
  → 确认后 → 自然语言总览(非卡) + 多张单镜头分镜提示词生成卡(按时间顺序)
  → 用户自然语言修改某张卡 / 手动应用某张卡
  → 应用 → 卡内容进 Canvas dock → 侧边栏提示"已进入 dock"
  → (Canvas dock 之后的发送生成/状态/结果，不回传侧边栏)
```

**红线边界**（来自 PRD §7.3 / 侧边栏规范 §10）：
- Agent 端**不自动生成、不调用生成工具、不自动扣费**；生成卡不是最终媒体
- **手动应用前**生成卡不进 dock；进 dock 后是否发送生成由用户确认
- 最终结果只在 Canvas 展示，**不回传侧边栏**；侧边栏不展示结果正文/缩略图
- 侧边栏只保留「生成卡」一种卡片；不拆脚本/分镜/提示词多确认门

## 4. 现状代码地图（2026-08-18 走查，前后端分离后）

### 前端 `web/`（Vite React，port 3000，代理 /api 与 /agent → 3100）

| 文件 | 现状 |
|---|---|
| `web/src/pages/CanvasPage/components/AgentPanel/index.tsx` | **Agent 侧边栏**：对话气泡 + 流式、模型选择、快捷问题卡、文件上传。**无思考过程/确认门/生成卡** |
| `web/src/pages/CanvasPage/hooks/useAgentSession.ts` | SSE 会话：处理 stream.ready / message.accepted / run.* / assistant.delta 等 9 个事件 |
| `web/src/api/agentSessions.ts` | `/api/agent/v1/projects/:id/sessions` 会话 API |
| `web/src/api/events.ts` | `SseEvent = {type,id,data}` |
| `web/src/api/conversation.ts` | `applyPlanMessage`（生成卡应用）是 **stub**，无 UI 调用、无后端 |
| `web/src/pages/CanvasPage/components/BottomDialog/index.tsx` | **Canvas dock**：收 prompt + 素材引用 → 创建 generation job；**无 Agent 卡→dock 通道** |

### 后端 `backend/`（NestJS，`apps/blue-whale`，port 3100，全局前缀 /api）

| 模块 | 现状 |
|---|---|
| `backend/apps/blue-whale/src/api/agent-assets/` | `@Controller("agent/assets")`：presign / uploads / GET。**旧 `POST /api/internal/agent-assets/resolve` 已不存在** |
| agent/v1 | **没有 `/api/agent/v1` 控制器/代理** → 本地 dev 下 agent 对话链路不通（这是 S4 要补的） |
| generation / jobs / canvases / scene-cards | 现有 dock 生成链路 |

### 契约层 `packages/contracts/`（前端未消费，仅参考）

- `agent-runtime.ts`：`agentRunStageSchema`（understanding|alignment|awaiting_final_confirmation|...）、`PlanCardCandidate`、`submit_plan` 等 —— **注意**：这套 plan-card 协议按历史决策可能被独立 agent 服务取代，**不要作为生成卡产物协议的最终依据**，以前端按原型定交互为准，产物协议等 agent 侧 IK9DWX-W1 拍板。

## 5. 要建的东西（5 个子工单）

| 子工单 | 内容 | 前端 / 后端 |
|---|---|---|
| **S1**（IK9DZ3） | 侧边栏主链路 UI：思考过程折叠区、追问、需求理解总结+确认门 | 前端 |
| **S2**（IK9DZ8） | 分镜提示词生成卡渲染（多张按时间顺序）+ 自然语言修改 | 前端 |
| **S3**（IK9DZH） | 手动应用到 Canvas dock + 应用状态提示 | 前端 + 后端通道 |
| **S4**（IK9DZO） | backend BFF：/api/agent/v1 代理、生成卡→dock 端点、素材契约 | 后端 |
| **S5**（IK9DZR） | 侧边栏状态机 + SSE 新事件类型消费 | 前端 |

**开发顺序建议**：S1 → S2 → S3（前端主链路，对照原型），S4（后端 BFF，可并行），S5（状态机/事件，随 S1 一起）。**前端交互优先**，数据先用 mock / 本地固定流程驱动（原型 app.js 就是 mock 的参考）。

## 6. 与 agent 侧（IK9DWX）的并行协作点

- **产物协议未定**：生成卡是「扩展 PromptCard 成多镜头」还是「新 generation-card 协议」，agent 侧 IK9DWX-W1 在拍。前端**不要等**——先用原型/mock 把交互和组件做扎实，字段（镜头编号/画面/提示词/素材引用/应用按钮）按 `04-侧边栏规范` §5.1 定，接口对接时再映射。
- **SSE 事件**：思考过程 / 需求理解确认 / 生成卡事件的事件名，agent 侧 V3 已有 `reasoning_trace.updated.v1`、`prompt_card.revision_committed.v1` 等，S5 先按这些 + 原型定义前端消费层。
- **素材契约**：agent 侧 V3 依赖旧 resolve 端点，S4 需要和 agent 侧一起把新 `/api/agent/assets` 契约对齐（见 `05-需求对齐报告` §4）。

## 7. 本地开发环境（怎么跑起来）

**始终连测试站 DB/Redis（走隧道），本地不建库。**

```bash
# 1) 打开隧道（MySQL 13306 + Redis 16379）
lsof -i :13306 || ssh -f -N -i ~/.claude/skills/bw-test-env/keys/weitian.pem -L 13306:127.0.0.1:3306 root@115.190.244.91
lsof -i :16379 || ssh -f -N -i ~/.claude/skills/bw-test-env/keys/weitian.pem -L 16379:127.0.0.1:6379 root@115.190.244.91

# 2) 后端（NestJS，3100）—— 需先 prisma generate + tsc-alias
cd packages/persistence && npx prisma generate
cd backend && pnpm build && npx tsc-alias
set -a && source ../.env && set +a && PORT=3100 node dist/apps/blue-whale/src/main.js &

# 3) 前端（vite，3000）
cd web && npm run dev   # http://localhost:3000
```

> `.env` 需满足：`MYSQL_PORT=13306`、`REDIS_HOST=127.0.0.1`、`REDIS_PORT=16379`。密码权威来源 `blue-whale-ai/.claude/skills/deploy-blue-whale-api/scripts/lib.sh`。

## 8. suggested skills（给开发用的 Claude 会话）

- `bw-test-env` — 一键启动本地测试环境（隧道 + 后端 + web）
- `mastra-frontend` — 用 @mastra/playground-ui 设计系统搭 UI（本 repo 前端）
- `react-best-practices` / `tailwind-v4` — 前端性能与样式规范
- `e2e-tests-studio` / `playground-msw-tests` — 前端测试
- `to-prd` / `to-issues` — 需要把本交接拆成更细任务时

## 9. 风险 / 待确认

1. **生成卡产物协议未定**（agent 侧 IK9DWX-W1）——前端按原型先做，接口对接时映射
2. **本地 dev 下 agent 对话不通**（无 /api/agent/v1 代理，S4 解决）；交互测试可用 mock
3. **素材授权契约变更**（resolve → presign）——S4 与 agent 侧一起对齐
4. **`~/Downloads/AGENT编排V0修改` 是本地路径**——需求文档已复制到本目录（docs/projects/agent-v0/），以本目录为准

---

*本交接文档不包含任何密钥/密码。敏感信息见 `blue-whale-ai/.env`（gitignored）与部署脚本，勿写入代码或文档。*
