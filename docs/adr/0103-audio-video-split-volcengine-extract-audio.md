# 音视频分离：执行面切火山 MediaKit extract-audio、入口改编辑态、本地 ffmpeg 链路保留不清理

画布视频卡工具栏「提取音频」（IKARDY/IKFS5W）原由 worker-java 本地 ffmpeg 抽音轨（仅 mp3、源视频上限 200MiB、占 worker 本地算力）一键直发。需求将其更名「音视频分离」并全面切换为火山官方「提交音频提取任务」API（`POST /api/v1/tools/extract-audio`，异步任务，结果 `audio_url` 为 24 小时临时链接需立即转存），同时开放五种输出格式（默认 m4a）供用户选择。本 ADR 记录四项决策。其一，执行面走 NewApi 网关（模型名 `mediakit-extract-audio`，命名以网关配置票为准；网关按模型名路由 MediaKit 渠道计次计费，本期 model_price 配 0，与高清/擦除/扩图/抠图/去字幕五工具同构）：worker 提交后轮询火山任务，完成后从临时链接下载转存自家 TOS 再发布资产；任务类型复用现有 `media_extract`，input 字段不变（`source_asset_id` + `output_format`，格式枚举从仅 mp3 扩为 m4a/mp3/ogg/flac/wav 五种），切换时在途任务被新逻辑自然领取处理，无兼容包袱。其二，入口交互因格式可选从一键直发改为编辑态（对齐去字幕形态：视频暂停锁定、上方工具条仅 X 退出、下方发送条含格式下拉与「本期免费」标注），发送才建任务与音频占位卡，退出不建。其三，**本地 ffmpeg 链路保留不清理**：全仓已核查 `FfmpegExtractor` 唯一主代码消费方就是 `MediaExtractJobProcessor` 本链路（无其他工具关联），但按产品决策暂时保留——切换后 `FfmpegExtractor` 及其配套测试成为无主代码（主代码零引用），worker-java Dockerfile 继续安装 ffmpeg，backend 的 `ffmpeg-static` 依赖（源码零引用的退役 node worker 遗留）一并原地保留。其四，不做前置置灰预检（火山输入上限 4K、建议 10GB 远宽于去字幕 2K 硬限，本仓视频资产几乎触碰不到），保留「视频未关联资产」这一唯一置灰条件，超限由后端与火山侧权威拦截走任务失败口径。

## Considered Options

- 保留 ffmpeg 作为火山失败时的兜底回退（双执行路径）：一次用户操作有两条成败路径，排障与计费口径变浑，否决；保留不等于兜底，ffmpeg 切换后不再被任何主代码调用。
- 按钮文案保持「提取音频」：需求已定名「音视频分离」，工单、词条、文案统一叫法，否决旧名。
- 下拉菜单选格式即发（不进编辑态）：与家族「进入会话再发送」口径（ADR-0098 对一键直发的否决）不符，否决。
- 前置置灰对齐去字幕（分辨率/时长预检）：4K 上限实际不会被本仓视频资产碰到，前置拦截徒增门槛，否决。

## Consequences

- `FfmpegExtractor` 与其测试、worker-java Dockerfile 的 ffmpeg 安装、backend 的 `ffmpeg-static` 孤儿依赖原本均为有意保留的死重；后续任何「清理死代码」提案须先对照本 ADR，清理需产品再拍板。
  - **2026-09-28 backend 侧已清理（产品拍板）**：`ffmpeg-static` 及其全部配套处置移除——依赖声明、`pnpm-workspace.yaml` 的 `allowBuilds` 条目、`backend/Dockerfile` 与 `Dockerfile.typescript-baseline` 的 `FFMPEG_BINARIES_URL`（该变量只为绕开它 postinstall 从 GitHub 下二进制，是验收基线镜像构建失败的独立原因）。audio-mix 浏览器验收套件不再在 `beforeAll` 现生成音频，改用检入夹具 `backend/apps/blue-whale/src/api/canvases/fixtures/sine-440-1s.mp3`（worker 本就只读取/转发字节、不解析音频）。
  - **Java 侧仍保留**：`FfmpegExtractor`、`MediaExtractJobProcessor` 的本地路径、worker-java 镜像的 ffmpeg 安装均未改动，清理另议。
- 产物命名从固定 `xxx(audio).mp3` 变为 `xxx(audio).{所选格式}`。
- 错误码面变化：本地路径特有错误（如 200MiB 的 video_too_large）对火山路径不再出现，新增网关与火山侧错误映射，错误码用位在契约票定义。
- worker 轮询超限判定与转存时序对齐去字幕（ADR 见 IKGZ7V 整包）既有实现。
