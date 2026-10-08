# 画布视频文生视频模式与媒体参考自动切换契约

## 时间

2026-09-13（2026-10-08 按 ADR-0124 修订：模式键域统一为 7 键、门控与自动切换改口径）

## 背景与范围

工单 IKFC1T（父需求 IKF93U）：画布视频生成以独立「文生视频」模式为新建默认，媒体参考（图片/视频/音频）实际成为当前视频目标参考时自动切为全能参考；交付完整手动创作路径（模式选择、参考接入、草稿恢复、提交边界）。IKFC26 同时交付方案绑定引入媒体的服务端模式同步。

前置事实：`prompt`（文生视频）标识已由「画布输入窗口跟随」合入（`followDialog.ts` 四模式体系），新建视频实际已默认文生视频。本契约固化其跨进程含义并补齐缺口。

## 1. 模式标识与值域

- 视频草稿模式唯一载体 = 草稿节点 `data.draftMode`（string，随画布快照持久化）。值域 = 能力行 `features.task_types` 的 7 个键：`'text2video' | 'omni' | 'image_reference' | 'first_frame' | 'first_last_frame' | 'edit' | 'extend'`（[ADR-0124](../../adr/0124-video-mode-as-capability-config.md) Decision 1）。
- **本条取代原「不得重定义 text2video」**：`'text2video'` 现在字面即文生视频；原先那个「实为图片参考」的键归位为 `'image_reference'`。
- 读侧兼容（ADR-0124 Decision 7，不做数据迁移）：旧值 `prompt→text2video`、`all→omni`、`keyframe→first_last_frame`、后端旧别名 `default→text2video` / `prolong→extend`；**歧义键 `text2video`** 按该草稿的素材集消歧——普通参考「有图、无视频/音频」判 `image_reference`，否则判 `text2video`（旧义与新义共用同一个键，只能靠素材集判定）。无 `draftMode` 的旧草稿按默认表起步。
- 模式**上送生成 API**：`parameters.mode`（`VideoJobParameters.mode`）显式传递，接纳侧按能力行校验并冻结进任务快照（ADR-0124 Decision 4）。首页 AI 视频交接（`gen-handoff.ts`）的 `mode` 直接带这 7 个键，不再做首页→画布的键翻译。

## 2. 门控与自动切换（前端唯一口径）

- **判定输入** = 「实际成为当前视频目标参考」的媒体集合：连线推导 + 角色库 `draftMaterialRefs` + 「到节点选择」暂存合并（= `videoDraftMediaRefs`，与面板显示、提交输入同源）。`invalid`（失效来源）不计入。文本附件（textNode 连线）不属于媒体参考，不参与判定。
- 附带修复（前置缺陷）：`readDraftMaterialRefs` 原断言写法 `(node.data ?? {}) as Record<string, unknown>['draftMaterialRefs']` 运行时取到 `node.data` 整体导致恒返回空数组（角色库草稿参考自 2026-09-09 起从未被读到）；本契约判定输入依赖该函数，修正为索引取字段并补防回归单测。
- **门控 = 配置 ∩ 素材**（ADR-0124 Decision 8）：配置答「这个模型有哪些模式」（`features.task_types` 的键，键在即开放），素材答「现在能不能点」。实现为纯函数 `enabledVideoModes(refs, configured)`（`web/src/pages/CanvasPage/videoModes.ts`）：
  - `text2video` —— 无任何媒体参考；
  - `omni` —— 恒可选（兜底落点）；
  - `image_reference` —— 图 ≥1 且无视频/音频；
  - `first_frame` / `first_last_frame` —— 无视频/音频（帧槽由帧模式自己产出，故不按图片数卡入口；张数越界在切换那一刻拦）；
  - `edit` / `extend` —— 普通参考里有视频 ≥1。
  白名单为空 ⇒ 不渲染任何模式（不兜底）。
