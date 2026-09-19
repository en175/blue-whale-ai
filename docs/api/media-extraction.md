# 视频提取音频 API 对接文档（前端）

> 需求：IKARDY 画布视频节点提取音频。后端 `media-extractions` 模块 + `generation-worker` 提取。
> 版本：v3（2026-09-19，IKH28T 契约扩面）。**output_format 枚举扩为五值、默认 m4a、非法值拒绝**（静默回退 mp3 废除）；错误码面新增火山执行路径兜底 1044（执行路径切换由后续票承载，切换前 worker 仍为本地 ffmpeg 链路）。
> 上一版：v2（2026-09-15，IKFS5W）画布改由前端写。**画布改由前端写**：建任务接口不再注入节点，worker 不再回写画布。
> 所有请求需 `Authorization: Bearer <token>`；响应统一 `{ code, msg, data }`，`code===200` 成功，前端 `apiRequest` 已解包 `data`。

---

## 0. 总览

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/projects/:projectId/media-extractions` | 视频提取音频：只建任务（**不写画布**） |
| GET | `/api/jobs/:id` | **轮询任务状态**（复用既有 jobs 接口） |

> 画布只有一个写入方：前端 `PUT /api/canvases/:projectId`。占位节点由前端建任务后本地插入并落库，
> 终态由轮询结果打本地补丁 —— 与图片/视频/音频生成任务完全同构。

---

## 1. 建提取任务

```
POST /api/projects/:projectId/media-extractions
```

请求：
```json
{ "source_asset_id": "3985", "output_format": "mp3" }
```
- `source_asset_id`：**必填**，画布视频节点的 `data.assetId`（后端校验归属 + 必须 `type=video`，非视频返回失败）
- `output_format`：可选，**`m4a`（缺省值）/ `mp3` / `ogg` / `flac` / `wav` 五值**（IKH28T 契约口径，对齐火山官方 `format` 参数；缺省落 `m4a`——官方默认值）；**传枚举外值 / 非字符串 / `null` 会被明确拒绝**（不再静默回退 mp3）

响应 `data`：
```json
{ "job_id": "1125", "status": "queued" }
```

**接口只建任务，不碰画布。** 前端拿到 `job_id` 后自己插入占位节点（形状固定如下，`buildMediaExtractPlaceholderNode()` 是唯一构造入口）：

```json
{
  "id": "media-extract-1125",
  "type": "mediaNode",
  "position": { "x": 1317, "y": 415 },
  "data": {
    "src": "",
    "fileName": "测试视频(audio).mp3",
    "mediaType": "audio",
    "genStatus": "generating",
    "progress": 0,
    "jobId": "1125",
    "toolMode": "select"
  }
}
```
- 位置 = 源视频节点**右边缘 + 60px**（同 y）：源节点内容宽按 `mediaContentBox` 算（视频 280×比例，16:9 约 498），不再固定 340 —— 固定值会压住宽视频节点。
- 节点 id 前缀 `media-extract-` 是**轮询与终态补丁的约定**（`mediaExtractNodeId` / `isMediaExtractNodeId`），不可改。
- 同时补一条 **视频 → 音频的来源边**（`edge.data.origin = "media-extract"`）：表达「这段音频取自那段视频」。
  它是来源记录、不是生成参考输入——参考推导（`audioMediaRefsOf`）会跳过带该标记的边，否则音频卡重新编辑时
  会把这个视频判成非法音频参考、禁用发送。服务端本来就只消费「文本节点 → 目标」的边（契约 IKDLQF），
  媒体→媒体边不参与输入推导；源视频删除时连线随节点级联清理。
- 落库：插入后前端立即 `flushCanvasSave` 一次（不等 800ms 防抖），避免刚建任务就关页丢节点。
- 终态由前端打本地补丁：成功写 `src`（音频 URL）、`assetId`、`mediaType:"audio"`、`progress:100`、清 `genStatus`；失败置 `genStatus:"failed"` + `errorText`。
- 中途刷新/重开：快照里的节点自带 `jobId` + `genStatus:"generating"`，水合按既有逻辑自动恢复轮询，无需额外代码。

---

## 2. 轮询任务状态（复用）

```
GET /api/jobs/:id
```

响应 `data`：
```json
{
  "job_id": "1125",
  "status": "queued | processing | succeeded | failed",
  "progress": 0,
  "asset": { "id": "3992", "url": "https://bluewhale-assets.tos-cn-beijing.volces.com/media-extract/audio/xxx.mp3", "type": "audio" },
  "error": { "code": "...", "message": "..." }
}
```
- `status === "succeeded"` → `asset` 为音频资产（`type:"audio"`），可播放。
- `status === "failed"` → `error.message` 前端展示；错误码见 §4。

---

## 3. 前端改动清单

1. `web/src/api/jobs.ts`（或新文件）加一个请求：`createMediaExtraction(projectId, { source_asset_id })` → `POST media-extractions`，返回 `{ job_id }`。
2. 视频节点「提取音频」入口：拿到节点 `assetId` → 调上一步 → **本地插入占位节点**（`buildMediaExtractPlaceholderNode` + `attachCallbacks`，同步写 `mediaNodesRef`）→ `flushCanvasSave` → `pollJob(jobId)`。
3. 终态由 `mediaExtractTerminalPatch` 打本地补丁，随自动保存落库。

> 建任务接口返回体里**没有**画布或版本信息，也不需要：画布版本只由前端自己的保存推进。

---

## 4. 错误码（失败任务）

| error.code | 含义 | 前端处理 |
|---|---|---|
| `video_has_no_audio_track` | 视频没有音轨 | 提示「视频没有音轨」 |
| `video_download_failed` | 视频下载失败 | 提示「视频下载失败」 |
| `video_too_large` | 视频超过 200MB 上限 | 提示「视频超过大小上限」 |
| `extract_failed` / `media_extract_failed` | 音频提取失败 | 提示「音频提取失败」 |
| `upload_failed` | 音频上传失败 | 提示「音频上传失败」 |
| `source_asset_unavailable` | 源视频资产不可用 | 提示刷新 |
| `enqueue_failed` | 任务入队失败（瞬时） | 提示重试 |

> 以上为现行本地 ffmpeg 链路错误码。IKH28T 已为火山执行路径定义兜底码 **`media_extract_provider_failed`（数值 1044，「音频提取失败，请重试」）**——网关分类链（额度 1001 / 内容 1018 / 版权 1038 / provider_failed 1011 / 超时 1012）之外的火山任务失败与转存失败统一归并该码；映射口径全文 = 迁移契约 §18.4。执行路径切换（worker 票 IKH28W）落地后该码开始产生，本地链路细分码（`video_too_large` 等）随之不再由新任务产生（存量已落库任务的投影不变）。

---

## 5. 注意事项

1. **失败不自动重试**：提取任务内部失败（下载/抽取/上传/无音轨）直接置 `failed`，**不重试**（暂无前端重试入口）。瞬时网络错误也终态——前端可引导用户重新发起。
2. **任务失败 → 前端置节点 failed**：轮询到 `failed` 时前端把占位节点 `genStatus` 置 `"failed"` + `errorText`（`mediaExtractTerminalPatch`）；用户关页则下次打开由水合轮询补上。
3. **异步无同步接口**：建任务后必须轮询 `GET /api/jobs/:id`；不要假设立即出结果。进度 `progress` 0-100（阶段映射：1-20 下载 / 21-90 提取 / 91-99 上传）。
4. **不再有版本漂移**：画布只由前端 `PUT /api/canvases/:projectId` 写，建任务与 worker 提取都不会 `version + 1`，因此提取过程不会把前端的 `If-Match` 顶成 `412`。
5. **节点位置在视频右侧**：按发起当刻的源视频节点位置算一次并落库；源视频之后移动，音频节点不跟随。
6. **音频文件名 = 视频名(audio).mp3**：由前端从视频节点 `fileName` 派生（`audioDisplayName`，如 `测试视频.mp4` → `测试视频(audio).mp3`）。
7. **大小上限 200MB**：超限任务失败（`video_too_large`）。
8. **并发**：后端默认同时处理 2 个提取任务（容器 2 核）；多个请求排队，轮询可见。
9. **归属校验**：`source_asset_id` 必须是**当前项目内**的视频资产，跨项目/他人资产返回失败。
10. **0 表迁移**：本功能无任何表结构变更；音频资产写入既有 `assets` 表（`type=audio`），可被资产库/共享资产等既有能力使用。

---

## 6. 完整流程示例

**视频节点 → 提取音频 → 画布出现音频节点**：
1. 取视频节点 `data.assetId`（如 `3985`）
2. `POST /api/projects/:projectId/media-extractions` `{ "source_asset_id": "3985" }` → `{ job_id: "1125" }`
3. 前端本地插入占位节点（视频右侧，`genStatus:"generating"`）并立刻保存
4. 前端 `GET /api/jobs/1125` 轮询 → `succeeded` 后 `asset.url` 可播放；节点本地补丁更新为最终音频并随自动保存落库
5. 失败 → 展示 `error.message`，节点显示失败态；中途关页/刷新由水合轮询补上终态
