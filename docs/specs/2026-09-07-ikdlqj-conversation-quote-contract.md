# 画布正文对话引用快照契约（IKDLQJ）

## 时间

2026-09-07

## 目标与边界

落实 IKDL9U 的「添加到对话」切片：用户把画布上实际编辑的正文加入 Agent 对话，引用的是操作当时的正文快照而非旧卡片版本指针；Agent 据此修改产出新 Prompt 预览，继续走 IKDLQE 的手动应用闭环。复用现行 NestJS Canvas API、Prisma 与 `PROMPT_TEXT_LIMITS`；不引入第二套可编辑文本资源，不接管独立 Agent 的消息存储。

不在本切片：旧生成卡内部「给 Agent」按钮退役（IKDLQL）、旧卡迁移（IKDLQK）、整图自动执行、隐式媒体传递。

## 引用快照

「文本对话引用快照」（领域术语见根 CONTEXT.md）由服务端持有、不可变：新建表 `conversation_quote_snapshots`，列为 `id`、`project_id`、`quote_key`、`node_id`、`source_json`（可空）、`title`、`text`、`gmt_create`。`quote_key` 是 `[nodeId, source, text]` 规范化 JSON 的 SHA-256，与 `project_id` 共同唯一（`uk_conversation_quote`）。并发创建只接受首个快照（createMany skipDuplicates 后回读）；此后任何画布编辑、来源节点删除都不改写或删除该快照。`source` 仅当节点携带 `promptSource`（IKDLQE 三件套 `{sessionId, revisionId, shotNo}`）时记录，普通无预览来源文本为 `null`，不伪造来源。

正文以客户端点击「添加到对话」当刻的画布内存正文为准（服务端画布可能滞后于未落盘编辑），服务端只校验限长与形状，不回读画布替代用户所见内容。

## 接口

- `POST /api/canvases/{projectId}/conversation-quotes`：body `{ nodeId, title, text, source? }`，zod 契约 `conversationQuoteCreateSchema`（`text` 1–100,000 UTF-16 code units，`title` 0–200（无标题节点允许空串，不落假标题），`nodeId` 非空，`source` 为 `previewSourceSchema` 或可省略/为 null）。成功信封 data 为 `{ quote, reused }`；`quote.quoteId` 为字符串化主键。超限/缺字段 400，零写入；项目不归属当前用户按既有 Canvas 约定返回数据不存在。
- `GET /api/canvases/{projectId}/conversation-quotes?ids=<逗号分隔，至多 100 个（`CONVERSATION_QUOTE_LIST_LIMIT`）>`：按主键批量回读，信封 data 为 `{ items }`；不存在的 id 省略不报错。供会话刷新后按消息中的 `quote_id` 还原引用事实。

两接口与 `prompt-previews/apply` 同控制器、同项目归属校验。前端在点击当刻调用 POST 拿到 `quoteId` 再生成引用胶囊；超限或请求失败明确提示、不产生胶囊，节点原文与输入框既有内容均不改动。

## 消息部件（跨进程契约，先于实现定死）

引用随用户消息进入 Agent `content` 数组，部件形状：

```json
{
  "type": "resource_ref",
  "resource_type": "text_quote",
  "resource_id": "<quoteId>",
  "resource_kind": "文本引用",
  "node_id": "<画布节点 id>",
  "display_label": "<节点标题或正文前 10 字>",
  "resource_text": "<快照正文，保留换行与完整允许文本>",
  "prompt_source": { "sessionId": "...", "revisionId": "...", "shotNo": 1 }
}
```

`prompt_source` 仅在有预览来源时携带。对独立 Agent 的要求（本切片用记录请求的替身验证，实际联调结论另行验证）：随消息持久化该部件并在快照中原样返回；以 `resource_text` 为引用正文（不按 id 解析、不用旧 revision 指针替代）；文本引用不展开为任何隐式媒体输入。Agent 的修改结果继续以新 revision 的 Prompt 预览回流，应用仍走 `prompt-previews/apply`：新预览创建新节点，不覆盖原节点，已有连线保持原归属。

## 前端行为

- 统一入口：文本节点（工具栏/选中条/右键）与生成卡顶部操作条的「添加到对话」走同一捕获逻辑；捕获当刻正文（`data.text` 为权威；旧 HTML 节点提取时 `<br>` 与块级标签边界还原为换行）与来源。生成卡不再只发旧版本指针。
- 胶囊标签为节点标题或正文前 10 字的紧凑形式；胶囊可从输入框移除，移除即不随消息发出。
- 会话刷新后从落库部件还原引用胶囊；部件缺 `resource_text` 时按 `quote_id` 调 GET 回读补齐。消息中的引用胶囊悬浮展示快照正文（超长截断），便于核对当时发出去的内容。引用后继续编辑或删除来源节点，已发送消息中的快照不变。
- 发送失败明确提示并保留输入框原文与胶囊；超长点击即拒绝，不截断、不丢原文。
- 文本节点引用不携带图片/视频/音频媒体块；文本历史参考图不进入消息。生成卡上**显式挂载**的素材引用（`assetRefItems`/`refs`）维持既有行为随引用随行——它们是卡自己的素材而非文本历史图片；生成卡内部「给 Agent」按钮的退役归 IKDLQL。

## 验证

测试边界沿用母规格确认的真实浏览器与公开业务 API，沿用 IKDLQE 的集成骨架：真实挂载生产 Canvas/Project 控制器与服务、Prisma/MySQL 隔离库、Agent BFF 透传到记录请求的 Agent 替身。覆盖：快照创建与去重并发、超限零写入、项目归属、来源节点删除后快照可回读、同节点编辑后产生新快照且旧快照不变。

浏览器用例（`IKDLQJ_BROWSER=1` 开启）：编辑节点正文 → 添加到对话 → 发送，断言 Agent 替身收到的 `resource_text` 为画布实际编辑内容且不含媒体部件；替身推进新 revision → 新预览手动应用为新节点，原节点不动；刷新会话后引用胶囊与消息事实可回读；引用后继续编辑来源，对话依据不变。

复现命令：`IKDLQJ_BROWSER=1 IKDLQJ_DATABASE_URL=mysql://root@127.0.0.1:23306/ikdlqj pnpm exec vitest run backend/apps/blue-whale/src/api/canvases/conversation-quote.integration.test.ts`。数据库必须是预先应用当前 Prisma schema 的隔离测试库，测试创建独立项目，不清理其他项目。

认证会话装配与独立 Agent 线上联调不在本切片证据范围内；外部 Agent 对 `text_quote` 部件的兼容以另行联调为准。
