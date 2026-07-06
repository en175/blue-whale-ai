# Route Decision Scenarios

测试 Director Agent 是否能选择正确生成链路。

## Scenario 1：直接生成轻量视频

输入：

```text
我想生成一个小猫跑步的视频
```

预期 workflow：

```text
direct_generation
```

必须出现：

- `visible_reasoning`
- `prompt_draft`
- `optimized_prompt`
- `GenerationJob.type = video`
- `canvas node.type = video`
- `canvas node.status = generating / ready`
- `confirmation_gate`

禁止出现：

- `skill_selector`
- `storyboard_agent`
- `stage_plan`
- `full video canvas`

通过标准：

```text
Agent 判断这是轻量视频生成，不进入完整广告编排。
```

## Scenario 2：直接生成商品图

输入：

```text
我想做一张保温杯商品图
```

预期 workflow：

```text
image_generation_prompt
```

必须出现：

- `visible_reasoning`
- `image_task_type = product_image`
- `prompt_draft`
- `optimized_prompt`
- `GenerationJob.type = image`
- `canvas node.type = image`
- `canvas node.status = generating / ready`

禁止出现：

- `storyboard_agent`
- `video_agent_canvas`
- `GenerationJob.type = video`

通过标准：

```text
Agent 不生成脚本，不进入视频分镜。
```

## Scenario 3：图片转视频

输入：

```text
让这张图动起来
```

前置条件：

```text
canvas 有 image asset
```

预期 workflow：

```text
image_understanding -> direct_generation
```

必须出现：

- `asset_understanding`
- `optimized_prompt`
- `GenerationJob.type = video`
- `canvas node.type = video`
- `canvas node.status = generating / ready`

禁止出现：

- 在没有 `asset_understanding` 时直接生成视频
- 直接把 asset id 当图片内容

通过标准：

```text
Agent 先理解图片，再生成图转视频提示词。
```

## Scenario 4：完整 UGC 广告视频

输入：

```text
用这张产品图做一个 15 秒 UGC 广告视频
```

前置条件：

```text
canvas 有 product image asset
```

预期 workflow：

```text
image_understanding -> video_agent_canvas
```

必须出现：

- `asset_understanding`
- `brief`
- `skill_recommendation`
- `stage_plan`
- `storyboard`
- `key_visual` 或 `image_result`
- `GenerationJob.type = video`
- `canvas node.type = video`
- `confirmation_gate`

禁止出现：

- 跳过脚本/分镜直接生成完整视频
- 未确认脚本/分镜就进入 video provider

通过标准：

```text
Agent 判断这是完整广告创作，不走轻量 direct video。
```

## Scenario 5：只优化提示词

输入：

```text
帮我把这个提示词优化成 Seedance 能用的：一只小猫在草地跑步
```

预期 workflow：

```text
prompt_optimizer only
```

必须出现：

- `optimized_prompt`
- `rules_used`
- `risk_note`

禁止出现：

- `Provider`
- `image_result`
- `video_result`

通过标准：

```text
Agent 只优化提示词，不调用生成。
```

## Scenario 6：上传图但没说用途

输入：

```text
用户只上传一张图片，没有文字说明
```

预期 workflow：

```text
ask_user
```

必须出现：

```text
我看到你上传了图片。你想用它做什么？
1. 生成商品图
2. 让图片动起来
3. 做成视频广告
4. 只分析图片内容
```

禁止出现：

- 自动生成图片
- 自动生成视频
- 自动选择 Skill

通过标准：

```text
Agent 不擅自假设用户意图。
```
