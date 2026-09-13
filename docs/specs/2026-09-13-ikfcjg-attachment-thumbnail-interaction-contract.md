# 附件索引素材缩略图三态交互契约

## 时间

2026-09-13

## 背景与范围

父需求 IKFCJG（附件索引素材缩略图三态交互升级）：图片/视频/音频三类生成面板参考栏的附件缩略图统一为**三态交互**的共享组件，文本卡附件后续以图标缩略图进入同一参考栏。本契约随首个切片 T1（工单 IKFCKK：共享组件 + 图片面板落地）落盘，固化展示与交互层语义；后续切片按「验证与关联」推进。

本契约是纯前端交互升级：promptDoc 序列化、生成请求契约、后端与 worker 均不动；无 schema / API 变更。

## 1. 共享组件与三态定义

- 共享组件 = `RefThumbnail`（参考缩略图单项）+ `RefPreviewOverlay`（悬浮放大预览浮层），位于 `web/src/pages/CanvasPage/components/RefThumbnail/`。三类面板（ImageDialog / BottomDialog / MusicDialog）附件条替换为共享组件收敛下线自绘实现；AudioDialog 基于共享组件新建参考缩略图条。
- **状态 1（默认）**：缩略图 + 左上角编号圆钮（仅显示数字）；底部「图片N」文字标签整体移除，类型靠缩略图形态区分。
- **状态 2（悬停）**：编号淡出，右上角浮出 × 删除按钮、右下角浮出 @ 按钮（约 150ms opacity 过渡）。
- **状态 3（悬停满 200ms）**：缩略图上方居中浮出放大预览；鼠标移出立即消失（close 0ms）。
- 素材形态四类：图片（`img`）、视频（`video` 首帧 `preload="metadata"`）、音频（AudioLines 图标）、文本（FileText 图标）。本地未保存上传项（blob URL）与已落库素材同样支持三态。

## 2. 编号体系（派生值）

- 编号按类型独立（图片N/视频N/音频N/文本N），为**派生值**：身份在保序引用列表中的下标 + 1；不改动 promptDoc 契约与后端。
- 角标只显示数字（两位数时圆钮自动加宽为胶囊形）；删除或换位后紧凑重编号，经既有 reconcile 链路自动同步正文 chip 文案。
- 面板不参与编号身份的素材（如图片面板的视频上传项）不显示圆钮。

## 3. × 删除语义

- 点击 × 立即删除、无确认弹窗；仅断开当前草稿的引用（连线模式断开画布连线 / 暂存项直接移除 / 本地上传项从面板列表移除），不删画布来源卡片、不调后端删除接口。
- 正文中对应提及沿用既有置失效生命周期（灰显「已失效：原图片N」、可换绑或单删、阻止发送，IKFA1N 契约）。
- 只读态（生成中/提交中）不渲染 × 与 @。
- **音频面板（T3 / IKFCKS）**：参考音频的 × 从面板参考列表移除（本地上传项回收 blob URL）；文本附件的 × 仅断开画布连线（走既有 `removePlanAttachment` 断边链路，保留画布原文本卡），与图片面板同款。播放 chip（点击播放/暂停 + 常显移除）随替换下线——预览确认为只读形态（图标+名称+时长卡片），播放能力不在参考栏交互内。

## 4. @ 插入语义

- @ 按钮与手动输入 @ 选择素材**走同一插入机制**（`PromptRefEditor`），产出同一种素材标签 chip（AssetRefNode）：
  - 手动 @ 菜单选择 → `insertRefAtMention`（原位替换 @ 查询）；
  - @ 按钮 → `insertRefAtPending`：有记忆光标原位插入，无记录追加到文本末尾。
- 插入后编辑器聚焦、光标落在插入内容之后（`insertRefAtPending` 在 update 提交后调用 `editor.focus()`；@ 按钮 `onMouseDown` 阻止编辑器失焦）。
- 面板按身份空间分派寻址键（`refKeyOf`）：来源节点 id 在文本附件集合 → `text_ref`，否则 `asset_ref`（IKFA1P 语义）。
- 无素材身份的项（如未上传完成的本地项）不提供 @ 入口。
- **音频面板等价语义（T3 / IKFCKS）**：AudioDialog 与 MusicDialog 的正文为纯 textarea（无 `PromptRefEditor` chip 机制），其「手动 @ 选择」的既有结果 = 素材进入参考区（`onMentionCanvas` 入口，经 externalPick 注入）。缩略图 @ 按钮与手动 @ 选择走**同一 `onMentionCanvas` 回调**（`audioRefToMentionItem` 转换为同一种素材项形态），结果等价、幂等；仅画布来源参考提供 @（本地 blob 上传项无画布身份，同「无素材身份不提供 @」口径）。MusicDialog 随 T3 补齐曲风描述 @ 菜单（仅音频可选，交互与 AudioDialog 同款）。

## 5. 悬浮放大预览规格

- 基于 `@floating-ui/react` + `FloatingPortal`：placement `top` 居中 + `flip`/`shift` 视口内收敛 + `autoUpdate` 跟随；不使用 safePolygon。
- 延迟 open 200ms / close 0ms；浮层 `pointer-events: none`（纯展示、鼠标穿透，不遮挡 × 与 @）；**仅打开时挂载**媒体节点（关闭即卸载，视频随之停播）。
- 预览内容（沿用 AssetChip 预览常量：内容最大 280×280px、`object-fit: contain` 不裁剪、8px 内边距 + 圆角 + 阴影 + 深色背景）：
  - 图片：静态放大；
  - 视频：`autoPlay muted loop`（静音是自动播放的浏览器硬前提，VideoMentionChip 先例）；
  - 音频：图标 + 名称 + 时长卡片（宽约 300px，对齐 audioPreview 规格）；时长由面板层探测（`useAudioDurations`：一次性 `Audio` 元素 `preload='metadata'` 读 duration，读到即入表；探测失败缺省不显示时长），共享组件不引入媒体探测职责；
  - 文本：正文内容卡片（超限滚动）。

