# 视频提取音频 API 对接文档（前端）

> 需求：IKARDY 画布视频节点提取音频。后端 `media-extractions` 模块 + `generation-worker` 提取。
> 版本：v1（2026-08-25）。所有请求需 `Authorization: Bearer <token>`；响应统一 `{ code, msg, data }`，`code===200` 成功，前端 `apiRequest` 已解包 `data`。

---

## 0. 总览

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/projects/:projectId/media-extractions` | 视频提取音频：建任务（**画布音频节点由后端自动注入**，前端无需创建节点） |
| GET | `/api/jobs/:id` | **轮询任务状态**（复用既有 jobs 接口） |

> 前端只需 1 个新请求（建任务）+ 复用既有 `fetchJobStatus` 轮询。**不需要**为提取写任何画布节点逻辑。

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
- `output_format`：可选，目前仅 `mp3`（缺省 `mp3`）

响应 `data`：
```json
{ "job_id": "1125", "status": "queued" }
```

**同时，后端会在画布快照里插入一个音频占位节点**（无需前端创建）：

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
- 位置 = 源视频节点**右侧**偏移 340px（同 y）。
- 节点带 `jobId` + `genStatus:"generating"` —— 前端**水合时对这类节点自动 `fetchJobStatus` 轮询**（对齐既有生成中节点的水合逻辑，无需新代码）。
- 提取成功后后端把节点更新为最终音频：`src`=音频 URL、`assetId`、`mime/size/duration`、`progress:100`、清 `genStatus`；失败置 `genStatus:"failed"` + `errorText`。

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

## 3. 前端改动清单（极小）

1. `web/src/api/jobs.ts`（或新文件）加一个请求：`createMediaExtraction(projectId, { source_asset_id })` → `POST media-extractions`，返回 `{ job_id }`。
2. 视频节点「提取音频」交互（如需触发入口）：拿到节点 `assetId` → 调上一步 → 用 `fetchJobStatus(job_id)` 轮询（复用既有 `pollJob` 形态）。
3. **画布节点出现/更新全部由后端处理**：刷新或水合即见；无需手拼节点。

> 当前画布音频节点由后端注入，前端若暂时不做「提取音频」入口按钮，可先通过 API 触发，刷新画布即可看到节点。

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

---

## 5. 注意事项

1. **失败不自动重试**：提取任务内部失败（下载/抽取/上传/无音轨）直接置 `failed`，**不重试**（暂无前端重试入口）。瞬时网络错误也终态——前端可引导用户重新发起。
2. **任务失败 → 画布节点置 failed**：后端把占位节点 `genStatus` 置 `"failed"` + `errorText`，前端刷新/水合即显示失败态。
3. **异步无同步接口**：建任务后必须轮询 `GET /api/jobs/:id`；不要假设立即出结果。进度 `progress` 0-100（阶段映射：1-20 下载 / 21-90 提取 / 91-99 上传）。
4. **画布节点注入会 bump 乐观锁版本**：后端写画布快照会 `version + 1`。前端若正持有旧版本做 `If-Match` 保存会收到 `412`——**刷新画布或从服务端重拉最新快照**后再保存。
5. **节点位置在视频右侧**：若源视频节点在画布上被移动，音频节点不会跟随（注入时按当时位置写死）。刷新后以快照为准。
6. **音频文件名 = 视频名(audio).mp3**：由后端从视频节点 `fileName` 派生（如 `测试视频.mp4` → `测试视频(audio).mp3`）。
7. **大小上限 200MB**：超限任务失败（`video_too_large`）。
8. **并发**：后端默认同时处理 2 个提取任务（容器 2 核）；多个请求排队，轮询可见。
9. **归属校验**：`source_asset_id` 必须是**当前项目内**的视频资产，跨项目/他人资产返回失败。
10. **0 表迁移**：本功能无任何表结构变更；音频资产写入既有 `assets` 表（`type=audio`），可被资产库/共享资产等既有能力使用。

---

## 6. 完整流程示例

**视频节点 → 提取音频 → 画布出现音频节点**：
1. 取视频节点 `data.assetId`（如 `3985`）
2. `POST /api/projects/:projectId/media-extractions` `{ "source_asset_id": "3985" }` → `{ job_id: "1125" }`
3. 后端已同步在画布注入占位节点（视频右侧，`genStatus:"generating"`）
4. 前端 `GET /api/jobs/1125` 轮询 → `succeeded` 后 `asset.url` 可播放；画布节点已更新为最终音频（或刷新后看到）
5. 失败 → 展示 `error.message`，画布节点显示失败态
