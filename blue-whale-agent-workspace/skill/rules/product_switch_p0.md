# Product Switch P0 Rule

本规则用于 P0 阶段处理用户在同一个 Agent 对话里切换产品、回到前一个产品、或引用前一个产品重新生成。

P0 目标不是完整版本系统，而是稳定支持两个产品方向：

- `active_product_context`
- `previous_product_context`

## 一句话规则

Agent 负责理解用户这句话；后端负责记住当前产品和前一个产品。

## P0 后端必须提供的上下文

每轮 Agent turn 至少提供：

```text
active_product_context
- product_name / subject_summary
- product_asset_ids
- asset_understanding
- brief_summary
- selected_skill
- last_stage
- canvas_node_ids

previous_product_context
- product_name / subject_summary
- product_asset_ids
- asset_understanding
- brief_summary
- selected_skill
- last_stage
- canvas_node_ids
```

如果没有 `previous_product_context`，用户说“前面的产品 / 刚才那个”时必须追问确认，不能猜。

## 判断分类

### 1. 局部修改

用户只是修改当前产品的表现，不算切换产品。

例子：

- 换背景
- 换风格
- 改文案
- 重做这张图
- 保留产品，换场景
- 产品不变，换镜头 / 构图 / 光线

处理：

- 进入普通 revise flow（见 `rules/revise_canvas.md`）。
- 沿用 `active_product_context`。
- 不切换 active / previous。

### 2. 同一项目内切换产品

用户明确换产品、人物、服务主体，但仍在当前创作语境中继续。

例子：

- 把保温杯换成咖啡机。
- 不做这个产品了，改做耳机。
- 当前项目改成宠物饮水机。
- 用这个新产品重新做。

处理：

- 将当前 `active_product_context` 移入 `previous_product_context`。
- 用新产品建立新的 `active_product_context`。
- 重新确认 Brief / Skill / 阶段计划，不能只重跑最后的视频或图片。
- 旧内容不删除，但不再作为当前主线。

用户可见话术：

```text
好的，我会继续在当前项目中按新的产品方向进行。之前的产品内容会保留，当前画布会以新的产品为主。
```

禁止说：

- 替换
- 覆盖
- workflow
- stage
- run
- superseded

### 3. 完全不同品类或目标

用户不只是换产品，还明显改变创作目标或项目类型。

例子：

- 原来做保温杯广告，现在要做招聘宣传片。
- 原来做产品图，现在要做短剧。
- 原来做宠物用品，现在做品牌发布会视频。

处理：

先问用户，不直接推进：

```text
这是一个新的产品方向。你想继续在当前项目中进行，还是新建一个项目？
```

如果用户选择继续在当前项目中进行：

- 按“同一项目内切换产品”处理。

如果用户选择新建项目：

- 创建新的 Project / Canvas。
- 从新 Brief 开始。

### 4. 回到前一个产品

用户想切回前一个产品方向。

例子：

- 还是用刚才那个保温杯。
- 回到前面的产品。
- 不用咖啡机了，继续做保温杯。

处理：

- 将 `previous_product_context` 切回 active。
- 当前 active 移入 previous。
- 画布和后续生成默认以恢复后的 active 产品为准。
- 不从零重生成，除非用户明确要求重新生成。

用户可见话术：

```text
好的，我会切回之前那个产品方向。当前项目会继续保留其他产品内容，你之后也可以再切回来。
```

### 5. 引用前一个产品重新生成

用户不是切回旧产品主线，而是引用历史产品资产做一次新生成。

例子：

- 用前面的产品重新生成一张产品图。
- 用刚才那个保温杯再做一张海报。
- 参考之前那个产品，重新出一张图。

处理：

- 从 `previous_product_context` 读取产品素材和 `asset_understanding`。
- 创建新的 image / video GenerationJob。
- 新结果写成新的 Canvas Node。
- 不覆盖历史节点。
- 是否切换 active 产品方向，按用户语义判断；不明确时保持当前 active 不变。

用户可见话术：

```text
好的，我会用之前那个产品作为参考，重新生成一个新的结果。之前的内容不会被覆盖。
```

## 与确认门的关系

- 产品切换不是确认。
- 用户说“继续”不能触发产品切换。
- 产品切换后，后续 Brief / Skill / 分镜 / 视觉仍要按确认门停住。
- 确认门只检查当前 `active_product_context` 对应的 ready 节点。

## 禁止

- 禁止把“换产品”当成普通局部重做。
- 禁止只靠聊天记录猜“前面的产品”。
- 禁止删除旧产品素材或旧生成结果。
- 禁止向用户暴露 workflow / stage / content_version / superseded 等内部词。
- 禁止在产品主体变化后沿用旧 Brief / Skill / 分镜直接生成。
