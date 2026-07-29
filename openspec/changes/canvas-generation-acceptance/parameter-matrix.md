# Canvas 生成能力与参数穷举矩阵

日期：2026-07-29

本矩阵把“穷举”拆成三层，避免用少量付费请求冒充全量覆盖：

1. **UI/recipe 穷举**：所有前台可选项都必须能生成确定的 recipe 和 Job payload。
2. **契约穷举**：用假 provider 遍历全部有效笛卡尔积，断言 Worker 到 New API 的最终请求体，不扣费。
3. **真实抽样**：每个模型至少一次；边界参数、引用模式和异步队列分别覆盖。图片可受控并发，视频严格串行。

只有三层均满足的能力才可写“完整”。真实调用不会遍历数千个笛卡尔积，否则成本不可控。

## 1. 五条生成链路

| 链路 | 前端入口 | recipe | Job 输入 | Worker / provider | 真实证据 | 当前状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 文生图 | 图片 Dock | `mediaKind=image`、prompt、model、比例、分辨率、数量 | Node Job | Next 内图片 Worker -> New API | Jobs 167-177 成功 | 部分完整 |
| 图生图 | 图片 Dock 引用图片 | 当前 recipe 有 URL；需要补 assetId | `reference_asset_ids` | 仅单参考图进入 `/v1/images/edits` | 尚无本轮付费成功 | 接线缺失 |
| 文生视频 | 视频 Dock | `mediaKind=video`、prompt、model、比例、清晰度、时长、模式 | Node Job | BullMQ -> Worker -> New API | Job 178、Asset 224 成功 | 完整 |
| 图生视频 | 视频 Dock 普通参考/首帧 | recipe 有 URL；需要补 assetId | 首帧/普通 reference 已分角色 | 单图片映射为 New API `image` | Job 179、Asset 225 成功 | 部分完整 |
| 视频生视频 | 视频可回填到 Dock | recipe 类型可表达 video reference | 视频 Asset 在提交层被过滤 | Worker 只解析 image Asset；New API 客户端无 video 输入 | 无法发起 | 接线缺失 |

首帧 + 尾帧不是独立第六条链路，而是图生视频的参数模式。Canvas、recipe、Job 和 Worker 已能表达两帧；当前 New API 仅有单 `image` 字段，适配器返回 `unsupported_video_inputs`，状态为“后端能力缺失”。

## 2. 图片有效组合

Node 能力表与 New API `/v1/models` 在以下 4 个图片模型 ID 上一致：

| 模型 | 分辨率 | 比例数 | 数量 | 参考图 | 联网 | 连续组图 |
| --- | --- | ---: | --- | --- | --- | --- |
| `doubao-seedream-5-0-pro-260628` | 1K/2K/4K | 8 | 1 | 0-1 实际；UI 0-4 | 否 | 否 |
| `doubao-seedream-5-0-260128` | 2K/3K/4K | 8 | 1-4 | 0-1 实际；UI 0-4 | 是 | 是 |
| `doubao-seedream-4-5-251128` | 2K/4K | 8 | 1-4 | 0-1 实际；UI 0-4 | 否 | 是 |
| `doubao-seedream-4-0-250828` | 1K/2K/4K | 8 | 1-4 | 0-1 实际；UI 0-4 | 否 | 是 |

8 个比例：`1:1`、`4:3`、`3:4`、`16:9`、`9:16`、`3:2`、`2:3`、`21:9`。

按“无参考/单参考”计算，有效 UI 笛卡尔积为 1,456 组；若把 UI 当前允许的 2-4 张参考图也算入，总选择空间为 3,640 组，但其中多参考图会被 Worker 拒绝，不能算有效能力。

### 图片字段消费状态

| 参数 | UI | recipe | Job | New API | 结论 |
| --- | --- | --- | --- | --- | --- |
| prompt | 有 | 有 | 有 | 有 | 已接线 |
| model | 动态 Node 能力表 | 有 | 有 | 有 | 4 个模型待逐模型真实验证 |
| resolution | 模型能力驱动 | 有 | 有 | 作为 `size` | 已接线 |
| aspect ratio | 8 项 | 有 | 有 | 当前未发送 | 接线缺失 |
| quantity | 1-4 | 有 | `expected_output_count` | 作为 `n` | 已接线；需 3/4 边界测试 |
| reference image | UI 0-4 | recipe 仅 URL | Asset ID | 单张走 edits | 多参考前后端不一致 |
| web search | 能力开关 | 未记录 | 有 | `tools: web_search` | recipe 缺失；真实开启待测 |
| sequential | 能力开关 | 未记录 | 有 | Worker 未消费 | 接线缺失 |

