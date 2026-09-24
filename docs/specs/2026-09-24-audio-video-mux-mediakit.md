# 画布音视频合成规格（AI MediaKit）

## 时间

2026-09-24

## 状态与目标

**已确认**：Kim 于 2026-09-24 确认本规格方向。会话形态（草稿卡+面板，Kim 提议）、视频绑定交互（方案丙拖线绑定，三方案原型评审拍板）、视频来源（仅画布与素材库，无本地上传）、发送后口径（面板关闭、工具条恢复）均已拍板；功能定义（原声处理两档、时长对齐三档全裁剪、本期免费、冻结重试、仅 URL 缺失置灰）按推荐口径确认。本文是后续实施与验收依据，当前**没有实现音视频合成产品代码**。

用户在画布选中一张已完成的音频成品卡，点工具栏「音视频合成」从源卡拉出草稿卡，拖线绑定一个视频并配置参数后发送，把源音频合进视频产出 MP4。供应商任务异步执行，生成前没有合成预览。

术语以根目录 `CONTEXT.md`「画布音频音视频合成」为准。本文将用户提供的 PDF 中的 API 限制、官方提交接口的补充字段，以及已确认原型中的可见交互同时固定下来。

## 已确认的产品边界

| 项目 | 规则 |
| --- | --- |
| 入口 | 仅已完成、可用的画布音频成品卡显示可点击「音视频合成」；位于卡片悬浮工具条第四位，顺序沿用「截取、调速、混合、音视频合成、下载」（ADR-0109；「转码」钮已于 2026-09-25 撤除）。 |
| 会话形态 | 点入口即从源音频卡右侧拉出**音视频合成草稿卡**（视频卡轮廓、虚线内容区、标题「音视频合成」），与源音频卡默认连音频输入线；参数面板跟随草稿卡下方。不使用截取/混合的单条发送条形态。 |
| 输入 | 点入口的卡是不可移除的固定音频源；视频只绑定**一个**，来源二选一：画布视频卡**拖线绑定**（从视频卡右侧加号拖到草稿卡吸附）或素材库选择（次级入口，不拉线）。本期不支持本地上传。同一草稿卡同一时刻只绑一个视频；同一视频卡可参与多次合成。节点身份用 `nodeId`、资产身份用 `assetId`，不靠文件名、画布位置或 URL 猜测。 |
| 参数 | 原声处理两档：「保留原声」（默认，新音频与视频原声混合）/「替换原声」。时长对齐三档：「保持原长」（默认）/「裁到视频长」/「裁到音频长」，全为裁剪语义。不提供音量调节（API 无此参数）、变速对齐、输出格式选择（API 固定 MP4）与合成预览。 |
| 输出 | 发送即草稿卡转生成中占位（不可播放）；成功**原地回填**为普通视频成品卡，不记合成身份（插帧成品卡口径）；结果卡名 = 视频名(音视频合成).mp4（原型中「合成视频.mp4」为占位名，以本规格为准）。时长以 `result.duration`、分辨率以 `result.resolution` 回填为服务端权威值，缺失回落源资产（去字幕先例）。 |
| 费用 | 本期免费；面板显示「⚡0 本期免费」，业务创建不预留积分、不走余额拦截，网关对客模型价格必须显式配 0（不配会被网关硬拦 400，图片擦除规格实证）。 |
| 来源 | 草稿卡与源音频卡的默认线、与画布视频卡的绑定线均为 `origin=audio-video-mux` 的专用语义边；素材库输入不凭空建卡或连线。来源线只表达溯源与绑定，从音频参考推导与 @ 编号中排除。 |
| 失败重试 | 失败保留结果卡并提供「重试」；重试复用**首次提交时冻结的视频、音频、参数与画布来源**，走 `:jobId/retry`（混合先例），不重新走创建入口。如需改输入或参数，删除草稿卡从源卡重新发起。 |
| 置灰 | 仅源音频 URL 缺失时整钮置灰并悬停说明（音视频分离「未关联资产」口径）；时长、分辨率元数据缺失不拦；视频超 4K、格式不受支持由任务失败口径兜底。 |

## 已确认的原型交互

**原型主证据**：本地分支 `chore/音视频合成交互原型`，两提交：三方案对比版 `edf89a1c0`（甲浮层选材/乙画布点选/丙拖线绑定，评审件）与定稿版 `521e32989`，文件 `web/prototypes/audio-video-mux.prototype.html`。可用 `git show 521e32989:web/prototypes/audio-video-mux.prototype.html` 查看。原型是一次性评审件，不并入产品代码；本节是无需运行原型即可实施的交互契约。

