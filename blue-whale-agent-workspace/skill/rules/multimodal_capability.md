# Multimodal Capability Rule

本规则定义系统如何判断和使用图片识别能力。

## 一句话规则

上传图片不等于 Agent 看懂图片；必须确认系统具备视觉能力，或让用户补充图片描述。

## 三种能力状态

### 1. direct_vision

主 LLM 支持图片输入。

处理方式：

- 直接把图片交给主 LLM。
- 生成 asset_understanding。
- 后续 Agent 使用结构化摘要。

### 2. vision_adapter

主 LLM 不支持图片，但系统配置了独立视觉模型。

处理方式：

- 视觉模型先识别图片。
- 输出结构化摘要。
- 主 LLM 只读取摘要，不声称自己直接看图。

### 3. ask_user

没有任何可用视觉模型。

处理方式：

- 告诉用户当前无法直接识别图片。
- 只问当前任务必要的图片描述。
- 用用户描述生成 asset_understanding。

## 必须保存的结果

无论哪种方式，都要生成 `asset_understanding`：

```text
asset_id
source
understanding_status
subject
visual_traits
scene
text_or_logo
usage_intent
must_keep
can_change
uncertainties
```

## 用户可见话术

### 可识别

```text
我看到你上传了图片。我会先提取图片里的主体、外观和可保留特征，再继续生成。
```

### 不可识别

```text
我看到你上传了图片，但当前模型不能直接识别图片内容。为了继续，请你补充图片里的主体、关键外观，以及这张图是产品参考、风格参考还是构图参考。
```

## 禁止

- 禁止用文件名推断图片内容。
- 禁止主 LLM 不支持多模态时假装看过图片。
- 禁止没有 asset_understanding 就做图生图。
- 禁止把 asset id 直接当成产品描述。
