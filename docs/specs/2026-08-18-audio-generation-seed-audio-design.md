# 音频生成模型接入设计(seed-audio-1.0)

- 日期：2026-08-18
- 状态：待评审
- 范围：一期只上豆包 `seed-audio-1.0`，走 new-api Gateway，画布 Dock 直生，仅文本描述参数；`music`（GenBGM v5.0）二期留位。

## 背景与目标

Blue-Whale 已有图片/视频生成的 GenerationJob 治理管线（成本预留 → 资产入库 → 审计，禁供应商直连旁路）。本期将「音频生成」作为新的生成技能能力接入，复用该管线，产品形态对齐图片/视频：

- 前端画布已有 `AudioDialog`（音频生成壳）与 `MusicDialog`（AI 音乐壳），模型为 mock、`onSend` 仅 `console.log`，本期把音频壳接真。
- 上游选型：豆包语音 `seed-audio-1.0`（人声 + 音效 + 环境声混合编排，支持时间轴描述），与「音效生成」定位契合，且对接成本最低（单 `X-Api-Key`、一次 POST 同步返回）。

## 需求澄清结论

| 维度 | 决定 |
| --- | --- |
| 产品定位 | 生成技能，复用 GenerationJob 治理管线 |
| 能力 | 音效生成，豆包 `seed-audio-1.0` |
| 范围 | 一期只上 seed-audio-1.0；`music`（GenBGM）留位二期 |
| 渠道 | 走 new-api Gateway（需先取证/适配端点） |
| 入口 | 仅画布 Dock 直生（AudioDialog） |
| 参数 | 仅 `text_prompt`；输出 mp3、水印等由后端默认固定 |

## 上游契约（定版 2026-08-19：完全透传 seed-audio 原生协议）

**产品侧实际调用 new-api 端点（new-api DoubaoAudio 渠道 type-62，完全透传，不做字段映射）:**
- 端点:`POST {new-api}/v1/audio/speech`（OpenAI 兼容入口，路由到 DoubaoAudio 适配器）
- 鉴权:`Authorization: Bearer {用户 sk-token}`(经 `sealProviderCredential` 密封,不落明文)
- 请求体:**seed-audio 原生协议直接透传**——`{ "model": "seed-audio-1.0", "text_prompt": "<文本>", "audio_config": { "format": "mp3", ... }, "watermark": {} }`；网关只锁 `model` 防计费绕过，其余顶层字段原样透传（`input`/`response_format`/`voice` 已弃用）
- 响应:**上游 JSON 原样透传** `{ audio(base64) | url, duration, original_duration }`，客户端自取音频（`url` 下载或 base64 解码，均可）；计费 `requestId` 取自响应头 `X-Oneapi-Request-Id`
- 同步、无 task 轮询；watermark 由产品固定下发 `{}`

**new-api 背后的豆包 seed-audio-1.0 原生契约（透传后即客户端契约，官方文档）:**
- 端点：`POST https://openspeech.bytedance.com/api/v3/tts/create`；鉴权 `X-Api-Key` 单头
- `text_prompt` ≤3000 字符;`audio_config.format` 支持 wav/mp3/pcm/ogg_opus
- 响应含 `audio`(Base64)/`url`(2h)/`duration`/`original_duration`(计费,上限 120s)
- 决策沿革：2026-08-18 初版曾计划 OpenAI 桥接（`input`→`text_prompt`、回裸 mp3 字节）；当日同事改定为 **完全透传**（new-api ADR-0004 + commit `eb5bc8e`），产品后端 `new-api-audio-provider.ts` 已按透传实现并验收通过（2026-08-19）。取证见 `blue-whale-api/.gitee_audio_tts_forensics.md`。

## 架构与数据流

