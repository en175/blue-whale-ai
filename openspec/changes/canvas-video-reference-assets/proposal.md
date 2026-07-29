# Proposal：视频生成支持图片/视频参考素材（IJZY24）

> **策略**：保持产品契约为有序 `reference_asset_ids`。Worker 按可信 Asset
> 记录解析媒体类型与元数据，再转换为 provider-neutral `VideoReference[]`；
> NewAPI 客户端只负责把该集合映射到 Seedance 2.0 `metadata.content`。

## Why

当前视频生成链路在三个位置把能力收窄成单张参考图：

- 创建任务 API 对普通参考素材最多只放行 4 个，旧兼容请求仍限制为 1 个；
- Worker 要求全部引用都是图片，并拒绝多素材；
- NewAPI 客户端只发送顶层 `image`，主动拒绝多图与首尾帧，也无法表达视频引用。

这使画布中已有的视频节点和本地上传视频无法真正进入 Seedance 2.0。官方能力是最多
9 张参考图片、3 个参考视频，并允许两类混合；一般多模态参考模式与首尾帧模式互斥。

## What Changes

- 创建任务 API 保留有序 `reference_asset_ids`，一般参考最多 12 个；若同时出现
  `first_frame_asset_id` / `last_frame_asset_id` 与普通参考则拒绝。
- Worker 一次性按用户/项目归属解析全部 Asset，以数据库 `type` 为权威，保序构造
  `VideoReference[]`；放行最多 9 张图、3 个视频。
- Worker 对已知的视频 MIME、大小、时长和宽高做 Seedance 约束校验；未知的历史元数据
  交给上游最终校验，不伪造前端声明。
- NewAPI 请求把图片/视频引用写入 `metadata.content`，分别使用
  `reference_image` / `reference_video` role；顶层与 metadata 都保留 `duration`。
- 视频 Dock 的画布选择只允许图片和视频节点；本地参考视频接受 MP4/MOV，音频入口和
  音频引用从本工单范围移除。
- 本地视频上传把浏览器可读取的宽、高、时长写入 Asset complete 请求，供 Worker
  使用可信持久化元数据做预校验。
- Job 状态列表复用 `GET /api/jobs`，新增 `ids` 精确批量查询参数，最多接受 100 个
  Job ID；视频轮询对所有在途任务共享一个 3 秒请求周期。

## Capabilities

### New

- `video-reference-assets`：有序图片/视频参考集合、可信 Asset 类型解析、Seedance 2.0
  混合引用与 NewAPI metadata 映射。

### Modified

- `crossmodal-creation`：视频 Dock 的选择范围由图/视/音收窄为图/视；音频引用不属于
  IJZY24。
- `canvas-generation-hook`：视频 recipe 与 GenerationJob 都保留图片/视频引用顺序。

## Impact

- OpenSpec：本 change 的 proposal/design/spec/tasks/test matrix。
- API：`blue_whale_web/lib/generation/handle-create-generation-job.ts`。
- Core：`packages/core/src/new-api-client.ts`。
- Worker：`packages/generation-runtime/src/video-job-runner.ts` 与 persistence Asset port。
- 前端：视频 Dock、Canvas 选择、生成参数投影与本地上传元数据。
- 不修改 `blue_whale_api` 生产代码；不实现音频引用、音频生成或视频提取音频。
