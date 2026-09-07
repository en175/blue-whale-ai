# 历史预览兼容与旧卡入口退役契约（IKDLQL）

## 时间

2026-09-07

## 目标与边界

落实 IKDL9U 的收尾切片：历史对话中已过时的预览修订可通过兼容映射手动应用；旧生成卡的双可写正文、「引用到 dock」「给 Agent」活动路径退役，旧数据只读兼容。复用 IKDLQE 的 `prompt-previews/apply`、`prompt_preview_snapshots`、限长与版本锁契约，以及 IKDLQK 的旧卡迁移与只读历史；不引入新表、不改生成任务接纳与快照行为。

不包含：整图自动执行、批量应用、时间轴全量历史修订挂载（刷新后时间轴仍只显示各卡组当前修订，入口与 IKDLQE 一致）、Agent 服务侧实现（本仓按本文契约先行实现读端并替身验证，实际联调另行记录）。

## 历史修订读取（跨进程契约，先定死再实现）

### 对独立 Agent 服务的新要求

Agent 服务的持久层已按任意 revision id 读取修订（`promptCardRevisionsByIds`，tenant 授权谓词，IKAMYY/IKBBU5 先例），但无 HTTP 入口。本契约要求新增按需读取路由，挂在本仓 BFF 已透传的 `/v1/projects/:projectId/sessions/:sessionId/...` 命名空间下：

```
GET /v1/projects/{projectId}/sessions/{sessionId}/prompt-card-revisions?revision_ids=<逗号分隔，至少 1 个>
```

成功 200，信封：

```json
{ "revisions": [ { ...promptCardRevisionView 形状，含 revision_id / payload / … } ] }
```

- 元素形状与快照 `prompt_cards[].active_revision` 完全一致（同一 `promptCardRevisionView` 投影）；查不到的 id 省略，不报错。
- 授权沿用既有 tenant 谓词：revision id 由客户端提供，按会话归属 tenant 过滤，命中不了他人修订。
- 该路由只读；不改变快照响应形状（`prompt_cards` 仍只带 `active_revision`）。

本切片用可记录请求的替身验证本仓对上述契约的消费；Agent 服务实际发布与线上联调结论单独记录（沿用 IKDLQE/IKDLQJ 的外部集成边界口径）。

### 本仓读端兼容映射（`readPromptPreview`）

应用来源解析顺序（`POST /api/canvases/{projectId}/prompt-previews/apply` 内部）：

1. `prompt_preview_snapshots` 已有可信快照 → 直接使用（IKDLQE 既有行为；稳定身份、重复应用、删除后重建不依赖 Agent 在线）。
2. 无快照 → 读 Agent 快照，匹配 `active_revision.revision_id`（IKDLQE 既有行为）。
3. **新增**：active 不匹配时，调上述历史修订路由按 `source.revisionId` 读取；在返回修订的 `payload.shots` 中按 `shot_no === source.shotNo` 取镜头，正文取 `title` 与 `prompt_text`，校验限长同现行（标题 200 / 正文 100,000 UTF-16）。
4. 全部不可得（路由缺失 404、修订不存在、镜头缺失、正文缺失或超限）→ 维持 IKDLQE 的明确错误（404「该历史预览已不可读取，请在对话中重新生成」或 400 超限），**不用 `frame_description`（画面描述）兜底或替代提示词**，原数据不改动。

兼容映射对应用结果与现行规则完全一致：首次应用成功即写 `prompt_preview_snapshots`，此后重复应用与删除后重建走快照，历史修订只在首次应用时读取一次。

## 旧生成卡活动路径退役

退役对象是仍在画布上按旧生成卡渲染的节点（迁移失败保留、或迁移未触发的旧项目数据，识别谓词与 IKDLQK 相同：`assetNode` 且 `data.kind === "generation"`）。本节覆盖 IKDLQK 契约中「继续按旧生成卡路径渲染**和编辑**」的编辑半句：编辑路径随本切片退役，渲染改为只读。

- **双可写正文退役**：移除双击编辑（标题/画面/提示词三字段的编辑态与 `onUpdate` 提交路径）。旧卡只读展示标题、画面描述与提示词原文；提示词缺失时该区不渲染，不伪造、不拿画面描述替代。
- **「引用到 dock」退役**：移除卡片上的按钮与 `onApplyToDock` 回调链（含 `videoSeed.cards` 卡片胶囊生产端与 BottomDialog `initialCards` 消费链路——退役后无生产者）。
- **「给 Agent」退役**：移除卡片上的按钮与 `onSendToAgent` 回调。引用入口统一为顶部操作条的「添加到对话」（IKDLQJ 已并轨，旧卡的 `assetRefItems` 显式素材引用随行行为不变）。
- **保留**：旧卡只读展示、删除、拖动、选择等无冲突画布操作；IKDLQK 打开迁移与失败报告、迁移历史只读查阅入口；Agent 面板预览卡的单正文展示与手动应用（IKDLQE）。

## 前端行为

- AssetCardNode 生成卡形态只读化：`GenerationCardNodeData` 删除 `onApplyToDock` / `onSendToAgent` / `onUpdate` 三个回调；卡片操作条只剩「添加到对话」。
- 时间轴（AgentPanel）不变：预览卡展示一份 Prompt 正文（`prompt`），缺失时显示「提示词正文缺失，请继续对话重新生成」；应用按钮随 `source` 存在与否启停。
- 应用历史修订卡（当前会话事件流时期仍可见的旧修订）在服务端兼容映射下成功落画布；失败沿用现有错误提示。

## 验证

沿用 IKDLQE 集成骨架（真实挂载生产 Canvas/Project 控制器与服务、Prisma/MySQL 隔离库、Agent BFF 透传到可记录请求的替身）。集成测试覆盖：

1. 历史修订（active 之外）应用成功，节点正文取 `prompt_text`，替身收到历史修订路由请求；
2. 同一来源重复应用定位原节点、删除后重建新身份、并发应用单一有效结果（快照规则统一）；
3. Agent 未提供历史修订路由（404/405）或修订缺失 → 明确错误、零画布写入；
4. 修订存在但提示词缺失 → 不用 `frame_description` 兜底，明确报错；
5. 旧卡只读退役后的画布行为以浏览器用例覆盖（见下）。

浏览器用例（`IKDLQL_BROWSER=1`）：旧项目打开 → 迁移/只读旧卡呈现 →（无编辑、无 dock/给 Agent 入口）→ 添加到对话引用 → 预览手动应用 → 编辑正文 → 连线生图/生视频目标 → 刷新恢复 → 迁移历史与已生成结果可查阅。

复现命令：`IKDLQL_BROWSER=1 IKDLQL_DATABASE_URL=mysql://root@127.0.0.1:23306/ikdlql pnpm exec vitest run backend/apps/blue-whale/src/api/canvases/legacy-preview-retirement.integration.test.ts`。数据库必须是预先应用当前 Prisma schema 的隔离测试库，测试创建独立项目，不清理其他项目。

外部 Agent 的历史修订路由实际兼容以另行联调为准；本切片不声称其已发布。
