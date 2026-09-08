# 图片参考连线与 Dock 双向同步契约（IKDMQR）

## 时间

2026-09-07

## 目标与边界

落实 [IKDMQM](2026-09-07-canvas-generation-draft-spec.md) 的第 2/7 个纵向切片：画布图片参考连线与图片 Dock 引用双向同步，图片参考真正进入生成任务与供应商输入。

不在本切片：视频/音频草稿的媒体引用（后续切片）、Dock 上传入口移除的迁移缓冲（本轮直接移除，见下）、成功卡「再次编辑复制」、失败重试/取消竞态细化。

## 参考关系表示（关系即连线）

- 图片参考关系**只以画布连线表示**：`edge {source: 就绪图片媒体节点, target: 图片草稿}`。不在草稿 `data` 上冗余存参考清单——单一事实源，保存/恢复/双向同步天然一致。
- 连线随既有 Canvas `edges` JSON 持久化；刷新/重开项目后按连线推导恢复 Dock 显示，无需额外字段或迁移（服务端零改动延续 IKDMQQ）。
- 与文本附件连线（IKDLQF：`textNode → target`，冻结为 `input.text_attachments`）相互独立并存；同一目标可同时挂图片参考连线与文本附件连线。
- 仅当目标是**图片草稿身份节点**（`draft: true` + `mediaType: "image"`）时才按图片参考语义校验与消费；视频/音频目标与其他目标类型沿用既有语义，不被本切片拦截。

## 来源有效性（仅有效图片媒体结果）

- 可连入条件：`mediaNode` + `mediaType === "image"` + 就绪态（无 `genStatus`）+ `src` 非空非 `blob:` + 有 `assetId`（上传完成）+ 未失效（非 `assetMissing`）。
- 拒绝并 toast 原因（不静默丢弃）：待生成草稿 / 生成中 / 失败·已取消 / 素材已被删除 / 上传中（blob）/ 视频与音频 / 素材未关联资产。
- 重复关系：同一 `assetId`（不同卡片、同一素材）再次连入 → 拒绝「该素材已连入当前草稿」；前端固定上限 9 张（`REF_LIMITS.image`），超限拒绝。模型能力上限（`features.max_reference_images`）与素材归属校验延续服务端既有链路（IKA72G：创建期 400 + worker 执行期同源校验）。
- 失效来源的**既有连线**保留在画布上（不自动清除），Dock 推导时跳过展示与消费；来源恢复或用户断线前不再作为输入。

## 双向同步

- **连线 → Dock**：草稿绑定面板的参考区由父级按连线实时推导渲染（`imageMediaRefsOf`，顺序即连线顺序）；画布连线/断线/删除来源节点级联清理即时反映。
- **Dock 选择 → 连线**：面板「到节点选择」进入画布图片节点选取，点击来源节点建立 `来源 → 草稿` 连线（走与手动拖线完全相同的校验与守卫）；不再注入面板本地素材列表。
- **移除双向**：Dock 参考项移除 = 按 `(source, target)` 精确断开对应连线；画布断线（剪刀）= Dock 同步移除该参考。移除只改变关系：不删除来源素材卡，不影响其他目标对同一来源的引用。
- **提交同源**：草稿绑定时 `input_asset_ids` 由同一连线推导（与 Dock 显示逐项一致），面板本地 `files` 不再参与；先 `flushCanvasSave` 落盘再建任务（IKDLQF 串行化沿用），服务端冻结 `input.input_asset_ids` + `input.text_attachments` 快照。
- 执行期间（`genStatus: "generating"`）：Dock 参考可见但移除入口隐藏；参数只读与连线只读沿用 IKDMQQ 拦截（新建/删除入边均 toast「生成中，输入连线只读」）。

## Dock 素材入口移除（Q7/Q10 在本切片落地）

- 图片 Dock（ImageDialog）移除本地上传与画布外素材选择：删除本地上传菜单/加号按钮/文件选择器，参考素材唯一入口是「到节点选择」（画布已有素材）。对所有入口生效（资产卡「生成图片」等非草稿绑定面板同样不再提供上传）。
- 非草稿绑定路径（重新编辑/资产卡/角色库多选）的面板本地 `files` 列表保留：渲染与提交消费（上传取 assetId）行为不变，仅不再提供上传入口。新素材先从画布上传入口（工具栏上传/资产库选择，保持可用）放入画布后再引用。

## 验证

测试边界沿用 IKDLQF/IKDMQQ 先例：真实浏览器 + 真实业务 API + 隔离 MySQL（`IKDMQR_DATABASE_URL`，独立 `ikdmqr` 库）；不调用真实付费供应商，不触碰共享生产/测试站数据库。

- 前端 vitest：`mediaRefs.test.ts`（来源校验/草稿判定/推导纯函数）+ `imageMediaRefs.test.tsx`（连线→Dock 显示与提交消费、文本附件并存、Dock 选择建线、非法来源拒绝、双路径移除断线与来源保留、无上传入口、画布连线拒绝、上限 9、生成中只读、恢复后显示=输入）。
- 公开接口集成（真 MySQL，`image-media-ref.integration.test.ts` API 段）：媒体参考连线与文本连线并存保存/恢复原样；连线参考进 `input.input_asset_ids` 冻结、接纳后断线改文不改写；模型能力上限延续 400。
- 浏览器段（`IKDMQR_BROWSER=1` 门控）：Dock 选择建线 → Dock 移除断线 → 画布拖线 → 剪刀断线（剪刀中点可能被 Dock 覆盖，点击用 DOM 派发；悬停可见性单独断言）→ 非法来源（视频）拒绝 → 文本附件回归 → 落盘与刷新恢复 → 提交冻结输入=请求=Dock 显示 → 生成中只读。复现命令：

```bash
IKDMQR_BROWSER=1 IKDMQR_DATABASE_URL=mysql://root@127.0.0.1:23306/ikdmqr \
  pnpm exec vitest run backend/apps/blue-whale/src/api/canvases/image-media-ref.integration.test.ts
```

## 后续切片复用点

- 视频/音频草稿媒体引用：同一「关系即连线 + 推导同源 + 校验在 connect」结构，仅参数与角色字段（首帧/尾帧/普通参考，Q：显式角色指定）按父规格后续切片扩展。
- 失败卡重编辑与新任务提交复用本切片的连线推导提交路径。
