# ADR-0024：recipe.params catalog 驱动 + 开放（Record）

**状态：** 已接受（2026-07-23）
**关联：** IJZXW7-D（IJZY24）、`node-recipe-provenance`、catalog（`getImageModels`/`getVideoModels`）

## 决策

`recipe.generation.params` 从固定 `GenParams`（按 mediaKind：`ImageGenParams`/`VideoGenParams`/`AudioGenParams`）改成 **`Record<string, unknown>`**（实际 key-value，形状随模型），**`modelId` 绑定**。

## 背景

- **catalog 已存在且已驱动 UI**：`getImageModels`/`getVideoModels` 返回每模型的参数能力（`supportedSizes`/`supportedAspectRatios`/`durations`/`features`），前端 `ImageModelSettingsPopover`/`VideoDockContent` 按 capability 动态渲染参数选项。不同模型参数差异 = capability.supportedXxx + features 不同。
- **recipe.params 固定形状只记 catalog 子集**：`ImageGenParams{aspectRatio,resolution,quantity}` 是 catalog 的一部分，不是全集。新模型带新参数（如 `style`/`motion`/`voice`）塞不进固定形状 → 每加一个参数要改 `GenParams` 类型 + recipe + 序列化 + 测试，扩展成本线性增长。

## 决策理由

**catalog 是参数能力的唯一源**（已驱动 UI），recipe.params 跟上 catalog：

- catalog 加参数 → recipe 自动记（key-value），**不动 recipe 模型/序列化/老 recipe**。
- **重新生成**：按 `recipe.model`（modelId）查 catalog 拿该模型的参数能力 → 用 `recipe.params` 实际值预填；模型换了/参数没了 → catalog 告诉哪些还有效，丢没效的。
- 老 recipe 的 params 是子集 → 新模型读时按 catalog 过滤，向后兼容。

## 被否方案

- **保留固定 `GenParams`（按 mediaKind）**：类型安全，但每参数改三处（`GenParams` + recipe + 序列化 + 测试），扩展贵，且 recipe 形状跟模型绑死（换模型老参数对不上）。→ 改开放。
- **recipe.params 按每模型 schema 声明**：过度设计（catalog 已有参数能力，重复）。→ 用 `Record` + modelId 查 catalog。

## 连锁影响

- `model.ts`：`recipe.generation.params` 改 `Record<string, unknown>`（可保留 `GenParams` 联合作向后兼容过渡，新参数进 Record）。
- 序列化：recipe.params JSON 自由（已序列化友好，无结构变）。
- 重新生成（`recipeToDockPrefill`）：按 modelId 查 catalog 解析参数能力 + 预填 recipe.params（不靠固定字段）。
- 测试：recipe.params 不再断言固定形状，按实际 key-value。
- 音频：后端音频 provider 接后加 `getAudioModels`（同 image/video catalog 模式），`AudioDockContent` mock 模型列表换 catalog。

## 后续（不在本 ADR）

- catalog 扩展参数能力（`supportedParams: [{key,type,options,default}]` schema）：每模型声明参数项，前端按 schema 渲染。后端 catalog 演进。
