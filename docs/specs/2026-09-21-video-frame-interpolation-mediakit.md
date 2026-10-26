# 视频插帧（火山 AI MediaKit）规格

> 需求共识来自 2026-09-21 两轮九问拍板（ADR-0113：高清 ▾ 下拉第二项入口、HD 式草稿卡面板三档帧率），父需求 IKHLES。术语以根 CONTEXT.md「画布视频插帧」词条组为准。本文件是**官方资料核对结论的落盘位**：冻结请求参数、结果字段、错误与限制的权威表述，并显式标注「官方未明确」项。契约实现 = `backend/libs/contracts/video-frame-interpolation.ts`（本文与契约注释互为口径单源）。

## Problem Statement

用户在画布上的视频常是低帧率或运动不连贯的素材：Seedance 等模型生成视频多为 24fps、快速运动与大屏播放场景下卡顿与跳帧明显。目前画布没有任何补帧能力，用户只能导出到外部工具处理再传回。用户希望直接在视频卡上把帧率提到指定档位，且不离开画布。

## Solution

视频素材卡悬浮工具条首位的「高清」单按钮升级为「高清 ▾」悬停下拉，第二项「插帧」为新入口：点击后为源视频在右侧建插帧草稿卡并跟随弹出极简面板（帧率三档 30 / 60 / 120 fps + 「本期免费」+ 发送）。发送后经 new-api 网关的 MediaKit 渠道调用火山引擎 AI MediaKit 视频插帧异步任务接口，成功后结果视频回填本卡为普通成品视频卡（分辨率和码率跟随原片，只提帧率）。本期免费：无幂等头、无积分预估、不走余额拦截门。

## 官方资料核对结论（2026-09-21）

核对方式：官方文档站为 JS 渲染，正文经其内容接口 `https://www.volcengine.com/api/doc/getDocDetail?DocumentID=<id>` 取回后逐页阅读（四页正文全文比对，非二手转述）；开发指南另有本地 PDF 副本 `/Users/kimjohn/Downloads/智能处理_视频插帧_1786022467.pdf`（内容与指南页一致）。

| 页 | 官方标题 | DocumentID | 最近更新 |
| --- | --- | --- | --- |
| 开发指南 | 视频插帧 | 2618118 | — |
| 提交任务 API | 提交视频插帧任务 API | 2624391 | 2026-08-06 |
| 查询任务 API | 查询任务信息 API | 2278532 | 2026-08-26 |
| 事件回调 | 事件回调（Eventcallback） | 2288701 | 2026-07-31 |
| 错误码 | 错误码 | 2300662 | 2026-07-01 |

### 上游端点（本仓不直连，经网关转发）

- 提交：`POST https://mediakit.cn-beijing.volces.com/api/v1/tools/video-frame-interpolation`（官方逐字）。
- 查询：`GET https://mediakit.cn-beijing.volces.com/api/v1/tasks/{task_id}`——**统一查询入口**，官方明示「支持查询 AI MediaKit 服务下所有类型的**异步**任务」，`task_type` 由服务端返回。
- 提交成功同步返回 `{ success: true, task_id, request_id }`；失败返回 `{ success: false, error: { code, type, message, param } }`。

### 请求参数（Body）

| 参数 | 类型 | 必选 | 官方描述（要点） |
| --- | --- | --- | --- |
| `video_url` | String | 是 | 待插帧视频 URL。来源支持公网 HTTP/HTTPS URL、`mediakit://`（本地上传）、`vod://`、`tos://` 四种协议；格式支持 `mp4`/`flv`/`ts`/`avi`/`mov`/`wmv`/`mkv` 等主流格式 |
| `fps` | Number | 是 | 目标输出帧率，**取值范围 [15, 120]**；**建议目标帧率不超过原片帧率的 4 倍**；若目标帧率低于原视频帧率，系统先插帧再降帧到目标帧率 |
| `media_output_destination` | String | 否 | 产物存储位置（`vod://<空间名>` / `tos://<桶名>`）；设置后结果 URL 返回存储地址而非临时下载地址 |
| `client_token` | String | 否 | 幂等控制，≤64 个 ASCII 可打印字符 |
| `callback_args` | String | 否 | 自定义回调参数，回调时原样返回，≤512 字节 |
| `callback_url` | String | 否 | 单任务回调地址，优先级高于控制台全局回调地址 |
| `queue_id` | String | 否 | 任务提交的目标队列 ID（按队列分账用） |

Header：`Authorization: Bearer {Your_API_Key}`（必选）。

**本仓只透传 `video_url` 与整型 `fps`**，其余可选参数一律不发（幂等 / 回调 / 队列 / 产物目录均不由本仓设置）。对客幂等不走 `client_token`：本期免费路径无幂等头（同 HD 高清 / 去字幕口径）。

