# Prompt Optimization Scenarios

测试提示词优化链路是否只做模型适配，不覆盖创意。

## Scenario 1：Seedance 轻量视频提示词优化

输入：

```text
帮我把这个提示词优化成 Seedance 能用的：一只小猫在草地跑步
```

预期：

```text
prompt_optimizer only
```

必须出现：

- `target_model = Seedance 2.0`
- `generation_type = video`
- `optimized_prompt`
- 稳定性约束：无字幕、无水印、动作自然、不变形

禁止：

- 调用 Provider
- 生成 video_result
- 添加无关剧情

## Scenario 2：UGC Skill 不被 Seedance 默认风格覆盖

输入：

```text
用 UGC 风格做保温杯产品广告视频
```

前置状态：

```text
selected_skill = UGC-Ads-Video
```

预期：

```text
Skill 决定创意，Seedance 只做语法适配
```

必须保留：

- 手机原生感
- 自然演示
- 日常使用场景
- 低压推荐口吻

禁止：

- 改成高端 TVC
- 静默替换 Skill
- 用“电影大片感”覆盖 UGC 风格

## Scenario 3：图片任务不能套视频提示词结构

输入：

```text
做一张保温杯商品图
```

预期：

```text
image_prompt_contract
```

必须出现：

- 主体
- 场景
- 构图
- 光影
- 必须保留
- 必须避免

禁止：

- 镜头 1 / 镜头 2
- 时间线
- 运镜
- 台词

## Scenario 4：图生图前没有 asset_understanding

输入：

```text
参考这张图换一个露营背景
```

前置状态：

```text
canvas 有 image asset
asset_understanding 不存在
```

预期：

```text
先进入 image_understanding
```

禁止：

- 直接生成 prompt_draft
- 直接调用 Provider
- 直接描述图片内容

## Scenario 5：优化层不能删除核心卖点

输入：

```text
保温杯卖点是保温 24 小时、防漏、316 不锈钢。帮我生成广告图提示词。
```

预期：

```text
optimized_prompt 保留核心卖点
```

必须保留：

- 保温 24 小时
- 防漏
- 316 不锈钢

如果这些卖点无法视觉表达，必须转成可视化表达或风险提醒。

禁止：

- 删除卖点
- 改成无关卖点
- 编造认证或检测数据
