# Seedance 视频参考素材与 NewAPI 网关契约核验

> 核验日期：2026-07-29  
> 范围：Seedance 当前视频模型、图片/视频参考素材组合与限制、NewAPI 的模型列表和请求转发方式，以及 Blue-Whale 当前接入差距。  
> 来源边界：只使用火山方舟官方文档、NewAPI 官方仓库源码和本仓库代码。未发起付费生成请求。

## 结论

1. **Seedance 2.0 支持参考图片和参考视频同时输入。** 多模态参考生视频允许
   `0~9` 张参考图、`0~3` 个参考视频和可选提示词；忽略本工单不处理的音频后，
   产品可以支持“仅图片”“仅视频”“图片 + 视频”三种组合。若产品做成图片/视频互斥，
   那是产品收窄，不是模型限制。  
   来源：[火山方舟「创建视频生成任务 API」—模型能力与 content](https://www.volcengine.com/docs/82379/1520757)。
2. **“参考视频只能有 1 个”的猜测不成立。** 官方上限是 `3` 个；每个视频时长
   `2~15s`，所有参考视频总时长不超过 `15s`。  
   来源：[火山方舟「创建视频生成任务 API」—视频信息](https://www.volcengine.com/docs/82379/1520757)。
3. **参考图也不止 1 张。** Seedance 2.0 多模态参考模式允许 `1~9` 张；
   单首帧模式固定 `1` 张，首尾帧模式固定 `2` 张。三种模式互斥，不能把
   `first_frame/last_frame` 与 `reference_image/reference_video` 混在同一请求中。  
   来源：[火山方舟「创建视频生成任务 API」—图片数量、role 与互斥规则](https://www.volcengine.com/docs/82379/1520757)。
4. **只有 Seedance 2.0 系列支持视频输入。** Seedance 1.5/1.0 仍只支持文生视频、
   首帧图生视频或部分首尾帧能力。  
   来源：[火山方舟模型列表](https://www.volcengine.com/docs/82379/1330310)、
   [创建视频生成任务 API](https://www.volcengine.com/docs/82379/1520757)。
5. **NewAPI 能透传混合图片/视频，但必须走 `metadata.content`。** 官方 Doubao
   适配器的 `ContentItem` 已包含 `image_url`、`video_url` 与 `role`，并会把
   `metadata` 反序列化到上游请求；它没有校验 Seedance 的素材数量、格式、时长或大小，
   这些必须由 Blue-Whale 预校验，最终仍由火山方舟强校验。  
   来源：[NewAPI Doubao 适配器](https://github.com/QuantumNous/new-api/blob/c27d1ef651c608dd8b9e60848a7e0f13a8619d9b/relay/channel/task/doubao/adaptor.go#L31-L64)、
   [metadata 转换实现](https://github.com/QuantumNous/new-api/blob/c27d1ef651c608dd8b9e60848a7e0f13a8619d9b/relay/channel/task/taskcommon/helpers.go#L14-L29)。

## 1. Seedance 模型能力

火山方舟当前公开的模型能力如下。模型 ID 和输出规格来自官方模型列表；输入视频能力来自
创建任务 API 对各系列的能力说明。

| 模型                                  | 多模态参考（图片/视频） | 首尾帧 | 首帧 | 文生视频 | 输出规格                                               |
| ------------------------------------- | ----------------------- | ------ | ---- | -------- | ------------------------------------------------------ |
| `doubao-seedance-2-0-260128`          | 支持，含视频输入        | 支持   | 支持 | 支持     | 480p/720p/1080p/4K，24fps，4~15s，MP4                  |
| `doubao-seedance-2-0-fast-260128`     | 支持，含视频输入        | 支持   | 支持 | 支持     | 480p/720p，24fps，4~15s，MP4                           |
| `doubao-seedance-2-0-mini-260615`     | 支持，含视频输入        | 支持   | 支持 | 支持     | 480p/720p，24fps，4~15s，MP4                           |
| `doubao-seedance-1-5-pro-251215`      | 不支持视频输入          | 支持   | 支持 | 支持     | 480p/720p/1080p，24fps，4~12s，MP4；官方标记“即将下线” |
| `doubao-seedance-1-0-pro-250528`      | 不支持视频输入          | 支持   | 支持 | 支持     | 480p/720p/1080p，24fps，2~12s，MP4                     |
| `doubao-seedance-1-0-pro-fast-251015` | 不支持视频输入          | 不支持 | 支持 | 支持     | 480p/720p/1080p，24fps，2~12s，MP4                     |

来源：[火山方舟「模型列表」Seedance 表](https://www.volcengine.com/docs/82379/1330310)；
[火山方舟「创建视频生成任务 API」模型能力](https://www.volcengine.com/docs/82379/1520757)。

### 1.1 三种图片输入语义不能混用

| 场景             | 素材                            | `role`                                               |
| ---------------- | ------------------------------- | ---------------------------------------------------- |
| 首帧图生视频     | 1 张图                          | `first_frame` 或不填                                 |
| 首尾帧图生视频   | 2 张图                          | 分别为 `first_frame`、`last_frame`                   |
| 多模态参考生视频 | 1~~9 张图，可同时有 0~~3 个视频 | 每张图 `reference_image`，每个视频 `reference_video` |

火山方舟明确声明“首帧”“首尾帧”“多模态参考”是三个互斥场景。多模态参考可以在提示词中
指定某张参考图作为首尾帧，但这不等于严格的首尾帧约束；需要精确首尾帧时应使用独立的
首尾帧模式。来源：[创建视频生成任务 API—图片 role 与互斥说明](https://www.volcengine.com/docs/82379/1520757)。

对本工单的直接含义：

- 画布/Bottom Dock 的“引用素材”应生成 `reference_image` 或 `reference_video`，
  不应复用首尾帧字段表达一般参考素材。
- 如果现有产品保留首帧/尾帧入口，应在请求校验中拒绝它与一般参考素材同时出现。
- 不考虑音频时，参考素材集合可以是 `1~9` 张图片、`1~3` 个视频，或两类同时存在；
  图片和视频各自计数，不是共享一个“最多 3 个”的总额度。

## 2. 参考视频上传规则

单个参考视频的官方约束如下：

| 维度         | 限制                                                         |
| ------------ | ------------------------------------------------------------ |
| 数量         | 最多 3 个                                                    |
| 时长         | 每个 2~15 秒；全部视频总时长 ≤15 秒                          |
| 大小         | 每个 ≤200 MB                                                 |
| 容器/扩展名  | MP4 (`.mp4`) 或 QuickTime (`.mov`)                           |
| MIME         | `video/mp4`、`video/quicktime`                               |
| 视频编码     | H.264/AVC 或 H.265/HEVC                                      |
| 音轨编码     | AAC 或 MP3                                                   |
| 输入分辨率档 | 480p、720p、1080p、4K                                        |
| 宽高比       | 0.4~2.5                                                      |
| 单边像素     | 300~6000 px                                                  |
| 总像素       | 409,600~8,295,044                                            |
| 帧率         | 24~60 FPS                                                    |
| API 载体     | 公网 URL 或 `asset://<ASSET_ID>`；视频字段未提供 Base64 形态 |
| role         | `reference_video`                                            |

来源：[火山方舟「创建视频生成任务 API」—`content.video_url` 与单个视频要求](https://www.volcengine.com/docs/82379/1520757)。

上传侧不能只校验扩展名和 `Content-Type`。推荐在完成上传前/后探测容器、编码、时长、
宽高和 FPS，并至少拒绝：

- 非 MP4/MOV、非 H.264/H.265 的文件；
- `<2s`、`>15s`，或加入后使全部参考视频总时长超过 `15s` 的文件；
- `>200MB`、尺寸/FPS/像素数越界的文件。

### 2.1 真人脸素材限制

Seedance 2.0 不接受任意“直接上传的真人人脸参考图/视频”。官方允许的替代路径包括
受信任的模型原始产物、预置虚拟人像和已授权真人素材；含人脸原始视频仅明确支持
“本账号近 30 天内由 Seedance 2.0 系列生成”的素材再次输入。

来源：[创建视频生成任务 API—真人脸输入警告与视频信息](https://www.volcengine.com/docs/82379/1520757)、
[录入真人形象素材](https://www.volcengine.com/docs/82379/2315856)。

因此 UI 文案不能承诺“任意视频都能作为参考”。普通无真人脸视频可以走 Blue-Whale 公网
Asset URL；授权真人素材若后续支持，应另存火山 `asset://` ID 与授权状态，不能只保存普通 URL。

## 3. 参考图片规则

| 维度           | 限制                                                                |
| -------------- | ------------------------------------------------------------------- |
| 多模态参考数量 | 1~9 张                                                              |
| 格式           | JPEG、PNG、WebP、BMP、TIFF、GIF；Seedance 1.5/2.0 另支持 HEIC、HEIF |
| 单张大小       | `<30 MB`                                                            |
| 整个请求体     | ≤64 MB；大文件不应使用 Base64                                       |
| 宽高比         | 0.4~2.5                                                             |
| 单边像素       | 300~6000 px                                                         |
| API 载体       | 公网 URL、Base64 data URI 或 `asset://<ASSET_ID>`                   |
| role           | 多模态参考为 `reference_image`                                      |

来源：[火山方舟「创建视频生成任务 API」—`content.image_url`、图片数量与 role](https://www.volcengine.com/docs/82379/1520757)。

Blue-Whale 当前图片上传全局上限是 20 MB，严于供应商的 30 MB，可以保留；但视频生成
入口当前若继续只允许 4 张参考图，应明确这是产品上限，不能写成“Seedance 最多 4 张”。
本仓依据：[`handle-upload.ts`](../../blue_whale_web/lib/assets/handle-upload.ts)、
[`handle-create-generation-job.ts`](../../blue_whale_web/lib/generation/handle-create-generation-job.ts)。

## 4. NewAPI 模型列表与兼容请求

### 4.1 内置模型列表并不完整

截至 NewAPI 官方仓库提交
[`c27d1ef`](https://github.com/QuantumNous/new-api/commit/c27d1ef651c608dd8b9e60848a7e0f13a8619d9b)，
Doubao Video 内置列表为：

```text
doubao-seedance-1-0-pro-250528
doubao-seedance-1-0-lite-t2v
doubao-seedance-1-0-lite-i2v
doubao-seedance-1-5-pro-251215
doubao-seedance-2-0-260128
doubao-seedance-2-0-fast-260128
```

来源：[NewAPI `doubao/constants.go`](https://github.com/QuantumNous/new-api/blob/c27d1ef651c608dd8b9e60848a7e0f13a8619d9b/relay/channel/task/doubao/constants.go#L5-L12)。

它与 2026-07-29 的火山方舟官方列表有差异：

- 缺少已经公开的 `doubao-seedance-2-0-mini-260615`；
- 仍列出当前火山模型列表页未展示的 `1-0-lite-t2v/i2v`；
- 未列出当前火山页展示的 `doubao-seedance-1-0-pro-fast-251015`。

所以 NewAPI `ModelList` 只能视为网关内置默认值，不能作为 Seedance 能力上限；上线模型仍应
以火山方舟当前开通状态和实际 Channel 模型配置为准。来源：
[火山方舟模型列表](https://www.volcengine.com/docs/82379/1330310)、
[NewAPI 内置列表](https://github.com/QuantumNous/new-api/blob/c27d1ef651c608dd8b9e60848a7e0f13a8619d9b/relay/channel/task/doubao/constants.go#L5-L12)。

本仓 `blue_whale_api` 导入的是同一 NewAPI 代码族，当前列表与上述官方源码一致；
本仓直连 Java 适配器固定为 `doubao-seedance-2-0-260128`。本仓依据：
[`blue_whale_api/.../doubao/constants.go`](../../blue_whale_api/relay/channel/task/doubao/constants.go)、
[`GenerationAdapterProperties.java`](../../blue_whale_server/blue-whale-agent/blue-whale-agent-service/src/main/java/com/blue/whale/agent/service/generation/GenerationAdapterProperties.java)。

### 4.2 路由与字段映射

NewAPI 提供 `POST /v1/video/generations` 和 `GET /v1/video/generations/{task_id}`；
同时注册了 `/v1/videos` 兼容路由。Blue-Whale 现有客户端使用前一组路由，可继续保持。
来源：[NewAPI `video-router.go`](https://github.com/QuantumNous/new-api/blob/c27d1ef651c608dd8b9e60848a7e0f13a8619d9b/router/video-router.go#L19-L32)。

Doubao 适配器可透传的上游结构包含：

```json
{
  "model": "doubao-seedance-2-0-260128",
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
    },
    {
      "type": "text",
      "text": "让视频中的主体参考图片中的造型"
    }
  ],
  "resolution": "720p",
  "ratio": "16:9",
  "duration": 8
}
```

NewAPI 的公开兼容请求不是直接发送上述 Ark body，而是把供应商字段放在
`metadata` 中：

```json
{
  "model": "doubao-seedance-2-0-260128",
  "prompt": "让视频中的主体参考图片中的造型",
  "metadata": {
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
    ],
    "resolution": "720p",
    "ratio": "16:9",
    "duration": 8
  }
}
```

依据：

- `ContentItem` 明确包含图片、视频和 `role`：
  [NewAPI `adaptor.go` L31-L38](https://github.com/QuantumNous/new-api/blob/c27d1ef651c608dd8b9e60848a7e0f13a8619d9b/relay/channel/task/doubao/adaptor.go#L31-L38)。
- `requestPayload` 包含 `content/resolution/ratio/duration`：
  [NewAPI `adaptor.go` L44-L64](https://github.com/QuantumNous/new-api/blob/c27d1ef651c608dd8b9e60848a7e0f13a8619d9b/relay/channel/task/doubao/adaptor.go#L44-L64)。
- 适配器把 `metadata` JSON 解到上游 request，并重建唯一的文本项：
  [NewAPI `adaptor.go` L276-L307](https://github.com/QuantumNous/new-api/blob/c27d1ef651c608dd8b9e60848a7e0f13a8619d9b/relay/channel/task/doubao/adaptor.go#L276-L307)。

注意以下兼容细节：

1. NewAPI 会要求顶层 `prompt` 非空，即使火山方舟多模态参考模式允许提示词省略。  
   来源：[NewAPI `relay_utils.go` L136-L140、L283-L312](https://github.com/QuantumNous/new-api/blob/c27d1ef651c608dd8b9e60848a7e0f13a8619d9b/relay/common/relay_utils.go#L136-L140)。
2. 顶层 `images` 会被转成没有 `role` 的 `image_url`；需要多参考图/视频时应统一使用
   `metadata.content`，不要混用顶层 `image/images`。  
   来源：[NewAPI `adaptor.go` L280-L305](https://github.com/QuantumNous/new-api/blob/c27d1ef651c608dd8b9e60848a7e0f13a8619d9b/relay/channel/task/doubao/adaptor.go#L280-L305)。
3. Doubao 适配器只从 `req.Seconds` 或 `metadata.duration` 写入 Ark `duration`；
   顶层 `duration` 虽会被通用请求对象解析和计费用，但该适配器没有把
   `req.Duration` 写回上游 payload。为避免输出时长丢失，应在
   `metadata.duration` 中显式发送。  
   来源：[NewAPI `TaskSubmitReq`](https://github.com/QuantumNous/new-api/blob/c27d1ef651c608dd8b9e60848a7e0f13a8619d9b/relay/common/relay_info.go#L837-L848)、
   [Doubao 转换逻辑](https://github.com/QuantumNous/new-api/blob/c27d1ef651c608dd8b9e60848a7e0f13a8619d9b/relay/channel/task/doubao/adaptor.go#L292-L305)。
4. NewAPI 通用校验只检查 prompt 与请求输出时长的宽泛上限 `3600s`，不检查
   Seedance 输入视频的 `2~15s`、总时长、格式、分辨率或 200 MB 上限。  
   来源：[NewAPI `relay_utils.go` L136-L156](https://github.com/QuantumNous/new-api/blob/c27d1ef651c608dd8b9e60848a7e0f13a8619d9b/relay/common/relay_utils.go#L136-L156)。

## 5. Blue-Whale 当前差距与实现边界

### 5.1 当前两个视频 provider 端口都只表达一张图片

- TypeScript `GenerateVideoInput` 只有 `image?: string`，没有视频或多素材集合；
- Worker 在 provider 调用前拒绝 `reference_asset_ids.length > 1`，并要求所有输入素材
  都是图片；
- NewAPI 客户端虽然已有 `firstFrameImage/lastFrameImage/referenceImages` 形态，但仍主动
  拒绝首尾帧或多参考素材，且没有 `referenceVideos`；
- Java `SeedanceAsyncGenerationProvider` 也只从单个 `referenceAssetId` 构造一个
  `image_url`，未传 `role`。

本仓依据：
[`video-provider.ts`](../../blue_whale_web/lib/generation/worker/video-provider.ts)、
[`generation-worker.ts`](../../blue_whale_web/lib/generation/worker/generation-worker.ts)、
[`new-api-client.ts`](../../packages/core/src/new-api-client.ts)、
[`SeedanceAsyncGenerationProvider.java`](../../blue_whale_server/blue-whale-agent/blue-whale-agent-service/src/main/java/com/blue/whale/agent/service/generation/SeedanceAsyncGenerationProvider.java)。

### 5.2 建议本工单采用的最小产品契约

音频不进入本工单。一般参考素材统一表达为有序集合，例如：

```ts
type VideoReference = {
  assetId: string;
  type: "image" | "video";
};
```

边界建议：

- 允许 `0~9` 张参考图和 `0~3` 个参考视频混合；若 UI 暂时收窄数量，错误文案写成产品限制；
- 每个视频必须满足第 2 节约束，且视频总时长 ≤15 秒；
- provider 转换时按素材顺序生成 `metadata.content`，分别标
  `reference_image/reference_video`；
- 首帧/尾帧继续使用独立字段和独立模式；服务端拒绝它与一般 reference 集合共存；
- 上传按钮接受 `.mp4,.mov,video/mp4,video/quicktime`，不能只接受 MP4；
- 从画布选择时只展示 `image` 与 `video` 节点/Asset，音频过滤掉；
- 不把 NewAPI 内置 ModelList 当成能力判断；至少以模型是否属于 Seedance 2.0 系列
  决定能否使用 `video_url`。

## 6. 本工单可直接采用的验收断言

1. 画布视频节点和本地 MP4/MOV 文件都能成为 Bottom Dock 的参考视频。
2. 仅图片、仅视频、图片+视频三种参考组合都能构造正确 `metadata.content` 与 role。
3. 第 4 个视频、单视频超 15 秒、总视频超 15 秒、单文件超 200 MB 在提交前被拒绝。
4. 首尾帧模式与一般参考模式同时出现时被拒绝，不向上游发送含糊请求。
5. NewAPI 请求在 `metadata` 中携带 `content/resolution/ratio/duration`，且顶层
   `prompt/model` 保持非空。
