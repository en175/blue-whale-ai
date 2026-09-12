# 文本附件正文标签（prompt_doc 文本扩展）契约

## 时间

2026-09-13

## 背景与范围

工单 IKFA1P（父需求 IKFA1J，四票拆分第 4 票）：生图与生视频正文插入【文本N】标签，绑定来源文本节点身份；生成时读取来源最新完整文字，供应商正文建立文本编号与内容的关系。本文记录相对 `2026-09-12-ikfa1m-image-prompt-ref-contract.md` 与 `2026-09-13-ikfa1o-video-prompt-ref-contract.md` 的增量；未提及的字段与规则沿两契约不变。代码侧权威实现在 `packages/contracts/src/prompt-doc.ts`（文本函数）、`backend/libs/shared/generation/handle-create-generation-job.ts`（接纳）与 `packages/core/src/compose-text-attachment-prompt.ts`（组合）。

## 1. 身份与片段

- 新增片段 `text_ref`：`{ kind: "text_ref", node_id, label?, invalid_label? }`（strict）。
- **稳定身份 = 来源画布 textNode 的节点 id**（非空字符串，长度 1–128，不限定格式）。画布节点 id 形如 `text-<时间戳>-<序号>`，与媒体身份空间（本地纯数字 / `asset-` 前缀）天然不重叠；两类身份永不错绑。
- `label` / `invalid_label` 语义与 `asset_ref` 同构：label 为展示编号缓存（`文本N`），服务端从不消费；`invalid_label` 存在即失效标签。
- 文本标签与媒体标签可在同一正文混排，各自独立编号。

## 2. 编号规则（`文本N`）

- `文本N` = node_id 在**当前有效文本附件顺序**中的下标 + 1。
- 文本附件顺序前后端同源：画布 edges 数组中连入目标媒体节点、source 为 textNode 的边序（前端 `textAttachmentsOf` 与后端 `resolveTargetSnapshot` 同一推导；IKDLQH 排序直接重排该边序）。
- 附件区徽标、@ 菜单、正文标签、服务端编译使用同一规则同一顺序；正文出现顺序不改变附件顺序（与媒体 D1 同理）。
- 失效与恢复完全复用 IKFA1N/IKFA1O 生命周期：移除附件（断开连线）→ 相关标签失效（保留原身份与原编号）；同身份重新连入 → 自动恢复并派生当次编号。文本无模式兼容概念，失效仅由「身份不在当前附件集合」决定。

## 3. 编译与组合（供应商正文建立编号 ↔ 内容关系）

### 3.1 正文编译

- `text_ref` 片段编译为字面 `文本N`；媒体片段编译规则不变（图片N / 首帧 / 视频N 等）。
- 编译函数扩展：`compilePromptDoc(doc, orderedAssetIds, orderedTextNodeIds?)` 与 `compileVideoPromptDoc(doc, refs, orderedTextNodeIds?)`；`orderedTextNodeIds` 缺省时正文含 `text_ref` 视为非法（不可编译）。

### 3.2 编号清单组合（`composeTextAttachmentPromptIndexed`）

正文含文本标签（`prompt_doc.segments` 存在 `kind=text_ref`）时，文本附件与正文的组合从「附件裸文本拼接」升级为**编号清单**格式（`packages/core` 新函数）：

```
文本1：<附件1正文>

文本2：<附件2正文>

<编译后正文>
```

- 全部文本附件（含未在正文提及者与方案附件）按序进入清单——未提及附件沿既有语义作为上下文输入，编号保持连续。
- 空白附件**保留编号占位**（`文本N：`，内容为空）：正文中的「文本N」字样与清单行号必须稳定对应，跳过会错位。
- 无 `text_ref` 的任务（纯媒体标签 / 无标签 / 旧客户端）组合格式逐字节不变。

### 3.3 快照字段

- `input.prompt_doc`：原始结构快照（含 text_ref 片段），现状不变。
- `input.text_attachments`：接纳当下从画布读取的最新完整文字（现状不变，天然满足「读取来源最新」），重试消费同一快照（D3/E4）。
- **新增 `input.composed_prompt`**：仅当正文含 `text_ref` 且无方案快照时冻结 = `composeTextAttachmentPromptIndexed(text_attachments, input.prompt)`。编号清单的格式逻辑只在接纳处实现一次，worker 不重复编译。
- 方案快照路径（存在 `prompt_plan_snapshot`）：`providerPrompt` 在冻结时按同一编号清单格式组合（方案附件正文经既有标签替换后进清单），worker 优先消费 `providerPrompt`（现状不变，不写 `composed_prompt`）。

