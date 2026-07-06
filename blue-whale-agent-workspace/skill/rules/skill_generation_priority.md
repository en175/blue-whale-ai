# Skill And Generation Priority Rule

本规则用于处理“用户选择的创作 Skill”和“Seedance 生成提示词规则”之间的关系。

## 一句话规则

Skill 决定创意；Seedance 决定语法。两者不冲突，不能互相替代。

## 分层优先级

| 层级 | 决定什么 | 例子 |
|---|---|---|
| 用户需求 | 最终目标 | 做一个保温杯 UGC 广告 |
| 创作 Skill | 内容结构和表现形式 | UGC、TVC、短剧、测评、产品展示 |
| Workflow | 阶段顺序和确认门 | Brief -> Skill -> 分镜 -> 首图 -> 视频 |
| Canvas 状态 | 是否能推进 | ready、generating、awaiting_confirm |
| Seedance 规则 | 生成提示词语法 | `@图片1`、`<主体1>`、一镜一运镜、稳定约束 |

## 不冲突的原因

创作 Skill 回答：

```text
这个视频应该怎么讲、怎么卖、用什么内容结构？
```

Seedance 规则回答：

```text
把已确认的内容结构翻译成模型更容易执行的提示词，应该怎么写？
```

所以 Seedance 不是另一个创作 Skill，它是生成阶段的“模型适配层”。

## Skill 来源与选择

Agent 在判定这一条 turn 用哪个创作 Skill 时,按以下来源与优先级:

| 优先级 | 来源 | 处理 |
|---|---|---|
| 1(最高) | `forced_skill_id`(用户手动 Use) | 必须使用此 skill,跳过候选筛选 |
| 2 | auto 候选池(`auto=true` 的已添加 skill) | Agent 按上下文 + Brief 匹配度自选最合适的一个 |
| 3 | 未指定 | 见下方「未指定时的分流」 |

### 未指定时的分流（轻量 vs Full Canvas）

Skill 库目前 60 个全是视频广告 / 电商向,**无通用生图 Skill**。因此未指定时按 Agent L1 轻量 classifier(haiku 级,见 `decision_layer.md`)的分流区别处理:

| 分流 | Skill 处理 |
|---|---|
| **轻量编排**(简单图 / 轻量视频) | **有匹配则用,无匹配跳过 Skill 直接优化提示词**——不强依赖 Skill,不反问。例:「生成一张猫图」无匹配 Skill,跳过,直接优化提示词生成。 |
| **Full Canvas**(广告 / UGC / 短剧) | CEO 路由按 Brief 推断 Skill;推断置信度低时反问用户,不擅自选、不默认兜底。 |

### forced 与 auto 共存

- 用户 Use 了 skill A,而 skill B/C 处于 auto=on:本 turn **只用 A**,B/C 不参与。
- forced 是一次性指令,**不修改** A 的 auto 状态,也不持久化成 auto。
- forced 的 skill 若与已确认 Brief 冲突:以用户本次明确选择为准(等同用户确认切换),并提示用户内容方向将变化。

### auto 候选池为空

- 用户既没 Use、auto 池也空:按上方「未指定时的分流」处理——轻量编排无匹配 Skill 时跳过直接优化提示词;Full Canvas 推断置信度低时反问,不默认兜底成某个固定 skill。

## 冲突处理

### 情况 1：Skill 风格和 Seedance 默认词冲突

例如用户选择 UGC，但 Seedance 默认补了“电影质感”。

处理：
- 保留 UGC 的手机原生、自然光、不完美构图。
- Seedance 只补稳定性表达，例如“画面稳定、人物不变形、无水印”。
- 不把画面改成高端 TVC。

### 情况 2：Skill 要多镜头，Seedance 简单路径不够

处理：
- 保留 Skill 的多镜头结构。
- 使用 Seedance 路径 B 三段论表达。

### 情况 3：Skill 需要真实社交感，但 Seedance 约束要求稳定

处理：
- 真实感保留在场景、动作和画面语气里。
- 稳定约束只用于防止人物变形、Logo、水印、字幕和重复人物。

### 情况 4：用户选择 Skill 后又上传素材

处理：
- Skill 仍决定创作结构。
- 素材按 Seedance 规则映射成 `@图片N` / `<主体N>`。
- 不能因为素材风格不同就自动换 Skill，除非用户确认。

## 生成阶段必须遵守

1. 不改变已确认 Brief。
2. 不改变已确认 Skill。
3. 不改变已确认脚本和分镜。
4. 只做模型语法级优化。
5. 关键歧义必须回到用户确认。

## 禁止

- 禁止把 Seedance 参考当成创意路线。
- 禁止用 Seedance 默认风格覆盖用户选择的 Skill。
- 禁止为了提示词稳定性删除用户确认过的核心卖点。
- 禁止在用户未确认时从 UGC 切换到 TVC、从产品广告切换到短剧。
