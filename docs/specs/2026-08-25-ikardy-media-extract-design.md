# 画布视频节点提取音频（media_extract）设计决策

- 日期：2026-08-25
- 状态：实现中
- 关联工单：IKARDY（画布视频节点提取音频，父需求 IKAN3P 画布共享资产 PRD）
- 实现分支：`feature/IKARDY-实现视频提取音频`

> 本文档是「视频提取音频」功能的唯一设计权威源，供后续会话查询。实现结论与代码如有出入，以本文档为准先核对。

## 1. 背景与目标

画布视频节点可发起「提取音频」：后端下载视频 → 抽取音轨 mp3 → 上传 TOS → 建音频资产 → 前端在视频节点右侧生成音频节点，实时显示提取进度。

可行性：**约 80% 现成**。下载+上传已有 `tos-video-media-relay.persist()`（`packages/generation-runtime/src/tos-video-media-relay.ts`）；音频 TOS 上传已支持（`backend/libs/shared/assets/tos-storage.ts` MIME 映射）；音频是一等资产（`assets` 表有 `type/duration/duration_ms/mime/size`）。唯一新能力是 ffmpeg 抽音轨，落在 ADR-0068 专用计算例外（原生二进制子进程，不引入第二套领域规则）。

## 2. 需求收口决策（grill-with-docs 会话结论）

| 维度 | 决策 |
| --- | --- |
| 接口形态 | 独立端点，不复用 GenerationJob 成本/配额管线 |
| 同步/异步 | 异步，复用现有 MQ（RocketMQ 默认 / BullMQ 回退） |
| 任务表 | **复用 `generation_jobs` 表**，新 type=`media_extract`，**0 表迁移** |
| 输出 | 一等资产（`assets` type=audio），带 duration 元数据 |
| 格式 | mp3（192k，`-vn -b:a 192k`） |
| 入参 | 前端传 `source_asset_id`（视频资产），后端做项目归属校验（SSRF 规避，不放行任意 URL） |
| 进度 | `generation_jobs.progress` 存 0-100 百分比；阶段文案由前端按百分比派生（A 方案，无新列） |
| 用量 | 免费工具，不计入生成用量/实扣/成本对账；新 type 对恢复扫描天然隔离 |
| MQ | 复用 video topic，新增 tag `media_extract`（BullMQ 回退 job name `media_extract`，与任务类型一致） |
| 前端触发 | 视频节点工具栏「提取音频」按钮；占位音频节点放视频节点右侧（IKFS5W 起按源节点内容宽让开）；复用 `pollJob` |

## 3. 架构与数据流

```
画布视频节点（选中态工具栏「提取音频」）
 └─ 创建占位音频节点（position = 视频节点右侧偏移，mediaType=audio, genStatus=generating）
    └─ POST /projects/:pid/media-extractions { source_asset_id, output_format?: 'mp3' }   ← 新端点
       ├─ 校验资产归属（findAccessible + type=video）
       ├─ 插 generation_jobs(type=media_extract, status=queued, input={source_asset_id, output_format}, next_action_at=now)
       └─ 入队 MQ：复用 topic，tag「media_extract」
           └─ generation-worker 新 SimpleConsumer（consumer group: generation-extract-worker）
              └─ runMediaExtractStep（claim-by-id fencing，镜像 runVideoJobStep）
                 ├─ 按 input.source_asset_id 解析 storageKey → presigned GET 下载视频（cap 200MB）→ 临时文件
                 ├─ ffmpeg 抽 mp3 + 解析时长（stderr Duration / -progress out_time_ms）→ 写 job.progress
                 ├─ 无音轨 → fail("video_has_no_audio_track")，不产资产
                 ├─ 上传 TOS（key: media-extract/{userId}/…，public-read）→ createAsset(type=audio, mime=audio/mpeg, duration)
                 └─ publish → output_asset_ids + status=succeeded
           └─ 前端复用 pollJob 轮询 GET /jobs/:id → 节点绑定音频资产，进度实时显示
```

## 4. 表结构（0 迁移）

复用 `generation_jobs` 与 `assets` 全部现成字段：

| 设计要素 | 落点 |
| --- | --- |
| 任务类型 | `generation_jobs.type` VARCHAR(32) 无枚举，直接存 `media_extract` |
| 入参 | `generation_jobs.input` JSON = `{source_asset_id, output_format}` |
| 提取百分比 | `generation_jobs.progress` INTEGER 0-100 |
| 结果资产 | `generation_jobs.output_asset_ids` JSON |
| 失败原因 | `generation_jobs.error` JSON |
| 领用/防重 | `lease_owner` / `lease_expires_at` / `fencing_token` |
| 音频资产 | `assets` 新行：type=audio / storage_key / url / mime / size / duration / generation_job_id |

无新表、无新列、无 seed 变更（`media_extract` 非模型能力，不进 `generation_model_capability`）、无索引变更。

## 5. MQ 与 Worker

