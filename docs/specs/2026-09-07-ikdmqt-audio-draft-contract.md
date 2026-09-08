# 音频草稿创建、保存与首次生成契约（IKDMQT）

## 时间

2026-09-07

## 目标与边界

落实 [IKDMQM](2026-09-07-canvas-generation-draft-spec.md) 的第 4/7 个纵向切片：侧栏音频入口先建音频生成草稿卡，草稿随画布保存恢复，点击「生成」才提交任务，首次结果填回原卡。复用 [IKDMQQ](2026-09-07-ikdmqq-image-draft-contract.md) 建立的草稿身份与任务身份约定。

不在本切片：音频参考输入（媒体引用连线、文本附件、上传入口均不引入——音频面板保持纯文字描述 + 模型）、成功后的新版本复制、失败重试与取消竞态细化（沿用既有行为）、AI 音乐。不扩展音频模型能力。

## 草稿身份（节点约定）

草稿是画布上的普通持久化节点，沿用 IKDMQQ 约定，仅 `mediaType` 为 `audio`。

- 节点形状：`type: "mediaNode"`，`data.mediaType: "audio"`，`data.genStatus: "draft"`，`data.draft: true`，无 `assetId`。
- 草稿参数随节点 `data` 持久化：`prompt`（文字描述）、`draftModelId`（模型 id）。音频无比例/分辨率/时长参数，不写 `draftRatio`/`draftSize`/`draftDuration`，也不写 `targetRatio`。
- 服务端 Canvas 保存对 mediaNode 无字段校验，草稿节点随 `nodes` JSON 原样存取；`genStatus: "draft"` 仅前端解释。
- 水合：带 `genStatus` 的节点跳过素材解析，草稿渲染为「待生成」而非素材缺失（沿用 IKDMQQ）。
- 草稿不进 `pendingNodeIds` 回滚集合：保存失败时草稿与当前编辑保留，随下一次保存重试落盘。
- 初始 `fileName` 为「音频草稿」；提交生成时改为「音频生成中」（配额/401 未建成任务回退待生成时恢复「音频草稿」）；成功后沿用现行 `生成-<jobId>`。

## 创建与编辑

- 侧栏音频入口每次点击新建一张独立草稿，位置沿用 `draftSpawn` 算法（视口中心附近空位、避开底部 Dock 预留区、与既有节点去重叠）；自动选中并打开 AudioDialog 绑定该草稿。
- 点击画布上已有音频草稿卡（`draft: true` 且 `genStatus: "draft"`）重新打开面板继续编辑；生成中与失败的草稿身份卡同样可点击打开面板查看。
- 面板编辑实时写回节点 `data`（文字描述 → `prompt`，模型 → `draftModelId`），经既有 800ms 防抖自动保存落盘；刷新或重开项目后点击草稿卡恢复参数。
- 音频面板不新增参考素材区、文本附件区与任何上传入口；面板的参考类型定义保留给 MusicDialog 共享，不构成功能入口。

## 任务身份与首次生成（原位）

- 仅面板点击「生成」提交任务；建卡、编辑均不创建任务。提交先 `flushCanvasSave` 串行化落盘，失败则 toast「保存失败，请重试」并中止提交（沿用 IKDMQQ，保存失败暂停生成与项目切换已在 IKDMQQ 落地，本切片复用）。
- 提交携带 `target_node_id = 草稿节点 id`。服务端 `target_node_id` 约定扩展：`type === "audio"` 允许携带；接纳时读取最新画布校验目标为 `mediaNode` 且 `mediaType === "audio"`，否则 400。
- 音频任务不推导文本附件：目标校验块对音频不遍历文本连线、不冻结 `text_attachments`；`prompt` 为空时 400（音频无附件兜底，空描述即无效输入）。
- 快照冻结：`generation_jobs.input` 落 `{ prompt, model_id, target_node_id, expected_output_count }`；执行与重试只读快照（沿用既有语义）。
- 原位模式：目标节点 `draft: true` 时前端不新建 media-gen 占位节点，草稿节点原地 patch 为 `genStatus: "generating"`（保留 id、位置与连线）；成功结果回填同一节点（`assetId`/`src`/时长），清除 `draft` 标记，节点转为普通成品卡；`draftModelId` 保留为生成参数记录。节点数量、身份、位置、连线全程不变。
- 创建失败回退：配额/401 回到 `genStatus: "draft"`（401 沿用登录恢复重试）；其他错误置 `genStatus: "failed"` + `errorText`，保留卡片、`draft` 标记与全部参数。任务执行失败同样保留。

## 执行期间只读

- `genStatus: "generating"` 的草稿身份卡：面板进入只读（描述输入、模型选择、发送均禁用），保留查看与节点上的既有「取消生成」入口。
- 输入连线只读：`isGeneratingNode` 拦截（`onConnect` 与入边 remove 变更）已按 `genStatus` 通用判定，音频草稿生成中天然被拦。
- 音频草稿对文本节点连线无附件语义：画布连线行为保持现状（可连线但不消费、面板不显示），任务输入不因连线改变。

## 验证

测试边界沿用 IKDMQQ/IKDMQS 先例：真实浏览器 + 真实业务 API + 隔离 MySQL（`IKDMQT_DATABASE_URL`，独立 `ikdmqt` 库）；不调用真实付费供应商，不触碰共享生产/测试站数据库。

- 前端 vitest：草稿创建/重复创建/参数写回/水合恢复不标缺失/原位提交（先落盘后建任务、节点数不变、携带 `target_node_id`）/成功回填同节点/生成中只读（面板 + 连线）/保存失败阻断生成/配额回退与失败保留卡片与原因。
- 公开接口集成（真 MySQL）：音频草稿节点（无 assetId）保存与 GET 恢复原样；对音频草稿 `target_node_id` 建任务冻结 `{ prompt, model_id, target_node_id }`；目标非音频媒体节点 400；空 prompt 400；不携带 `text_attachments`。
- 浏览器段（Playwright，`IKDMQT_BROWSER=1` 环境门控）：建卡未建任务 → 重复创建 → 编辑后刷新恢复 → 保存故障阻断生成、恢复后放行 → 提交后（DB 翻 succeeded）同卡回填不新增结果卡、生成中面板与连线只读。复现命令（库名按惯例隔离）：

```bash
IKDMQT_BROWSER=1 IKDMQT_DATABASE_URL=mysql://root@127.0.0.1:23306/ikdmqt \
  pnpm exec vitest run backend/apps/blue-whale/src/api/canvases/audio-draft.integration.test.ts
```

数据库必须是预先应用当前 Prisma schema 的隔离测试库；测试创建独立项目，不清理其他项目。

## 后续切片复用点

- 再次编辑复制切片：成功卡「再次编辑」复制新草稿时，音频按本切片的 `prompt`/`draftModelId` 参数集复制（无 ratio/size/duration）。
- 重试/取消细化切片：音频沿用统一的失败保留与任务入口约定。