## 3. 视频有效组合

New API 有 7 个 Seedance 模型；Node 视频能力表当前只启用 3 个，视频 Dock 又只硬编码展示其中 1 个。

| 模型 | 分辨率 | 比例 | 数量 | 引用 |
| --- | --- | --- | --- | --- |
| `doubao-seedance-2-0-260128` | 480p/720p/1080p | 16:9/9:16/1:1 | 1 | 无/单图片 |
| `doubao-seedance-2-0-fast-260128` | 480p/720p | 16:9/9:16/1:1 | 1 | 无/单图片 |
| `doubao-seedance-2-0-mini-260615` | 480p/720p | 16:9/9:16/1:1 | 1 | 无/单图片 |

按 12 个时长档（4-15 秒）、3 个比例、模型各自分辨率、无引用/单图片计算，契约穷举为 504 组。真实视频不跑 504 次；按模型、分辨率边界、比例边界、时长边界和引用模式做 pairwise 串行抽样。

### 视频字段消费状态

| 参数 | UI | recipe | Job | New API | 结论 |
| --- | --- | --- | --- | --- | --- |
| prompt | 有 | 有 | 有 | 有 | 已接线 |
| model | 仅硬编码 1 个 | 有 | 有 | 有 | 前台模型列表接线缺失 |
| resolution | 全局 480/720/1080 | 有 | 有 | width/height | 未按模型能力收窄 |
| aspect ratio | UI 6 项 | 有 | 有 | width/height | 3 项超出能力表 |
| duration | 4-15 秒 | 有 | 有 | 有 | 未按模型校验；真实只测 5 秒 |
| quantity | 1-4 | recipe 未保存 | 有 | Worker 忽略 | 接线缺失；能力表实际仅 1 |
| internet search | 有开关 | 未保存 | 未发送 | 未发送 | 纯 UI |
| ordinary image reference | 有 | 有 URL | Asset ID | 单图映射 `image` | Job 179 后继续验证 |
| first frame | 有 | 有 URL | 独立 Asset ID | 单图映射 `image` | Job 179 真实成功 |
| first + last frame | 有 | 有 | 独立 Asset ID | 单字段无法表达 | 后端能力缺失 |
| video reference | 有上传/回填入口 | 类型可表达 | 被过滤 | 无字段 | 视频生视频接线缺失 |

## 4. 自动化穷举任务

- [ ] 图片 1,456 个有效组合：断言 UI 配置 -> recipe -> Job -> provider body。
- [ ] 图片 2-4 参考图：断言前台禁用或后端返回明确能力错误，不允许静默只取一张。
- [ ] 视频 504 个有效组合：断言模型、分辨率、比例、时长、单图片角色到 provider body。
- [ ] 视频无效组合：模型不支持的 1080p/比例、数量 >1、首尾帧、视频 reference 返回明确错误。
- [ ] 并发恢复：10 图片 + 多视频历史任务独立 taskId、节点、progress、Asset 映射。

## 5. 真实调用顺序

1. 图片：4 个模型各 1 次，覆盖不同分辨率/比例；再补单参考图、联网、连续组图和数量边界。
2. 视频：Job 178 文生视频、Job 179 单首帧、Job 180 Fast 480p/9:16/4 秒、Job 181 Mini 720p/1:1/5 秒均已通过 BullMQ 完成。
3. 视频：首尾帧只验证能力错误，不调用 provider 扣费。
4. 视频：Fast 已由 Job 180 覆盖 480p/竖屏/4 秒；Mini 已由 Job 181 覆盖 720p/方形/5 秒；15 秒高成本边界暂不与模型验证重复扣费。
5. 视频生视频：当前接线缺失，先完成契约设计和 RED，不直接扣费。
