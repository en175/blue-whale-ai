# 生视频正文素材标签（prompt_doc 视频扩展）契约

## 时间

2026-09-13

## 背景与范围

工单 IKFA1O（父需求 IKFA1J，四票拆分第 3 票）：生视频面板复用 IKFA1M/IKFA1N 建立的正文引用生命周期，扩展到图片/视频/音频多媒体标签与首尾帧角色。本文记录相对 `2026-09-12-ikfa1m-image-prompt-ref-contract.md` 的增量；未提及的字段与规则沿该契约不变。代码侧权威实现在 `packages/contracts/src/prompt-doc.ts`（视频函数）与 `backend/libs/shared/generation/handle-create-generation-job.ts`（接纳）。

## 1. 身份扩展

- `asset_ref.asset_id` 身份空间从「本地 Asset 纯数字 id」扩展为「本地纯数字 id **或** 素材库 `asset-` 前缀 id」；正则 `/^([1-9][0-9]*|asset-.{1,128})$/i`，与生成接纳 `materialId()` 同口径（大小写不敏感）。
- 两个身份空间不按名称混用：本地 id 命中 `references[].asset_id`，素材库 id 命中 `references[].material_id`。生图路径的 `input_asset_ids` 仍为纯数字，素材库身份标签在生图接纳自然落 `unknown_asset` 拒绝。

## 2. 视频标签文案派生（`videoRefLabel`）

以提交的**单数组 references 实际结构**为唯一口径（帧在前、普通参考保序），不信任客户端 `label` 缓存：

- `role=first_frame` → `首帧`；`role=last_frame` → `尾帧`（按角色显示，不编号）。
- `role=reference` → 按同类型在 reference 序中的顺序**连续编号**：`图片N` / `视频N` / `音频N`（各类型独立计数）。
- 身份不在集合 → `null`（失效）。
- 前端 `videoLabelMapOf`（`web/src/pages/CanvasPage/videoPromptRefs.ts`）附加**模式判定**：keyframe 只接受帧身份、text2video 只接受 image 普通参考、all 不接受帧。身份在集合但模式不接受 → 不给标签（reconcile 判失效，C2）；恢复条件 = 身份在集合**且**当前模式接受（C5：仍不兼容不误恢复）。

## 3. API 接纳（POST /api/projects/:id/generation-jobs）

- `prompt_doc` 允许 `type=image|video` 携带；`type=audio` 携带 → `400 unsupported_input`（文案：正文素材标签暂仅支持图片与视频生成）。
- **视频携带 `prompt_doc` 必须同时携带单数组 `references`**（新客户端唯一路径）；旧字段路径（`reference_asset_ids` 等）携带 → `400 unsupported_input`。
- 服务端复核（在 references 结构复核之后）：
  - 携带 `prompt_doc` 时对 references 的本地 `asset_id` 项补存在性/归属复核（复用 `resolveInputAssets`），并比对声明 `type` 与素材实际类型——编号由 type 派生，谎报 type 拒绝（`400 invalid_reference_type`）；素材库 `material_id` 沿 IKDJNZ 既有边界（上游强校验，worker 执行期兜底）；
  - 已知边界：正常 UI 下帧与普通参考互斥（`videoRefConflict` 阻止发送）；直接请求混排提交时服务端按提交结构确定编号，与任一前端模式展示可能不同（混排本身是非法状态，不构成一致性缺口）；
  - 存在带 `invalid_label` 的失效标签 → `400 invalid_reference`；
  - 标签身份不在 references（asset_id ∪ material_id）→ `400 invalid_reference`；
  - 编译结果必须再次通过既有非空/长度/组合约束。
- 编译：`compileVideoPromptDoc`，规则见 §2；编译结果替代 `parameters.prompt` 冻结进 `input.prompt`。

## 4. 冻结快照与执行/重试

- `job.input.prompt` = 编译后正文；`job.input.prompt_doc` = 原始结构快照；`job.input.references` 顺序冻结（现有行为）。
- worker 现有消费路径零改动：单数组 references 下首尾帧并入 provider 请求的 `references`（带 `role`），正文取 `input.prompt`。
- 旧视频任务（无 `prompt_doc`）：执行语义完全不变。
- 重试原样复制 `input`，消费同一快照。

## 5. 草稿持久化

视频草稿节点 `data` 沿用生图同构双写：`prompt`（拍平镜像）+ `promptDoc`（`{version, segments, flat}`）。恢复判定、防丢失语义（镜像一致才恢复结构）与生图契约 §5 相同。模式持久化在 `data.draftMode`，恢复后标签有效性按当前参考集合 + 模式重新推导。

## 6. 错误响应样例

```json
{ "code": 1034, "msg": "存在已失效的素材标签，请删除后再提交" }
{ "code": 1034, "msg": "正文素材标签指向无效的参考素材" }
{ "code": 1004, "msg": "视频正文素材标签请求必须携带单数组 references" }
{ "code": 1004, "msg": "正文素材标签暂仅支持图片与视频生成" }
```

## 7. 验证与关联

- 契约单测：`packages/contracts/src/prompt-doc.test.ts`（身份扩展、视频编号/编译）。
- 前端纯逻辑：`web/src/lib/prompt-doc.test.ts`（reconcile 泛化 C1/C2/C5）、`web/src/pages/CanvasPage/videoPromptRefs.test.ts`（模式判定）。
- 组件：`web/src/pages/CanvasPage/components/BottomDialog/video-prompt-ref.test.tsx`（@ 多媒体插入、角色同步、模式失效、发送携带 prompt_doc）。
- 接纳与快照：`backend/libs/shared/generation/handle-create-generation-job.test.ts`（视频 describe）。
- 集成：`backend/apps/blue-whale/src/api/canvases/prompt-ref-video.integration.test.ts`；`IKFA1O_DATABASE_URL` 门控 API 级，`IKFA1O_BROWSER=1` 增开真实浏览器→公开 API→隔离库→记录式视频供应商链路（混合媒体编译、首尾帧角色、删除失效/重连恢复、重试冻结）。
- 关联：IKFA1J（父需求）、IKFA1M/N（前置票）、IKFA1P（后续票：文本附件标签）。
