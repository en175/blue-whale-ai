# IKDL9U 本仓验收与 Agent 交接

## 时间

2026-09-07

## 范围与责任

本仓负责 Prompt 应用、Canvas 文本与连线、文本引用快照、生成任务输入冻结和历史迁移。独立 `blue-whale-agent` 仓由其负责人实施以下两项；本次未修改 Agent 仓代码。母需求 IKDL9U 不因本仓检查通过而关闭。

## 本仓验证结果

独立发布分支：`fix/IKDL9U-提示词重构独立发布`，远程基线：`84de64dc`；仅包含 IKDLQE/QF/QG/QH/QJ/QK/QL 七个子任务及审查修复。原综合开发分支保持保留，不发布其图片草稿、图片参考双向同步、面板抽屉和工程配置改动。Agent 接收人：李述（Gitee `shuggggg`）。

下列测试已在独立分支重新执行；远程 PR 与交接 issue 链接以最终交付记录为准。

| 证据 | 结果 | 能证明什么 |
| --- | --- | --- |
| 七组公开接口集成测试，开启全部 IKDLQE/QF/QG/QH/QJ/QK/QL_BROWSER | 56/56 通过，包含 8 个真实 Chromium 场景 | 应用/编辑/刷新、图片视频附件与排序、引用发送、旧卡迁移/只读历史、历史预览读取 |
| 生产 Canvas/Project 服务 + Prisma + 本地隔离 MySQL 8.4 | 已执行 | 实际持久化、重复/并发请求、跨项目访问隔离及历史冲突保留 |
| 图片 worker 与视频 runner 测试 | 50/50 通过 | 记录式供应商替身收到冻结正文和正确附件顺序，旧任务兼容 |
| Canvas 回归 | 294/294 通过 | 独立分支的页面、附件和节点交互回归 |

发布前须对实际 `origin/master` 基线运行 `verify-change-scope.mjs run --stage pr` 并通过 `check --stage pr`，以该次凭证为准。

运行环境：本次新建 Docker 容器 `ikdl9u-review-mysql`，仅监听 `127.0.0.1:24306`，数据库 `ikdl9u_review`，以当前 Prisma schema 初始化。未使用既有 23306 端口或共享测试库。

测试命令：在根目录运行 Vitest 的七个 `backend/apps/blue-whale/src/api/canvases/` 集成测试文件，文件名分别为 `prompt-preview`、`text-attachment-image`、`text-attachment-video`、`text-attachment-ordering`、`conversation-quote`、`legacy-card-migration`、`legacy-preview-retirement`（后缀均为 `.integration.test.ts`）；对应 `IKDLQ*_DATABASE_URL` 指向隔离库，`IKDLQ*_BROWSER=1`，使用 `--no-file-parallelism`。

限制：认证身份由测试装配提供；Agent 使用 HTTP 替身。生成浏览器测试覆盖到任务接纳与数据库快照，没有启动 RocketMQ 和真实供应商，日志中的入队失败与缺少任务轮询路由来自该测试装配。供应商输入转换另由 worker/runner 测试验证，不能把两段证据描述成完整队列端到端成功。真实 Agent 兼容与部署环境联调尚待下述交接完成。

## 交接一：让文本引用正文进入模型上下文

### 已提供的本仓能力

- `POST /api/canvases/{projectId}/conversation-quotes`，请求 `{nodeId,title,text,source?}`，返回业务信封 `data: {quote,reused}`。
- `GET /api/canvases/{projectId}/conversation-quotes?ids=<id列表>`，返回 `data: {items}`，项目归属校验，快照不可变。
- 发送消息时，沿现有 BFF 将下述部件放进 Agent 消息 `content` 数组。正文已经随请求送达，不要求 Agent 回调本仓读取正文。

```json
{
  "type": "resource_ref",
  "resource_type": "text_quote",
  "resource_id": "123",
  "resource_kind": "文本引用",
  "node_id": "text-1",
  "display_label": "角色设定",
  "resource_text": "画布编辑后的正文\n第二行",
  "prompt_source": {"sessionId":"s1","revisionId":"r1","shotNo":1}
}
```

