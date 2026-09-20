# 文本附件驱动视频生成契约（IKDLQG）

## 时间

2026-09-06

## 目标与边界

落实 IKDL9U 的第三切片：把 IKDLQF 已验证的「持久连线 + 文本附件 + 接纳快照」语义从生图目标扩展到生视频目标。复用现行 `canvas.edges_json` 连线持久化、`generation_jobs.input` 快照、RocketMQ + video-job-runner 视频执行链与视频参数面板（BottomDialog）；不引入新的目标资源类型、不做多附件排序界面（IKDLQH）、不做旧卡迁移（IKDLQK）、不做图片节点经连线作为视频媒体输入。

连线持久化、附件推导口径、快照语义、限长与组合规则凡本契约未改写处，均以《单个文本附件驱动图片生成契约》（2026-09-06-ikdlqf）为准。

## 生视频目标与文本附件

- 本切片的生视频目标是画布上 `mediaType` 为 `"video"` 的 mediaNode（含此前生成得到的视频节点）；目标生成类型恒为视频，连线不改变目标类型。
- 文本附件推导口径与图片一致：持久边中 `target` 为该目标、`source` 为 `textNode` 且 `data.text` 为 string 的边；顺序即 `edges` 数组顺序；同一来源对同一目标至多一条边。
- 创建生视频任务 body 允许携带 `target_node_id`（string）——`type === "image" | "video"` 均可；`type === "audio"` 携带时明确失败（`target_node_id 仅支持图片/视频生成`）。携带时服务端在接纳当下读取最新 Canvas 推导有序附件；目标节点不存在或不是与 `type` 同类的媒体节点 → 明确参数错误（视频报「目标节点不存在或不是视频媒体节点」），不创建任务。不携带时旧链路（底部固定入口、首页交接等）行为不变。
- 显式媒体输入仍走现有路径：首尾帧 `first/last_frame_asset_id`（或素材库 `*_material_id`）、普通参考 `reference_asset_ids` / `reference_materials`，沿用归属、类型与模型能力校验；面板上传/画布选取/角色库带来的参考素材语义不变。文本附件只携带纯文本正文；textNode 不含图片引用，不存在沿文本隐式携带图片或视频的通道。
- 连接、编辑正文、应用预览均不触发任何生成；只有面板中点击「生成」（发送）才提交。

## 接纳快照

- 携带 `target_node_id` 的视频任务，接纳时在既有视频冻结字段（`prompt`、`aspect_ratio`、`model_id`、`resolution`、`duration`、首尾帧与参考素材引用）之上，追加冻结 `target_node_id` 与 `text_attachments: [{ node_id, title, text }]`（当次正文快照）。字段形状与图片快照完全一致。
- 附件与目标提示词分别表达，互不覆盖。`prompt` 允许为空字符串，当且仅当至少一条附件正文去除空白后非空；全部有效文本为空时沿用「提示词必填」校验明确失败。
- 执行与已有任务重试只读 `input` 快照（重试复制原 `input` 的现行行为不变），不回读来源节点；修改正文后的下一次生成重新读取最新 Canvas。断开或删除来源后，新任务不再消费该来源；历史任务与结果不改写。
- 前端提交前先等待并落盘当前画布编辑（同 IKDLQE/IKDLQF 的保存串行化），再发起创建，保证服务端读到的正文包含未防抖落盘的编辑。底部固定入口（无目标节点）不做提交前落盘、不携带 `target_node_id`。

## 供应商请求组合（确定性）

- ~~图片与视频共用同一条确定性组合规则，落在 packages/core 纯函数 `composeTextAttachmentPrompt(attachments, prompt)`：取附件正文按序排列，忽略仅含空白的正文，以 `"\n\n"` 连接；`prompt` 去除首尾空白后非空时再在其后以 `"\n\n"` 追加。无附件时原样返回 `prompt`。不做任何改写、翻译或模型侧加工。~~
- ~~既有 `composeImagePrompt` 语义不变，实现上委托 `composeTextAttachmentPrompt`（名称保留，IKDLQF 契约与调用点不动）。~~
- ~~video-job-runner 在 `buildSubmitRequest` 组织 `provider.submit` 的 prompt 时调用该函数：快照含 `text_attachments`（数组）时以冻结附件 + 冻结 `prompt` 组合；快照无该字段（存量任务、plan/scene_card 形态）时行为逐字节不变。供应商替身测试中记录的实际请求 prompt 必须能与冻结快照按此函数精确对应。~~

  > **2026-09-20 修订（IKH9NU）**：本节机制已**退役删除**。ADR-0088 起正文由提交方给全、服务端不再组合，`composeTextAttachmentPrompt` / `composeImagePrompt` 已无生产调用者，源码与 `@lib/core` 导出一并移除。执行侧只读 `input.prompt`；供应商替身测试只断言「出站 prompt 与传入值逐字一致」，不再按组合函数对应冻结快照。

