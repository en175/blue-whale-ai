# Revise Canvas Rule

本规则定义 `revise_canvas` 分支的处理——对当前画布已有结果做局部修改。与 `product_switch_p0.md` 对偶：product_switch 管「换产品」，本规则管「改当前画布」。

## 一句话规则

对当前画布已有结果做局部修改——不换产品、不新建 workflow_run，带自然语言修改指令，复用当前 workflow 链路重生，结果 ready 回确认门。

## 触发

`decision_branch=revise_canvas`。三个来源：

1. **L1 判 revise**：用户说「改一下 / 重做 / 换风格 / 这张不行 / 脚本不对 / 保留这个」（强信号见 `generation_route_decision.md`）
2. **从 confirm_pending 推翻**：用户在确认门说「修改意图」（见 `confirmation_gate.md` 修改意图分类）→ 走 revise
3. **从 new_task 推翻**：用户说「重新生成这版」但当前画布已有结果 → 主 Agent 推翻 L1 的 new_task 为 revise_canvas（推翻规则见 `decision_layer.md`）

## 前置检查

进 revise flow 前，必须有可 revise 的节点：

| 节点 status | 可 revise？ | 说明 |
|---|---|---|
| `ready` / `awaiting_confirm` | ✓ | 默认 revise 对象 |
| `confirmed` | ✓（门槛高，见修改方式） | 默认 fork，不覆盖 |
| `failed` | ✓ | revise = 带修改指令的恢复（比裸 retry 多一个 instruction） |
| `queued` / `generating` | ✗ | 还没结果，revise 无对象 |

无可 revise 节点 → 不进 revise flow，反问「你想改哪个结果？」或先补齐当前 stage。

## 节点定位

按优先级定位 revise 对象（优先级与 `workflows/image_understanding.md` 候选图消歧一致，统一 `asset_id`）：

- **pointed（本轮 `@` 引用 `reference_asset_ids` / 上传新 asset）**：最高优先，用用户本轮明示的
- **active_asset（前端选中态透传 `active_asset_id`）**：用户当前选中的画布节点（后端反查 `node.asset_ref == active_asset_id` 定位 node）
- **默认**：当前 stage 的最近 `ready` / `awaiting_confirm` 节点（以上都没有时）
- **「保留 A 重做 B」**：识别保留集 + 重做集——保留的节点不动，只对重做集生成变体

> 本轮显式（pointed）压倒历史隐式（active_asset），active_asset 压倒默认最近。用户选中或 @ 优先于「最近 ready」默认。

后端从 canvas 状态自解析 `stage_id` / `node_ids`，**不要求前端传递**（呼应 `backend_implementation_contract.md`）。

## 修改方式：in-place vs fork

| 用户信号 | 方式 | 节点处理 |
|---|---|---|
| 「改这版 / 重做 / 换背景 / 换风格 / 不满意」 | **in-place**（默认） | 覆盖原节点：status 重置为 generating，原 GenerationJob 标记 superseded，新建 Job 复用 node_id |
| 「保留这个，再做一个 / 另做一个不同角度」 | **fork** | 新建变体节点（新 node_id），原节点保留 |
| **confirmed 节点** revise | **默认 fork** | 保留已确认原版 + 新建变体；in-place 需用户更明确说「替换那版」 |

修改指令：用户自然语言 instruction（如「保留构图，换成清晨桌面风格」），传给 Prompt Optimizer。

## 走生成链路

复用当前 `workflow_run` 的链路，**不新建 workflow_run**：

- 轻量图节点 revise → `image_generation_prompt` 链路
- 轻量视频节点 revise → `direct_generation` 链路
- Full Canvas stage 节点 revise → 对应 stage 链路（首批视觉 / 视频生成）

**必过 Prompt Optimizer**（Agent 链路铁律；Dock 直生才豁免，revise 是 Agent 链路）。有图时先 `asset_understanding`。

## 结果落点 + 回确认门

状态机循环（呼应 `canvas_state_rules.md`）：

```text
awaiting_confirm
  -> rejected（用户修改意图）
  -> revise（本规则）
  -> running（GenerationJob 重生）
  -> ready
  -> awaiting_confirm（回确认门，不自动 advance）
```

revise 结果 ready 后，下轮 `decision_context.awaiting_confirm=true` → 自然进 `confirm_pending`。**不自动 advance_stage**（要用户明确确认）。

## 与其他分支的边界

| 场景 | 走哪个 branch | 判据 |
|---|---|---|
| 产品主体没变，改表现（背景/风格/文案/镜头/构图） | `revise_canvas` | 主体不变 |
| 产品主体变了（保温杯 → 咖啡机） | `product_switch` | 主体变（读 `product_switch_p0.md`） |
| 当前画布已有结果，用户说「重新生成这版」 | `revise_canvas`（推翻 new_task） | 已有结果 = 修改非新建 |
| 当前画布空，用户说「做个视频」 | `new_task` | 无已有结果 |

## 后端实现含义

- **不新建 workflow_run**：在当前 workflow_run 内重生节点（product_switch 同项目换产品才重置 workflow）
- **in-place**：原节点 status 重置（ready → generating），原 GenerationJob 标记 superseded，新建 GenerationJob 复用 node_id
- **fork**：新建 node_id，原节点保留；新节点绑定同 stage_id
- **节点定位**：后端从 canvas 状态解析（current_stage + 节点 status + 用户 instruction 推断保留/重做集）
- **API 返回**沿用现有结构（`canvas_updates` + `message_updates`），不新增字段

## 用户可见话术

revise 触发时（`visible_reasoning`）：

```text
我看到你想修改当前结果。产品方向不变，我会按你的要求重新生成这一版。
```

fork 时：

```text
我会保留当前这版，另做一个不同方向供你对比。
```

不暴露：node_id、superseded、workflow_run、stage、GenerationJob 等内部词。

## 禁止

- 禁止把产品切换当 revise（产品主体变 → `product_switch`）
- 禁止 revise 跳过 Prompt Optimizer（Agent 链路铁律）
- 禁止擅自覆盖 confirmed 节点（默认 fork，in-place 要明确指令）
- 禁止 revise 结果 ready 后自动 advance_stage（必须回确认门）
- 禁止 revise 时新建 workflow_run
- 禁止把「重新生成这版」（当前画布已有结果）当 new_task
- 禁止向用户暴露 node_id / superseded / workflow_run / stage 等内部词
