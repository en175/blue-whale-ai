# 一档能力按参考图别名分流上游模型名 + 提示词长度目录化

**状态**：accepted（2026-09-10，IKESD6 / IKESD9）；2026-09-11 经 IKF4LI **部分修订**（见文末「修订一」——gpt-image-2 侧改由出站协议分流，`i2i_model_name` 对 gpt-image-2 作废）；2026-09-20 经 IKH4B8 **修订**（见文末「修订二」——提示词上限取值改为配置优先）

能力目录里上游模型按输入模态拆名的档位（gpt-image-2-text-to-image / gpt-image-2-edit、nano-banana-2-t2i / i2i），对用户合并为**一档能力**：主行 `model_id` 承载文生图上游名，`features.i2i_model_name` 承载图生图上游名，执行侧（worker-java image 链——IKESD6 二轮拍板：Node worker 退役中，分流不落旧版）在「行配了别名 且 本 job 带参考图」时换用别名；`features.max_prompt_length` 同时把提示词上限从三层硬编码改为目录可配（image-2 配 32000；组合上限的取值口径见文末「修订二」）。分流是纯数据驱动，无开关、无按模型特判——上游只暴露单一模型名的档位（seedream / banana 单名）不配别名即行为不变。

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

## 修订二（2026-09-20，IKH4B8）：提示词上限改为「模型配置优先，否则取缺省」

**触发**：本文档原来的组合闸取 `max(契约预算 30000, 模型值)`，理由是「否则配了大上限的模型一挂文本附件就先撞组合闸，配置形同虚设」。它解决了「配置 > 30000 被契约预算挡住」，但**顺带把「配置 < 30000」也吞掉了**——后台把某模型配成 2000 想收紧，实际生效仍是 30000；改小值不生效、改大值才生效，行为不可预期。

**结论**：原文的「取大」改为**配置优先，未配置才回落缺省**——配置大用配置、配置小也用配置，两侧诉求同时满足。

- **取值口径唯一化**：三道闸（raw prompt 闸、组合闸、方案卡闸）统一走 `resolvePromptMaxLength(budget, type, configured)`（`backend/libs/contracts/prompt-text-limits.ts`）。原来两处 `Math.max` 是**同形不同源**——一个的第二操作数是已含缺省的 raw 生效值，另一个是 `?? 0` 的配置原值——正是分叉的温床。
- **两档缺省并存，故取值函数带 `budget` 参数，且该参数选的是「回落哪档」而非「量的是哪段字符串」**：`legacy-hardcode` = 旧硬编码（图片/视频 4000、音频 3000），只给 raw 闸；`contract-budget` = 契约预算 30000，组合闸与方案卡闸共用。方案卡闸量的是方案卡正文自身（其实是 raw 长度），但它从本文档起就沿用组合口径，换 raw 档会把缺省从 30000 砍到 4000，属行为回归——所以参数按「缺省档」命名，不按闸名。
- **最容易踩的坑**：把 raw 闸的**生效值**（已含缺省 4000/3000）当装配配置读回去，会让未配置模型的组合上限从 30000 掉到 4000。传**配置原值**，回落交给取值函数。契约预算常量取值不变（仍 30000），只是从「取大的底」降级为「未配置时的缺省」。
- **适用范围**：图片 / 视频 / 音频三类生成。音频只经 raw 闸与组合闸；方案卡闸的调用点已按 `type === "image" || "video"` 限定，音频不进入。注意**后台模型表单目前只对 image / video 放出该字段**（`web/src/admin/pages/ModelList/ModelFormModal.tsx` 的 `types: ['image','video']`），所以音频档位眼下只能经 API 配置——要放开是产品侧决定，不在本单。
- **配置值的边界**由 admin 写入口把关（`parseModelCreateBody` / `parseModelUpdateBody`，1–65535 整数或 null）；取值函数另对 0 / 小数 / NaN 之类脏值自防（回落缺省）。本决策不在代码侧再加下限——再加一条下限就是重新造出「配了不生效」。
- **行为影响**：未配置的模型零变化。仓库 migration 内配了 `max_prompt_length` 的只有 32000 两行——`gpt-image-2-text-to-image`（IKESD6 迁移写入）与 IKF4LI 迁回干净名后的 `gpt-image-2` 行（紧前一行在同批被软删）；32000 > 30000，改动前后都生效 32000，不变。
- **上线前须实测，别只信上面的推断**：以上是**从仓库 migration 推断**的结论，不等于测试站 / 线上实际。后台手配过小于 30000 的值的模型改动后会开始拒绝此前放行的长提示词——用户可见且静默。部署前对每个环境跑一次（camelCase 键也要查，读取侧两键都认），查出的行就是生效上限会收紧的档位：

  ```sql
  SELECT provider_id, model_id, capability_type,
         JSON_UNQUOTE(JSON_EXTRACT(features,'$.max_prompt_length')) AS v
  FROM generation_model_capability
  WHERE is_delete = 0 AND enabled = 1
    AND JSON_EXTRACT(features,'$.max_prompt_length') < 30000;
  ```

- **前端**：`web/` 侧的 `features.max_prompt_length ?? DEFAULT_MAX_INPUT(=1000)` 本来就是「配置优先」口径，缺省值仍与后端不一致（前端 1000 / 后端 4000），收口另见 IKGXO7。
