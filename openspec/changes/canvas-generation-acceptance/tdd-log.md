# Canvas 生成 TDD 日志

日期：2026-07-29

## Slice 1：视频首帧、尾帧、普通参考素材保留角色

- RED：路由处理器只保存扁平 `input_asset_ids`；Worker 只读取一张普通参考图。
- GREEN：新增 `first_frame_asset_id`、`last_frame_asset_id`、`reference_asset_ids`；Worker 分角色解析并做用户/项目归属校验。
- 证据：`handle-create-generation-job.test.ts`、`video-job-runner.test.ts`。

## Slice 2：New API 不静默丢尾帧

- RED：多图片输入缺少明确契约。
- GREEN：单首帧/单普通参考映射为 `image`；尾帧、多参考图返回 `unsupported_video_inputs`。
- 证据：`new-api-client.test.ts`。

## Slice 3：图片 `n=1` 必须进入 New API

- 真实 RED：New API HTTP 400，价格表达式读取不到 `n`，报 `nil * int`。
- 测试 RED：断言 `n: 1` 时请求体必须显式包含 `n`。
- GREEN：图片生成请求始终发送 `n`。
- 真实 GREEN：Job 167 成功；Jobs 168-177 并发 10/10 成功。

## Slice 4：单首帧不能重复成为普通 reference

- 真实请求形状：Canvas 同时发送 `input_asset_ids=[11]` 和 `first_frame_asset_id=11`。
- RED 命令：`pnpm --filter blue_whale exec vitest run lib/generation/handle-create-generation-job.test.ts`。
- RED 结果：收到 `reference_asset_ids: [11]`，违反“只有首帧角色”的断言。
- 最小实现：存在显式首帧/尾帧时，兼容 `input_asset_ids` 不再回退为普通 reference；显式 `reference_asset_ids` 不变。
- GREEN 结果：11/11 tests passed。
- 真实 GREEN：Job 179 已持久化 `first_frame_asset_id=215`、无 `reference_asset_ids`、provider taskId 非空；最终 `succeeded`、progress 100、Asset 225。

## BullMQ 真实链路证据

- Job 178：文生视频，Seedance 2、720p、16:9、5 秒，最终成功并生成 Asset 224。
- Job 179：单首帧生视频，首帧 Asset 215，最终成功并生成 Asset 225。
- Job 180：文生视频边界组合，Seedance Fast、480p、9:16、4 秒；BullMQ 中 13 个 submit/poll 短步骤全部 `completed`，0 failed，最终生成 Asset 226，TOS HEAD 200。
- Job 181：文生视频模型组合，Seedance Mini、720p、1:1、5 秒；BullMQ 中 13 个 submit/poll 短步骤全部 `completed`，0 failed，最终生成 Asset 227，TOS HEAD 200；New API 日志有同模型 `type=6` 和 quota 记录。
- 四条业务链均为 `Next GenerationJob API -> Redis/BullMQ -> generation-worker -> New API -> TOS -> MySQL`，不使用直连结果替代业务闭环证据。

## 待执行 RED/GREEN

1. 图片比例：当前 Job 有 `aspect_ratio`，provider port 和 New API body 无该字段。
2. 连续组图：当前 Job 有 `sequential_image_generation`，Worker 未消费。
3. 图片多参考：UI 允许 4，Worker 在 2 张时失败。
4. 视频模型/能力：Dock 硬编码单模型，分辨率和比例未按能力表收窄。
5. 视频数量/联网：UI 可配置但 Worker/provider 未消费。

## Slice 5：Canvas 不提供视频取消入口

- RED：processing 视频在 BottomDock 中仍显示整条状态栏和“取消生成”按钮。
- 最小实现：删除 BottomDock 视频任务状态/取消栏及 Canvas 编排层传参；不改变后端 Job 状态机和历史取消状态恢复。
- GREEN：组件测试确认即使传入旧 cancellation props，也不显示“视频生成中”状态栏或“取消生成”按钮。

## Slice 6：公网 TOS 参考图回填不携带产品 Authorization

- 真实根因：同一公网 TOS URL 裸 GET 返回 200；附加 `Authorization: Bearer ...` 后对象存储返回 400。
- RED：带 assetId 的公网 TOS 图片被 `DockMediaThumb` 误判为 Product API 私有地址，进入 `AuthenticatedImage -> apiFetch`，Dock 无法直接渲染。
- 最小实现：只有 `/api/projects/...` 内容地址走带身份读取；公网 TOS、blob 和 data URL 直接交给 `<img>`。
- GREEN：组件测试 7/7；真实 `project=56` 图片点击“生成视频”后 Dock TOS 缩略图 `naturalWidth=2048`，无 asset unavailable 日志。

## Slice 7：暂时隐藏视频提取音频入口

- RED：`toolbarForKind("video")` 仍返回 `extract-audio` action。
- 最小实现：只从视频节点 toolbar 配置移除“提取音频”；保留底层 action/mapping 占位，后端能力接入后可重新开放。
- GREEN：配置层回归测试确认视频节点不再暴露 `extract-audio`。

## Slice 8：显式视频角色与兼容素材列表共同规范化

- RED 1：2 个帧角色 + 4 个普通 reference 会因兼容 `input_asset_ids` 共 6 项而被旧的四项上限提前拒绝。
- RED 2：只有显式 `reference_asset_ids` 的多参考请求仍被旧“视频只允许一张参考图”校验拒绝，无法进入 Worker 的 provider 能力判断。
- RED 3：`first_frame_asset_id=11` 与兼容 `input_asset_ids=[11,13]` 同时出现时，普通 reference 13 被静默丢失。
- 最小实现：显式视频角色允许最多 6 个兼容身份；从兼容列表扣除首尾帧后，与显式普通 reference 去重合并，规范化后的普通 reference 仍最多 4 个；无显式角色的旧请求继续最多一张。
- GREEN：路由处理器 14/14；Hook + 路由聚焦 32/32。另补同批 2 个图片任务 + 2 个视频任务按 taskId 独立 hydrate 的回归证据。
