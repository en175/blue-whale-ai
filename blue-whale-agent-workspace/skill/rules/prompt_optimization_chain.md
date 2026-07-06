# Prompt Optimization Chain Rule

本规则定义提示词优化在整个编排里的位置。

## 一句话规则

Prompt Optimizer 是生成前的中间层，只做模型适配，不做创意决策。

## 链路位置

```text
用户需求 / Brief
  -> Skill Selector
  -> Storyboard / Image Prompt
  -> Prompt Optimizer
  -> Provider
  -> Canvas Result
  -> Confirmation Gate
```

## 图片生成链路

```text
Brief
  -> Skill
  -> Image Understanding（如有参考图）
  -> Image Prompt Agent
  -> Prompt Optimizer Agent
  -> Image Provider
  -> image_result
```

## 视频生成链路

```text
Brief
  -> Skill
  -> Storyboard
  -> Image Understanding（如有参考图）
  -> Generation Agent
  -> Prompt Optimizer Agent
  -> Video Provider
  -> video_result
```

## 优化边界

可以优化：

- 生成模型语法
- 素材引用方式
- 主体绑定方式
- 构图和光影表达
- 稳定性约束
- 负面约束
- 简单/复杂提示词结构

不可以优化：

- 用户目标
- 已确认 Brief
- 已确认 Skill
- 已确认脚本
- 已确认分镜
- 产品核心卖点
- 用户要求保留的主体特征

## 输出要求

Prompt Optimizer 每次输出：

```text
目标模型：
生成类型：
使用规则：
最终提示词：
保留的创意约束：
稳定性约束：
风险提醒：
```

## 确认门

提示词优化本身通常不需要用户确认。

但以下情况必须回到用户：

- 参考图含义不清
- 用户要求和 Skill 冲突
- 目标模型能力不足
- 为了稳定性需要删除或大幅改变用户已确认内容

## 禁止

- 禁止直接把用户原话发给 Provider。
- 禁止让 Provider 层重新做创意判断。
- 禁止优化层覆盖 Skill 层。
- 禁止跳过图片理解做图生图。