### 结果字段（`result`，仅 `status=completed` 返回）

| 字段 | 类型 | 官方描述（要点） |
| --- | --- | --- |
| `video_url` | String | 插帧后视频文件地址；默认（未设 `media_output_destination`）为 **HTTPS 临时下载链接、有效期 24 小时**，须及时下载保存 |
| `duration` | Number | 输出视频时长（秒），**用于计量计费** |
| `resolution` | String | 输出视频分辨率档位；**插帧不改变分辨率，跟随原片**；取值范围 `240p`/`360p`/`480p`/`540p`/`720p`/`1080p`/`2k`/`4k`/`8k` |
| `fps` | Number | 输出帧率，**与提交任务时指定的目标帧率一致** |

### 任务状态

`running` / `completed` / `failed` 三态；`result` 仅 `completed` 返回，`error` 仅 `failed` 返回；另有 `expires_at`（结果过期时间戳，仅成功且有结果时）、`created_at`、`finished_at`（completed 或 failed 时出现）、`queue_id`。

### 错误码

- 提交 / 查询的 `error` 对象形状：`code`（错误码）、`message`（详细描述）、`param`（可选，出错的参数名）、`type`（宏观类型，如 `BadRequest`；查询接口为 `TaskError`/`ApiError`）。
- 官方错误码表（HTTP 状态码 + 建议解法）：`AuthenticationError`(401)、`MissingParameter`(400)、`InvalidParameter`(400)、`AccessDenied`(403)、`TaskCanceled`(410)、`RequestLimitExceeded`(429)、`InternalServiceError`(500)、`DownloadFileError`(500)、`AbilityProcessingError`(500)、`ServiceInitializingError`(503)、`InternalServiceTimeout`(504)。
- 官方失败示例逐字：`{"error":{"code":"InvalidParameter","message":"The 'fps' parameter is out of range [15, 120]","param":"fps","type":"BadRequest"}}`。
- **无插帧专属错误码**：任务级失败复用上述通用码（`TaskError` 类），任务类型只体现为 `task_type`。

### 事件回调

- 事件类型固定 `AIMediaKitTaskComplete`（单任务执行完成事件，成功或失败都推）；回调字段：`RequestId`、`Version`、`EventType`、`EventTime`、`TaskId`、`QueueId`、`Data{ Code(Success|Failed), Message, TaskId, Result(失败为 null), CallbackArgs }`。
- 接收方须返回 200；失败（非 200 或连接超时）最多重试 3 次，间隔 5s / 10s / 30s，全失败即丢弃；**当前版本不支持回调签名鉴权**，官方建议业务层按 `task_id` 幂等。
- 本仓**不使用回调**：沿用家族口径走轮询（`GET /api/v1/tasks/{task_id}`）。

### 官方未明确（不臆造）

1. **文件大小上限**：四页均未给出数值。仅错误码页 `DownloadFileError` 提到「文件大小是否超出限制」为可能原因之一，无具体阈值。
2. **视频时长上限**：四页均未给出数值（指南页只说处理时间「与视频文件大小、时长相关」）。
3. **输入分辨率上下限**：参数级 API 参考页的 `video_url` 描述未给输入分辨率门槛（与 HD 高清不同——画质增强大模型版明示短边 [360,1080] / 长边 [360,1920]），故本工具**不设分辨率门槛**。
4. **上游任务失败时的逐码对照**：错误码表给的是通用码；`failed` 状态下哪类输入触发哪条码未逐项列出。
5. **回调请求体形态**：Content-Type 可配 `application/json` 或 `application/octet-stream`，本仓不使用回调故不涉及。

## 契约冻结（本票 IKHLK3 交付面）

跨进程字段单源 = `backend/libs/contracts/video-frame-interpolation.ts`（worker-java 镜像 = `domain/contract/VideoFrameInterpolationContract.java`，防漂移断言 = `video-frame-interpolation.test.ts` 读 Java 源码文本逐值对账）。

