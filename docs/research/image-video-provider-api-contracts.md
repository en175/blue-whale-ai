# 图片与视频供应商真实 API 契约核验

> 核验日期：2026-07-13。
> 核验目标：OpenAI `gpt-image-2` 图片 API 与火山方舟 `doubao-seedance-2-0-260128`（Doubao Seedance 2.0）视频 API。
> 本文基于官方文档、API Reference 与端点定义；**未执行会产生费用的真实生成调用**，因此结论属于官方契约与端点级核验，不是账号配额、延迟、画质或线上稳定性实测。

## 结论（TL;DR）

两家供应商不存在可直接复用的统一 Job 契约：OpenAI `POST /v1/images/generations` 是一次请求内完成的图片生成；可用 SSE 接收
partial images，但没有可持久查询的 provider task、retrieve 或 cancel；`gpt-image-2`
默认返回 `b64_json`，不支持托管结果 URL。

- 火山方舟 `POST /api/v3/contents/generations/tasks` 创建持久视频任务，随后可 GET 查询、
  callback 接收状态、DELETE 取消排队任务；终态结果提供 `video_url`。
- Blue-Whale 必须自己持久化 GenerationJob，并将 OpenAI 适配成“本地 queued/processing +
  单次上游调用”，将火山任务适配成“provider task + callback/轮询”。
- 任一供应商结果都必须尽快复制到 Blue-Whale Asset 存储。OpenAI 返回的是字节；火山
  官方未说明 `video_url` TTL，不能把 provider URL 当长期 Asset URL。

最小共同面只应包含：提交、查询本地 Job、best-effort cancel、规范化终态、结果落 Asset、
规范化错误、产品幂等键与产品事件。供应商 task id、callback、SSE partial image、原始错误码
均留在适配器内部。

## 1. 本地契约基线

现有前端与 PRD 已确定：

- `GenerateRequest` 统一带 `type`、`prompt`、`model`、`params`、
  `reference_asset_ids` 与 `source`；
- `GenerateResponse` 返回 Blue-Whale `job_id` 与本地状态；
- `JobResponse` 暴露 `queued | processing | succeeded | failed`、progress、
  `output_asset_ids` 与规范化 error；
- Asset 是独立文件实体，URL 过期后由 `GET /api/assets/{id}` 重新签发；
- BottomDock 和 AgentChatPanel 是不同入口，但共用 GenerationJob 与 Asset；
- 产品数据库而非供应商保存 Project、GenerationJob、Asset、SSE sequence 和恢复事实。

依据：[`dto.ts`](../../blue_whale_web/lib/api/dto.ts)、
[`domain.ts`](../../blue_whale_web/types/domain.ts)、
[`BACKEND-API-PRD.md`](../../blue-whale-agent-workspace/PRD/BACKEND-API-PRD.md)
与 [`CONTEXT.md`](../../CONTEXT.md)。

## 2. 能力总表

标记含义：`支持` = 官方契约明确提供；`不支持` = 官方契约明确没有该形态或明确排除；
`官方未说明` = 所核对官方资料没有形成可依赖承诺。

| 契约维度 | OpenAI `gpt-image-2` | 火山 Seedance 2.0 |
|---|---|---|
| 纯文本素材 | 支持，`prompt` | 支持，`content[].type=text` |
| 图片参考素材 | generations 不支持；edits 支持 | 支持 `image_url` / 授权素材 URI |
| 视频/音频参考素材 | 不支持 | Seedance 2.0 宣传支持多模态参考；具体 API 字段须按模型文档校验 |
| 创建端点 | `POST /v1/images/generations` | `POST /api/v3/contents/generations/tasks` |
| 调用形态 | 同步响应或同连接 SSE | 异步持久 task |
| provider task id | 不支持 | 支持 `id` |
| 状态查询 | 不支持 | 支持 GET by id |
| 状态枚举 | 无持久状态枚举 | queued/running/succeeded/failed/cancelled |
| callback | 不支持 | 支持 `callback_url` |
| 轮询 | 不支持 provider retrieve | 支持 GET 轮询 |
| 取消 | 不支持 | 仅 queued 可取消；running 不支持取消 |
| provider 重试任务 | 不支持 | 官方未说明“重试同一任务”接口 |
| 内容审核 | 支持，输入与输出过滤 | 支持，文本/图片输入与视频输出错误码 |
| 结果 | `b64_json` | `content.video_url` |
| 结果 URL TTL | 不适用，无 GPT Image URL | 官方未说明 |
| 错误模型 | HTTP + `{error}`，含 request id | HTTP + `error.code/message`，含 request id |
| 提交幂等 | 官方未说明 | 官方未说明 |
| 限流/配额 | 支持 429；具体额度按账号/model | 支持 429 `QuotaExceeded`；具体额度按账号 |