```
AudioDialog(画布)
  └─ createGenerationJob('audio', {prompt, model_id})
      └─ POST /projects/:pid/generation-jobs
          ├─ handleCreateGenerationJob: validate 放开 audio → 白名单校验 → 建 job(queued) + 预留 + 日志
          ├─ controller else 分支 → void processJob(进程内即时调度)
          │    └─ generation-worker.processClaimedJob: audio 分支
          │         ├─ 解密封 sk-token → createAudioProvider(token)
          │         ├─ AudioProvider.generate({model, prompt}) → 结果 data(mp3 原始字节)
          │         ├─ persistProviderMedia(data, "audio", …) → 直传转存 TOS
          │         └─ repo.createAsset({type:"audio", …}) → completeJob + settleReservation + log
          └─ 前端轮询 GET /api/jobs/:id → 资产库出现可播放音频节点
```

关键设计决策：

- **控制器零改动**：`generation-jobs.controller.ts:56-77` 的分派逻辑已是 `video → 队列，其余 → 进程内 processJob`，`validate()` 放开 audio 后自动落入进程内即时调度。
- **同步透传 JSON**：契约定版为透传后，new-api `/v1/audio/speech` 同步返回上游 JSON（`audio` base64 / `url`），无异步 task 轮询;`AudioProvider` 解析出 `data`（base64 解码）或 `url`，`persistProviderMedia` 优先走 url 下载转存、data 兜底直传。
- **恢复兜底**：音频与图片同生命周期（进程内任务），恢复扫描从 image-only 推广为 image+audio。

## 后端改动

### 能力模型（0 条 DB 迁移）

`generation_model_capability.capability_type`、`assets.type`、`generation_jobs.type` 均为无枚举 VARCHAR，`audio` 直接可存；`assets` 已有 `duration`/`duration_ms` 可记录音频时长。仅改 TS 常量 + seed：

- `backend/libs/shared/model-capability/constants.ts:1`：`MODEL_CAPABILITY_TYPES = ["image", "video", "text", "audio"]`
- `:4-8`：标签加 `audio: "音频"`
- `:151-160`：管理端校验错误文案 → "只支持 image / video / text / audio"
- 管理端 CRUD（`parseModelCreateBody`）自动兼容空数组 `JSON_ARRAY()`。

### 创建任务校验（`handle-create-generation-job.ts`）

`validate()` 按类型分叉：

| 校验项 | image/video（现状） | audio（新增） |
| --- | --- | --- |
| type 门（:63） | — | 放开，允许 audio |
| prompt | 必填 ≤4000 | 必填 **≤3000**（对齐 seed-audio 上限） |
| aspect_ratio | 必填（:75） | **不要求**（音频无宽高比） |
| expected_output_count | 1–4（video=1） | **=1**（单输出） |
| 参考素材 | 有规则 | **一期拒收**（仅文本描述） |

- 输入组装（:172-176）：audio → `input = { prompt, model_id }`，无 aspect_ratio/size/resolution
- `actionType`（:212）：audio → `"generate_audio"`
- TS 类型放宽：`body.type`/`job.type` 的 `"image"|"video"` 联合在 `handle-create-generation-job.ts`、`generation-command-repo`、`generation-worker.ts:107` 门处加 `"audio"`
- 成本预估：`costEstimator({type:'audio'})` 无 audio 分支时降级 0+dev（与图片缺省一致，可接受）

### seed（`packages/persistence/schema/002_seed.sql`）

```sql
(
  'new-api',                          -- 走 new-api Gateway，与视频行一致
  'seed-audio-1.0',
  'audio',
  '豆包 Seed Audio 1.0',
  JSON_ARRAY(),                       -- supported_sizes：音频无尺寸
  JSON_ARRAY(),                       -- supported_aspect_ratios：无
  JSON_ARRAY(1, 120),                 -- supported_durations：1–120s 区间提示
  JSON_ARRAY('mp3'),                  -- supported_formats：默认 mp3
  '',                                 -- default_size
  'mp3',                              -- default_format
  '',                                 -- default_aspect_ratio
  NULL,                               -- default_duration
  JSON_OBJECT('watermark', TRUE),     -- features：仅水印
  TRUE,
  30                                  -- sort_order，排在图片/视频之后
)
```

