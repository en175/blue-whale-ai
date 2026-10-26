# new-api 网关视频参考提交 51s 同步耗时归因

> 归因日期：2026-09-29
> 工单：IKJ80O（母单 IKJ80I）
> 范围：new-api 网关（测试站 14.103.43.52:3006）处理带 video_url 参考的视频提交为何需约 51 秒；耗时在网关同步下载/转存/探测素材，还是上游渠道同步等待；给出修复归属与跟进方。
> 来源边界：仓内代码与文档（worker 客户端、ADR、素材 API 契约）；new-api 开源源码（QuantumNous/new-api，fork 基线版与最新 main）；火山方舟官方 API 文档原文（经仓内调研笔记 `2026-09-29-seedance-2-5-omni-reference-ratio.md` 引用）。网关调用凭证不在本调研进程环境（ADR-0064 凭证纪律），未做网关复测与上游直测，相关项标注未证实。

## 1. 探针数据归档（2026-09-29 实测，引自母单 IKJ80I）

同网关、同模型 `doubao-seedance-2-5-260628`、同凭证，22:20 前后：

| 探针 | 结果 |
| --- | --- |
| 网关 /v1/models 探活 | 53ms 正常 |
| 无效模型提交 | 41ms 快速 503（分发层正常） |
| 无参考提交 | 1.4s 成功 |
| 仅图片参考提交 | 6.2s 成功 |
| 仅视频参考提交 | 45s 掐断无响应；放长等待后 **51.1s 返回成功（task queued）** |
| 完整参考（2 图 + 1 视频，与失败任务一致） | 45s+ 掐断无响应（未等到返回） |
| 参考素材本体 | 22MB mov，外网下载仅 12.7s（约 1.7MB/s） |

素材物理存储：本地 Asset 走 TOS URL（`bluewhale-asset.tos-cn-shanghai.volces.com`，见 `docs/api/2026-09-07-material-association-api.md` §1 示例）；已关联素材库的素材由 worker 改以 `asset://<素材ID>` 载体提交（ADR-0077），由网关解析。

## 2. 归因结论

**51s 的主体是「参考素材的同步下载/探测」耗时，发生在网关同步等待上游「创建任务」返回期间；下载/探测的主体在上游渠道侧（火山方舟创建任务时获取素材），而非 new-api 网关自身的计算环节。**网关在这 51s 里只是同步挂起等待上游 HTTP 响应——开源 new-api 的 doubao 视频渠道代码对素材 URL 是纯透传，不下载、不转存、不探测。

分级证据：

| 结论 | 级别 | 依据 |
| --- | --- | --- |
| 耗时与参考素材体量线性相关，构成是素材下载/探测 | 已证实（探针数据） | 无参考 1.4s / 仅图片 6.2s / 仅视频 51.1s；完整参考（2 图 + 1 视频）总素材量最大，45s+ 仍未返回。22MB ÷ 49.7s ≈ **0.44MB/s（约 3.6Mbps）** 的恒定拉取速率量级；仅图片档的 +4.8s 若按 2-4MB 图片估算也在同一速率量级（图片字节数探针未记录，此项为推断） |
| 素材源站出口带宽不是瓶颈 | 已证实 | 同一素材 URL 外网下载 12.7s（1.7MB/s），比链路内拉取快约 4 倍 |
| 网关分发/转发层健康，非网关计算瓶颈 | 已证实（探针数据） | /v1/models 53ms、无效模型 41ms 快速 503 |
| worker 不传素材本体，素材以 URL 引用提交 | 已证实（仓内源码） | `NewApiVideoClient.java:100-121`（`buildContentItem`，video_url 仅 URL 字符串）、`:145-150`（请求体）；`VideoJobProcessor.java:854`（素材库引用转 `asset://` 载体） |
| new-api 网关 doubao 视频渠道纯透传，不下载素材 | 已证实（开源源码，两代实现） | 见 §3.2：fork 基线（2026-07，Go 适配器）与最新 main（JS 插件）都只做请求形状转换，video_url 原样转发 |
| 上游火山方舟在创建任务时同步获取（下载/探测）素材 | 机制已证实（官方文档），耗时占比强推断 | Ark 官方 API 文档：`omni_reference_task_type` 的 edit 取值「content 中必须至少包含一个 reference_video，**且视频时长必须为 4–30 秒**……接口在提交任务时提前校验」；duration 参数「传入的待编辑视频时长需在 [4, 30]s 内，否则将触发报错」——时长校验必须先获取素材，HTTP 响应头给不了。文档站 JS 渲染，原文经仓内调研笔记 `2026-09-29-seedance-2-5-omni-reference-ratio.md` §2.2/§2.5 引用（官方页面 2026.09.22 版） |
| 下载/探测的确切主体（Ark 直拉 vs 中转层拉取） | 未证实 | 需网关日志或上游直测分辨（无凭证，见 §6） |

