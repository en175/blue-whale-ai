# Design：节点 Recipe

> 关联 ADR-0022（recipe「留位」声明）、IJZXW7（多模态 PRD）、`canvas-doc-model` spec。
> 本文给数据模型 + 8 项关键决策。spec.md 给可验证需求与场景；tasks.md 给落地步骤。

## 数据模型（`model.ts`）

```ts
/** 节点产物来源。 */
export type NodeOrigin = "uploaded" | "generated" | "derived";
// uploaded  = 用户上传文件（无生成参数）
// generated = AI 生成（图/视/音）—— 有 generation 记录
// derived   = 派生变换（清晰化/截图/提取音频/局部重绘/基于节点重生成）—— 有 generation + sourceNode/asset

/**
 * 节点 Recipe：产物「怎么来的」+ 重生成所需全部信息。
 * 持久化进画布 JSON；是「重新生成」与「派生操作」的唯一依据。
 */
export type NodeRecipe = {
  origin: NodeOrigin;
  /** origin=generated/derived 才有；uploaded 无。 */
  generation?: GenerationRecipe;
};

/** 生成记录：模型 + 参数 + 输入引用 + 绑定 job。 */
export type GenerationRecipe = {
  mediaKind: MediaKind;                              // image | video | audio（决定 params 形状）
  model: string;                                     // catalog modelId（重生成必需；provider 由 model 隐含，见决策 4）
  params: ImageGenParams | VideoGenParams | AudioGenParams;
  inputs: RecipeInputs;                              // 生成时冻结的输入引用（lineage）
  jobId?: string;                                    // 绑定的 GenerationJob（可重查状态/结果）
  generatedAt?: string;                              // ISO 时间（溯源排序）
};

/** 输入引用：上游如何喂入本次生成。 */
export type RecipeInputs = {
  prompt?: RecipeInput;        // 文本 prompt 来源（文本节点 / 内联）
  firstFrame?: RecipeInput;    // 视频首帧来源
  lastFrame?: RecipeInput;     // 视频尾帧来源
  references?: RecipeInput[];  // 参考图/视频/音频（omni 模式）
};

/**
 * 单个输入引用：nodeId 优先（画布内可追溯 + 重连感知），
 * assetId/url/text 兜底（节点被删 / 画布外资产 / 纯文本仍可重生成）。
 */
export type RecipeInput = {
  kind: MediaKind;     // text/image/video/audio
  nodeId?: string;     // 画布内来源节点（优先）
  assetId?: string;    // 画布外资产 id
  text?: string;       // text 内联值（prompt 文本快照）
  url?: string;        // 解析后 src 快照（防节点删除后丢依据）
};

/** 派生变换记录（origin=derived）。 */
export type DerivedRecipe = GenerationRecipe & {
  transform: "upscale" | "snapshot" | "extract-audio" | "inpaint" | "regenerate";
  sourceNodeId?: string;   // 源画布节点
  sourceAssetId?: string;  // 源画布外资产
};
// 注：derived 复用 generation 形状（transform 也是一次「生成」），额外记 transform + 源。

// 生成参数（对齐 BottomDock settings + GenerateRequest，按 mediaKind 区分）
export type ImageGenParams = {
  aspectRatio: string;     // "16:9" 等 token
  resolution: string;      // 分辨率 id
  quantity: number;
  refMode?: string;        // 参考模式（若有）
};
export type VideoGenParams = {
  aspectRatio: string;
  resolution: string;
  duration: number;        // 秒
  refMode: string;         // none / firstlast / omni
  internetSearch?: boolean;
};
export type AudioGenParams = {             // 未来（音频生成子工单 IJZY1D）
  [key: string]: unknown;
};

// CanvasNodeData 扩展
export interface CanvasNodeData {
  // ...既有字段
  recipe?: NodeRecipe;   // ★ 产物溯源 + 重生成依据（旧节点无 = origin 未知）
}
```

## 关键决策

### 1. recipe vs edges：冻结快照 vs 活接线（并存，语义不同）

- **`edges`** = 当前活接线（用户可重连、删、加）。`engine.resolveInputs(edges)` 在**生成时刻**解析出实际喂入的 inputs。
- **`recipe.inputs`** = 生成那一刻**冻结的快照**（provenance：这次到底用了什么）。
- 生成时：`resolveInputs(edges) → inputs → 冻结进 recipe.inputs`。
- 重新生成时：params 取 frozen `recipe.generation.params`；inputs **重解析当前 edges**（尊重用户重连），edges 缺失则**回退 frozen `recipe.inputs`**。
- 二者不互斥：edges 服务「现在怎么连」，recipe 服务「这节点怎么来的 / 同参数再来一次」。

### 2. origin 三态：uploaded / generated / derived

