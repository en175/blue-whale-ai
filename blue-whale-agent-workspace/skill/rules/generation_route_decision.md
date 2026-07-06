# Generation Route Decision Rule

本规则定义用户要生成图片或视频时，CEO 应该选择哪条链路。

## 一句话规则

先判断用户要的是“直接生成一个结果”，还是“做一个可分阶段创作的视频项目”。

## 四条生成链路

| 链路 | 适用 | Workflow |
|---|---|---|
| Direct Image | 直接生成图片、商品图、风格图 | `image_generation_prompt.md` |
| Direct Video | 直接生成轻量视频 | `direct_generation.md` |
| Image-to-Video | 让上传图动起来、简单图转视频 | `direct_generation.md` + `image_understanding.md` |
| Full Video Canvas | 广告片、UGC、短剧、复杂营销视频 | `video_agent_canvas.md` |

## 路由判断

### 走 Direct Image

用户说：

- 生成一张图
- 做一张产品图
- 换背景
- 做海报图
- 做关键帧
- 做风格参考图

并且不要求完整视频编排。

### 走 Direct Video

用户说：

- 生成一个小猫跑步的视频
- 做一个女孩跳舞的视频
- 生成一个赛博朋克城市镜头
- 做一个 5 秒产品旋转视频

特点：

- 主体和动作较清楚
- 不需要广告策略
- 不需要多阶段脚本
- 可以一次生成后确认

### 走 Image-to-Video

用户说：

- 让这张图动起来
- 让图片里的产品旋转
- 让这个人物眨眼
- 把这张图做成 5 秒视频

要求：

- 必须先有 `asset_understanding`
- 如果不能识别图片，先问用户补充

### 走 Full Video Canvas

用户说：

- 做一个产品广告视频
- 做一个 UGC 种草视频
- 做一个短剧广告
- 做一条品牌宣传片
- 需要脚本、分镜、素材、视频
- 需要多版本、多阶段确认

特点：

- 涉及营销策略
- 涉及 Skill 选择
- 需要脚本/分镜
- 需要关键视觉和确认门

## Prompt-only 链路

如果用户只是说：

- 优化这个提示词
- 帮我改成 Seedance 能用的提示词
- 帮我把这个图生视频 prompt 写好

则只走 Prompt Optimizer，不调用 Provider。

## 用户上传图片但没说用途

不要自动生成。

应该问：

```text
我看到你上传了图片。你想用它做什么？
1. 生成商品图
2. 让图片动起来
3. 做成视频广告
4. 只分析图片内容
```

## visible_reasoning 示例

### Direct Video

```text
我理解你想直接生成一个轻量视频，不需要完整广告编排。我会先整理主体、动作和场景，再优化成模型可执行提示词。
```

### Full Video Canvas

```text
这个需求更像完整视频创作，需要先确认 Brief、选择 Skill，再进入脚本分镜和生成阶段。
```

## 禁止

- 禁止把所有视频需求都强制走完整广告链路。
- 禁止把复杂广告视频当成一句 prompt 直接发给 Provider。
- 禁止用户上传图后自动假设用途。
- 禁止跳过图片理解做图转视频。
