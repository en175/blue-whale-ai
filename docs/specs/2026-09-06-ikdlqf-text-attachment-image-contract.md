# 单个文本附件驱动图片生成契约（IKDLQF）

## 时间

2026-09-06

## 目标与边界

落实 IKDL9U 的第二切片：文本节点到生图目标的直接连线持久化，并以单个文本附件驱动图片生成。复用现行 Canvas JSON 版本锁、生图任务链路（`generation_jobs.input` 快照 + RocketMQ + worker）与图片参数面板（ImageDialog）；不引入新的生成卡资源类型、不做视频目标（IKDLQG）、不做多附件排序界面（IKDLQH）、不做旧卡迁移（IKDLQK）。

## 连线持久化

- `canvas` 表新增 `edges_json`（JSON，可空）。一条边的持久形状为 `{ id, source, target }`（均为非空 string），与 React Flow 边兼容；流光样式、悬停剪刀等渲染细节不持久化。
- Canvas PUT body 新增 `edges`（JSON 数组字符串，与 `nodes` 同构）；GET 返回 `edges`，旧数据缺省视为空数组。
- 保存校验（不满足即明确失败、零写入）：`edges` 必须是数组；`id`/`source`/`target` 为非空 string 且 ≤128 字符；`source`、`target` 必须引用同次保存中存在的节点 id；同一 `(source, target)` 只允许一条边；边总数 ≤500。`edges_json` 序列化 ≤256 KiB UTF-8。PUT 省略 `edges` 字段时保留既有连线（旧客户端保存不得清边），仅携带时才校验并覆盖；前端手动拖线建边时拒绝自环与重复对（画布自环仅由重编辑面板「到节点选择」等入口产生，见文末修订）。
- 边与节点同一次条件写入（If-Match 版本锁）；连线增删参与前端自动保存签名；刷新或重开恢复连线。
- 连线默认可见（`showEdges` 初始为 true），不再默认隐藏。

## 生图目标与文本附件

- 本切片的生图目标是画布上 `mediaType` 为 `"image"` 的 mediaNode（含此前生成得到的图片节点）；目标生成类型恒为图片，连线不改变目标类型。
- 文本附件 = 持久边中 `target` 为该目标、`source` 为 `textNode` 且 `data.text` 为 string 的边；顺序即 `edges` 数组顺序（连入顺序）；同一来源对同一目标至多一条边（保存层唯一性保证）。
- 创建生图任务 body 新增可选 `target_node_id`（string），仅 `type === "image"` 时允许。携带时服务端在接纳当下读取最新 Canvas 推导有序附件；目标节点不存在或不是图片媒体节点 → 明确参数错误，不创建任务。不携带时旧链路（底部固定入口等）行为不变。
- 显式媒体输入仍走现有 `input_asset_ids`（面板上传/选择的参考图）路径，沿用归属、类型与模型能力校验。文本附件只携带纯文本正文；textNode 不含图片引用，不存在沿文本隐式携带图片的通道。
- 连接、编辑正文、应用预览均不触发任何生成；只有面板中点击「生成」才提交。

## 接纳快照

- 接纳时冻结进 `generation_jobs.input`：`prompt`（目标提示词，字符串，可为空）、`target_node_id`、`text_attachments: [{ node_id, title, text }]`（当次正文快照）、既有模型参数与 `input_asset_ids`。
- 附件与目标提示词分别表达，互不覆盖。~~`prompt` 允许为空字符串，当且仅当至少一条附件正文去除空白后非空~~；**2026-09-20 修订（IKH8AU）**：正文由提交方给全（附件正文已拼进 `prompt`），**空 `prompt` 一律 400「prompt 无效」**，「至少一条附件非空即可」这条兜底随组合档退役。
- 执行与已有任务重试只读 `input` 快照（重试复制原 `input` 的现行行为不变），不回读来源节点；修改正文后的下一次生成重新读取最新 Canvas。断开或删除来源后，新任务不再消费该来源；历史任务与结果不改写。
- 前端提交前先等待并落盘当前画布编辑（同 IKDLQE 应用前的保存串行化），再发起创建，保证服务端读到的正文包含未防抖落盘的编辑。

## 供应商请求组合（确定性）