## 3. OpenAI `gpt-image-2`

### 3.1 端点与素材输入

官方 [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
给出的直接生成调用为：

```http
POST https://api.openai.com/v1/images/generations
Content-Type: application/json

{
  "model": "gpt-image-2",
  "prompt": "...",
  "n": 1
}
```

该 generations 端点是“从文本生成新图片”。参考图片不属于该端点；`gpt-image-2`
使用图片素材时应走 `POST /v1/images/edits` 的 multipart `image[]`，官方示例允许多图输入，
且该模型自动以高 fidelity 处理输入图。对应字段以
[Images API Reference](https://developers.openai.com/api/reference/resources/images)为准。

因此适配器必须按 `reference_asset_ids` 分流：

- 无参考图：调用 generations；
- 有参考图：下载受控 Asset 字节并调用 edits；
- 不能把 Blue-Whale 签名 URL 填进 generations 并假设模型会自行拉取。

### 3.2 同步与 SSE，不是异步任务

普通调用在 HTTP 响应中直接返回最终结果。Image API 也支持 `stream=true` 与
`partial_images=0..3`，通过 SSE 发送 `image_generation.partial_image` 和 completed 事件；
partial image 数量可能少于请求值，且每张 partial image 增加输出 token 成本。

这个 SSE 是单次生成连接的渐进输出，**不是持久 provider task**：官方 Images 资源只有
create generation/edit/variation，没有 retrieve task、list task 或 cancel task。
连接中断后不能拿某个 image task id 恢复查询。

Blue-Whale 应把本地 Job 状态映射为：

```text
queued（本地排队）
→ processing（Worker 已开始 OpenAI HTTP 调用）
→ succeeded | failed（收到最终字节或错误）
```

partial images 最多作为临时预览事件，不落为最终 Asset，不可虚构百分比；断线后仍以
本地 GenerationJob 查询为权威。

### 3.3 结果获取与持久化

GPT Image 模型默认返回 `data[].b64_json`。官方明确：`url` 只适用于 DALL·E 2/3，
对 GPT Image models 不支持。输出格式可选 PNG、JPEG 或 WebP。

适配器必须：

1. 流式或普通响应取得最终 base64；
2. 解码为受限大小的二进制；
3. 写入 Blue-Whale 对象存储；
4. 探测并登记 mime、width、height、size；
5. 创建 Asset，再把 `output_asset_ids` 写回 GenerationJob。

OpenAI 结果没有 URL TTL 问题，因为没有托管 URL；但响应字节若未成功持久化，供应商没有
retrieve 接口补取。Asset 写入失败必须标为可恢复的本地 ingest failure，而不是重新生成图片。

### 3.4 审核、错误、重试与限流

官方说明所有 prompt 与生成图片均经过内容过滤，`moderation` 可选 `auto` 或 `low`；
被拦截时示例错误码为 `moderation_blocked`。应映射为产品
`content_moderation_rejected`，不做自动原样重试。

[OpenAI error codes](https://developers.openai.com/api/docs/guides/error-codes)定义标准 HTTP
错误与 request id；429 可能表示速率限制或 quota。适配策略：

- 429/5xx/网络错误仅在“未收到成功响应且幂等风险已评估”后指数退避；
- moderation、参数 4xx 不自动重试；
- API Reference 未承诺 images generations 的提交幂等键，网络超时后重发可能重复计费；
- provider request id、HTTP status、原始 code 进内部诊断，不直接泄露到前端。

OpenAI 不提供取消已开始生成的 API。Blue-Whale cancel 只能停止本地排队，或停止等待并忽略
迟到响应；不能向用户承诺上游已停止计费或计算。

## 4. 火山方舟 Doubao Seedance 2.0

### 4.1 模型与创建端点

火山官方已宣布 [Seedance 2.0 API 全面开放](https://developer.volcengine.com/articles/7628567056649125942)；
官方模型专属资料与控制台链接使用 Model ID `doubao-seedance-2-0-260128`，可由
[真人授权素材文档](https://www.volcengine.com/docs/82379/2315856?lang=zh)中的 Seedance 2.0
体验中心链接交叉核对。API 可用性与具体 Model ID 分别取证，避免用营销发布页代替接口字段证据。

[创建任务 API](https://api.volcengine.com/api-docs/view?action=CreateContentsGenerationsTasks&serviceCode=ark&version=2024-01-01)
定义：

```http
POST https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks
Authorization: Bearer <ARK_API_KEY>
Content-Type: application/json

{
  "model": "doubao-seedance-2-0-260128",
  "content": [...],
  "callback_url": "https://..."
}
```

成功响应只返回 task `id`。`content` 明确支持 text 与 image information；图片项使用
`type: image_url` 及 URL。Seedance 2.0 的更多视频/音频/多素材引用能力以其模型填写说明为准，
不能只凭发布宣传猜测每个 API 字段、顺序与数量限制。

### 4.2 真人素材不是普通 URL

火山 [录入真人形象素材](https://www.volcengine.com/docs/82379/2315856?lang=zh)
要求真人认证、授权与一致性校验；授权素材获得 Asset ID 后，可按 `asset://<asset_id>`
作为 `image_url.url` 并标记 reference role 使用。

这说明 Blue-Whale 的普通 `reference_asset_ids` 与火山可信真人 Asset 不是同一身份：

- 普通图片可由适配器签发供应商可访问的短期 URL；
- 真人形象必须另存 provider asset id、授权主体、授权状态和有效期；
- 未完成授权的真实人像不能自动退化成普通 URL 绕过可信素材流程；
- 供应商 Asset ID 只作 provider metadata，不替代 Blue-Whale Asset id。

### 4.3 查询、callback 与状态

[查询任务 API](https://api.volcengine.com/api-docs/view?action=GetContentsGenerationsTask&serviceCode=ark&version=2024-01-01)
为 `GET /api/v3/contents/generations/tasks/{id}`，返回：

```text
queued | running | succeeded | failed | cancelled
```

成功时 `content.video_url` 提供结果；失败时 `error.code/message` 提供错误。

创建时可传 `callback_url`。状态变化会 POST 与查询响应同形的 body；官方明确 succeeded/failed
回调若 5 秒内未成功发送，会回调三次。官方资料未说明 callback 签名或验签字段，故：

- callback 不能作为唯一信任来源；
- 必须校验 task id 属于本项目、状态转换合法，并对重复回调幂等；
- 回调后可用服务端凭据 GET 复核终态；
- 长时间无回调仍要轮询；
- 不能把“三次”解释为永久可靠投递。

产品映射：`queued → queued`、`running → processing`、`succeeded → succeeded`、
`failed → failed`；`cancelled` 需要产品层新增/内部保留取消语义，不能静默映成 failed。

### 4.4 取消、删除与重试

[删除/取消 API](https://api.volcengine.com/api-docs/view?action=DeleteContentsGenerationsTasks&serviceCode=ark&version=2024-01-01)
为 `DELETE /api/v3/contents/generations/tasks/{id}`。查询文档明确只有 queued task 支持取消；
running task 不具备可依赖的取消承诺；`cancelled` 记录只保留 24 小时，之后会被删除。

因此 Blue-Whale 的 best-effort cancel 必须返回实际结果：

- 本地尚未提交：确定取消；
- provider queued：调用 DELETE 后 GET 确认 cancelled；
- provider running：记录 cancel requested，但不得宣称已取消；
- succeeded/failed：按终态处理，不反向改写。

官方未提供“重试同一视频 task”的契约。重试应创建新的 Blue-Whale GenerationJob 和新的
provider task，并用 `retry_of_job_id` 关联；不要复用旧 task id。

### 4.5 结果、审核、错误与限流

终态成功的 `video_url` 必须由 Worker 立即下载、校验媒体类型/大小/时长并复制到 Blue-Whale
对象存储。官方查询契约未说明 URL TTL，因此既不能写死过期秒数，也不能长期直链前端。

官方错误至少区分：

- `InputTextSensitiveContentDetected`；
- `InputImageSensitiveContentDetected`；
- `OutputVideoSensitiveContentDetected`；
- 429 `QuotaExceeded`。

前三类映射 `content_moderation_rejected` 且不原样自动重试；429 映射可恢复的上游容量错误，
按退避与本地队列调度。官方创建文档未说明提交 idempotency key；网络超时后盲目重发可能
产生重复 task 和计费，适配器必须先以 Blue-Whale 幂等键封锁重复提交，并记录每次尝试。

## 5. 最小共同供应商端口

建议端口只使用产品中性类型：

```text
submit(spec, idempotency_context) -> ProviderSubmission
poll(provider_ref) -> ProviderObservation
request_cancel(provider_ref) -> CancelOutcome
fetch_result(provider_result) -> BinaryStream
normalize_error(provider_error) -> UpstreamError
```

`ProviderSubmission` 允许两种合法返回：

- immediate result handle：OpenAI 最终字节已在当前调用中产生；
- asynchronous task ref：火山 provider task id 已创建。

不要为了统一而给 OpenAI 伪造 provider task retrieve，也不要把火山长任务阻塞成一次同步 HTTP。

## 6. GenerationJob 与 Asset DTO 对照

| 产品字段 | OpenAI 映射 | 火山映射 | 结论 |
|---|---|---|---|
| `job_id` | Blue-Whale 自建 | Blue-Whale 自建 | 永不使用 provider id |
| `provider_task_id` | `null` | task `id` | 仅内部 metadata |
| `status` | 本地调用阶段 | provider status 归一化 | 产品终态权威 |
| `progress` | 无真实百分比 | 官方未给百分比 | 用 null/阶段，不伪造 0.35 |
| `output_asset_ids` | base64 落库后创建 | video_url ingest 后创建 | 只指向自有 Asset |
| `error.code` | moderation/HTTP 归一化 | sensitive/quota 归一化 | 原始码另存诊断 |
| `reference_asset_ids` | edits 上传字节 | URL 或授权 asset URI | 适配器解析 |
| `cancel_requested_at` | 只能本地语义 | queued 可执行 | 建议补字段 |
| `retry_of_job_id` | 新 Job | 新 Job + 新 task | 建议补字段 |

现有 `JobStatus` 只有四态，既无法准确表达 cancel，也缺少前序产品状态机已冻结的
`partially_succeeded`。DTO 应补齐部分成功语义；首版若不公开 `cancelled`，至少应在内部模型保留
`cancel_requested/cancelled`，并定义 DTO 升级，不能把用户取消伪装成 provider failure。

`progress` 当前是必填 number，但两个供应商都没有可依赖的百分比。建议改为可空，另加稳定
`stage`；SSE 只发布真实状态变化与 partial preview，不用时间估算伪造进度。

`GenerationParams` 当前把图片、视频和特定供应商选项都做成必填平铺字段，会迫使图片请求携带
`duration/ref_mode`，也会把 `internet_search` 之类能力误当成共同面。应按生成类型与 catalog
能力做可判别参数，并在模型目录中声明每个选项的合法范围；供应商专属字段只能进入适配器配置，
不能继续扩成“所有供应商参数的并集”。

领域 `Asset` 已有可选 `expiresAt`，但 `AssetResponse` 没有对等的 `expires_at`。这里应表达的是
Blue-Whale 自有签名 URL 的过期与刷新，而不是供应商结果 URL 的 TTL；`PresignAssetResponse.expires_in`
则只表示上传 URL 的有效期。公开 API 协议票需要冻结这三类 URL 的不同语义。

## 7. 产品级提交与恢复规则

1. 接口先用客户端请求 id/业务指纹去重，再创建 Blue-Whale GenerationJob。
2. Worker 获取租约后才调用 provider，并记录 attempt、provider request/task id。
3. 不确定提交结果时进入 `submission_unknown` 内部状态，禁止立即盲重试。
4. OpenAI 成功字节和火山 video URL 都先 ingest，再提交 Asset 与 Job 终态。
5. callback、轮询、SSE 断线和 Worker 重启都通过同一个幂等状态转换函数。
6. 终态不可逆；迟到 callback/response 只能补诊断，不能覆盖已确认产品终态。
7. GenerationAuthorizationGate 在 provider submit 前完成；供应商审核是第二道门，不替代它。

## 8. Spike 验收清单

本轮未付费调用。后续凭据与预算就绪后，最小 tracer bullet 应验证：

1. OpenAI text-to-image 最终 base64 能落为 Asset，原始字节不进数据库 JSON。
2. OpenAI reference image 自动路由 edits，而不是 generations。
3. OpenAI SSE partial 中断不产生最终 Asset，普通响应仍能正确完成。
4. OpenAI moderation_blocked、429、5xx 和网络超时分别归一化。
5. 火山创建 task 后能用 GET 恢复，Worker 重启不重复提交。
6. callback 重复三次仍只完成一次；伪造 task id 被拒绝并以 GET 复核。
7. 无 callback 时轮询完成；轮询与 callback 竞态不破坏终态。
8. queued DELETE 后确认 cancelled；running cancel 明确返回 best-effort 未完成。
9. video_url 立即 ingest；模拟 URL 过期不会丢失已完成 Asset。
10. 两家网络超时下产品幂等键都阻止无界重复计费。
11. 多输出部分成功由产品层保存成功 Asset，并只重试缺失输出。
12. 前端只看到产品 Job/Asset/SSE，不看到 provider task id、原始 URL 或内部错误。

## 9. 最终判断

OpenAI 与火山可以共同支撑 Blue-Whale 首版，但只能通过差异化适配器：OpenAI 是同步/流式
图片计算与立即 ingest，火山是异步视频 task 与 callback/轮询。产品最小共同面应建立在
Blue-Whale GenerationJob/Asset 上，而不是两家供应商契约的“交集假象”上。

当前可以锁定的架构决定是：**产品 Job 先于 provider 调用创建；provider 输出必须转存 Asset；
OpenAI 无 retrieve/cancel；火山只保证 queued cancel；未知 TTL、callback 签名和提交幂等均按
“官方未说明”处理，并由产品幂等、复核与恢复机制兜底。**
