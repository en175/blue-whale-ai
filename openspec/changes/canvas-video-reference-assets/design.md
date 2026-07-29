# Design：视频生成图片/视频参考链路

## 1. 边界与数据流

```text
Canvas / Video Dock
  -> ordered reference_asset_ids
  -> GenerationJob.input.reference_asset_ids
  -> Worker resolveInputAssets(ids, userId, projectId)
  -> ordered VideoReference[]
  -> NewApiVideoInput.references
  -> metadata.content
  -> Seedance 2.0
```

`reference_asset_ids` 是跨进程唯一产品契约。前端不提交媒体类型；Worker 只信 Asset
记录中的 `type`、`mime`、`size`、`duration` 等字段。

## 2. API 契约

视频任务允许：

- 文生视频：无帧、无普通 reference；
- 首帧/首尾帧：`first_frame_asset_id` 与可选 `last_frame_asset_id`；
- 一般多模态参考：有序 `reference_asset_ids`，结构上最多 12 个。

API 在不知道 Asset 类型时不猜图片/视频配额，精确的 9/3 配额由 Worker 在解析可信
Asset 后执行。以下请求直接返回 400：

- 帧字段与非空 `reference_asset_ids` 同时出现；
- `last_frame_asset_id` 存在但没有 `first_frame_asset_id`；
- 普通 reference 超过 12 个或包含非法 ID。

旧 `input_asset_ids` 只作为兼容身份列表参与去重。存在显式视频字段时，它不得改变帧与
普通 reference 的角色；没有显式字段的旧视频请求继续保持最多 1 个引用，避免无版本
契约被静默扩宽。

## 3. Worker 可信解析与校验

Provider-neutral 类型：

```ts
export type VideoReference = {
  type: "image" | "video";
  url: string;
};
```

`resolveInputAssets` 只查询当前用户拥有、且属于当前项目或尚未挂项目
（`project_id=0`）的 Asset，并按请求 ID 顺序返回。`project_id=0` 是现有上传链路的
同用户全局素材暂存语义，不放宽用户归属。

返回结构：

```ts
type VideoWorkerInputAsset = {
  id: string;
  type: string;
  url: string;
  mime: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
};
```

Worker 校验：

- 引用必须全部存在并属于当前用户与项目；
- 帧 Asset 必须是图片；
- 普通引用只能是图片或视频，图片最多 9 个、视频最多 3 个；
- 视频引用只允许 Seedance 2.0 模型；
- 已知 MIME 只允许 `video/mp4` / `video/quicktime`；
- 已知大小不得超过 200 MB；
- 已知单视频时长必须为 2~15 秒，已知时长总和不得超过 15 秒。
- 已知宽高的单边必须为 300~6000 px，宽高比必须为 0.4~2.5，总像素必须为
  409,600~8,295,044。

历史 Asset 元数据为空时不伪造值，仍把 URL 交给 Seedance 最终校验。新上传视频会把
浏览器读取到的宽、高写入 Asset，并把精确时长写入可空 `duration_ms`；兼容字段
`duration` 继续保存整数秒。Worker 优先读取 `duration_ms / 1000`，旧 Asset 缺少该值时
回退 `duration`。新生成视频继续把整数输出时长写回 `duration`。

## 4. NewAPI 映射

Core 输入：

```ts
type NewApiVideoReference = {
  type: "image" | "video";
  url: string;
};
```

一般参考请求：

```json
{
  "model": "doubao-seedance-2-0-260128",
  "prompt": "修改视频风格",
  "duration": 8,
  "metadata": {
    "duration": 8,
    "resolution": "720p",
    "ratio": "16:9",
    "content": [
      {
        "type": "image_url",
        "image_url": { "url": "https://..." },
        "role": "reference_image"
      },
      {
        "type": "video_url",
        "video_url": { "url": "https://..." },
        "role": "reference_video"
      }
    ]
  }
}
```

顶层 `duration` 供 NewAPI 通用校验和计费；`metadata.duration` 供 Doubao 适配器转发。
`resolution` 与 `ratio` 使用 GenerationJob 已校验的原始参数，不从 width/height
反推。

首帧/首尾帧使用同一 `metadata.content` 载体，role 分别为 `first_frame` /
`last_frame`。Core 对帧与一般 references 同时出现做第二道 fail-closed 校验。

## 5. Video Dock

- `dockAccept("video")` 返回 `["image", "video"]`，不包含 audio。
- 从画布选中节点时，`DockMediaItem.type` 使用真实 `node.data.kind`，不得硬编码 image。
- `referenceAssetIds` 按 Dock 排列顺序提取图片与视频 Asset ID，最多 12 个。
- `refMode="omni"` 只提交普通 references；`refMode="first-last"` 只提交帧字段。
- 本地文件 input 接受图片以及 `.mp4,.mov,video/mp4,video/quicktime`。
- 视频缩略图用 `<video preload="metadata">`，图片继续用现有图片组件。
- 不渲染音频参考上传按钮，不把音频 Asset 投影到视频生成请求。

## 6. 错误语义

API 使用稳定的 400 用户错误；Worker 在 provider submit 前失败并写入稳定 code：

- `invalid_video_inputs`：帧与一般 reference 混用或 ID 形状错误；
- `reference_asset_unavailable`：Asset 不存在或越权；
- `unsupported_reference_type`：音频等非图/视素材；
- `reference_limit_exceeded`：图片/视频数量超限；
- `invalid_reference_video`：已知 MIME、大小、时长或宽高不满足约束；
- `unsupported_video_inputs`：非 Seedance 2.0 模型携带视频引用。

## 7. Job 批量状态查询

`GET /api/jobs` 保留现有 `projectId`、`status`、分页参数，并新增可选的逗号分隔
`ids` 参数。存在 `ids` 时按当前用户精确过滤这些 Job，去重后最多 100 个；超出上限
返回 400，不改变其他用户的可见性。响应继续使用 `{ records, total, size, current }`
列表形状，未找到的 ID 不补占位记录。

视频 Dock 的在途 Job 使用单个 3 秒 timer，每轮最多发一个 `ids` 批量请求；终态记录从
本地轮询集合移除，避免每个 Job 创建独立 timer 和请求。

## 8. 验证边界

先完成 API/Core/Worker 的 RED-GREEN，并验证实际 NewAPI request body；这些通过后才修改
前端。聚焦测试后运行 Node workspace、Web 全量测试、typecheck/build。浏览器验证覆盖
画布选图片、画布选视频、本地 MP4/MOV、混合引用、互斥模式和刷新后引用身份。
