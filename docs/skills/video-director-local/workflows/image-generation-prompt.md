# 生图编排（Image Generation Prompt Workflow）

目标：把用户的图片生成需求转成可复制到生图工具的提示词。

## 适用判断（Director 自主）

- 用户要做产品图、商品图、海报图、关键帧、风格图
- full-canvas 进入首批关键视觉
- 用户要求图生图、换背景、换场景、改风格

## 流程

| 步骤 | 名称 | 执行者 | 产物 | 确认 |
|---|---|---|---|---|
| 1 | 判断图片任务类型 | Director | image_task_type | 否 |
| 2 | 资产理解检查 | image-understanding | asset_understanding | 必要时 |
| 3 | 生图提示词草案 | image-prompt | prompt_draft | 否 |
| 4 | 提示词优化 + 交付 | prompt-optimizer | 生图提示词卡 | 否 |
| 5 | 自检 | review | 审核摘要 | 自动 |

### 步骤 1：判断图片任务类型

Director 自主判断：文生图 / 图生图 / 产品图 / 关键帧 / 风格图 / 场景图 / 局部重做。

### 步骤 2：资产理解检查

任务依赖图片时必须先有 asset_understanding。没有则进入 image-understanding（`agents/image-understanding.md`）。

### 步骤 3：生图提示词草案

image-prompt agent 输出：主体、场景、构图、光影、风格、必须保留、必须避免、prompt_draft。

### 步骤 4：提示词优化 + 交付

prompt-optimizer 优化（只允许提高清晰度、补构图光影、加稳定约束、规范素材引用、加负面约束；不允许改 Skill / 产品外观 / 核心卖点 / 已确认风格），按生图提示词卡格式输出（按图编号，标注「将用于：镜头N」，格式见 `../references/generation-action-guide.md`）。**本地版到此为止**。

### 步骤 5：自检

**生图提示词卡交付后自动进自检，不等用户指令**（对齐 `full-canvas-creation.md` 阶段 4→5 自动续跑铁律）。review 检查提示词对齐 + 可复制性。

## 禁止

- 不在缺少图片理解时执行图生图。
- 不直接把用户一句话当最终提示词（要走草案 → 优化）。
- 不跳过提示词优化层。
- 分镜重排（增删镜头 / 调顺序）后，必须回写所有已交付生图卡的「将用于：镜头N」标注，与终版分镜对齐；不遗留错位标注。
- 不调用生图 API（本地版止于提示词）。
