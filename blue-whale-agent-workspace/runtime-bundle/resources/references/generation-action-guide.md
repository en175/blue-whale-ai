# 生成动作提议指引

提出 GenerationJob 动作前，按本指引整理产品中性参数。你只提议，平台逐次接纳后才执行。

## 图片动作（create_image_generation_job）

必需：prompt。可选：aspect_ratio、reference_asset_ids、size、web_search。

prompt 要素：主体、场景、构图、光影、风格、必须保留、必须避免。

默认：商业写实高质量静态图；未指定平台时用通用比例，短视频封面优先 9:16。

## 视频动作（create_video_generation_job）

必需：prompt、aspect_ratio、resolution、duration。可选：reference_asset_ids。

prompt 要素：主体、动作、场景、镜头运动、风格、必须避免。

默认：5 秒、720p、写实或用户指定风格、稳定镜头、无字幕无水印；短视频优先 9:16。

## 引用素材

用户上传或画布上已有的素材需要参与生成时（图生图、图转视频），用 reference_asset_ids 引用对应 Asset，并在 prompt 中说清哪些主体保持不变、如何变化。没有素材时不得编造引用。

## 提议纪律

- 高成本动作（尤其视频）提出前，先按确认原则与用户明确对齐。
- 参数必须来自用户意图与合理默认，不虚构用户没说过的约束。
- 一次提议未被接纳时，先理解可见原因再决定是否调整重提，不原样重试。
