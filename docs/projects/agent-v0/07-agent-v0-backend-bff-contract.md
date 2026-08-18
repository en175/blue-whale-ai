# Agent v0 — backend BFF 契约（S4）

> 日期：2026-08-18 ｜ 对接：web 前端 → blue-whale-ai 后端 → 独立 blue-whale-agent 服务
> 关联：IK9DZO（S4）、IK9DYZ（web/ai 总工单）、IK9DWX（agent 侧并行）
> 状态：代理骨架已落地，产物协议待 IK9DWX-W1 拍板

## 1. 目的

定义 Agent v0 侧边栏主链路在 **blue-whale-ai 后端**的 BFF 承接方式：web 前端不再直连 agent 服务，统一经本后端 `/api/agent/v1` 透传。本文档是前端与后端的契约基准，agent 侧产物协议确定后在此补充映射。

## 2. 数据流

```
web 前端 (/api/agent/v1/*)
  → vite dev 代理 → blue-whale-ai 后端 (PORT 3100)
  → AgentV1ProxyController (BFF 透传)
  → 独立 blue-whale-agent 服务 (AGENT_SERVICE_BASE_URL，默认 http://localhost:4111)
```

- 前端调用路径：`/api/agent/v1/projects/:projectId/sessions`、`.../sessions/:sessionId/snapshot`、`.../messages`、`.../runs/:runId/cancel|retry`、`.../events`（SSE）
- 后端 `@Controller("agent/v1")` + `@All("*path")`：方法/路径/query/body/headers 全透传，保留 `/api/agent/v1` 前缀
- `@Public()`：本层不做业务鉴权，Bearer token 透传给上游 agent 服务校验（与 `internal/agent-assets` 服务凭证模式一致）
- SSE（`/events`）流式 pipe，不截断；上游不可达 → `502 { code, msg, data }`

## 3. 配置

| 变量 | 默认 | 说明 |
|---|---|---|
| `AGENT_SERVICE_BASE_URL` | `http://localhost:4111` | 独立 blue-whale-agent 服务地址。本地未起时 `/api/agent/v1/*` 返回 502 |
| `PORT` | `3100` | 本后端端口（web dev 代理目标） |

本地联调：agent 服务本地起在 4111 时，`AGENT_SERVICE_BASE_URL` 无需改动；测试站部署时按实际地址设置。

## 4. 前端数据源切换

前端 `useAgentSession` 按 `VITE_AGENT_MOCK` 切换数据源：

- dev 默认 **mock**（`agentSessions.mock.ts` 回放原型流程）——后端 `/api/agent/v1` 未接 agent 服务时交互可独立验证
- `VITE_AGENT_MOCK=0` 走 **真实接口** `/api/agent/v1/*`（经本 BFF 代理）

S4 落地后，真实链路可用；mock 保留用于 agent 服务未部署时的前端交互开发。

## 5. 素材契约（现状）

- `POST /api/internal/agent-assets/resolve`：agent 服务读取授权素材的解析端点（服务凭证鉴权），已在 feature/Agent素材读取接口（e61a83d5）落地
- `POST /api/agent/assets/presign`：前端上传素材的预签名流程
- 与 agent 侧（IK9DWX）的素材授权契约对齐详见 `05-需求对齐报告.md` §4

## 6. 生成卡 → Canvas dock（现状）

- 前端 S3：生成卡「手动应用」→ `onApplyToDock` → CanvasPage 注入 `videoSeed` → BottomDialog（dock）承接 prompt
- dock 内用户确认后走现有 `generation-jobs` create 链路发送生成
- `applyPlanMessage`（`web/src/api/conversation.ts`）为历史 stub，**未被调用**；产物协议（IK9DWX-W1）确定后若需专用「生成卡→dock」端点，再在本文档补充契约

## 7. 待 agent 侧确认

- 生成卡产物协议：`PromptCardRevision`（任务卡）vs 新 `generation_card`（分镜提示词卡）——IK9DWX-W1 拍板后映射
- 生成卡→dock 是否需要后端专用承接端点（当前复用 generation-jobs）
- **路由形状不对齐（2026-08-19 发现，未解决）**：本文档 §2 列的前端调用路径带 `projects/:projectId/` 一层（如
  `/api/agent/v1/projects/:projectId/sessions`），但 blue-whale-agent 服务当前的 HTTP 路由是裸
  `/v1/sessions`、`/v1/sessions/:id`……完全没有 project 段。`AgentV1ProxyController` 保留前缀全量转发，
  这层形状差异会让代理请求在 agent 侧 404。不是简单的前缀转换能补上的，需要决定：agent 侧加 `/projects/:id/`
  这层，还是本文档改成配合 agent 现有的扁平路由形状。当晚未处理，只记录。
