# Product Switch P0 Rule

本规则用于 P0 阶段处理用户在同一个 Agent 对话里切换产品、回到历史产品、或引用历史产品重新生成。

> P0 已从「两槽位（active / previous）」升级为「多产品历史（`content_versions` 列表 + active 指针）」。完整产品规格、给后端约束、调研结论见 `PRD/PRODUCT-HISTORY-PRD.md`。本规则是运行时执行口径，字段定义以 PRD §6 为准。

P0 目标：同对话内**可恢复的多产品历史**，且**容忍但有界**（不鼓励无限堆产品，到阈值引导用户新开 project）。

## 一句话规则

Agent 负责理解用户这句话 + 消歧指向哪个产品；后端负责用 `content_versions` 记住所有产品方向，每轮把 active 全量 + history 摘要喂给 Agent。

## 后端每轮必须提供的上下文

```text
active_product_context（当前主线，全量字段）
- product_name / subject_summary
- product_asset_ids
- asset_understanding
- brief_summary
- selected_skill
- last_stage
- canvas_node_ids

product_history（历史产品方向，仅摘要）
- 每条：subject_summary + status(active|inactive|superseded) + product_asset_ids 数量
- 不含当前 active（active 单独全量喂）
- 不含半成品 Brief（见「写入门槛」）
```

机制保证：产品记忆走后端结构化，**不依赖 LLM 对话压缩**。压缩丢对话流，`content_versions` 纹丝不动。详见 PRD §3。

## 写入门槛

- 一条 `content_version` 在 **Brief confirmed 时**写入 `product_history`。
- 半成品 Brief（未 confirmed）**不进** `product_history`（沿用 `ORCHESTRATION-DECISIONS.md` 决策 1）。已上传图片 asset 保留在画布可复用。
- 探索阶段（传图未确认 Brief）不占历史位。

## 判断分类

### 1. 局部修改

用户只修改当前产品的表现，不算切换产品。

例子：

- 换背景 / 换风格 / 改文案 / 重做这张图
- 保留产品，换场景
- 产品不变，换镜头 / 构图 / 光线

处理：

- 进入普通 revise flow（见 `rules/revise_canvas.md`）。
- 沿用 `active_product_context`。
- 不动 `product_history`，不切 active。

### 2. 同一项目内切换产品

用户明确换产品、人物、服务主体，但仍在当前创作语境继续。

例子：

- 把保温杯换成咖啡机。
- 不做这个产品了，改做耳机。
- 用这个新产品重新做。

处理：

- 将当前 `active_product_context` 移入 `product_history`（标 inactive）（**前提：当前 Brief 已 confirmed**）。
- **Brief 未确认时**：半成品 Brief 文本不保留、不进 `product_history`；已上传图片 asset 保留画布可复用；模型在 `visible_reasoning` 声明废弃 + 下一步，不弹确认。详见 `ORCHESTRATION-DECISIONS.md` 决策 1。
- 用新产品建立新的 `active_product_context`。
- 重新确认 Brief / Skill / 阶段计划，不能只重跑最后的视频或图片。
- 旧内容不删除，但不再作为当前主线。
- **阈值检查**：移入后若 `product_history` 里 `status ≠ superseded` 的方向数达到阈值（意向 3），触发第 6 类阈值引导。

用户可见话术：

```text
好的，我会继续在当前项目中按新的产品方向进行。之前的产品内容会保留，当前画布会以新的产品为主。
```

### 3. 完全不同品类或目标（强推新 project）

用户不只是换产品，还明显改变创作目标或项目类型。

例子：

- 原来做保温杯广告，现在要做招聘宣传片。
- 原来做产品图，现在要做短剧。
- 原来做宠物用品，现在做品牌发布会视频。

处理：

**明确建议新 project**（从「问一下」升级为强推）——这不是同对话多产品，是另一个创作任务：

```text
这是一个全新的创作方向，跟当前项目差别比较大。建议你新建一个项目来做，更好管理。要不要新开一个项目？
```

