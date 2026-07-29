# Test Matrix：视频生成图片/视频参考链路

| Requirement | RED/GREEN 证据 | 层 |
|---|---|---|
| REQ-1 有序 IDs | API 去重保序 + Worker resolve 顺序测试 | API / Persistence |
| REQ-2 模式互斥 | API、Worker、Core 三层拒绝混用 | API / Worker / Core |
| REQ-3 可信 Asset | 越权、缺失、audio Asset provider 未调用 | Worker |
| REQ-4 9 图 + 3 视频 | 仅图、仅视、混合、9/3 边界、10/4 越界 | Worker |
| REQ-5 视频元数据 | MIME、200 MB、2~15 秒、总时长 15 秒、宽高/比例/总像素 | Worker |
| REQ-6 neutral port | `VideoReference[]` submit 断言 | Worker |
| REQ-7 metadata.content | 捕获 POST body 精确比较 role/order/metadata | Core |
| REQ-8 Dock 图/视 | dockAccept + 画布 pick kind + ID 投影测试 | Web |
| REQ-9 MP4/MOV 上传 | accept、file input click、complete 元数据测试 | Web |
| REQ-10 范围 | git diff 确认无 `blue_whale_api` 生产文件 | Review |

## 接口门禁

前端改动前必须满足：

1. API/Core/Worker 新增测试均观察到预期 RED。
2. 最小实现后对应聚焦测试全部 GREEN。
3. `pnpm build:node` 成功。
4. 捕获的 NewAPI POST body 同 design 第 4 节一致。

## 浏览器验收

| 场景 | UI | 请求 | Worker/Asset |
|---|---|---|---|
| 画布图片参考 | 图片缩略图可见 | ID 在 references | Asset type=image |
| 画布视频参考 | 视频缩略图可见 | ID 在 references | Asset type=video |
| 本地 MP4/MOV | 上传后进入 Dock | ID 在 references | mime/size/metadata 可查 |
| 图片+视频混合 | 顺序与 Dock 一致 | IDs 顺序一致 | metadata.content role/order 一致 |
| 首尾帧互斥 | 不提交隐藏普通 refs | 无混合字段 | provider 不收到含糊请求 |
| 超限/非法视频 | 显示稳定错误 | provider 未调用 | Job 失败 code 可解释 |

## 真实链路证据（2026-07-29）

- 本地登录后完成参考视频 presign、TOS PUT、complete；参考 Asset `236` 为
  `video/mp4`、1280x720、3 秒，`duration_ms=3000`。
- 本地创建 GenerationJob `193`，输入为 Seedance 2.0 + `reference_asset_ids=["236"]`；
  Worker 取得真实 `provider_task_id`，NewAPI 回查状态为 `SUCCESS`。
- Job `193` 最终 `succeeded / progress=100`，输出 Asset `237`；TOS HEAD 为
  `200 video/mp4`，`ffprobe` 确认为 H.264 + AAC、1280x720、约 5.06 秒。

## 批量 Job / 真实并发验收（2026-07-29）

- `GET /api/jobs?ids=...`：10 个真实 Job 每个 3 秒周期只发一个批量请求，共 281 轮；
  响应始终返回 10 条当前用户记录。
- 真实网关并发提交：10/10 接受（Job `206`–`215`，项目 `58`，参考视频 Asset `236`）。
- 终态：9 succeeded（输出 Asset `240`–`248`，视频/mp4），1 failed（Job `207`，上游
  `OutputAudioSensitiveContentDetected.PolicyViolation`；Worker 已将 NewAPI `FAILURE`
  映射为终态 failed）。
