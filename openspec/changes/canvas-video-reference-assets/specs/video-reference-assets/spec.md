# Spec：video-reference-assets

## ADDED Requirements

### Requirement: 有序 reference_asset_ids 是唯一产品契约

Canvas/Dock MUST 只提交有序 `reference_asset_ids`，不得提交前端声明的媒体类型。
GenerationJob MUST 原样保留去重后的顺序。

#### Scenario: 图片和视频身份按 Dock 顺序持久化

- **GIVEN** Dock 依次包含图片 A、视频 B、图片 C
- **WHEN** Canvas 创建视频 GenerationJob
- **THEN** Job 的 `reference_asset_ids` 顺序为 A、B、C，且请求中没有媒体类型声明

### Requirement: 首尾帧模式与一般参考模式互斥

任何非空普通 reference 与 `first_frame_asset_id` / `last_frame_asset_id` 同时出现时，
API、Worker 和 Core MUST fail closed，不得向上游发送含糊请求。尾帧 MUST NOT 在没有
首帧时单独出现。

#### Scenario: 首尾帧与普通 reference 混用

- **GIVEN** 请求同时包含帧字段和非空 `reference_asset_ids`
- **WHEN** 创建 GenerationJob
- **THEN** API 返回 400，任务不落库

#### Scenario: 尾帧单独出现

- **GIVEN** 请求只有 `last_frame_asset_id`
- **WHEN** 创建 GenerationJob
- **THEN** API 返回 400，任务不落库

### Requirement: Worker 使用可信 Asset 记录

Worker MUST 按归属查询每个 Asset，并按 ID 顺序恢复结果：Asset 必须属于当前用户，
且属于当前项目或现有上传链路使用的同用户全局暂存项目（`project_id=0`）。媒体类型、
URL 与元数据 MUST 来自 Asset 记录；缺失、跨用户、跨普通项目和非图/视 Asset MUST
在 provider submit 前失败。

#### Scenario: 前端不能把音频伪装成视频

- **GIVEN** `reference_asset_ids` 指向一个数据库 `type=audio` 的 Asset
- **WHEN** Worker 解析普通 reference
- **THEN** 任务以 `unsupported_reference_type` 失败且 provider 未被调用

### Requirement: Seedance 2.0 开放 9 图 + 3 视频混合引用

一般参考模式 MUST 支持仅图片、仅视频和图片+视频三种组合。图片上限为 9，视频上限为
3，两类分别计数。非 Seedance 2.0 模型 MUST NOT 接收视频引用。

#### Scenario: 图片和视频按顺序进入 provider

- **GIVEN** `reference_asset_ids=[imageA, videoB, imageC]`
- **WHEN** Worker 解析 Asset 并提交 Seedance 2.0
- **THEN** provider references 顺序为 imageA、videoB、imageC

#### Scenario: 第 10 张图片被拒绝

- **GIVEN** 一般参考包含 10 张可信图片
- **WHEN** Worker 构造 provider 请求
- **THEN** 任务以 `reference_limit_exceeded` 失败且 provider 未被调用

#### Scenario: 第 4 个视频被拒绝

- **GIVEN** 一般参考包含 4 个可信视频
- **WHEN** Worker 构造 provider 请求
- **THEN** 任务以 `reference_limit_exceeded` 失败且 provider 未被调用

### Requirement: 已知视频元数据在提交前校验

Worker MUST 拒绝已知的非 MP4/MOV MIME、超过 200 MB、单个时长不在 2~15 秒、或已知
总时长超过 15 秒的视频。已知宽高时，单边 MUST 在 300~6000 px，宽高比 MUST 在
0.4~2.5，总像素 MUST 在 409,600~8,295,044。新上传视频 MUST 持久化毫秒精度时长供
Worker 校验；未知历史元数据 MAY 交由 Seedance 最终校验，但不得伪造。

#### Scenario: 已知视频总时长超过 15 秒

- **GIVEN** 三个视频 Asset 的已知时长合计超过 15 秒
- **WHEN** Worker 构造 provider 请求
- **THEN** 任务以 `invalid_reference_video` 失败且 provider 未被调用

#### Scenario: 已知参考视频像素不足

- **GIVEN** 参考视频 Asset 记录宽高为 640x360
- **WHEN** Worker 构造 provider 请求
- **THEN** 任务以 `invalid_reference_video` 失败且 provider 未被调用

