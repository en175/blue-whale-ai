# 视频理解（Video Understanding Workflow）

目标：把用户给的视频，转成可供 Director 推断结构配方的理解结果。爆款拆解的前置中间层。

> **输入约定**：用户在对话里直接附视频文件。本地版用 Claude 的多模态能力直接看视频（Claude 能读视频并抽帧理解）。

## 三态（本地版简化）

本地 Claude 自带多模态，按读视频能力分三态（直读 / 抽帧 / 抽帧+口述）：

| 态 | 条件 | 处理 |
|---|---|---|
| `direct_multimodal` | Claude 能直接读视频（默认） | 直接看视频，输出结构信号 |
| `frame_extraction` | 视频可解码但直读吃力 / 只需关键帧 | 自动抽若干关键帧，基于帧理解结构信号，不强制用户口述 |
| `frame_plus_user_narration` | 视频太大 / 格式不支持 / Claude 读不了 | 引导用户口述结构 + 用户手动截几张关键帧发来；基于帧 + 口述推断 |

## 铁律

- **绝不假装看懂**：读不了或看不清时必须说，并标 confidence / uncertainties。
- 不虚构视频里没有的卖点 / 画面。

## 流程

### 步骤 1：读视频

Claude 直接看视频（或用户补的关键帧 + 口述），提取结构信号：钩子候选、叙事节拍候选、卖点候选、CTA 候选、节奏。

### 步骤 2：缺口补充（仅 fallback）

fallback 态下推断不出的部分，只问必要问题：「这片大概讲什么？开头怎么抓人？哪几个卖点？结尾怎么引导？」

## 输出（交给 video-decode-replicate 拆解段）

```text
video_understanding:
- strategy: direct_multimodal / frame_extraction / frame_plus_user_narration
- key_frames: [...]           # 关键帧时间点 + 画面描述
- speech_text: ...            # 口播文本（听得出则填）
- on_screen_text: ...         # 画面文字（看得出则填）
- structural_signals:
    - hook_candidate: ...
    - beat_candidates: [...]
    - selling_point_candidates: [...]
    - cta_candidate: ...
- confidence: high / medium / low
- uncertainties: [...]
```

## 禁止

- 不把视频上传 / 附带等同于视频已理解。
- 不假装看懂了视频。
- 不在 confidence 不足时输出确定性配方而不标 uncertainties。
