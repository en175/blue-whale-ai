# 图片高清放大接入火山 AI MediaKit：经 new-api 网关既有 MediaKit 渠道、版本档映射 Lite/Pro/Max、本期免费、源卡连线纯视觉

画布图片素材卡新增「高清放大」入口，供应商为火山引擎 AI MediaKit 图像画质增强。调用不经我们后端直连火山，而是走 blue-whale-api 网关的既有 MediaKit 渠道（同步路由 `POST /v1/mediakit/sync/enhance-image`，对客模型名 `mediakit-enhance-image`）：网关持有上游凭证（渠道 key 字段），请求与响应体原样透传，执行侧携带用户 sk- 调用，与图片生成经网关的链路同构。面板上「模型」下拉的三档展示名 Lite / Pro / Max 分别映射 MediaKit 的 standard / professional / max 三个 tool_version，默认 Pro；放大倍数固定 2/4/6 三档，不开放 API 支持的 1~30 任意倍率；增强策略与色彩校正作为高级参数暴露，版本不支持时置灰并悬停说明。源图尺寸门槛（standard 长边 ≤2160px、professional 短边 ≥256px、max 宽高比 ≤32）由前端在打开面板时预检，不满足的版本档置灰。本期高清放大不显示积分预估也不实际扣费：网关上 `mediakit-enhance-image` 的 model_price 配为 0（网关同步工具未配价会被硬拦 400，免费形态是配零价而非不配价），本仓不写成本预留，沿用 media_extract 免费工具先例；预估展示与按档计费后续单独工单一起补。源卡与高清卡之间的连线仅表达来源关系，不参与参考计数与 @ 编号；高清卡记住自身身份，其「重新编辑」始终打开高清放大面板，结果填回本卡而非源卡。

## Considered Options

- 设计稿中的 Topazlabs 作为供应商：设计稿为占位，实际接入只有火山 AI MediaKit 一家；供应商级下拉保留但只有 MediaKit 一项，未来接第二家时自动出现，当前不做 Topazlabs 任何接入。
- 开放 1~30 任意倍率：API 支持且 professional/max 上限 30 倍，但设计稿固定 2/4/6 已覆盖主流诉求，任意倍率引入输入校验与超分辨率上限的额外复杂度，否决。
- 本期即扣积分（只不做预估展示）：展示与扣费拆开会使用户余额无声减少，且预估展示在全站无先例，一并推迟到后续工单，否决。
- 复用图片生成面板（带提示词与参考栏）：高清放大的输入图固定为源卡、无提示词语义，复用会引入大量禁用态分支，另起轻量面板。
- 我们后端直连火山 MediaKit（平台级 API Key 环境变量注入）：网关已有现成 MediaKit 渠道类型与注册表（enhance-image 已登记），直连要自管凭证、绕开网关计费护栏，也与「供应商调用经 new-api 网关」的既有链路分裂，否决。

## Consequences

- 上线前置条件在网关侧：在火山控制台 AI MediaKit 页面创建 API Key，在网关执行 mediakit-bootstrap.sql 建渠道（或控制台手工建渠道并配模型清单与 abilities），本期 model_price 配 0。网关缺渠道或缺定价时，调用以 400 失败，产品侧呈现为任务失败。
- 计费粒度已知限制：网关按模型名（`mediakit-enhance-image`）按次计费，不区分 tool_version，而三档官方成本差 40 倍（standard 6 元/千次、professional 36、max 240）。本期免费无影响，后续计费工单需先解决分档计价（拆模型名或网关侧增强），否则只能按单一价收费。
- MediaKit 同步返回的结果图 URL 仅 24 小时有效，执行侧必须在响应后立即下载并落入对象存储，产物才成为 Asset。
- 网关对 success=false 的上游响应不扣费并返错，失败原因取自上游 error 对象；本侧据此映射任务失败，由用户在原卡手动重试，无自动重试。
