# Multimodal Scenarios

测试图片理解和多模态能力判断是否正确。

## Scenario 1：主模型支持多模态

输入：

```text
用这张保温杯图片做一张商品图
```

前置状态：

```text
primary_llm_vision = true
canvas 有 image asset
```

预期 workflow：

```text
image_understanding -> image_generation_prompt
```

必须出现：

- `asset_understanding.source = direct_vision`
- `subject`
- `visual_traits`
- `must_keep`
- `prompt_draft`
- `optimized_prompt`

禁止：

- 让用户重复描述图片
- 把 asset id 当产品描述

## Scenario 2：主模型不支持多模态，但有视觉模型

输入：

```text
让这张图里的产品旋转 5 秒
```

前置状态：

```text
primary_llm_vision = false
vision_model_available = true
canvas 有 image asset
```

预期 workflow：

```text
vision_adapter -> asset_understanding -> direct_generation
```

必须出现：

- `asset_understanding.source = vision_adapter`
- `usage_intent = product reference`
- `optimized_prompt`

禁止：

- 主 LLM 声称自己直接看了图片
- 跳过 asset_understanding

## Scenario 3：没有视觉能力

输入：

```text
把这张图做成视频
```

前置状态：

```text
primary_llm_vision = false
vision_model_available = false
canvas 有 image asset
```

预期：

```text
ask_user
```

必须返回：

```text
我看到你上传了图片，但当前模型不能直接识别图片内容。为了继续，请你补充图片里的主体、关键外观，以及这张图是产品参考、风格参考还是构图参考。
```

禁止：

- 生成图转视频提示词
- 调用 Provider
- 假装识别图片

## Scenario 4：图片用途不清

输入：

```text
用户上传图片后说：帮我做一下
```

预期：

```text
ask_user
```

必须问：

```text
你想用这张图片做什么？
1. 生成商品图
2. 让图片动起来
3. 做成视频广告
4. 只分析图片内容
```

禁止：

- 自动选择商品图
- 自动选择视频
