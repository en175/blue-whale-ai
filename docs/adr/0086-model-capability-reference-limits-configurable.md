# 模型能力目录承载参考素材分类上限与任务类型约束（替代前端/服务端硬编码）

**状态**：accepted（2026-09-14，IKFJJT）

后台模型能力配置（`generation_model_capability.features` JSON 列）补齐多类型素材限制并核正参数：参考素材的分类上限（图/视频/音频）、输入素材总时长上限、按任务类型的比例与时长约束、以及视频生成是否接受视频/音频素材作参考，全部落**能力目录**，生成面板与服务端校验同读目录，删除前端 `REF_LIMITS` / `MAX_VIDEO_REFS` 与服务端 `validateAudioReferences` / `validateVideo` 里的硬编码常量与 `seedance-2` 前缀特判。

**动因**：工单核对官方接口差异发现——Seedance 2.0/2.5 视频、音频素材各自总时长上限（15s/30s）、2.0 禁单独输入音频、视频素材作普通参考目前靠 `supportsVideoReferenceModel` 硬编码 `seedance-2` 前缀，图片参考图上限前端 `ImageDialog` 写死 9 张与服务端能力行（缺省 10）不一致。这些规则按模型能力行表达后，新增模型不需要改代码。

## Considered Options

- **维持前端/服务端硬编码常量**：新增模型要同步改多处代码，2.5 vs 2.0 差异无法用数据表达，否决。
- **新增能力类型或表结构**：能力类型是生成种类（image/video/audio/text 四种，创建后不可改），参考限制是同一档运行约束，塞进类型枚举污染语义；新增表带来 join 与后台表单大改，否决。`features` JSON 列已有 `i2i_model_name` / `max_prompt_length` 先例（ADR-0085），扩展同机制。
- **只前端配置化、服务端保留硬编码**：验收要求「生成面板与服务端校验一致」，不同源必漂移，否决。

## Decisions

1. `features` 新增键（全 snake_case，写侧走写入闸门，读侧对脏值宽容降级）：
   - `video_reference: boolean` — 视频生成是否接受**视频素材**作普通参考（替代 `seedance-2` 前缀特判；2.5 开，其余关）
   - `video_reference_max: number` — 普通参考中视频素材上限（缺省 3）
   - `audio_reference: boolean` — 视频生成是否接受**音频素材**作参考（2.0 关，2.5 开）
   - `audio_reference_max: number` — 音频生成中音频参考上限（缺省 3）
   - `image_reference_max: number` — 音频生成中图片参考上限（缺省 1）
   - `max_reference_duration_sec: number|null` — 输入参考素材总时长上限（视频/音频；2.0=15，2.5=30；null=不限）
   - `task_types: object` — 按任务类型的比例/时长约束（default/first_frame/first_last_frame/edit/prolong 各自 allowed 比例与时长；本轮结构就位，前端现有模式映射 first_frame/first_last_frame，edit/prolong 无 UI 入口）
   - 既有 `max_reference_images`（图参考上限）与 `quantity_max`（单次输出数）保留复用
2. **服务端校验全读 features**：`validateAudioReferences`（音频≤`audio_reference_max`、图≤`image_reference_max`、不可混用由能力位表达）、`validateVideo`（普通参考视频素材≤`video_reference_max`）、参考素材总时长≤`max_reference_duration_sec`、图参考≤`max_reference_images`。
3. **前端同源**：删 `REF_LIMITS` / `MAX_VIDEO_REFS` / `supportsVideoReferenceModel`，面板读 `GenerationModel.features` 驱动数量/时长/视频参考门控。
4. **任务类型比例/时长**：前端按现有 mode 映射（prompt→default、keyframe/text2video→first_frame/first_last_frame）读 `features.task_types` 约束渲染（自适应比例/自动时长钳制）。
5. **数据**：种子 `002_seed.sql` 补全新字段 + 新增 Seedance 2.5 样例行；生产库数据由运营在后台按字段说明更新，不写生产 SQL。

## Consequences

- 新增模型只要在后台配能力行即生效，前端/服务端无需改码。
- 前端硬编码上限删除后，旧常量消费者（`ChatBox`/`CanvasPage` 各面板）统一走能力行，行为对齐「能力行上限与服务端校验一致」。
- 后台表单新增数字/布尔特性键，`ModelFormModal` 的 `FEATURE_NUMBER_LABELS` / 布尔特性标签扩展；`ModelFeatures`（web + backend）类型扩展。
- 生产库既有模型行的新字段缺省值兜底（读侧 `?? 缺省`），未配置前行为不变（视频参考上限 3、音频参考≤3/图≤1、无总时长限制）——与现状一致，不破坏在产功能。
