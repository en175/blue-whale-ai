# 视频生成「是否带音频」契约（generate_audio）

- **工单**：IKG0LP（后端）/ IKG0LQ（前端），父需求 IKF XQ8
- **日期**：2026-09-15
- **状态**：定稿。契约先行——四端（前端 → 后端 → worker → 上游）实现前先定死

## 一、字段与本端语义

| 层 | 名字 | 类型 | 缺省 | 语义 |
|---|---|---|---|---|
| 能力位 | `generation_model_capability.features.audio`（**保留现键名**） | boolean | `false`（未配按 false） | 该模型**是否允许**生成带音频 |
| 用户参数 | `parameters.generate_audio` | boolean | `true` | 用户这次**要不要**带音频 |
| 上游出站 | `generate_audio` | boolean | 不传 | 显式传用户选的值 |

三层是三个问题，不要混：

- **能力位**回答「这个模型能不能」——管理员在后台 `/admin/models` 配，属能力事实。
- **用户参数**回答「这次要不要」——用户在生成面板选。
- **出站**只在能力位为 `true` 时带上；否则**完全不传**该字段，维持上游默认行为。

## 二、`features.audio` 的语义修订

`features.audio` 的既有含义是「**视频带音轨**」，不是「该模型能否做音频生成」。两处权威定义：

- `CONTEXT.md:229`：`_Avoid_: 把音频生成当成视频特性；用 features.audio 表示音频模型（那是「视频带音轨」）`
- `docs/specs/2026-08-18-audio-generation-seed-audio-design.md:112`：「刻意不设 features.audio=true：那是「视频带音轨」标识（前端用于视频能力），不是音频生成能力标志，避免混淆。」

⚠️ 工单 IKF XQ8 第 11 条把它称做「是否有音频生成能力」是**错误叫法**，CONTEXT.md 已将这种用法列为反模式。

本次**不新建字段**，把该键从「事实描述」升级为「许可位」：语义变为「该模型是否允许生成带音频」。键名保持不变，读侧兼容逻辑不变（`f.audio === true`）。

## 三、上游事实（火山方舟 Ark）

参数名 `generate_audio`，布尔值，控制输出视频是否含与画面同步的音频（人声 / 音效 / 环境音 / 配乐），输出为单声道。

**默认值 `true`**。依据：① 多份文档一致（其中一份标注对照 `docs.byteplus.com` 核对）；② 与本仓现状吻合——现有出站请求从不带该字段，而线上生成的视频确实有音频。

支持范围：

| 模型 | `generate_audio` |
| --- | --- |
| Seedance 2.0 / 2.0 Fast | 支持 |
| Seedance 2.5 | 支持 |
| Seedance 1.5 Pro | 支持 |
| Seedance 1.0 Pro / Pro Fast | **不支持** |
| Seedance 1.0 Lite T2V / I2V | **不支持** |

> 来源为火山方舟模型列表与多份第三方 API 文档的交叉印证；`volcengine.com` 在部分网络环境下不可直连，落地时以官方页面为准。**出站显式传值即规避默认值分歧**。

## 四、已知限制（必须遵守）

**新增模型时，不支持音频生成的模型必须把 `features.audio` 配为 `false`（或保持不配）。**

因为能力位为 `false` 时我们不传该字段，不受影响；但若误配 `true`，出站会带 `generate_audio: true` 发给一个不支持的模型，被上游顶回。

本仓当前目录内视频行只有 `doubao-seedance-2-0-260128` 与 `doubao-seedance-2-5-260628`，二者均支持，因此现状安全。这条约束靠约定与接入检查保证，不加额外代码门控。

## 五、数据前置

种子里 Seedance 2.0 现配 `'audio', FALSE`、2.5 配 `'audio', TRUE`。

**2.0 / 2.0 Fast / 2.0 Mini 必须改为 `true`**，否则链路接完后用户仍然看不到开关。这正是 IKF XQ8 第 11 条的要求，与 IKG0LP 同批落地。

## 六、各端职责

| 端 | 职责 |
| --- | --- |
| 前端 | 仅当所选模型 `features.audio === true` 时渲染开关，默认开；值随请求与 handoff 传递 |
| 后端 | 读能力位决定是否透传；把用户选择冻结进 job input 快照 |
| worker | 从 job input 取该布尔值，能力位为 `true` 时写入上游 body |
| 运营 | 按第四、五节维护能力位数据 |

## 七、验收

1. 能力位 `true` 的模型：用户选「带音频」→ 上游收到 `generate_audio: true`；选「不带」→ 收到 `false`
2. 能力位 `false` / 未配的模型：出站 body **不含**该字段，行为与改动前逐字一致
3. 存量视频行为不变（默认带音频）
4. 首页 → 画布 handoff 过程中开关状态不丢