### Requirement: Provider-neutral VideoReference

Worker 与 provider 端口之间 MUST 使用有序 `VideoReference[]`，每项只包含可信的
`type: "image" | "video"` 与 `url`。NewAPI 私有字段不得泄漏进 Worker 的领域接口。

#### Scenario: Worker 端口不包含 NewAPI 字段

- **GIVEN** Worker 已解析一个图片和一个视频 Asset
- **WHEN** Worker 调用 `VideoTaskProvider.submit`
- **THEN** submit 输入包含 `VideoReference[]`，不包含 `metadata`、`image_url` 或
  `video_url`

### Requirement: NewAPI metadata.content 映射

Core MUST 把图片映射成 `image_url/reference_image`，视频映射成
`video_url/reference_video`，并保持顺序。请求 MUST 同时包含顶层 `duration` 与
`metadata.duration`；`metadata` MUST 包含 `resolution`、`ratio` 和 `content`。

#### Scenario: 图片和视频映射成 NewAPI metadata

- **GIVEN** Core 收到 imageA、videoB、imageC 三个有序 references
- **WHEN** Core 提交 NewAPI 视频任务
- **THEN** `metadata.content` 顺序为 imageA/reference_image、
  videoB/reference_video、imageC/reference_image

### Requirement: 视频 Dock 只接收图片和视频

视频 Dock 的画布选择 MUST 允许图片节点和视频节点，MUST 排除音频节点。被选素材的
`DockMediaItem.type` MUST 使用真实节点 kind。普通 reference ID MUST 按可见顺序提交。

#### Scenario: 画布视频节点成为参考

- **GIVEN** Video Dock 进入“从画布选择”且画布有图片、视频、音频节点
- **WHEN** 用户选择视频节点
- **THEN** Dock 增加 `type=video` 的可见素材并提交其 Asset ID；音频节点不可选

### Requirement: 本地参考视频支持 MP4/MOV

视频 Dock MUST 能本地选择 MP4/MOV 视频并走现有 presign/PUT/complete 上传链路。新
上传视频 SHOULD 把浏览器可读取的宽、高、时长写入 Asset。可见视频上传入口 MUST
实际触发 file input。

#### Scenario: 本地 MOV 成为参考

- **GIVEN** 用户在 Video Dock 选择合法 MOV 文件
- **WHEN** 上传完成并点击生成
- **THEN** Asset ID 进入 `reference_asset_ids`，Worker 读取其 `type=video`

### Requirement: Job 状态支持精确批量查询

`GET /api/jobs` MUST 支持可选逗号分隔的 `ids` 参数。服务端 MUST 按当前用户精确过滤
这些 Job，去重后最多接受 100 个 ID；超过上限 MUST 返回 400。响应 MUST 保持现有
`records/total/size/current` 形状，未找到的 ID 不得补占位记录。

#### Scenario: 一次查询多个在途 Job

- **GIVEN** 当前用户有 Job A、B，另有用户有 Job C
- **WHEN** 客户端请求 `GET /api/jobs?ids=A,B,C`
- **THEN** 响应只包含 A、B，且每个 Job 只出现一次

#### Scenario: 批量查询超过上限

- **GIVEN** `ids` 去重后包含 101 个 Job ID
- **WHEN** 客户端请求 `GET /api/jobs?ids=...`
- **THEN** API 返回 400，且不查询数据库

### Requirement: 在途 Job 共用一个轮询周期

视频轮询 MUST 为所有在途 Job 共用一个 3 秒 timer；每轮最多调用一次带 `ids` 的列表
接口，不得为每个 Job 创建独立状态请求 timer。

#### Scenario: 十个视频 Job 只发一个批量请求

- **GIVEN** Hook 中同时有 10 个在途 Job
- **WHEN** 一个 3 秒周期到达
- **THEN** API 只收到一个包含 10 个 ID 的批量请求，且各 Job 仍分别触发自己的进度或终态回调

### Requirement: 范围约束

本 change MUST NOT 修改 `blue_whale_api` 生产代码，MUST NOT 实现音频引用、音频生成
或视频提取音频。

#### Scenario: 变更范围审查

- **GIVEN** IJZY24 实现完成
- **WHEN** 审查 Git diff
- **THEN** `blue_whale_api` 生产文件、音频 provider 和提取音频实现均无改动