> 刻意不设 `features.audio=true`：那是「视频带音轨」标识（前端用于视频能力），不是音频生成能力标志，避免混淆。

## Provider 与 worker

### AudioProvider 端口（新增 `backend/libs/shared/generation/worker/audio-provider.ts`）

仿 `image-provider.ts` 端口风格：

```ts
export interface GenerateAudioInput { model: string; prompt: string; }   // text_prompt ≤3000
export interface GeneratedAudio {
  url: string;            // 可直接下载的结果地址（new-api 优先给 url）
  mime?: string;
  duration?: number;      // 秒，写入 assets.duration
  requestId?: string;     // 计费流水关联（同图片）
  data?: Uint8Array;      // base64 兜底：new-api 只回 audio 时解码后直传
}
export interface AudioProvider { generate(input: GenerateAudioInput): Promise<GeneratedAudio>; }
export class AudioProviderError extends Error { constructor(public code: string, message: string) {...} }
```

**同步/异步自适应封装在 provider 内部**：调 new-api 音频端点，若响应带 task_id（new-api 包成异步），内部 submit→poll 到出音频再返回，上层 worker 无感知。

### new-api 音频适配器（新增）

- `packages/generation-runtime/src/new-api-audio-provider.ts`：`createNewApiAudioProvider(baseUrl, token)` → `AudioProvider`（按透传契约：请求发 `text_prompt`/`audio_config`/`watermark`，响应解析 `audio`/`url`/`duration`）
- 已随 PR !386 合入 origin/master，2026-08-19 对测试站 3006 验收通过（200 + JSON + mp3 + 计费）
- base64 兜底：响应只回 `audio` 时解码为字节走 `data`；有 `url` 时优先 `url` 下载

### worker 音频分支（`generation-worker.ts`）

- `:107` 类型门加 `"audio"`
- 新增 audio 分支（仿 image 但更简）：解密封凭证 → `createAudioProvider(token)` → 能力行存在校验 → `provider.generate({model, prompt})` → `persistProviderMedia(url, "audio", …)` → `createAsset({type:"audio", duration})` → `finishJob`（结算/审计全复用）
- `WorkerDeps` 加 `createAudioProvider`，在 `generation-worker.service.ts` 装配
- **参考素材显式拦**：`referenceIds.length > 0` → fail(`unsupported_input`)，一期不支持参考音频，不静默忽略
- `persistProviderMedia` 的 `type` 扩为 `"image"|"video"|"audio"`，audio 默认 mime=`audio/mpeg`

### 恢复扫描

- 图片恢复（`image-recovery.ts` + 60s `ImageRecoveryService`）认领范围从 image-only 推广为 **image+audio**：claim 层新增 `claimNextInProcessJob`（type ∈ image, audio）并让恢复循环改用它（替代 image-only 的 `claimNextImageJob`）；`resetStalledImageJobs` 语义扩展到进程内任务（含 audio）
- 保证：音频**不进** BullMQ 视频队列，视频 worker 完全不碰音频

## 前端改动

### 类型与参数

- `web/src/api/generation.ts:7`：`ModelCapability = 'text' | 'video' | 'image' | 'audio'`（`fetchGenerationModels('audio')` 通用，缓存逻辑不用动）
- `web/src/api/jobs.ts:8`：`JobType = 'image' | 'video' | 'audio'`
- 新增 `AudioJobParameters { prompt: string; model_id: string }`；`CreateJobPayload.parameters` 联合加它
- `JobAsset.type` / `JobRecord.type` 自动覆盖 audio

### 画布接线（`CanvasPage/index.tsx`）