### 布局与视觉

- 源音频卡沿用现有 `MediaNode` 的 480×240 深色卡、波形、红色播放头；草稿卡为视频卡轮廓（16:9 内容区虚线占位，未绑定文案「选择视频并配置参数」，已绑定文案「已就绪，点击发送生成」），卡外顶部标题行「音视频合成」。悬浮工具条、面板及浮层复用仓库 `variables.css` 的深色浮层、描边、阴影、蓝色选中态令牌。不得使用黄色主按钮。
- 参数面板跟随草稿卡下方：标题「音视频合成」、视频槽、原声处理两档分段、「时长对齐」三档分段、「⚡0 本期免费」、圆形 `↑` 发送钮（统一 Dock 主发送钮样式）。未绑定视频时发送钮置灰并提示「先选择视频」。
- 视频槽三态：未绑定显示引导「从视频卡右侧 ＋ 拖线到本卡」与「或从素材库选择」次级链接；绑定中跟随拖线手势；已绑定显示视频信息条（缩略图、文件名、时长、来源标注「· 画布」或「· 素材库」、× 移除）。
- 素材库浮层：单列表视频资产（无页签、无上传），选中即绑定不拉线；点浮层外部或 Esc 自动关闭（AudioMixBar outside-dismiss 口径）。
- 模态口径：会话期间（未绑定/绑定中/已绑定）媒体卡悬浮工具条整条不渲染（HD/插帧面板全局会话门口径），Dock 六面板不可见不可开；发送后面板关闭、工具条恢复且「音视频合成」保留高亮。

### 拖线绑定细节

- 从画布视频卡右侧加号锚点拖出虚线跟随鼠标，拖到草稿卡上吸附成实线即绑定，并建立 `origin=audio-video-mux` 输入线；拖到空白不绑定、状态回退。
- 拖线落点是实现接缝：现有口径中拖线落到已有卡建普通参考连线；落到未绑定/绑定中的音视频合成草稿卡时转为**绑定动作**，不建普通参考线。实现须在连线落点判定处按目标卡身份分流。
- 已绑定后信息条 × 或删除绑定线均可解绑重选；音频输入线（固定源）不可单独删，删除草稿卡才解除。
- 候选视频卡必须是已完成、关联资产的视频成品卡；非视频卡、生成中卡不接受拖线绑定。

### 状态流转

| 动作或状态 | 画布可见结果 | 持久化与约束 |
| --- | --- | --- |
| 进入/编辑 | 源音频卡右侧出现草稿卡与默认音频输入线，面板跟随；可拖线或从素材库绑定视频、调参数。 | 进入不创建任务、资产或来源边（默认线与绑定线随卡持久化）；草稿卡未发送可手动删除，不自动清理（HD 卡口径）。 |
| 提交被业务 API 接受 | 面板关闭，草稿卡原地转**不可播放**的生成中视频占位卡；工具条恢复。 | 冻结视频与音频的资产身份、画布节点身份、参数与来源；保存任务；刷新或重新打开画布仍能看到任务状态并恢复查询。点击发送需防重复建任务。 |
| 任务完成 | 同一张卡原地变为普通可播放视频成品卡，名 = 视频名(音视频合成).mp4；来源线保留。 | 将供应商结果先转存为我方长期资产，再用真实 `result.duration` 与 `result.resolution` 回填卡片；卡片不再记合成身份。 |
| 任务失败 | 同一张卡显示失败原因与「重试」，仍不可播放；来源线保留。 | 重试沿用冻结输入与参数，在**原卡**重新进入生成中；不复制结果卡或来源线。 |
| 创建请求未被接受 | 保持面板与已绑定视频，展示可读错误。 | 不产生虚假的任务、占位卡或来源线；允许修正后再次发送。 |

输入卡日后被删除时，结果资产仍独立存在；画布上已不存在的节点不留下悬空线，冻结任务输入仍可审计。草稿卡优先放在源音频卡右侧就近空位，不覆盖已存在的卡。

## 供应商 API 依据与映射

### 原始资料