| 项 | 冻结值 |
| --- | --- |
| 任务类型 / MQ tag / `generation_jobs.type` | `video_frame_interpolation`（三处同值；`JobTypeEnum` + `GenerationMqRouteEnum` 镜像） |
| 来源值（claim SQL 白名单） | `video_frame_interpolation` |
| input 键 | `source_asset_id` / `target_node_id` / `fps`（三键恒在，strict 拒多余键；`provider_credential` 为创建侧注入的基础设施键，不进 zod） |
| fps 取值 | 整型三档 `30` / `60` / `120`（官方 [15,120] 的产品真子集）；**缺省补默认 60** |
| 结果字段 | `video_url` / `duration` / `resolution` / `fps`（官方四字段，键名单源在契约 `RESULT_KEYS`） |
| 对客提交路径（网关） | `POST /v1/mediakit/video-frame-interpolation`——**假设值**，按家族规律（`/v1/mediakit/{与上游同名的工具段}`）命名，待网关票 IKHLLB 对齐后定稿（单源，改一处） |
| 对客查询路径（网关） | 复用 `GET /v1/mediakit/tasks/{task_id}`（MediaKit 异步工具共用，路径不含 async 段） |
| 错误码 | 兜底 `video_frame_interpolation_failed` = **1049**（1045–1048 已由 HD 高清 / 场景切分 / 人声背景分离 / 音频截取占用；落码前全仓 grep `1049` 零命中）；入队失败另走 `enqueue_failed`(1028) |
| 免费口径 | 无幂等头、无积分预估、不走余额拦截门（同 HD 高清 / 去字幕） |

**网关路径 ≠ 火山上游路径**（video_enhance 的 IKH67T 实测：混用即 404 Invalid URL，任务卡在提交相）。

### 产品口径与官方口径的差异（均为产品决策，ADR-0113）

- 官方 fps 面 [15,120]，产品只暴露 30/60/120 三档；枚举外（含官方合法的 45）在创建入口明确拒绝。
- 官方「目标帧率不超过原片 4 倍」为**建议非硬限**，且仓内全链无 fps 元数据、源帧率前端不可知 → **不做前置拦截**，越界由任务失败文案（1049「视频插帧失败，请重试」）兜底。
- 官方「低于原片帧率时先插帧再降帧」→ 30 档对 60fps 源视频是合法的降帧路径，同样不拦截。
- 分辨率与码率跟随原片（官方明示），要提清晰度须配合 HD 高清（画质增强大模型版）——产品侧以入口归拢在同一下拉内体现。

## 后端创建入口（本票交付面）

`POST /api/projects/:projectId/video-frame-interpolations`（模块 `video-frame-interpolations`，service 在 `backend/libs/shared/video-frame-interpolations/`）：

1. zod 复核（strict 三键，fps 缺省补 60，枚举外可读拒绝）；
2. 项目归属校验（`findOwnedById`）；
3. 源素材归属与类型校验（`findOwnedSource` + `type === "video"`，非本人一律 404 不泄露存在性）；
4. **无输入门槛**（不照搬 HD 分辨率门槛、不做 4 倍建议拦截，理由见上）；
5. 请求方 sk- 凭证冻结进 `input.provider_credential`（断链防护，同家族口径）；
6. job 先持久化（`generation_jobs` type/source = `video_frame_interpolation`，status=queued，`next_action_at` 回拨 60s），返回 `{ job_id, status: "queued" }`；
7. RocketMQ 投递（tag = `video_frame_interpolation`）；投递失败响应仍 200，job 落 `enqueue_failed` 失败终态（对客文案「任务入队失败，请重试」，`details.raw` 为内部调试信息不外露）。

查询复用既有 `GET /api/jobs/:id`（零改动）：worker 终态写 `output_asset_ids` 与 `error.code = video_frame_interpolation_failed` 后，投影自动出 1049 与中文文案；`generation-job-error-projection.ts` 已补本类型兜底分支（无 `stored_error` 时不再落图片生成文案）。

## Out of Scope

- worker-java 执行器（消费者 / 处理器 / 网关客户端 / 转存 / 终态收口）——由 IKHLKJ 按附录 C 触点承接。
- 前端「高清 ▾」下拉与插帧面板、插帧卡（前端票）。
- 网关侧路由与 `model_price` 配 0（网关票 IKHLLB）；契约里的对客路径是待对齐的假设值。
- 卡片 / 资产 fps 元数据链（ADR-0113：全链不新增 fps 元数据字段）。
- 任务中途取消（官方无取消端点，家族「发出不取消」口径天然成立）。
- 事件回调接入（官方支持，本仓沿用轮询；`callback_url` 等可选参数一律不发）。

## Further Notes

- 官方查询接口自 2026-08-20 起**仅支持查询 30 天内创建的任务**；任务结果默认保留 24 小时，剩余有效期不足 2 小时时调用查询会自动续期。对本仓无行为影响（worker 在任务完成后立即下载转存），但排查历史任务时须注意该窗口。
- 官方 `resolution` 结果档位取值含 `8k`，本仓不消费该字段做元数据（仅随终态日志 payload 承载，assets 无 resolution/fps 列）。
- HD 高清与插帧同源（画质增强门类）但门槛不同源：HD 有官方输入分辨率门槛并可推导输出宽高，插帧两者皆无。
