# 结构配方规范（Structure Recipe Spec）

本文件定义「爆款拆解」产出的结构配方的机读 schema。配方是**结构配方级**颗粒度：钩子 + 叙事 + 卖点 + 节奏 + 转化点，**不做**镜头语言（推拉摇移）/ BGM / 情绪曲线数值。

> 本地版无画布：配方在**对话内维护**，不跨会话持久化。多轮复刻靠对话上下文恢复。

## 顶层结构

```yaml
recipe:
  hook: { ... }
  narrative_structure: { ... }
  selling_points: [...]
  pacing: { ... }
  cta: [...]
  meta: { ... }
```

## hook（钩子）

开头抓注意力的机制。

| 字段    | 说明                                                                                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| type    | 钩子类型枚举：`pain_point`（痛点）/ `visual_shock`（视觉冲击）/ `question`（提问）/ `suspense`（悬念）/ `comparison_tease`（对比预告）/ `direct_assertion`（直接断言） |
| content | 钩子具体内容（人读）                                                                                                                                                   |
| timing  | 出现时间（如 `0-3s`）                                                                                                                                                  |

## narrative_structure（叙事结构）

| 字段           | 说明                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| pattern        | 叙事模式枚举（见下表，对齐 Creative Skill 库分类，复刻时直推对应 Skill）                               |
| beats[]        | 按时间轴的节拍，每项含 `label`（节拍名）/ `intent`（这拍要达成什么）/ `timing`（时间区间）/ `duration` |
| total_duration | 总时长                                                                                                 |

### pattern 枚举与 Skill 库对齐

| pattern            | 含义                | 复刻可直推的 Creative Skill（参考，见 library/_index.md）       |
| ------------------ | ------------------- | --------------------------------------------------------------- |
| `problem_solution` | 痛点 → 方案 → 证据  | pain-point / problem-solution-commercial                        |
| `before_after`     | 前后对比可见改善    | before-and-after / before-and-after-video                       |
| `demo_first`       | 先演示产品功能      | fast-product-demo / product-in-use / product-display            |
| `story_driven`     | 情绪叙事 / 日常仪式 | story-driven / micro-drama / emotional-short-drama              |
| `list_benefits`    | 逐条罗列卖点 / USP  | fast-paced-usp / overlay                                        |
| `testimonial`      | 口碑 / 评论 / 推荐  | review-testimonial / selfie-testimonial / friend-recommendation |
| `unboxing`         | 开箱 / 揭秘         | unboxing-to-demo / unboxing-video / mystery-box                 |
| `tutorial`         | 教程 / 技巧         | how-to-tutorial / tutorial-video / secret-hack-reveal           |
| `drama_reversal`   | 剧情反转 / 权力逆转 | revenge-power-reversal / social-argument-twist / comedy-plot    |

> Skill 名称对应 `library/raw/` 下的文件；复刻时 skill-selector 按此候选直推 + 告知（照搬）或开放问方向（差异化）。

## selling_points[]（卖点）

每条卖点：

| 字段          | 说明                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| point         | 卖点内容（人读）                                                                                       |
| evidence_type | 证据类型：`visual`（视觉展示）/ `verbal`（口播陈述）/ `comparison`（对比）/ `before_after`（前后对比） |
| evidence      | 证据具体内容                                                                                           |
| timing        | 出现时间                                                                                               |

## pacing（节奏）

| 字段           | 说明                                             |
| -------------- | ------------------------------------------------ |
| overall        | 整体节奏：`fast` / `medium` / `slow`             |
| cut_density    | 切镜密度（每分钟镜头数，或 `快 / 中 / 慢` 档位） |
| energy_curve[] | 节拍级能量曲线，每项 `{beat_label, energy: 1-5}` |

## cta[]（转化点）

每条 CTA：

| 字段    | 说明                                                                           |
| ------- | ------------------------------------------------------------------------------ |
| type    | 类型：`buy`（购买）/ `follow`（关注）/ `interact`（互动）/ `brand`（品牌沉淀） |
| content | CTA 内容                                                                       |
| timing  | 出现时间                                                                       |
| primary | 是否主转化点（布尔）                                                           |

整条配方有且仅有 1 条 `primary: true` 的 CTA。

## meta（元信息）

| 字段            | 说明                                                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| source_video    | 源视频（用户提供的本地文件名或描述）                                                                                                          |
| decode_method   | 拆解方式：`direct_multimodal`（Claude 直接看视频）/ `frame_extraction`（抽帧理解，无需用户口述）/ `frame_plus_user_narration`（抽帧 + 用户口述） |
| confidence      | 整体置信度：`high` / `medium` / `low`                                                                                                         |
| uncertainties[] | 不确定点（无法确证的推断，需向用户确认）                                                                                                      |

## 完整示例（节选）

```yaml
recipe:
  hook:
    type: pain_point
    content: 「夏天出门保温杯装冰水，两小时就化了」痛点开场
    timing: 0-3s
  narrative_structure:
    pattern: problem_solution
    beats:
      - { label: 痛点, intent: 引发共鸣, timing: 0-3s, duration: 3s }
      - { label: 方案, intent: 引出保温杯, timing: 3-8s, duration: 5s }
      - { label: 证据, intent: 6小时仍冰冷实测, timing: 8-18s, duration: 10s }
      - { label: CTA, intent: 引导购买, timing: 18-20s, duration: 2s }
    total_duration: 20s
  selling_points:
    - {
        point: 6小时保冷,
        evidence_type: before_after,
        evidence: 实测冰块前后对比,
        timing: 8-18s,
      }
  pacing:
    overall: fast
    cut_density: medium
    energy_curve:
      - { beat_label: 痛点, energy: 4 }
      - { beat_label: 方案, energy: 3 }
      - { beat_label: 证据, energy: 5 }
      - { beat_label: CTA, energy: 4 }
  cta:
    - { type: buy, content: 「点击下方链接」, timing: 18-20s, primary: true }
  meta:
    source_video: 用户上传的保温杯爆款片段
    decode_method: direct_multimodal
    confidence: high
    uncertainties: []
```

## 约束

- 颗粒度锁在结构配方级：不写镜头语言（推拉摇移）、不写 BGM、不写情绪曲线数值；只写「这拍要达成什么意图 + 什么节奏 + 什么证据」。
- `confidence` 非 `high` 时必须填 `uncertainties`，复刻决策门向用户披露并确认。
- 配方在对话内有效，不跨会话持久化。