## 4. 执行端消费优先级（TS 与 Java 一致）

```
prompt = prompt_plan_snapshot.providerPrompt ?? input.composed_prompt ?? 既有组合(附件裸文本, input.prompt)
```

- TS 图片 worker、TS 视频 runner：在既有优先级链中插入 `composed_prompt`。
- Java VideoJobProcessor：同一优先级链插入 `composed_prompt`（`basePrompt` 兜底维持既有简化边界不变）。
- 旧任务（无 `composed_prompt`、无 `text_ref`）执行语义逐字节不变（E5）。

## 5. API 接纳（POST /api/projects/:id/generation-jobs）

在既有复核链（参考存在性/归属/类型 → 媒体标签复核 → 编译）之后追加：

- 正文含 `text_ref` 时，须携带 `target_node_id`（文本附件由画布连线推导）；未携带 → `400 invalid_reference`（正文文本标签指向无效的文本附件）。
- `text_ref.node_id` 必须在接纳当下推导的文本附件集合内；不在 → `400 invalid_reference`（同文案）。保存与提交之间的连线变化以接纳当下复核为准（D4）。
- 带 `invalid_label` 的文本标签 → `400 invalid_reference`（存在已失效的素材标签，请删除后再提交；沿用既有文案）。
- 编译后正文（含 `文本N` 字样）再次通过既有非空/长度/组合约束；组合长度上限沿用 `max(契约预算, 模型 raw 上限)`。
- `type=audio` 携带 `prompt_doc` 拒绝规则不变（正文素材标签暂仅支持图片与视频生成）。

## 6. 前端行为

- 生图（ImageDialog）与生视频（BottomDialog）@ 菜单「已引用」分区追加文本附件项：名称 = 来源节点标题、徽标 = `文本N`、类型图标（无缩略图）；搜索按名称与编号过滤。
- 选择已引用文本 → 当前光标原位插入【文本N】标签；多次提及去重为同一份附件（不重复建连线）。
- 从画布素材菜单选择新文本节点 → 既有 `connectPair` 建连线添加附件，添加成功后在 @ 插入点落标签（A3 文本版）。
- 标签失效/恢复/替换/删除语义与媒体标签共用同一编辑器生命周期（IKFA1N/IKFA1O）。
- 草稿持久化沿用 `promptDoc` + `prompt` 拍平镜像双写（`文本N` / `已失效：原文N`）；附件区展示 `文本N` 徽标。

## 7. 错误响应样例

```json
{ "code": 1034, "msg": "存在已失效的素材标签，请删除后再提交" }
{ "code": 1034, "msg": "正文文本标签指向无效的文本附件" }
```

## 8. 验证与关联

- 契约单测：`packages/contracts/src/prompt-doc.test.ts`（text_ref 结构、编号、编译、复核）。
- 组合单测：`packages/core` compose（编号清单、空白占位、无标签不变）。
- 前端纯逻辑：`web/src/lib/prompt-doc.test.ts`（restore/reconcile/flatten 文本泛化）。
- 组件：ImageDialog / BottomDialog 测试（文本插入、失效恢复、发送携带 prompt_doc）。
- 接纳与快照：`backend/libs/shared/generation/handle-create-generation-job.test.ts`（文本复核、composed_prompt 冻结）。
- worker：generation-worker / video-job-runner 的 composed_prompt 优先级。
- 集成：`backend/apps/blue-whale/src/api/canvases/prompt-ref-text.integration.test.ts`；`IKFA1P_DATABASE_URL` 门控 API 级，`IKFA1P_BROWSER=1` 增开真实浏览器→公开 API→隔离库→记录式供应商（生图+生视频：改来源再生成、重复提及、删除/修复、刷新、与媒体及方案混用、重试冻结）。
- 关联：IKFA1J（父需求）、IKFA1M/N/O（前置票）。
