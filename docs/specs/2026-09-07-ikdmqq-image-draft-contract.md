# 图片生成草稿创建、保存与首次生成契约（IKDMQQ）

## 时间

2026-09-07

## 目标与边界

落实 [IKDMQM](2026-09-07-canvas-generation-draft-spec.md) 的第 1/7 个纵向切片：侧栏图片入口先建图片生成草稿卡，草稿随画布保存恢复，点击「生成」才提交任务，首次结果填回原卡。本切片建立后续视频/音频/媒体引用切片复用的**草稿身份与任务身份约定**。

不在本切片：图片媒体引用（连线媒体输入）、成功后的新版本复制、失败重试与取消竞态细化、Dock 上传入口移除（Q7/Q10 在媒体引用切片落地）。文本附件连线沿用 [IKDLQF 契约](2026-09-06-ikdlqf-text-attachment-image-contract.md)，不修改。

## 草稿身份（节点约定）

草稿是画布上的普通持久化节点，不是 GenerationJob，也不是已接纳 Asset。

- 节点形状：`type: "mediaNode"`，`data.mediaType: "image"`，`data.genStatus: "draft"`（`genStatus` 联合新增取值），`data.draft: true`（草稿身份标记），无 `assetId`。
- 草稿参数随节点 `data` 持久化：`prompt`（提示词）、`draftModelId`（模型 id）、`draftSize`（分辨率档位 id）、`draftRatio`（宽高比）。`targetRatio` 与 `draftRatio` 同步写入，仅决定卡片占位形状（沿用现行语义）。
- 服务端零改动：Canvas 保存对 mediaNode 无字段校验，草稿节点随 `nodes` JSON 原样存取；`genStatus: "draft"` 仅前端解释。
- 水合：`resolveNodeAssets` 对带 `genStatus` 的节点本已跳过素材解析（瞬时态语义），草稿因此**不会**被标记 `assetMissing`，渲染为「待生成」而非「素材已被删除」。`assetMissing`/`selected` 等派生态仍不持久化。
- 草稿不进 `pendingNodeIds` 回滚集合：保存失败时草稿与当前编辑保留在画布上（IKDMQM Q19「保留当前编辑」优先于「添加失败回滚」），随下一次保存重试落盘。
- 初始 `fileName` 为「图片草稿」；提交生成时改为「图片生成中」（配额/401 未建成任务回退待生成时恢复「图片草稿」）；成功后沿用现行 `生成-<jobId>`。

## 创建与编辑

- 侧栏图片入口每次点击新建一张独立草稿（不再开关空对话框），位置在当前可见画布中心附近空位：候选点纵向避开底部 Dock 预留区（屏幕底上抬约 300px 换算 flow 坐标），并与既有节点占位盒去重叠；自动选中并打开图片面板绑定该草稿。
- 点击画布上已有草稿卡（`draft: true` 且 `genStatus: "draft"`）重新打开面板继续编辑；生成中（`genStatus: "generating"`）与失败（`genStatus: "failed"`）的草稿身份卡同样可点击打开面板查看/修改。
- 面板编辑实时写回节点 `data`（提示词、模型、分辨率、宽高比），经既有 800ms 防抖自动保存落盘；刷新或重开项目后点击草稿卡恢复全部参数与连线关系。
- 草稿面板的参考图文件（旧 Dock 本地上传路径）仍是会话级行为、不持久化；媒体引用连线与本文件无关，由后续切片交付。

## 任务身份与首次生成（原位）

