# 画布视频文生视频模式与媒体参考自动切换契约

## 时间

2026-09-13

## 背景与范围

工单 IKFC1T（父需求 IKF93U）：画布视频生成以独立「文生视频」模式为新建默认，媒体参考（图片/视频/音频）实际成为当前视频目标参考时自动切为全能参考；交付完整手动创作路径（模式选择、参考接入、草稿恢复、提交边界）。方案绑定引入媒体的服务端同步由后续任务完成，不在本契约范围。

前置事实：`prompt`（文生视频）标识已由「画布输入窗口跟随」合入（`followDialog.ts` 四模式体系），新建视频实际已默认文生视频。本契约固化其跨进程含义并补齐缺口。

## 1. 模式标识与值域

- 视频草稿模式唯一载体 = 草稿节点 `data.draftMode`（string，随画布快照持久化）。值域：`'prompt' | 'all' | 'keyframe' | 'text2video'`。
- `'prompt'` = 文生视频（仅提示词 + 文本附件）；**不得**重定义 `'text2video'`（其语义保持图生视频：仅图片普通参考）。
- 旧值（all/keyframe/text2video）语义不变；无 `draftMode` 的旧草稿恢复时按面板默认（prompt）起步，由门控（§2）按实际参考纠正。
- 模式**不上送生成 API**（`VideoJobParameters` 无 mode 字段）；请求中模式由 references 结构表达。首页 AI 视频交接（`gen-handoff.ts`）mode 值域仍为三模式，带入值按用户显式选择尊重，缺省走新建默认。

## 2. 门控与自动切换（前端唯一口径）

- **判定输入** = 「实际成为当前视频目标参考」的媒体集合：连线推导 + 角色库 `draftMaterialRefs` + 「到节点选择」暂存合并（= `videoDraftMediaRefs`，与面板显示、提交输入同源）。`invalid`（失效来源）不计入。文本附件（textNode 连线）不属于媒体参考，不参与判定。
- 附带修复（前置缺陷）：`readDraftMaterialRefs` 原断言写法 `(node.data ?? {}) as Record<string, unknown>['draftMaterialRefs']` 运行时取到 `node.data` 整体导致恒返回空数组（角色库草稿参考自 2026-09-09 起从未被读到）；本契约判定输入依赖该函数，修正为索引取字段并补防回归单测。
- 门控（`enabledVideoFollowModes`，签名自 sourceKinds 改为接收 `VideoMediaRefs`）：
  - 无任何有效媒体参考 → `['prompt', 'all']`（all 保持可选保证「不自动切回」）；
  - 存在任一媒体参考（普通参考或首尾帧）→ prompt 不可选，`['all']` 起；图片数 ≥1 追加 `text2video`，≥2 追加 `keyframe`（帧按图片计）。
- 自动切换（唯一方向）：当前 `prompt` 且门控不再含 prompt（媒体成为参考）→ 自动切 `all` + toast「已根据当前素材切换生成模式」；保留提示词、文本附件与全部媒体引用。移除全部媒体参考只恢复 prompt 可选，**不自动切回**。首尾帧/图生视频等其他模式间行为维持现状，不被统一改为全能参考。
- 覆盖全部已有参考接入路径：画布连线、资产库（落节点+连线）、角色库（draftMaterialRefs）、「到节点选择」暂存、@ 引用。不新增上传入口。

## 3. 面板与标签

- 模式选项含文生视频（跟随态 `VIDEO_FOLLOW_MODE_ORDER` 首项；自由态 `dockModeOptions` 同步补齐且置首，默认值 = 首项 = 文生视频）。
- 文生视频模式保留参考添加入口（添加后经 §2 自动切换）；防线下 `modeConflict` 增 prompt 分支「文生视频模式不支持媒体参考」，手动切换到 prompt 在存在媒体参考时被拒绝。
- 正文素材标签有效性（`videoPromptRefs.modeAccepts`）：`prompt` 模式不接受任何媒体参考身份 → 全部媒体标签失效（C2 口径），与 all/keyframe/text2video 既有判定并列。

## 4. 提交边界

- 仅提示词或提示词 + 文本附件均可提交（文生视频模式），文本附件不触发模式切换。
- 无媒体请求**省略 `references` 字段**，不发送 `references: []`（现有 `buildVideoJobReferences` 空数组省略行为固化为契约）。
- 自动切换后的实际提交保留完整引用；现有模型能力与参考合法性校验（`videoRefConflict`、服务端 400 同口径约束）继续生效。

## 5. 草稿持久化与兼容

- 草稿模式持久化链不变：面板实时写 `data.draftMode`；恢复经 `openVideoDraftDialog` 读回；生成卡记录 `draftMode` 供重新编辑带回。
- 恢复保持已保存模式含义；引用使用显式素材与节点身份（数字 assetId / `asset-` 前缀 materialId / 文本节点 id），切换目标不串用模式或参考。
- 后端 `validateVideoPlan` 对 `'prompt'` **无特判**（宽容通过，不新增拒绝分支）：模式兼容由前端自动切换保证；方案绑定路径的 draftMode 读取照旧，其媒体引入同步为后续任务。

## 6. 验证与关联

- 纯函数：`web/src/pages/CanvasPage/followDialog.test.ts`（门控新口径）、`videoPromptRefs.test.ts`（prompt 标签失效）。
- 画布流程层：`web/src/pages/CanvasPage/videoDraft.test.tsx`（新建默认、仅提示词提交省略 references、文本附件不切换、连线/角色库/暂存触发自动切换、置灰与不切回、草稿恢复）；组件层 `videoRefArea.test.tsx` 维持来源菜单/角色槽覆盖。
- 测试边界：供应商为替身，不声明真实视频生成或人工验收通过。
- 关联：IKF93U（父需求）、IKDMQS/IKDMQU（草稿绑定与跟随输入框）、IKFA1O/IKFA1P（正文素材标签前置契约）。