- `startGenerationJob`（:653）：type 联合加 `'audio'`；`fileName` 分支加「音频生成中」（:670）
- `handleAudioDialogSend`（:963）：从 `console.log` 改为 `startGenerationJob('audio', { prompt: text, model_id: model })`（仿 `handleImageDialogSend`）
- 画布 `mediaType: 'audio'` 节点、资产预览已支持，不用动

### AudioDialog 改造（`components/AudioDialog/index.tsx`）

- **去 mock**：`MODEL_OPTIONS`（:38-41）换成 `fetchGenerationModels('audio')` 拉真实模型（`seed-audio-1.0`），下拉选 `model_id`
- **v1 简化为纯文本**：下掉音频/图片参考按钮、本地上传、画布选择 UI（:150-265）——后端 v1 对参考素材显式拒绝，留着按钮会产生「加了没用」的困惑
- `onSend` 签名改为传 `model_id`（现 :131 传的是 label，为 mock 遗留，必须改为模型 id 才能对上后端白名单）
- 底部文案 `模拟生成`（:344）改为「生成」
- `onSwitchToMusic`（AI 音乐）保持原样，MusicDialog 本期不动（二期）

## 测试与验证

按仓库「影响面分层」策略，产品影响路径 → 定向测试 + 联调。

### 单元测试

- `handle-create-generation-job`：audio 放行；aspect_ratio 对 audio 非必填；prompt>3000 报错；expected_output_count≠1 报错
- `persistProviderMedia`：type='audio' 的 mime 校验（`audio/mpeg` 前缀）、默认 mime 兜底
- worker audio 分支：mock provider+repo → 断言 `createAsset({type:'audio', duration})` + `completeJob`/`settleReservation` 被调
- 恢复扫描：`claimNextInProcessJob` 能领 image 和 audio，不碰 video

### 联调/集成

- 本地起 backend + fake/mock 音频 provider → 端到端：建 job → succeeded → 资产库出 mp3
- new-api 音频端点取证通过后，接真实渠道联调一次（若测试站可用）

### 前端验证

- `tsc` 类型检查 + 画布手测：AudioDialog 选 seed-audio-1.0 → 输文本 → 生成 → 节点轮询 succeeded → 资产可播放

## 验收标准

1. 能力目录出现 `seed-audio-1.0`（`audio`），管理端可见可开关
2. 画布完整链路：`生成音频` → 出音频节点 → 轮询成功 → 资产库可播放 mp3
3. 边界校验正确：文本>3000 字符 / 传参考素材 → 明确报错，不静默
4. **无回归**：image/video 路径、白名单、恢复扫描行为不变

## 边界与风险

| 风险 | 影响 | 处置 |
| --- | --- | --- |
| **new-api 无 seed-audio-1.0 端点**（最大不确定项） | 阻塞网关路径 | 取证先行；缺则 blue-whale-api 加适配，或重评渠道 |
| new-api 返回 base64 而非 url | 转存路径不同 | provider 已预留 `data` 兜底 |
| 上游生成耗时 30–120s | 进程内长等待 | Node 异步 I/O 不阻塞；恢复扫描兜底 |
| 计费 request_id 缺失 | 实扣落 0+dev | 与图片缺省一致，可接受 |
| 水印/合规 | 政策要求 | 后端固定 AIGC 水印，不进 UI |
| ContentReview | 图片/视频也未实现 | 本期不额外引入，一致对待 |
| GenBGM（music） | 二期 | 本期仅留 capability 位 |

## 实施注意

- 后端（blue-whale-ai）：可写任务须先建 task worktree（`scripts/start-task-worktree.sh`）
- 前端（web）：位于 worktree `feature-ik9crx/web`（独立 npm 项目），按其自身分支管理
- new-api（blue-whale-api，Go）：取证项——确认/补充 seed-audio-1.0 渠道端点
- 跨仓库契约：如 new-api 需新增音频端点，先在契约文档定死后实现（同族工单串行、契约先行）
- 本设计为散文 spec 文档，落盘走 ADR-0025 例外
