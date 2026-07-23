# Proposal：节点 Recipe —— 产物溯源 + 重生成参数

> **状态：已实现**（commit `286cadb`，2026-07-22）。核对结论：实现与本设计 **1:1 一致**——类型层（NodeOrigin/RecipeInput/RecipeInputs/各 GenParams/GenerationRecipe/DerivedRecipe/NodeRecipe）、持久化（serialize/parse 保 recipe + 向前兼容）、engine（toRecipeInputs/buildGenerationRecipe）、mappers（recipeToDockPrefill）、page（生成/上传流写 recipe + 重新编辑预填）、测试（model/engine/mappers）全覆盖。仅 2 处微调（已据此回更本 spec）：① 老 `Recipe` interface（ADR-0022 留位 `{model,params}`）被新 `NodeRecipe` 取代、零引用，已删；② REQ-10「无 recipe 重新编辑」由"禁用入口+提示"改为"软降级开空 Dock"（实现更友好）。

## Why

画布节点丢了「怎么来的」。现状（IJZXW7 第 0 档声明 recipe 为「工作流留位」但从未落地）：

- `serialize` 产出 `NodeItem[]` 时**剥离 recipe**（只保留 id/type/position/assetId/prompt/references）。
- 生成参数（model / 比例 / 分辨率 / 时长 / refMode / quantity / 首尾帧 / 参考图/视频/音频 / internetSearch）只活在 BottomDock 的临时 state，生成完即丢，**不落画布 JSON**。
- 输入溯源只靠 `edges`（连线），而 edges 本轮恒空 / 不渲染，且即便有也只记「谁连谁」，不记「生成那一刻用了什么参数、首帧来自画布内节点还是上传素材」。

后果：
1. **无法重新生成**：刷新后想「基于这张图用同参数再出一张 / 换个比例重出」——参数没了，只能从零配。
2. **无法溯源**：某视频的首帧是引用画布里哪个图片节点、还是用户上传的某素材？不可查。
3. **堵死派生扩展**：未来「放大 / 清晰化 / 截图 / 提取音频 / 局部重绘 / 基于某节点重生成」全要知道「这个节点怎么来的 + 用了什么」——现在无依据。

本 change 把 recipe 做实：**每个媒体节点记录 origin（怎么来的）+ generation（生成参数 + 输入引用 + 绑定 job）**，持久进画布 JSON，作为「重新生成」与「派生操作」的唯一依据。

## What Changes

- **`model.ts`**：落地 `NodeRecipe` 类型——`origin: "uploaded" | "generated" | "derived"` + 可选 `generation: { mediaKind, model, params, inputs, jobId, generatedAt }`；`CanvasNodeData.recipe: NodeRecipe`（旧节点无 recipe 视为 origin 未知，不阻塞渲染）。
- **`serialize` / `parse`**：recipe 随节点进出画布 JSON。向后兼容——老 `/canvas` 读已知字段、忽略 `recipe`，不崩；老数据无 recipe 正常加载。
- **生成流**（`handleGenerate` / `handleGenerateFromNode`）：生成成功即冻结 recipe——`origin:"generated"` + 当前 model + 完整 params + `resolveInputs(edges)` 解析出的 inputs（nodeId 优先，assetId/url/text 兜底）+ jobId。
- **上传流**（`handleFileChange` / `handleDockLocalUpload`）：`origin:"uploaded"`（无 generation）。
- **输入引用 `RecipeInput`**：`nodeId`（画布内，可追溯 + 重连感知）优先，`assetId` / `url` / `text` 兜底（节点被删 / 画布外资产仍可重生成）。
- **重新生成入口**（节点 toolbar「重新编辑/生成」）：读 `recipe.generation.params` 预填 BottomDock + 重解析当前 live edges 的输入（尊重重连，回退 frozen inputs），再跑一次。
- **provider vs model**：存 `model`（catalog modelId，重生成必需）；`provider` 当前不单存（model 隐含 provider；后端未来按 provider 路由时再加字段）。
- **清晰化 / 截图 / 提取音频**：归 `origin:"derived"`（派生操作产新节点，recipe 记 `sourceNodeId/assetId` + transform 类型 + 参数），不混进 `generated.params`。本轮只**预留 derived 类型 + 占位**，不实现派生动作（属后续子工单）。

## Capabilities

### New Capabilities

- `node-recipe-provenance`：节点产物来源（uploaded/generated/derived）+ 重生成参数（model/比例/分辨率/时长/refMode/…）+ 输入溯源（prompt/首帧/尾帧/参考 来自画布内节点 or 画布外资产），持久化进画布 JSON，作为重新生成与派生操作的唯一依据。

### Modified Capabilities

- `canvas-doc-model`：`serialize`/`parse` 保留 `recipe`（节点持久化字段扩展，向后兼容老 `/canvas` 与老数据）。

## Impact

- 前端 `blue_whale_web/app/canvas/_canvas/model.ts`（NodeRecipe 类型 + serialize/parse）、`v2/page.tsx`（生成/上传流写 recipe）、`v2/nodes.tsx`（无 recipe / origin=uploaded 节点的渲染与「重新生成」可用性）、`engine.ts`（resolveInputs 产出可冻结的 inputs）。
- 画布 JSON：节点对象增 `recipe` 字段。**无需清表**（recipe 是新增可选字段；老节点无 recipe 正常加载，渲染不阻塞，重新生成时提示「无重生成依据」）。
- 后端**零改**：canvas 仍 opaque PUT，recipe 随 `nodes_json` 透传（CanvasService 不解析节点内容）。
- 与 `edges` 的关系：recipe = 生成时**冻结快照**（provenance）；edges = **当前活接线**（可重连）。二者并存，语义不同（见 design.md 决策 1）。

## Phasing

- **P1（本 change 核心）**：recipe 类型 + 捕获（生成/上传即写 recipe）+ 持久化 round-trip。
- **P2**：重新生成入口（读 recipe 预填 BottomDock + 重解析 edges + 重跑）。
- **P3（后续子工单）**：派生操作（toolbar「清晰化/截图/提取音频/局部重绘」产 derived 节点）。
