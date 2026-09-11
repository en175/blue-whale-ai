# 一档能力按参考图别名分流上游模型名 + 提示词长度目录化

**状态**：accepted（2026-09-10，IKESD6 / IKESD9）；2026-09-11 经 IKF4LI **部分修订**（见文末「修订一」——gpt-image-2 侧改由出站协议分流，`i2i_model_name` 对 gpt-image-2 作废）

能力目录里上游模型按输入模态拆名的档位（gpt-image-2-text-to-image / gpt-image-2-edit、nano-banana-2-t2i / i2i），对用户合并为**一档能力**：主行 `model_id` 承载文生图上游名，`features.i2i_model_name` 承载图生图上游名，执行侧（worker-java image 链——IKESD6 二轮拍板：Node worker 退役中，分流不落旧版）在「行配了别名 且 本 job 带参考图」时换用别名；`features.max_prompt_length` 同时把提示词上限从三层硬编码改为目录可配（image-2 配 32000，组合上限取 `max(30000, 模型值)`）。分流是纯数据驱动，无开关、无按模型特判——上游只暴露单一模型名的档位（seedream / banana 单名）不配别名即行为不变。

## Considered Options

- **维持双行目录**：模型列表永远半数是重复档位，否决（本单动因）。
- **新增 text2image / image2image 能力类型**：能力类型是生成种类（仅 image/video/text/audio 四种，创建后不可改），模态是同一档的运行方式，塞进类型枚举会污染白名单与目录语义，否决。
- **创建任务时分流（把别名写进 frozen input.model_id）**：污染快照的 canonical 语义——白名单校验、重试沿用原 input、恢复重投、计费对账全部要跟着判别名，否决。别名 swap 只发生在执行侧出站 HTTP body 的 `model` 字段。

## Consequences

- 被合并的图生图行（id 37 `gpt-image-2-edit`、id 34 `nano-banana-2-i2i`）**软删**；`uk_provider_model` 唯一键含软删行，这两个上游名永久不可再建同名列。旧主行 `gpt-image-2` / `gpt-image-2-light`（停用未删）占着干净名，故合并主行沿用 `gpt-image-2-text-to-image` 现名，model_id 与展示语义不再望文生义——label 才是用户看到的。
- 测试站画布各有 1 个节点引用被软删的 edit 名，重跑会报「model_id 不在白名单」需重选模型（已确认接受；不改写用户画布 JSON）。
- worker-java 迁移为同一张表同一 MQ（停一开一），别名分流语义已作为**冻结增量**写入 [IKEL4A 迁移契约 §11](../specs/2026-09-10-ikel4a-worker-java-migration-contract.md)，Java 侧（刀③ image 链）必须逐字复刻 canonical 语义；TS worker 退役中不再实现分流。
- 测试站目录数据自本次起以仓库 migration/seed 为准回写，消除「线上行只活在测试站」的漂移。

## 修订一（2026-09-11，IKF4LI）：gpt-image-2 改走出站协议分流，别名让位

**触发**：上游 gpt-image-2 换成官方 OpenAI Images 协议，旧的建桥渠道（模型名拼 URL 路径）废弃。实测（2026-09-11，真实调用）：`generations` 带 `image` 字段 400 `Unknown parameter: 'image'`、带 `response_format` 400；图生图**必须**走 `/v1/images/edits` multipart，而**模型名恒为 `gpt-image-2`，不因模态而变**。

**结论**：本文档的前提（「上游按输入模态拆名」）对 gpt-image-2 不再成立，`i2i_model_name` 换名机制对本档位**失去对象**。

- **新决策**：出站形态由能力行 `features.image_protocol` 声明，不按模型名特判。
  - `openai-images`（gpt-image-2）：无参考图走 generations(JSON)、有参考图走 edits(multipart，参考图下载成字节)；模型名恒为 `model_id`，**端点分流代替换名**。
  - `inline-image`（缺省，banana / seedream 现状）：恒 generations + `body.image`，此形态下才应用本文档的 `i2i_model_name` 换名。**本文档的别名机制整体保留**，只是不再是 gpt-image-2 的实现方式。
- **目录 id 回归干净名**：合并主行从 `gpt-image-2-text-to-image` 迁回 `gpt-image-2`（015 的原始名，也正是上游模型名 → 出站零映射）。这**推翻了本文档 Consequences 第 1 条**当时的取舍——那时保留漂移名是为了避开 `uk_provider_model` 的软删占位与用户画布引用；现在上游名与我方 id 重合的收益更大，且用户明确选择接受引用代价。
- **接受的代价**（用户 2026-09-11 拍板）：不加 `gpt-image-2-text-to-image → gpt-image-2` 兼容别名。老画布节点/历史 job 里存的旧 id 不再被解析，重跑会在白名单校验处 400，需重选模型——与本文档 Consequences 第 2 条对软删行接受的代价同类。
- **同步**：契约 §11 第 3 条被 §12 收窄，明细见 [IKEL4A 迁移契约 §12](../specs/2026-09-10-ikel4a-worker-java-migration-contract.md)。