## 限长

- 目标提示词 ≤4000 UTF-16 code units（现行校验不变）；单条附件正文 ≤100,000（IKDLQE 存储限制）。
- 组合后的供应商 prompt ≤30,000 UTF-16 code units（新契约常量 `COMPOSED_VIDEO_PROMPT_MAX_LENGTH`，定义于 `packages/contracts/src/prompt-text-limits.ts`，与 `COMPOSED_IMAGE_PROMPT_MAX_LENGTH` 同值并列——两个常量各自承载本产品契约预算，日后模型能力表给出真实上限时分别对齐）。超出时接纳明确失败且不创建任务、不截断、不删除附件。

  > **2026-09-20 修订（IKH8AU）**：本条已作废。`COMPOSED_VIDEO_PROMPT_MAX_LENGTH` / `COMPOSED_IMAGE_PROMPT_MAX_LENGTH` 均退役——ADR-0088 起正文由提交方给全，服务端不再组合，长度闸只按**正文全文**量一次；上限取**模型配置优先、未配置回落缺省**（图片/视频 4000）。见 [ADR-0085 修订二](../adr/0085-catalog-input-modality-model-alias-and-per-model-prompt-length.md)。前端面板不重复实现该校验：超限以后端权威拒绝（明确错误提示）为准。
- 面板在打开时展示当前附件列表（来源标题与正文预览，长文折叠），附件的增删通过画布连线的建立与断开进行，本切片不在面板内做排序或多选取舍。

## 前端目标面板

- 视频节点的「重新编辑」与「生成视频」均打开 BottomDialog 并携带目标语义：`targetNodeId` + 打开当下的连线文本附件快照（只读展示，UI 与 ImageDialog 附件区一致：标题 + 正文预览、超 120 字折叠可展开）。
- 存在有效附件正文时允许空提示词发送；全部有效文本为空时沿用「提示词必填」。底部固定入口与首页交接不带目标语义，行为不变。
- 图片节点的「生成视频」维持旧语义（图片作为参考素材生成全新视频任务），不携带 `target_node_id`。

## 验证

测试边界沿用母规格与 IKDLQF 先例：真实浏览器 + 真实业务 API + 隔离 MySQL 测试存储；仅外部生成供应商使用记录请求的替身。

- 公开接口集成（真 MySQL + 生产 Canvas/Generation 控制器与服务）：携带 `target_node_id` 的视频创建冻结附件快照且与当时 Canvas 一致；目标缺失/非视频媒体节点/音频类型携带/他人项目明确失败；仅附件正文可创建；组合超限明确失败；断开来源后新任务不再消费；重试沿用原快照；图片路径全量回归不改写。
- worker 与供应商线路：video-job-runner 假 provider 记录式替身断言组合 prompt 与冻结快照精确对应；仅有附件无目标提示词可提交；附件加提示词同时送达；无 `text_attachments` 的存量任务提交内容逐字节不变。
- 前端 vitest：视频目标面板附件展示与空提示词放宽；提交前保存串行化与 `target_node_id` 携带；底部固定入口不带 `target_node_id`。
- 浏览器段（Playwright，`IKDLQG_BROWSER=1` 环境门控）：连线到视频目标 → 面板见到附件 → 点击生成 → 库内冻结快照 → 编辑正文后新生成读取最新内容 → 刷新后连线与附件关系恢复。
- 复现命令：`IKDLQG_BROWSER=1 IKDLQG_DATABASE_URL=mysql://root@127.0.0.1:23306/ikdlqg pnpm exec vitest run backend/apps/blue-whale/src/api/canvases/text-attachment-video.integration.test.ts`。数据库必须是预先应用当前 Prisma schema 的隔离测试库；测试创建独立项目，不清理其他项目。

## 不做

- 图片节点经连线作为视频媒体输入、多附件排序界面、旧生成卡迁移、整图自动执行、音频目标、BottomDialog 既有参考素材交互重做、连线类型菜单与框选拖线（属 IKD0JZ 线，另行评审）。