## 6. 视觉参数

- 缩略图 56×56px、圆角 12px，三面板统一；媒体 `object-fit: cover`。
- 编号圆钮：直径 16px、背景 `rgba(0,0,0,0.6)`、数字白色 10px、四角内嵌 3px；两位数自动胶囊加宽。
- × 按钮保持 hover 变红 `rgba(229,72,77,0.85)`；@ 使用 AtSign 图标；悬停过渡约 150ms。
- 「+」添加占位按钮尺寸与共享缩略图对齐（56×56）。

## 7. 范围边界（Out of Scope）

- 尾部「+」添加按钮与来源菜单的改造、「最多 N 张」上限规则、触屏/移动端适配、Agent 面板素材提及 chip（ImageMentionChip/VideoMentionChip）改造均不在本轮。
- promptDoc 契约、生成请求契约、后端与 worker 的任何改动。
- 独立「文本附件（N）」区块：进栏后直接移除（T4），无渐进迁移。

## 8. 验证与关联

- 组件级（唯一新接缝）：`web/src/pages/CanvasPage/components/RefThumbnail/index.test.tsx`——三态切换（含 200ms 延时与移出即逝）、四类素材预览形态、pointer-events 穿透、× 删除回调、紧凑重编号、@ 两路插入（有/无记忆光标，含聚焦与光标位置的行为断言）。
- 面板集成：`ImageDialog/prompt-ref.test.tsx` 扩展（× 走断开连线回调、@ 与手动 @ 选择等价、只读态按钮不渲染）；既有 `imageMediaRefs.test.tsx`、`cardRename.test.tsx`、`attachments.test.tsx`、`text-prompt-ref.test.tsx` 全绿验证外部契约（`dock-media-ref` testid、`img alt`、`button[title="移除"]`）保持。
- 音频面板集成（T3 / IKFCKS）：`MusicDialog/index.test.tsx`、`AudioDialog/index.test.tsx`（缩略图替换/新建、× 断边回调、@ 同一入口等价、只读态、发送参数回归）+ `connectAbility.test.ts`（文本卡 → 音频生成连线放行与既有组合回归）；`cardRename.test.tsx` 音频参考改名锚点随 chip 下线切换为缩略图 title。
- 视觉像素值与过渡时长不进单测，留浏览器验收。
- 切片：T1 IKFCKK（共享组件 + 图片面板，已合入）；T2 IKFCKQ（视频面板 BottomDialog，已合入）；T4 IKFCKN（文本附件进栏，已合入）；T3 IKFCKS（音频面板 MusicDialog 替换 + AudioDialog 新建，已合入——含画布文本卡连线进音频面板的连线能力放行：`isAudioGenEnabled` 对含文本组合可选，文本卡作为创作上下文，不进生成请求）；T5 IKFCKT（拖拽排序，本切片定稿见 §9）。父工单：IKFCJG。


## 9. 拖拽排序（T5 / IKFCKT 定稿）

- **实现形态**：轻量 HTML5 DnD（共享层 `RefThumbnail/strip-dnd.ts` 的 `arrayMove` + `useRefStripDrag`，零新依赖）；`RefThumbnail` 经 `dragProps` 透传拖拽属性到根节点，`img`/`video` 设 `draggable={false}` 防原生图片拖拽劫持手势。按钮点击（mousedown 未移动不触发 dragstart）与拖拽手势天然区分。
- **统一序列语义**：各面板参考栏构造统一序列 = 媒体项段 + 文本项段拼接（两段保持类型聚合渲染）；拖拽落点在统一序列上计算换位，再按类型提取新相对顺序分别落到顺序权威源。跨类型拖拽只改变类型内相对顺序（编号按类型独立），类型子序未变不触发回调。
- **顺序权威源分派**：连线媒体（图片/视频/音频面板）= 重排目标连入边序（`reorderTargetEdges`，其余边相对位置不变）；视频角色库 material 参考 = 重排草稿 `draftMaterialRefs` 数组序；视频自由模式暂存参考 = 数组整体重排；图片本地文件与音乐/音频面板本地参考 = 面板本地 state；文本附件 = 重排文本连入边序（顺序即生成上下文拼接顺序，与服务端 `text_attachments` 推导同源，契约语义不变）。
- **编号与正文同步**：编号为派生值（§2），重排权威源后角标与正文 chip 文案经既有 reconcile 链路自动更新；无额外同步逻辑。
- **首尾帧角色槽**（视频面板 keyframe 模式）：首帧/尾帧为固定角色槽（徽标不参与数字编号），不参与拖拽换位；该模式下拖拽域为文本附件序列。
- **只读态**：生成中/提交中（readOnly）整条参考栏禁拖（`draggable=false`）。
- **随 T5 定稿处置下线**：BottomDialog 死 prop `onSetVideoRefRole` / `onSetMaterialRefRole`（IKFCKQ 起无 UI 消费）及其 CanvasPage 侧孤儿实现（`handleSetVideoRefRole` / `changeVideoFreeRefRole`）一并移除——角色由「模式 + 目标槽」决定，无跨槽切换入口。