`prompt_source` 可省略，不伪造；正文上限 100,000、标题上限 200，均为 UTF-16 code units。标题可空；正文保持换行，不静默截断。该文本属于用户上下文，不应提升为系统指令。

### Agent 待实施

在 Agent 基线 `c32db4cf` 核对发现：`src/domain/message-parts.ts:textProjection` 对 `resource_ref` 只输出引用标签；`src/memory/conversation-history.ts:toMastraMessage` 将用户文本投影送入模型，结构化部件只在 metadata 中，因此正文没有进入模型文本。

让 `text_quote.resource_text` 进入实际模型输入，同时保留结构化部件的消息存储与快照回读。不得按旧 revision 重新取正文，也不得隐式附加图片。缺失/非法正文应明确处理，不能显示成功却只发送标签。具体实现由 Agent 负责人选择，避免重复注入正文。

### 验收用例

1. 收到上述部件后，记录实际模型请求，包含“画布编辑后的正文\n第二行”，不是只有“角色设定”。
2. 发送后修改/删除画布节点，当前与后续历史上下文仍使用发送当时正文。
3. 刷新会话，部件与正文可回读；多条引用顺序一致，不隐式产生媒体输入。
4. 原有 asset_ref、skill_ref、普通文本行为不回归；非法/超限输入明确反馈。
5. Agent 修改产出新 revision，手动应用创建新文本节点，旧节点及其连线不被覆盖。

## 交接二：提供历史 Prompt 修订只读接口

### Agent 待提供

```http
GET /v1/projects/{projectId}/sessions/{sessionId}/prompt-card-revisions?revision_ids=r1,r2
Authorization: Bearer <现有服务端凭证>
x-blue-whale-tenant-id: <现有租户>
x-blue-whale-user-id: <当前用户>
x-blue-whale-project-id: <项目>
```

成功返回 Agent 原生 JSON（不套本仓业务 data 信封）：

```json
{"revisions":[{"revision_id":"r1","payload":{"shots":[{"shot_no":1,"title":"镜头一","prompt_text":"历史版本提示词"}]}}]}
```

示例仅列本仓消费字段；实际元素复用快照 `prompt_cards[].active_revision` 的完整 `promptCardRevisionView`。未知 id 省略，全部未知返回空数组。复用既有 `promptCardRevisionsByIds`，并校验请求租户、用户、项目、会话及修订的对应归属，不能只凭 revision id 或同租户放行其他会话。接口只读，不改变 active revision。查询至少一个 id；批量上限由 Agent 在接口中明确并测试，本仓当前每次仅请求一个 id。

### 本仓已经实现

`backend/libs/shared/canvas/prompt-preview.ts`：可信本仓预览快照优先；其次读 Agent active revision；不匹配才调用历史接口，按 `revision_id` 和 `shot_no` 取 `title/prompt_text`。请求超时 15 秒。404/405 或找不到版本：明确提示历史预览不可读取；上游失败：502 可重试；缺失/超限正文：明确拒绝。不使用 `frame_description` 替代。

### 验收用例

1. active 为 r2 时可以读 r1，应用节点正文来自 r1；接口元素与快照投影一致。
2. 未知 id 返回空数组；非法参数、跨租户/用户/项目/会话均不得泄漏内容。
3. 应用成功后本仓已有快照，重复应用定位原节点；删除后重建，无需再次依赖 Agent 在线。
4. 历史正文缺失时不以画面描述兜底；故障恢复后重试可成功。

## 合作方完成后的联调

先上线兼容的 Agent 能力，再用真实 Agent 执行“编辑文本→引用→发送→模型读取→新预览→手动应用”和“旧 revision→历史读取→应用”。双方记录实际请求及结果，避免记录凭证。两项完成前，本仓可提交审查，整体需求不能宣称全部验收通过。

关联契约：`docs/specs/2026-09-07-ikdlqj-conversation-quote-contract.md`、`docs/specs/2026-09-07-ikdlql-legacy-preview-retirement-contract.md`。