- ~~`composeImagePrompt(attachments, prompt)`（packages/core 纯函数，worker 与测试共用）：取附件正文按序排列，忽略仅含空白的正文，以 `"\n\n"` 连接；`prompt` 去除首尾空白后非空时再在其后以 `"\n\n"` 追加。无附件时原样返回 `prompt`。不做任何改写、翻译或模型侧加工。~~
- ~~worker 组织 `providerInput.prompt` 时调用该函数；供应商替身测试中记录的实际请求 prompt 必须能与冻结快照按此函数精确对应。~~

  > **2026-09-20 修订（IKH9NU）**：本节机制已**退役删除**。ADR-0088 起正文由提交方给全、服务端不再组合，`composeImagePrompt` / `composeTextAttachmentPrompt` 已无生产调用者，源码与 `@lib/core` 导出一并移除。执行侧只读 `input.prompt`；供应商替身测试只断言「出站 prompt 与传入值逐字一致」，不再按组合函数对应冻结快照。

## 限长

- 目标提示词 ≤4000 UTF-16 code units（现行校验不变）；单条附件正文 ≤100,000（IKDLQE 存储限制）。
- 组合后的供应商 prompt ≤30,000 UTF-16 code units（新契约常量 `COMPOSED_IMAGE_PROMPT_MAX_LENGTH`，定义于 `packages/contracts/src/prompt-text-limits.ts`）。超出时接纳明确失败且不创建任务、不截断、不删除附件。30,000 是本切片的产品契约预算，不代表任何模型宣称的物理上限；模型能力表日后给出真实上限时再对齐。前端面板不重复实现该校验：超限以后端权威拒绝（明确错误提示）为准。

  > **2026-09-20 修订（IKH8AU）**：本条已作废。`COMPOSED_IMAGE_PROMPT_MAX_LENGTH` 常量退役——ADR-0088 起正文由提交方给全（附件正文已在 `prompt` 里），服务端不再组合，长度闸只按**正文全文**量一次；上限取**模型配置优先、未配置回落缺省**（图片/视频 4000、音频 3000）。见 [ADR-0085 修订二](../adr/0085-catalog-input-modality-model-alias-and-per-model-prompt-length.md)。
- 面板在打开时展示当前附件列表（来源标题与正文预览，长文折叠），附件的增删通过画布连线的建立与断开进行，本切片不在面板内做排序或多选取舍。

## 验证

测试边界沿用母规格与 IKDLQE 先例：真实浏览器 + 真实业务 API + 隔离 MySQL 测试存储；仅外部生成供应商使用记录请求的 HTTP 替身。

- 公开接口集成（真 MySQL + 生产 Canvas/Generation 控制器与服务）：连线保存/读取恢复；非法边（悬空端点、重复、超限）明确失败零写入；携带 `target_node_id` 的创建冻结附件快照且与当时 Canvas 一致；目标缺失/非图片/他人项目明确失败；正文为空明确失败；断开来源后新任务不再消费；重试沿用原快照。
- worker 与供应商线路：假 provider / fetch 记录式替身断言组合 prompt 与冻结快照精确对应；仅有附件无目标提示词可生成；附件加提示词同时送达。
- 前端 vitest：edges 序列化/水合/保存签名；面板附件展示；提交前保存串行化与 `target_node_id` 携带。
- 浏览器段（Playwright，`IKDLQF_BROWSER=1` 环境门控）：应用文本节点 → 连线到图片目标 → 面板见到附件 → 点击生成 → 刷新后连线与附件关系恢复。
- 复现命令：`IKDLQF_BROWSER=1 IKDLQF_DATABASE_URL=mysql://root@127.0.0.1:23306/ikdlqf pnpm exec vitest run backend/apps/blue-whale/src/api/canvases/text-attachment-image.integration.test.ts`。数据库必须是预先应用当前 Prisma schema 的隔离测试库；测试创建独立项目，不清理其他项目。

## 不做

- 视频目标、多附件排序界面、图片节点经连线作为媒体输入、旧生成卡迁移、整图自动执行、连线类型菜单与框选拖线（属 IKD0JZ 线，另行评审）。

## 修订

- 2026-09-11 自环合法化：删除保存校验中的 `source !== target`。成品素材卡原卡重新编辑（IKDMQU 原位生成）时把自身当前素材连为参考属合法输入，自环边与普通连线同等保存；端点存在性、重复对、数量与字节上限等其余校验不变。消费语义：媒体参考推导在前端（连线→Dock 展示、提交时换算 `input_asset_ids`），服务端快照推导（`resolveTargetSnapshot`）仅消费文本附件边、不消费媒体自环——非 web 客户端需自行把自环换算为显式媒体输入，画布保存本身不产生生成输入。前端手动拖线仍拒绝自环（handleConnect），自环由重编辑面板「到节点选择」点选原卡等入口产生。已知缺口：画布上自环边渲染退化、剪刀不可剪（Dock 参考芯片可见可移除），另行立项修复。