- 队列：复用 `VIDEO_GENERATION_QUEUE`（RocketMQ topic / BullMQ queue 单一事实源）。
- 新 tag：RocketMQ tag `media_extract`；BullMQ 回退 job name `media_extract`。
- Producer：`enqueueMediaExtractJob(jobId)`（镜像 `enqueueVideoGenerationJob`，driver 二选一）。
- Consumer：`generation-worker` 新增第二个 `SimpleConsumer`（consumer group `generation-extract-worker`），订阅同 topic + tag `media_extract`；BullMQ 回退路径新增 `GenerationExtractProcessor`。
- **多视频并行**：`RocketMqMediaExtractConsumer` 用 Semaphore 并发派发（**默认 2**，对齐容器 2 核部署；`MEDIA_EXTRACT_CONCURRENCY` 可调 1-16）。ffmpeg 单视频抽音轨多线程无效（mp3 编码 libmp3lame 单线程，实测 -threads 1/8 无差异），进程级并行（每个任务独立 ffmpeg）才是吃多核的正解。默认固定 2 而非动态读核数：`os.availableParallelism()` 在容器未设 CPU 限额时误读宿主机核数，固定值更确定。
- 状态机：`runMediaExtractStep` claim-by-id（`claimMediaExtractJobById`）→ processing → updateMediaExtractProgress（progress 单调 0-99）→ publishMediaExtractResult（succeeded + audio 资产）或 failMediaExtractJob（failed + error）。

## 6. ffmpeg

- 依赖：`ffmpeg-static` 打包二进制。Docker 构建设 `FFMPEG_BINARIES_URL=https://registry.npmmirror.com/-/binary/ffmpeg-static`，postinstall 从 npmmirror 镜像下载（避免 GitHub 超时）；本地 `pnpm install` 已下载本地二进制。
- 命令：`ffmpeg -i <in> -vn -acodec libmp3lame -b:a 192k -y -progress pipe:1 -nostats <out.mp3>`。
- 时长：解析 ffmpeg stderr 的 `Duration: HH:MM:SS.xx`。
- 进度：解析 `-progress` 输出的 `out_time_ms` / 时长 → 百分比。
- 无音轨：提取产物为空/ffmpeg 报 `Output file does not contain any stream` → fail `video_has_no_audio_track`。

## 7. 前端

- `MediaNode` 工具栏（视频节点）加「提取音频」按钮（与「生成音频」并排）。
- `CanvasPage`：handler 创建占位音频节点（`position.x = 源节点内容宽 + 60`，`mediaType='audio'`，`genStatus='generating'`）→ 立刻保存画布 → 连一条带 `origin='media-extract'` 标记的来源边 → `POST media-extractions` → 复用 `pollJob` 轮询 `GET /jobs/:id` → 成功绑定（`src`/`assetId`/`mediaType='audio'`）。
  IKFS5W 起画布只由前端写（后端建任务时不再插节点、worker 不再回写），本文档早期版本的「后端注入」实现已废止。
- 失败/无音轨 → 节点 `genStatus='failed'` + `errorText`，可重试。

## 8. 边界与异常

| 场景 | 行为 |
| --- | --- |
| 源资产非视频/无归属 | 端点 4xx，不建任务 |
| 视频无音轨 | fail `video_has_no_audio_track`，不产空资产 |
| 视频 > 200MB | 下载失败 fail |
| 下载/提取/上传失败 | fail + error JSON 可审计；重投由 MQ 不可见期兜底 |
| 重复提取 | 允许，每次独立任务 + 独立音频资产（不做去重） |

## 9. 验证

- 影响面：产品路径 → 定向测试 + 联调。
- 单测：端点校验/建任务；claim/progress/publish/fail 状态机（守卫+后写）；无音轨失败路径；TOS 上传。
- PR 门禁：`node scripts/verify-change-scope.mjs run --stage pr`。

## 10. 实施状态

> 本期范围：**仅后端**（用户确认前端不做）。前端交互（工具栏按钮/占位节点/轮询）留待后续。

- [x] persistence：类型/claim/ops/repo 接线
- [x] generation-runtime：runMediaExtractStep
- [x] backend：MQ tag + producer
- [x] backend：worker 消费者 + 模块注册
- [x] backend：建任务端点 + 模块
- [x] backend：public-error + 类型联合 + ffmpeg-static
- [x] ffmpeg 冒烟验证（含音轨抽取 / 无音轨报错 / 时长解析）
- [x] **本地端到端验证**（测试视频 asset 3985 → 音频资产 3987 成功，MP3 192k 可播放）
  - 修复①：模块缺 `providers: [MediaExtractionsService]`（Nest DI 启动挂）
  - 修复②：`next_action_at` 设过去 60s——`DATETIME(0)` 秒精度把 `new Date()` 进位到下一秒，同秒 claim 的 `lte now` 判 false 致任务悬挂（media_extract 无恢复扫描）
  - 修复③：下载改走资产**公网 URL**（手写 TOS SigV4 预签名 `buildTosPresignedGetUrl` 对真实 TOS 返回 403，未做真实校验）
- [ ] 前端：工具栏按钮 + 占位节点 + 轮询（**本期不做**）
- [x] 测试 + typecheck + 回归