- **默认模式表**（`defaultVideoModeFor`，只看普通参考集，帧槽不参与）：空 → `text2video`；只有图片 → `image_reference`；只有视频 → `edit`；视频+图片 → `omni`。首尾帧不进默认表（只可选、不自动切）。算出的模式不在白名单时兜底：→ `omni`，否则取 `VIDEO_MODE_ORDER` 内第一个非帧模式。
- **自动切换（覆盖式，取代原「唯一方向」口径）**：`nextVideoModeOnRefsChange(current, refs, configured)` —— 当前模式不在白名单 ⇒ 按默认表兜底切换；是帧模式 ⇒ 不动；仍在可选集 ⇒ 不切；否则 ⇒ 按默认表兜底切换，并 toast「已根据当前素材切换生成模式」。保留提示词、文本附件与全部媒体引用。
- **帧槽不触发重算**：`refs.first` / `refs.last` 是帧模式内部操作，素材签名（`videoModeRefsSignature`，身份+媒体类型、与角色无关）在普通参考 ⇄ 帧槽互转前后不变，故切进/切出首尾帧都不会把用户弹回。
- 覆盖全部已有参考接入路径：画布连线、资产库（落节点+连线）、角色库（draftMaterialRefs）、「到节点选择」暂存、@ 引用。不新增上传入口。

## 3. 面板与标签

- 模式选项两个入口（跟随态与自由态）都取同一份 `configuredVideoModes(features)`，标签取 `VIDEO_MODE_LABEL`；首页 AI 视频的模式列表同样按白名单渲染且必须 ⊆ 白名单。默认值 = 默认表（空素材集 → 文生视频）。
- 文生视频模式保留参考添加入口（添加后经 §2 自动切换）；防线下 `modeConflict` 按模式逐条：`text2video` 有媒体参考 / `image_reference` 有非图参考 / 帧模式有普通参考 / 非帧模式有帧槽 / `edit`·`extend` 无参考视频，各自给出用户可读拒绝文案。
- 参数锁读配置（`lockedRatioOf` / `lockedDurationOf`）：模式约束声明了唯一比例（2.5 的帧模式、编辑、延长）时比例锁 `adaptive` 且不渲染控件；声明了唯一时长（`edit` 的 `-1`）时时长锁「跟随原视频」。出站值由 `effectiveVideoParams` 派生（面板、报价、重发路径同一份）。
- 正文素材标签有效性（`videoPromptRefs.modeAccepts` → `videoModeAcceptsRef`）：`text2video` 不接受任何媒体参考身份 → 全部媒体标签失效（C2 口径）；`image_reference` 只收普通参考里的图片；帧模式只收帧角色（`first_frame` 不收尾帧）；`edit`/`extend`/`omni` 收普通参考。

## 4. 提交边界

- 仅提示词或提示词 + 文本附件均可提交（文生视频模式），文本附件不触发模式切换。
- 无媒体请求**省略 `references` 字段**，不发送 `references: []`（现有 `buildVideoJobReferences` 空数组省略行为固化为契约）。
- 自动切换后的实际提交保留完整引用；现有模型能力与参考合法性校验（`videoRefConflict`、服务端 400 同口径约束）继续生效。

## 5. 草稿持久化与兼容

- 草稿模式持久化链不变：面板实时写 `data.draftMode`；恢复经 `openVideoDraftDialog` 读回；生成卡记录 `draftMode` 供重新编辑带回。
- 恢复保持已保存模式含义；引用使用显式素材与节点身份（数字 assetId / `asset-` 前缀 materialId / 文本节点 id），切换目标不串用模式或参考。
- 后端 `validateVideoPlan` 的模式判定按 `normalizeVideoMode` 归一后读新键：帧模式与普通参考互斥、`image_reference` 只收图片、`edit`/`extend` 至少要有 1 段参考视频。

## 6. 验证与关联

- 纯函数：`web/src/pages/CanvasPage/videoModes.test.ts`（门控 / 默认表 / 兜底 / 自动切换 / 参数锁 / 读侧兼容）、`videoMediaRefs.test.ts`（角色库参考读取）、`videoPromptRefs.test.ts`（标签失效）。
- 画布流程层：`web/src/pages/CanvasPage/videoDraft.test.tsx`（新建默认、仅提示词提交省略 references、文本附件不切换、连线/角色库/暂存触发自动切换、置灰与不切回、草稿恢复）；组件层 `videoRefArea.test.tsx` 维持来源菜单/角色槽覆盖。
- 测试边界：供应商为替身，不声明真实视频生成或人工验收通过。
- 关联：IKF93U（父需求）、IKDMQS/IKDMQU（草稿绑定与跟随输入框）、IKFC26（方案绑定模式同步）。

## 7. 独立发布基线

本次发布以远程 release/2026.09.15 的 19f836a8 为基线，仅移植 IKFC1T 与 IKFC26 的模式及引用协调实现，保留该基线现有提示词编辑器。未发布的 IKFA1J 正文素材索引改造及其专属标签测试不包含在本次范围。