## 3. 代码级证据链

### 3.1 worker → 网关：素材只传引用

- `server/blue-whale-worker/src/main/java/com/bluewhale/worker/infrastructure/gateway/NewApiVideoClient.java`
  - `:66` `SUBMIT_TIMEOUT_MS = 30_000`——worker 侧 30s 提交超时即母单根因；
  - `:108-121` references 按类型映射 `image_url`/`audio_url`/`video_url`，URL 为字符串引用；
  - `:145-150` 请求体 `{model, prompt, duration, response_format:"url", metadata:{content:[...]}}`。
- `server/blue-whale-worker/src/main/java/com/bluewhale/worker/application/processor/VideoJobProcessor.java:854`：素材库引用以 `asset://<素材ID>` 载体交给网关（ADR-0077：素材库由网关 blue-whale-api 对外暴露）；本地 Asset 走 TOS URL。

即：22MB 素材的下载只可能发生在网关侧或上游侧，不在 worker。

### 3.2 new-api 网关：doubao 视频渠道纯透传（开源源码）

blueapi（blue-whale-api）是 new-api 的二开 fork（ADR-0020 部署、ADR-0063 渠道决策），私有仓 `gitee.com/hangzhou-xuanfu_1/blue-whale-api` 本调研不可访问（403），以下按上游开源源码同构分析，覆盖两代实现：

- **fork 基线代**（2026-07-20 时点 main，commit `5a6c53d`，Go 适配器）`relay/channel/task/doubao/adaptor.go`：
  - `:126` `BuildRequestURL` → `{baseURL}/api/v3/contents/generations/tasks`（火山 Ark 原生端点）；
  - `:273-302` `convertToRequestPayload` 仅做形状转换（images + metadata.content 合并、拼 prompt）；
  - 全文无 download/fetch/TOS/upload/probe 逻辑——video_url 原样透传。
- **最新 main 代**（JS 插件）`plugins/tasks/doubao/plugin.js`（1077 行）：`buildSubmitRequest` 把 content（含 video_url 条目）原样 concat 后 POST 到 Ark，同样无素材下载逻辑。
- 通用任务提交层 `relay/relay_task.go`：`io.ReadAll` 仅读上游响应，无素材下载。

fork 的二开记录（ADR-0062/0063/0077/0114）均为渠道类型、计费、身份、素材库 asset:// 解析等，无「素材转存/预下载」记录。**唯一未核实项**：fork 对 `asset://` 载体的解析实现（解析成物理 URL 转发，还是下载转存）——见 §6。

### 3.3 上游火山方舟：创建任务时同步获取素材

官方文档（创建视频生成任务 API，doc 82379/1520757，2026.09.22 版，原文经 `docs/research/2026-09-29-seedance-2-5-omni-reference-ratio.md` §2.2/§2.5 引用）：

> 「显式指定任务类型，即 omni_reference_task_type 为 reference、edit 或 extend：**接口在提交任务时提前校验对应任务的特殊参数限制。**不符合要求时，接口立即报错，任务不会创建。」
> 「设置 edit 时，content 中必须至少包含一个 reference_video，**且视频时长必须为 4–30 秒**」
> 「传入的待编辑视频时长需在 [4, 30]s 内，否则将触发报错」

视频时长（以及模型对素材的语义理解）无法从 URL 字符串获得——上游必须先拉取素材再建任务，素材拉取时间被同步计入「创建任务」HTTP 响应，逐层透传回 worker 的 submit 调用。这与探针「51.1s 后返回成功（task queued）」吻合：上游任务确实创建成功，慢在建单前的素材获取。

## 4. 耗时分解