- 仅面板点击「生成」提交任务；建卡、连线、编辑均不创建任务。提交沿用 IKDLQF：先 `flushCanvasSave` 串行化落盘，失败则 toast「保存失败，请重试」并中止提交。
- 提交携带 `target_node_id = 草稿节点 id`；服务端接纳校验目标为 `mediaNode` 且 `mediaType` 匹配（不要求 `assetId`，现行行为天然兼容空草稿），按最新画布推导文本附件并冻结进 `generation_jobs.input`（`prompt`/`target_node_id`/`text_attachments`）。
- 原位模式：目标节点 `draft: true` 时前端**不再新建 media-gen 占位节点**，把草稿节点原地 patch 为 `genStatus: "generating"`（保留 id、位置与连线）；任务创建成功后写入 `jobId` 并启动既有轮询。成功结果回填同一节点（`assetId`/`src`/尺寸），同时清除 `draft` 标记，节点转为普通成品卡；节点数量、身份、位置、连线全程不变。`draftModelId`/`draftSize`/`draftRatio` 保留为该卡的生成参数记录（后续「再次编辑复制」切片按 Q15 复制新草稿时复用）。
- 创建失败回退：配额/401 回到 `genStatus: "draft"`（401 沿用登录恢复重试）；其他错误置 `genStatus: "failed"` + `errorText`，保留卡片、`draft` 标记与全部参数。任务执行失败同样保留。失败重试的快照/新任务语义与取消细化由后续切片定稿，本切片维持既有重试/取消行为（重试沿用失败任务快照；取消确认后移除卡片）。

## 执行期间只读

- `genStatus: "generating"` 的草稿身份卡：面板进入只读（提示词、模型/分辨率/宽高比选择、参考图增删、发送均禁用），保留查看与节点上的既有「取消生成」入口。
- 输入连线只读：画布上向生成中节点新建连线（`onConnect`）与删除其入边（剪刀等 `onEdgesChange` remove 变更）均被拦截并 toast 提示；来源文本节点的正文编辑不受限，但不改写已冻结的当次输入（IKDLQF 快照语义）。
- 只读边界（本切片解释）：**删除来源节点本身不受限**——节点离开画布后其连线按既有级联规则清理，已冻结的任务输入快照不受影响。「输入连线只读」约束的是连线配置的直接编辑（连入/断开），不阻止用户删除画布内容；若后续切片认为需要阻止删除生成中任务的来源节点，另行评审。
- 失败/待生成状态的连线与参数恢复可编辑。

## 保存失败暂停（Q19 本切片落地范围）

- 生成提交：落盘失败即中止（见上）。
- 项目切换：顶栏切换与新建项目前先 `flushCanvasSave`；保存失败 toast「保存失败，请重试」并留在当前项目；保存成功后放行。顺带修复了「带未防抖编辑切换项目丢失修改」的旧缺口。浏览器前进/后退与删除项目后的自动切换不在本切片。

## 验证

测试边界沿用 IKDLQF 先例：真实浏览器 + 真实业务 API + 隔离 MySQL（`IKDMQQ_DATABASE_URL`，独立 `ikdmqq` 库）；不调用真实付费供应商，不触碰共享生产/测试站数据库。

- 前端 vitest：草稿创建/重复创建/参数同步/水合恢复不标缺失/原位提交（先落盘后建任务、节点数不变）/成功回填同节点/生成中只读（面板 + 连线）/保存失败阻断生成与项目切换/失败保留卡片与原因；出生点避让纯函数；MediaNode 待生成渲染。
- 公开接口集成（真 MySQL）：草稿节点（无 assetId）保存与 GET 恢复原样；对草稿 `target_node_id` 建任务冻结快照。
- 浏览器段（Playwright，`IKDMQQ_BROWSER=1` 环境门控）：建卡未建任务 → 重复创建 → 编辑后刷新恢复 → 保存故障阻断生成与切换、恢复后放行 → 提交后（DB 翻 succeeded）同卡回填不新增结果卡。复现命令：

```bash
IKDMQQ_BROWSER=1 IKDMQQ_DATABASE_URL=mysql://root@127.0.0.1:23306/ikdmqq \
  pnpm exec vitest run backend/apps/blue-whale/src/api/canvases/image-draft.integration.test.ts
```

数据库必须是预先应用当前 Prisma schema 的隔离测试库；测试创建独立项目，不清理其他项目。

## 后续切片复用点

- 视频/音频草稿：同一身份约定（`draft: true` + `genStatus: "draft"` + 对应 `mediaType`），仅参数集与面板不同。
- 媒体引用切片：在草稿 data 上扩展媒体引用角色字段（首帧/尾帧/普通参考），并落地 Dock 上传移除（Q7/Q10）。
- 再次编辑复制切片：成功卡「再次编辑」按 Q15 立即复制新草稿（复用本切片的草稿创建与参数持久化），原结果保留。