1. **Kim 提供的 PDF**：《智能处理 · 音视频合成》，本机 `/Users/kimjohn/Downloads/智能处理_音视频合成_1785209548.pdf`，8 页，SHA-256 `2937666a281bc83f9571919f3d197243c3342ab4d341e4118eb511d9757eff8f`。PDF 是能力、任务流程、对齐语义、输入限制与 24 小时地址约束的原始资料；实施字段已摘录于本文，无需依赖本机文件才能实现。
2. [火山引擎《提交音视频合成任务 API》](https://docs.volcengine.com/docs/6448/2288704?lang=zh)：提供 `is_audio_reserve`、`is_video_audio_sync`、`sync_mode`、`sync_method`、幂等与回调等 PDF 指向的接口细节；核对日期 2026-09-24。

**已核对差异**：PDF 开发指南开头称将讲解「音量控制」，但指南正文与提交接口参考页均**没有任何音量调节参数**；调音量是另一个独立 API。本产品首版不做音量控制，不静默承诺该能力。如上线前接口文档再变化，应重新验证参数全集与返回字段，不静默回退。

### 上游请求与响应

| 项目 | 火山引擎契约 | 本产品约束 |
| --- | --- | --- |
| 提交 | `POST https://mediakit.cn-beijing.volces.com/api/v1/tools/mux-audio-video`，`Authorization: Bearer {API_KEY}`，JSON body。成功返回 `success=true`、`task_id`、`request_id`。 | 浏览器不持有供应商密钥，不直连此地址；经我方业务 API、执行侧及网关调用。 |
| `video_url` | 必填；公网 HTTP/HTTPS、`mediakit://`、`vod://`、`tos://`；mp4/flv/ts/avi/mov/wmv/mkv 等；建议 ≤10 GB（建议值非已证实硬限制）；最高 4K（3840×2160）。 | 我方要求一个视频资产；发送前将资产解析为网关/供应商可读的 URL，不把浏览器临时对象 URL 当作输入。服务端复核归属、媒体类型与可访问性。 |
| `audio_url` | 必填；协议同上；mp3/aac/wav/m4a 等主流格式；建议 ≤10 GB。 | 固定为源音频卡资产，同上解析与复核。 |
| `is_audio_reserve` | 可选，默认 `true`：保留原音轨并混音；`false` 用新音频替换原音。 | 面板「原声处理」两档映射；总是显式传入。 |
| `is_video_audio_sync` | 可选，默认 `false`：不对齐，输出时长取较长流（音长画定格、画长音后静音）。 | 「保持原长」不传该参数（或显式 `false`）。 |
| `sync_mode` | 对齐基准 `video`（默认）/`audio`，仅 sync=true 时生效。 | 「裁到视频长」传 `video`，「裁到音频长」传 `audio`。 |
| `sync_method` | 对齐方式 `trim`（默认，裁剪较长流）/`speed`（变速对齐）。 | 本产品三档全走 `trim`，总是显式传 `trim`；`speed` 不在本期（官方建议仅时长差 10% 内使用）。 |
| 可选辅助参数 | `media_output_destination`、`client_token`（≤64 个可打印 ASCII 的幂等键）、`callback_args`（≤512 字节）、`callback_url`、`queue_id`。 | 首版不在 UI 暴露。网关/执行侧可用 `client_token` 防重复提交；轮询已足够，不要求新增回调或专属队列；未配置授权前不传 `media_output_destination`。 |
| 查询 | `GET https://mediakit.cn-beijing.volces.com/api/v1/tasks/{task_id}`，或事件回调。任务完成状态为 `completed`。 | 持久化供应商 `task_id`，沿现有异步任务恢复机制查询，失败终态需保留原因。 |
| 错误 | 提交参数或鉴权错误可同步返回 `success=false`、`code`/`message`/`type`。 | 记录 `request_id` 供排查；同步失败不得按已提交任务轮询或显示假完成。 |
| 结果 | `result.video_url`（未设目标存储时为 **24 小时有效**临时链接）、`result.duration`（秒）、`result.resolution`；输出固定 MP4，无格式参数。 | 不能把临时地址直接存成永久资产；任务成功后立即转存到我方存储，创建 video Asset，再完成任务。时长与分辨率以实际返回值回填，缺失回落源资产；跨进程存储若采用毫秒需明确从秒换算。 |
| 处理时间 | PDF 给平均 RTF≈1，耗时与视频时长正相关。 | 这是均值，不是 SLA 或超时上限；不能直接复制截取任务固定约 60 分钟的轮询截止。 |

上游最小请求示意：

```json
{
  "video_url": "https://example.com/my_vlog.mp4",
  "audio_url": "https://example.com/bgm.mp3",
  "is_audio_reserve": true,
  "is_video_audio_sync": true,
  "sync_mode": "video",
  "sync_method": "trim"
}
```

成功查询结果至少读取：

```json
{
  "success": true,
  "task_id": "amk-tool-mux-audio-video-1704500",
  "status": "completed",
  "result": {
    "video_url": "https://example.volcvideo.com/final_video.mp4?auth_key=...",
    "duration": 227.0,
    "resolution": "1920x1080"
  }
}
```

## 我方实施契约与前置条件

- **任务输入快照**：新增独立 `audio_video_mux` 任务类型。冻结 `{ audio: { assetId, nodeId }, video: { assetId, nodeId? }, is_audio_reserve, sync }`，其中 `audio` 首项语义为固定源（必有 `nodeId`），画布拖线绑定的 `video` 有 `nodeId`、素材库输入没有；`sync ∈ { "none", "video", "audio" }` 为三档对齐档位的单字段冻结，执行侧映射：`none` 不传 `is_video_audio_sync`，`video`/`audio` 传 `is_video_audio_sync=true, sync_mode=<值>, sync_method="trim"`。跨进程字段名（TS zod、DB input JSON、Java Contract）三端同字，契约先行。重试读快照而不是读当前选中态或重算来源。
- **浏览器与业务 API**：前端预检视频已绑定、类型为视频、身份有效；NestJS 创建入口权威复核用户对两份资产的访问权、媒体类型（audio/video 各归各位）、可用 URL 与协议白名单（https/mediakit/vod/tos）、TOS storageKey 还原与公开可读探测（音频混合同款 `inspectObject` + Range GET，并发 8、15s 总 deadline）。创建成功才回 `jobId` 并退面板转占位卡；创建失败留在面板，不留假卡。免费任务不冻结费用、不预留成本、不拦余额。
- **执行与网关**：执行侧经 blue-whale-api 的 MediaKit 渠道提交并查询异步任务，供应商 `task_id` 持久化，进度/终态投影回画布。拟新增对客模型 `mediakit-mux-audio-video`、网关路由 `POST /v1/mediakit/mux-audio-video`，查询沿用 `GET /v1/mediakit/tasks/{task_id}`；这是**新增契约提案，并非当前已上线接口**，网关侧实现、模型价格 0、渠道与 API Key 配置均为上线前置，照高清放大网关单（IKGOKL）同流程办理。TS（`backend/libs/contracts/`）与 Java（worker `*Contract`）双端常量 `SUBMIT_PATH`/`POLL_PATH_PREFIX` 同字冻结；迁移总契约出站键同步增补。
- **结果资产**：成功后先完成安全下载与我方 TOS 持久化，再建 Asset、回填结果卡/任务终态。现有转存先例有 **1 GiB** 上限；视频产物体积随较长输入增长，不能假定该上限可覆盖。实施时须升级/验证实际产物容量能力，或另行明确产品级容量限制并补 UI 说明，避免"供应商成功而用户结果丢失"。转存失败按任务失败呈现并可重试，不暴露临时供应商 URL 作为成品。
- **轮询与恢复**：音频混合执行器先例为提交后 5 秒首查、退避 `min(60s, 5s << min(4, pollCount/3))`，超时预算 `max(1d, 4×估算+6h)`、未知 7d、上限 365d。音视频合成耗时随视频时长增长（RTF≈1），必须沿用可恢复的超时/退避规则，验证长视频不会仅因固定次数耗尽而误判失败；刷新画布可继续追踪生成中卡。恢复扫描照音频混合特例 `maxAge=0`（提交即持久化 `provider_task_id`，恢复不按龄期过滤，ADR-0114 同语义）；并发档照音频混合复用 `mediaExtract()`，不新增 `WorkerProperties` 字段。
- **来源隔离**：为源音频卡（默认线）与画布视频卡（绑定线）建 `origin=audio-video-mux` 的语义边；素材库输入只保留在输入快照。音频参考推导、@ 编号和生成素材槽应跳过该来源边（音频混合已踩过该坑）。边与草稿卡一起持久化、刷新后恢复；重试不重复建边；输入卡删除不留悬空线。
- **工具条点亮**：`compose` 钮从 `Toolbar.tsx` 的 `audioToolItems` 占位数组移出单独渲染（调速钮先例），门槛函数 `audioVideoMuxSourceError`（已完成音频成品卡 + URL 缺失），`data-testid="audio-tool-compose"`；同步 `Toolbar.test.tsx` 的 `placeholderIds` 与顺序注释（原「仅剩 `transcode`」口径已失效：「转码」钮于 2026-09-25 撤除，本钮移出后占位数组为空）。
- **会话注册**：新增会话种类 `audioVideoMux`（`toolSessionCoordinator.ts` 的 `TOOL_SESSION_KINDS`、`SELECTION_EXIT_KINDS`、`ESC_EXIT_KINDS` 三处数组），`editSessionActive` 派生析取与退出函数照音频混合同款；面板打开期间媒体卡悬浮工具条整条不渲染的派生注入（`soloToolbarHidden`）照 HD/插帧面板口径。
- **占位卡与终态回填**：占位卡为视频型（`mediaType: 'video'`、内容区视频尺寸、节点记住 `audioVideoMux` 身份），**不能**复用写死音频类型的音频混合占位卡工厂；视频占位卡先例是去字幕家族的 `createImageDraftCard` + `mediaType:'video'`。终态走通用回填分支（按 `asset.type` 翻 `mediaType`，宽高/时长从 `detail.asset` 补），需要专属文案时再加分支。这是音频卡会话首次产出视频卡，机制已验证无障碍。
- **恢复与重试**：`planAudioVideoMuxRecovery` 照 `planAudioMixRecovery` 同构（pending 补占位卡、终态补轮询、来源边按冻结输入补画）；重试走 `POST :jobId/retry` + `Idempotency-Key` + `command_idempotency` 表（混合双轨口径），前端重试键同键复用。

## 验收要点

1. 仅已完成音频成品卡点亮第四钮；源音频 URL 缺失置灰并悬停说明；视频超 4K、格式不支持不拦、由任务失败呈现原因。
2. 拖线绑定全流程：视频卡加号拖线到草稿卡吸附绑定并拉输入线、拖到空白不绑定、信息条移除可重选；素材库绑定不拉线且标注「· 素材库」；绑定前发送置灰，连点发送不重复建任务、卡或线。
3. 原声处理两档与时长对齐三档的全组合逐一提交核验（API 参数映射正确），默认「保留原声 + 保持原长」；冻结快照在重试时原样生效。
4. 发送即出现不可播放的生成中视频占位卡；刷新后占位卡、任务与来源线仍在；成功原地回填可播放成品，时长分辨率取供应商返回值（缺失回落源资产）；失败卡展示原因并以冻结参数在同卡重试；创建请求失败不留假卡。
5. 会话期媒体卡工具条整条不渲染、Dock 六面板不可见不可开；发送后面板关闭、工具条恢复且高亮保留。
6. 本期免费徽标、零价网关配置、无余额拦截均成立；临时 URL 过期、长视频轮询、超过现有转存 1 GiB 的情况有可验证的处理结果，不能被标记为成功却没有可用资产。

## 不在本期

本地上传视频输入、变速对齐（`speed`）、音量调节（独立 API）、多视频或批量合成、连线派生菜单入口（从加号拖线经连线类型菜单建合成草稿卡）、输出格式选择（API 固定 MP4）、付费积分估算、事件回调与专属队列、生成前的合成试听。

## 关联依据

- 视觉与控件：`web/src/pages/CanvasPage/components/MediaNode/index.module.css`、`web/src/pages/CanvasPage/components/AudioMixBar/index.module.css`、`web/src/styles/variables.css`。
- 已有异步卡/来源/恢复先例：`web/src/pages/CanvasPage/audioMix.ts`、`web/src/pages/CanvasPage/index.tsx`（去字幕占位卡与通用终态分支）、插帧面板组件。
- 工具条与会话锚点：`web/src/pages/CanvasPage/components/MediaNode/Toolbar.tsx`（`audioToolItems`）、`web/src/pages/CanvasPage/components/MediaNode/toolSessionCoordinator.ts`。
- 后端与执行先例：`backend/libs/contracts/audio-mix.ts`、`backend/libs/shared/audio-mixes/audio-mixes.service.ts`、`worker-java/.../AudioMixJobProcessor.java`、`JobFinalizer.publishAudioMixResult`、`NewApiMediaKitMixAudioClient.java`。
- 供应商接口：上文 PDF 与[官方提交 API](https://docs.volcengine.com/docs/6448/2288704?lang=zh)。
- 已确认原型：本地分支 `chore/音视频合成交互原型` 提交 `edf89a1c0`（三方案对比）与 `521e32989`（定稿）；spec 正文是交互权威，原型用于复核视觉与状态。
