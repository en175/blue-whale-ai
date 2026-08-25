# 视频提取音频复用 generation_jobs 表与 ffmpeg 专用计算

- **状态**：Accepted
- **日期**：2026-08-25
- **决策者**：李小强（经 `grill-with-docs` 会话确认）
- **关联工单**：[IKARDY 画布视频节点提取音频](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IKARDY)（父需求 IKAN3P 画布共享资产 PRD）
- **上游决策**：[ADR-0068 产品技术栈与专用计算边界](0068-node-typescript-product-runtime-and-specialized-compute-boundary.md)、[ADR-0074 前后端分离 NestJS Product API](0074-frontend-backend-separation-nestjs-product-api.md)
- **设计详案**：[specs/2026-08-25-ikardy-media-extract-design.md](../specs/2026-08-25-ikardy-media-extract-design.md)

## 背景

画布视频节点需要「提取音频」：后端下载视频 → 抽音轨 mp3 → 上传 TOS → 建音频资产 → 前端视频节点右侧生成音频节点并显示进度。新增一个异步接口，前端传视频 `source_asset_id`，后端建任务入 MQ，worker 消费提取。

复用现有资产已可行：下载+上传有 `tos-video-media-relay.persist()`，音频 TOS 上传与 `assets` 音频字段现成。唯一新能力是 ffmpeg 抽音轨——属 ADR-0068 明确允许的「持续 CPU 密集媒体计算」专用计算例外。

## 决策

1. **独立端点，不复用 GenerationJob 成本/配额管线**：新增 `POST /projects/:pid/media-extractions`，只建任务 + 入队，返回 `{ job_id }`；轮询复用现有 `GET /jobs/:id`（通用返回 `{status, progress, asset}`，前端 `pollJob` 零新代码）。
2. **复用 `generation_jobs` 表，新增 type=`media_extract`，0 表迁移**：`type` 为无枚举 VARCHAR，直接可存；入参放 `input` JSON，进度放 `progress`，结果放 `output_asset_ids`，失败放 `error`，领用防重用现有 `lease_owner/lease_expires_at/fencing_token`。免费工具，不做配额预留/实扣。
3. **复用视频 MQ topic，新增 tag `media_extract`**：RocketMQ 同 topic 新 tag（BullMQ 回退 job name `media_extract`），与任务类型一致，`generation-worker` 新增第二个 `SimpleConsumer`（consumer group `generation-extract-worker`），不新增部署单元。**多视频并行**：消费者经信号量并发派发提取任务（**默认 2**，对齐当前容器 2 核部署；`MEDIA_EXTRACT_CONCURRENCY` 可调 1-16），每个任务独立 ffmpeg 进程吃一个核——ffmpeg 单视频抽音轨多线程无效（mp3 编码单线程），进程级并行才是吃多核的正解。默认值取固定 2 而非动态读核数：`os.availableParallelism()` 在容器未设 CPU 限额时会误读宿主机核数导致超订，固定值更确定。
4. **ffmpeg 专用计算**：`ffmpeg-static` 打包二进制，子进程抽 `-vn -b:a 192k` mp3，解析时长与进度；无音轨明确失败 `video_has_no_audio_track`，不产空资产。符合 ADR-0068 专用计算边界，不引入第二套领域规则/Product API。**构建避开 GitHub**：Docker 设 `FFMPEG_BINARIES_URL=https://registry.npmmirror.com/-/binary/ffmpeg-static`，postinstall 从 npmmirror 镜像下载二进制（国内构建 GitHub 超时）。
5. **入参用 `source_asset_id` 而非裸 URL**：后端按资产 id 做项目归属校验，规避 SSRF 与越权。**下载走资产公网 URL**（资产 public-read，URL 来自 DB 资产记录非用户输入）——手写 TOS SigV4 预签名（`buildTosPresignedGetUrl`）对真实 TOS 返回 403（该实现从未做过真实 TOS 端到端校验），故媒体提取下载不依赖预签名。

## 被否方案

- **新建独立任务表**：`generation_jobs` 的 `type/progress/output_asset_ids/input/error/lease` 字段已完整覆盖异步任务状态机，新表重复造轮子。
- **复用 GenerationJob 成本管线**：给免费媒体工具塞配额/预留/实扣语义错位；独立端点只复用任务表与 MQ，不碰成本。
- **新起 worker 应用**：当前无独立扩缩容/故障隔离证据，`generation-worker` 内加消费者更简单，对齐 ADR-0068「模块化单体 + 进程隔离」。
- **Python/FFmpeg 库替代**：ffmpeg 原生二进制是媒体处理的成熟关键能力，走 ADR-0068 例外；不引入第二套语言运行时。

## 后果

- 新增一个免费媒体工具端点；`generation_jobs` 新增 `media_extract` 类型值，对恢复扫描（按 type 选）天然隔离，不影响 image/video/audio 生成路径。
- 0 表结构迁移；`media_extract` 不进 `generation_model_capability`（非模型能力），不计入生成用量统计。
- generation-worker 镜像打包 ffmpeg-static 二进制（Docker 构建设 `FFMPEG_BINARIES_URL` 从 npmmirror 镜像下载，避免 GitHub 超时）；提取为 CPU 密集短步骤，与视频/图片 worker 同进程隔离边界。
- 前端新增「提取音频」工具栏入口与占位节点复用 `pollJob`；进度为 `progress` 百分比，阶段文案由前端按百分比派生。