- 用户同意新 project：创建新 Project / Canvas，从新 Brief 开始。
- 用户坚持留在当前 project：按第 2 类处理（active 进 history，新品变 active），但记录已建议过。

### 4. 回到历史产品

用户想切回之前某个产品方向（N 槽位，可能是历史中任意一个）。

例子：

- 还是用刚才那个保温杯。
- 回到前面的产品。
- 不用咖啡机了，继续做保温杯。
- 切回最早那个耳机。

处理：

- **消歧**：用户语言 + 画布素材（画布全量显示所有产品节点）指向 `product_history` 中某条。用 `subject_summary` 做 name / keyword 匹配。
- **匹配不上 / 歧义**：Agent 在对话流**临时文字列出**当前历史产品方向供用户选（"你这段对话做过：1.保温杯 2.咖啡机，要切哪个？"）。命中即不弹。**不做常驻 UI 组件**。
- 命中后：该条切回 active（status 转 active），当前 active 移入 history（inactive）。
- **切回不主动推进**：只换 active，不替用户决定干啥。用户需求不清时追问（"你想接着上次的进度往下，还是有新的调整？"），搞明白才推进。
- **不重过确认门**（切回产品 Brief / Skill 已 confirmed 存在 content_version），除非用户明说「重新做」。
- 不从零重生成，除非用户明确要求。

用户可见话术：

```text
好的，我会切回这个产品方向。你想接着上次的进度往下，还是有新的调整？
```

### 5. 引用历史产品重新生成

用户不是切回旧产品主线，而是引用历史产品资产做一次新生成（N 槽位，引用历史中任意一个）。

例子：

- 用前面的产品重新生成一张产品图。
- 用刚才那个保温杯再做一张海报。
- 参考之前那个产品，重新出一张图。

处理：

- **消歧**：同第 4 类，语言 + 画布素材匹配 `product_history` 中某条；匹配不上临时列表。
- 从命中的历史产品读取素材和 `asset_understanding`。
- 创建新的 image / video GenerationJob。
- 新结果写成新的 Canvas Node（归属当前 active 产品）。
- 不覆盖历史节点。
- **不切 active**（引用 ≠ 切换），除非用户明确要切。

用户可见话术：

```text
好的，我会用之前那个产品作为参考，重新生成一个新的结果。之前的内容不会被覆盖。
```

### 6. 阈值引导（容忍但有界）

`product_history` 里 `status ≠ superseded` 的方向数达到阈值（意向 3），Agent 软提示一次：

```text
这段对话已经做了几个不同产品方向，新产品要不要新开一个项目单独做？更好管理。
```

- **软提示，不强制**：用户坚持留下，`product_history` 继续 append。
- 具体阈值数值与触发实现由工程评估（意向 3，P1 按真实用户行为校准）。详见 PRD §5.4 / §9。

## 与确认门的关系

- 产品切换不是确认。
- 用户说「继续」不能触发产品切换。
- 产品切换后，后续 Brief / Skill / 分镜 / 视觉仍按确认门停住。
- 确认门只检查当前 `active_product_context` 对应的 ready 节点。
- product_switch 触发时，若当前 `awaiting_confirm` 的 Brief 未 confirmed，半成品 Brief 不进 `product_history`（见第 2 类 + 写入门槛）。

## 禁止

- 禁止把「换产品」当成普通局部重做。
- 禁止只靠聊天记录猜「前面的产品」——必须靠 `product_history` 消歧，匹配不上就追问 / 列列表。
- 禁止删除旧产品素材或旧生成结果。
- 禁止向用户暴露 workflow / stage / run / content_version / version / superseded 等内部词。
- 禁止在产品主体变化后沿用旧 Brief / Skill / 分镜直接生成。
- 禁止鼓励用户在一个对话里无限堆产品（到阈值必须引导新 project）。
- 禁止切回产品后不问就主动推进生成。