| 环节 | 耗时 | 级别 |
| --- | --- | --- |
| worker 构建请求 + 网关接收/分发 | <0.1s | 已证实（无效模型 41ms 快速 503） |
| 网关 → 上游建任务链路基线（无素材时） | ~1.4s | 已证实（无参考探针） |
| 参考素材同步拉取/探测：图片（2 张） | ~4.8s | 已证实增量（6.2 − 1.4），字节数未记录 |
| 参考素材同步拉取/探测：22MB 视频 | ~49.7s（0.44MB/s） | 已证实增量（51.1 − 1.4） |
| 完整参考（2 图 + 1 视频） | >45s 未完成，预计 ≥55s | 推断（两档串行累加，与 45s 掐断无响应一致） |
| 网关服务器自身出口带宽受限导致慢 | 不成立（就现有证据） | 素材源站 TOS 公网下载 1.7MB/s，链路内拉取 0.44MB/s；瓶颈在拉取方（上游渠道）到源站的路径或拉取方自身限速，而非网关出口（网关按开源源码不下载素材） |

## 5. 修复归属与跟进建议

| 归属 | 判断 | 依据 |
| --- | --- | --- |
| 网关配置 | 无证据需要改 | 探针显示分发层健康；耗时是上游建单链路的固有同步成本 |
| 网关代码 | 无需改（开源部分）；fork 一处待核实 | 开源 doubao 渠道纯透传无耗时环节；fork `asset://` 解析实现待内部核实（若 fork 在解析时同步转存素材，则网关侧可优化——见 §6①） |
| 上游渠道 | **主要归属** | 素材拉取/探测在上游建单链路内同步发生，22MB 素材 0.44MB/s 的拉取速率显著低于素材源站公网出口能力（1.7MB/s），慢点在上游侧或上游到素材源站的网络路径 |

跟进方与建议（建单归协调者，此处仅建议）：

1. **内部网关维护方（blue-whale-api fork 维护者）**：自查 fork 对 `asset://` 载体的处理（§6①）与测试站 `doubao-seedance-2-5-260628` 的渠道类型（§6②），拿到网关日志的 submit 耗时分解后即可闭环本报告的未证实项。
2. **短期解锁（已在做）**：IKJ80M 提长 worker 提交超时（≥120s）是对「上游建单天然慢」的适配，不依赖上游修复。
3. **中期优化（若要压耗时）**：候选方向是让上游更快拿到素材或绕过同步拉取——例如素材转存至火山生态内网可达存储（TOS 北京/同区域）、或上游侧预上传接口；需先完成 §6①② 核实再评估，且归属可能落在上游渠道侧，建议以跟进工单形式立项。
4. **上游渠道侧**：若 §6③ 直测证明 Ark 直连同样 ~50s，则素材拉取速度属火山方舟服务能力，只能走工单/商务渠道反馈或以 3 的转存方案绕过。

## 6. 未证实项清单

1. **fork `asset://` 解析实现**（私有仓不可访问）：blueapi 收到 `asset://<素材ID>` 后是解析物理 URL 转发还是同步下载转存。若为后者，网关侧存在可优化点，本报告「网关代码无需改」的结论需修正。探针是否使用 asset:// 形态提交也未记录——探针直接打网关接口，很可能用了公网 http URL，此时 51.1s 已不含 asset:// 解析环节，结论不受影响。
2. **测试站渠道类型**：doubao-seedance-2-5-260628 配的是 doubao 直连渠道（blueapi → Ark）还是 New API 中转渠道（blueapi → neovixai 等 new-api 系厂商 → Ark，ADR-0063 首个上游为 neovixai）。中间层多一层，素材拉取主体就多一个候选。探针「无效模型 41ms 503」只证明分发层健康，不区分渠道类型。
3. **上游直测**：无 Ark 凭证（凭证只在网关侧，ADR-0064 纪律），未直测「绕过网关直接向 Ark 提交同素材」的耗时——这是区分「Ark 拉」与「中间层拉」的最短实验。
4. **网关日志**：无服务器访问权限（SSH key 在部署机），未拿到 submit 期间的网关侧耗时分解日志。
5. **图片参考素材字节数**：探针未记录，「速率恒定量级」中图片档速率系估算。

## 7. 附带说明

- worker 30s 放弃后上游任务实际已创建的「孤儿任务」问题由 IKJ80P 治理，不在本报告范围。
- 素材库关联素材走 `asset://`（ADR-0077/0087）、本地 Asset 走 TOS URL 两条路径在 worker 侧并存（`VideoJobProcessor.java:738-854`），耗时归因对两者同构——素材获取都发生在网关及更上游。
