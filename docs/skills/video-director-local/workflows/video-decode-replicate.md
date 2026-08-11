# 视频拆解与复刻（Video Decode & Replicate Workflow）

目标：把一条视频拆解成结构配方，再按用户选定的复刻度，用新产品素材复刻出同结构 / 同方法论的新视频提示词。**本地版止于分镜脚本 + 提示词**，不生成视频。

> 面向用户话术保留「爆款拆解」；workflow 命名中性化。

## 两大阶段

1. **拆解阶段**：视频 → video-understanding → 结构配方（`../references/structure-recipe-spec.md`）
2. **复刻阶段**：配方 + 产品 → 现有创作链路（brief → skill-selector → storyboard → prompt-optimizer → review）

中间是**复刻决策门**。

## 拆解阶段

### 步骤 1：视频理解

进入 `video-understanding.md`，拿到 video_understanding。绝不假装看懂，confidence 不足标 uncertainties。

### 步骤 2：推断结构配方

Director 基于 video_understanding 推断配方：从 structural_signals 提炼 hook / beats / selling_points / pacing / cta；pattern 收敛一个（对齐 Skill 库分类，便于复刻直推）；填 meta。

### 步骤 3：拆解报告（人读）

```text
这片子的结构我看下来是：
- 钩子：{type}，{content}（{timing}）
- 叙事：{pattern}，{beats 概述}
- 卖点：{卖点1}（{evidence_type}）、{卖点2}…
- 节奏：{overall}，能量集中在{哪拍}
- 转化：{CTA}（{timing}）

我不确定的点：{uncertainties}（如有）
```

## 复刻决策门（确认门）

Director 呈现拆解报告后，停住让用户确认 + 做三个决策：

1. **确认拆解准确**：用户认可配方（或纠正 uncertainties）。
2. **选复刻度**：
   - `replicate_faithful`（照搬结构换素材）：beats 顺序 / 时长 / 意图不变，只换产品。
   - `replicate_method`（提取方法论差异化）：保留 pattern + 「有证据支撑 / 强钩子 / 节奏服务叙事」原则，beats 可重组、钩子可换 type、节奏可调。
3. **绑定产品素材**：用户提供新产品图 / 描述 → image-understanding（`agents/image-understanding.md`）出 product understanding。

> **版权提示**：呈现复刻度选项时，`replicate_faithful` 的选项说明内静态自带一句：`⚠️ 照搬结构有原创度风险，请确认已获授权或自担风险`。不判商用、不询问商用属性、不弹窗、不二次确认——用户看到提示仍选 faithful 并确认 = 已知情自担。

## 复刻阶段

配方 + 产品理解就位后，进入现有创作链路（agents 复用，切 input_mode）：

| 步骤 | agent            | input_mode                            | 动作                                                               |
| ---- | ---------------- | ------------------------------------- | ------------------------------------------------------------------ |
| 1    | brief            | replicate                             | 从配方 + product understanding 预填 Brief                          |
| 2    | skill-selector   | replicate_faithful / replicate_method | 照搬→高置信直推 pattern 对应 Skill + 告知；差异化→多候选开放问方向 |
| 3    | storyboard       | replicate_faithful / replicate_method | 照搬→照抄 beats 换产品；差异化→pattern 作约束自主生成              |
| 4    | prompt-optimizer | （零改造）                            | 出可复制提示词交付包                                               |
| 5    | review           | replicate                             | 对照配方检查保留度                                                 |

> **呈现铁律（B7）**：复刻链路两处「一句话告知」必须出现在**用户可见对话**（流式大白话段落），收进思考摘要即断点——用户看不到「为什么直接定了这个 Brief / 这个 Skill」就无从纠正，推断+确认可纠机制失效。
> - **Brief 预填告知**（步骤 1）：Brief 卡呈现前后一句「Brief 已按原片配方预填，对照卡片确认」（Brief 卡顶模式条是可见性兜底，口头告知不可省）。
> - **Skill 直推告知**（步骤 2 照搬）：一句说清直推了哪个 Skill、为什么（如「按原片的痛点解决结构，直接套用 XX Skill」）。
> 思考摘要只放方向判断（为谁 / 做什么 / 走到哪），不替代上述告知。

### 两复刻度对 storyboard 的影响

- **照搬（replicate_faithful）**：storyboard 几乎照抄配方 beats——每个 beat 的顺序 / 时长 / 意图不变，画面内容换成当前产品；钩子同 type 换内容；卖点同序同 evidence_type。Skill 高置信直推 + 一句话告知。
- **差异化（replicate_method）**：storyboard 用 pattern 作约束自主生成——保留「强钩子 / 有证据支撑的卖点 / 节奏服务叙事」原则，beats 可重组、钩子可换 type、节奏可调；Skill 多候选开放问方向，不二选一。

## 多轮漂移防护

- 配方 / 复刻决策在对话内维护，不跨会话持久化。**用户新会话直接说「复刻上次那个」、本会话无配方时**：先告知「配方不跨会话保存，这次不在本会话里」，引导重发原视频重新拆解、或重新描述需求走普通创作——不假装记得配方、不凭空编。
- 主体 / 目标变了 = 新任务，不沿用旧链路。
- 接受偶尔误判，靠用户纠正。

## 禁止

- 不在 confidence 不足时假装拆解准确。
- 不把镜头语言 / BGM / 情绪曲线写进配方（颗粒度锁在结构配方级）。
- 不跳过复刻决策门直接复刻。
- 照搬模式下擅自改变配方结构（换结构须切差异化并经用户确认）。
- 不调用生成 API（本地版止于分镜 + 提示词）。
