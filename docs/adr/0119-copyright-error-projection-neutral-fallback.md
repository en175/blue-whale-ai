# 版权类拒绝的错误投影：中性兜底文案 + 输出侧音频精确码

上游（火山方舟 Seedance 系）的版权类拒绝经 worker `NewApiErrorClassifier` 按 `copyright|版权` 关键词统一归入 1038 `content_rejected_reference`，投影层文案写死「参考内容可能涉及版权限制」（IKFL53 口径）。该口径自始错位：判定从不看任务有无参考素材，IKFL53 首例（job 2048）就是输出侧视频拒绝；2026-09-30 样片 3239（文生视频、无参考、generate_audio=true）被上游以 `OutputAudioSensitiveContentDetected.PolicyViolation` 拒绝——官方释义「生成的音频可能涉及版权限制，请您更换输入内容后重试」——用户却看到「参考内容…」的提示，错误归因导致困惑。

**决定**：① 1038 错误码与数值不变，文案改为中性兜底「生成内容可能涉及版权限制，请调整提示词或素材后重试」（投影层运行时查码表，存量任务自动获得新文案）；② Java worker `NewApiVideoClient` poll 终态路径在版权关键词判断**之前**加前置分支：命中官方错误码 `OutputAudioSensitiveContentDetected` 或 message 含 `"output audio"` → 新错误码 `content_rejected_audio`（数值码 1059），文案对齐官方释义「生成的音频可能涉及版权限制，请调整提示词后重试」；③ TS 侧 `error-codes.ts` 同步加字符串码/数值码/文案并放行投影白名单。

**明确不做**：TS 侧分类器不动（图片链路无音频场景）；`OutputVideo`/输入侧 `InputImage`/`InputText` 不配精确文案（统一走中性兜底）；IKFL53 优先级链（版权 > 内容政策 > 额度 > 兜底）不变；图片链路 copyright 归 1018 的既有不一致保持现状（如需拉平另立单）。

**理由**：优先信官方错误码名（确证信号）而非关键词猜测——上游官方 taxonomy 本就分输入/输出侧，精确映射只在能确证的场景做（本期仅输出侧音频，generate_audio 默认开启使其为最高频踩坑点）；其余版权信号无法区分参考/输出归因，中性文案保证任何场景下都不再错误归因，优于精确的错。前端只消费投影 msg、无错误码特判，改文案/加码对前端零适配。