- `uploaded`：用户传文件。recipe = `{origin:"uploaded"}`，无 generation。
- `generated`：AI 生成（图/视/音）。recipe 带 generation（params + inputs + jobId）。
- `derived`：派生变换（清晰化/截图/提取音频/局部重绘/基于节点重生成）。带 generation + `transform` + source。**本轮只预留类型**，不实现派生动作（toolbar 占位动作属 P3 后续子工单）。

### 3. 输入引用 RecipeInput：nodeId 优先，assetId/url/text 兜底

- `nodeId`（画布内节点）优先：可溯源（「首帧来自节点 X」）、可重连感知（重新生成时若 X 还在，用 X 的当前 asset；用户可能已换 X 的图）。
- `assetId` / `url`（画布外资产 / 上传素材）：节点被删或输入来自 Dock 上传素材时兜底，保证仍能重生成。
- `text`：prompt 文本快照（文本节点被删后，prompt 文本仍在 recipe 里）。
- **回答用户「视频首帧怎么来的——引用哪个节点？还是上传素材？」**：看 `recipe.generation.inputs.firstFrame`——有 `nodeId` = 画布内图片节点；有 `assetId`/`url` 无 `nodeId` = 上传素材 / 画布外资产。

### 4. provider vs model

- **`model`**：catalog 给的 modelId（如 `doubao-seedream-3.0` / `kling-v2-1.5`）。这是 `GenerateRequest.model` 实际要的，**重生成必需，必存**。
- **`provider`**：上游 AI 服务（即梦/Vidu/可灵/doubao）。当前前端 catalog **不把 provider 作为独立维度**（一个 modelId 隐含一个 provider）。故 recipe **只存 model**；后端未来若按 provider 路由，再加 `provider?: string`。
- 即：现在分不清 provider/model 是因为前端就没分开——recipe 跟前端契约走（存 model），不为假想需求加字段。

### 5. serialize 向后兼容（不破坏老 /canvas、不清表）

- recipe 是节点对象的**新增可选字段**。`serialize` 把 recipe 写进 NodeItem[] 节点对象；老 `/canvas` 读已知字段、**忽略 recipe**（不崩）。
- 老数据（无 recipe）`parse` 后 recipe=undefined，渲染不阻塞；「重新生成」时提示「无重生成依据」。
- **无需清表**（区别于 v2 架构那次清表——那次是 NodeItem→{nodes,edges} 结构变；这次是同结构加可选字段）。

### 6. 重新生成语义

- 节点 toolbar「重新编辑/生成」点击：读 `recipe.generation`。
  - params → 预填 BottomDock（model/比例/分辨率/时长/refMode/首尾帧/参考）。
  - inputs → 重解析当前 edges（若 prompt handle 仍连文本节点，用其当前 prompt；否则回退 recipe.inputs.prompt.text）。
  - 用户可改任意项后重新生成 → 产**新节点**（origin=generated 或 derived.regenerate，sourceNodeId=原节点）。
- 无 recipe（上传/老节点）→ 该入口禁用或提示「此节点无生成依据」。

### 7. 清晰化 / 截图 / 提取音频 = derived，不混进 generated.params

- 这些是**对已有节点的变换**，产新节点。新节点 `origin:"derived"`，recipe 记 `transform` + `sourceNodeId`/`sourceAssetId` + 变换参数。
- 不塞进 `generated.params`（generated.params 只描述「从 prompt + 参考直接生成」的参数）。
- 本轮预留 derived 类型；toolbar 动作仍占位（P3 实现）。

### 8. 持久化边界

- recipe 全是可序列化原语（string/number/boolean/数组）→ 直接 JSON 化，无需特殊处理。
- `url` 存的是生成时的 src 快照（可能后续过期/重签），重生成时优先重解析 nodeId→当前 asset.src，url 仅兜底。

## 落地点（生成/上传流写 recipe 的位置）

| 流 | 位置 | recipe |
|---|---|---|
| 图片生成（流式/同步） | `handleGenerate` image 路径 / `handleGenerateFromNode` image | `{origin:"generated", generation:{mediaKind:"image", model, params, inputs, jobId}}` |
| 视频生成 | `handleGenerate` video 路径 / `handleGenerateFromNode` video / useJobStatus succeeded | `{origin:"generated", generation:{mediaKind:"video", model, params{duration,refMode,...}, inputs{firstFrame,lastFrame,references}, jobId}}` |
| 上传（左栏/Dock） | `handleFileChange` / `handleDockLocalUpload` | `{origin:"uploaded"}` |
| 卡片生成（Agent） | `handleCardGenerated` | `{origin:"generated", generation:{mediaKind:"image", inputs{prompt:text}}}`（Agent 路径参数有限，记能记的） |

`engine.resolveInputs` 已返回 `Record<string, Asset>`——加一层 `toRecipeInputs(resolved, edges)` 把解析结果 + nodeId 映射成 `RecipeInputs`（冻结）。
