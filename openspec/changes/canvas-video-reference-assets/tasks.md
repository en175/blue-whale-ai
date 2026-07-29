# Tasks：视频生成图片/视频参考链路（IJZY24）

> 顺序硬约束：OpenSpec → API/Core/Worker RED-GREEN → 接口验证 → 前端
> RED-GREEN → 全量验证。不得先改前端。

## T1 — API 契约 RED-GREEN

- [x] RED：创建任务测试覆盖 12 个普通 reference 放行、13 个拒绝、帧与普通 reference
  混用拒绝、单独尾帧拒绝、有序去重持久化。
- [x] GREEN：更新 `handle-create-generation-job.ts` 的视频校验与规范化；旧
  `input_asset_ids` 无显式字段时继续最多 1 个。
- [x] 运行 API 聚焦测试并记录 RED/GREEN。

## T2 — Core NewAPI 契约 RED-GREEN

- [x] RED：Core 测试断言图/视混合引用按序写入 `metadata.content`，且
  `duration/resolution/ratio` 位于 metadata；顶层 duration 保留。
- [x] RED：Core 测试断言首尾帧 role 正确、帧与普通 references 混用 fail closed。
- [x] GREEN：扩展 `NewApiVideoInput` 与 `submitVideo`，移除单图顶层 `image` 收窄。
- [x] 运行 Core 聚焦测试并记录 RED/GREEN。

## T3 — Worker 可信 Asset RED-GREEN

- [x] RED：Runner 测试覆盖有序图/视混合映射、9 图+3 视频边界、10 图、4 视频、
  音频 Asset、非 2.0 模型视频引用、已知 MIME/大小/单时长/总时长越界。
- [x] RED：Persistence 测试断言 `resolveInputAssets` 返回可信元数据且保持请求顺序。
- [x] GREEN：引入 provider-neutral `VideoReference[]`，实现 Asset 解析与校验；把
  resolution/ratio 透传 Core。
- [x] GREEN：新生成视频 Asset 写入任务 duration。
- [x] 运行 Runner/Persistence/Task provider 聚焦测试并记录 RED/GREEN。

## T4 — 接口门禁

- [x] 构建 Node workspace，验证 Core 与 Worker 类型契约一致。
- [x] 用捕获 fetch 的测试确认实际 POST body 与 OpenSpec JSON 一致。
- [x] 只有 T1-T3 聚焦测试和 Node build 通过后，才能开始 T5。

## T5 — Video Dock RED-GREEN

- [x] RED：测试 `dockAccept("video")` 只返回 image/video，画布视频节点保留
  `type=video`，普通引用按可见顺序提取图/视 Asset ID 且最多 12 个。
- [x] RED：组件测试验证视频缩略图、MP4/MOV accept、可见视频上传按钮触发 file input、
  音频参考入口不渲染。
- [x] GREEN：修改 Canvas 选择、BottomDock 参数投影、VideoDockContent 与共享上传部件。
- [x] GREEN：本地视频上传 complete 携带可读取的 width/height/duration。
- [x] 运行前端聚焦测试并记录 RED/GREEN。

## T6 — 全量验证与提交

- [x] 刷新 CBM/graphify 索引。
- [x] 顺序运行 Node workspace test/typecheck/build 与 Web test/design lint/build。
- [x] 浏览器验证图片节点、视频节点、本地 MP4/MOV、图视混合、数量错误和互斥模式。
- [x] 使用 code-review 检查 Spec 覆盖、回归与 `blue_whale_api` 零生产改动。
- [x] 增加 `GET /api/jobs?ids=` 精确批量查询契约，前端在途 Job 使用单一 3 秒 timer，
  并用真实网关验证 10 路视频并发轮询只发批量请求。
- [x] 补齐 NewAPI `FAILURE` 终态映射，避免上游失败任务永久停留在 processing。
- [x] 通过仓库标准入口提交；用户明确授权后发布指向 `master` 的 PR，不合并。
