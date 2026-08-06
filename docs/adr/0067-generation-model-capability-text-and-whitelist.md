# ADR-0067: 模型能力目录扩 text 能力 + 创建生成任务 model_id 白名单强制

**日期：** 2026-08-06
**状态：** 已接受
**工单：** IK6T8W（getTextModels）/ IK6T90（白名单校验）触发；IK6T9F 收尾
**关联：** IK6T46（admin 模型列表管理页）、IK6T9E（启停/排序/软删）

## 背景

前端 dock 模型选项与后端调用此前长期引用 mock「定价规则」页与写死的模型名。IK6T46 族将
`generation_model_capability` 确立为唯一事实源（admin 模型列表管理页 CRUD + 启停/排序/软删 +
审计），本期在其上补齐两个此前缺失的行为：

1. **能力类型扩到 text（文生文）**：目录原本只承载 image / video 展示与调用。为后续 agent
   文生文选型预留 text 档位，前端新增 `getTextModels()` 取数函数（请求 `capability=text`）。
2. **创建生成任务强制 model_id 白名单**：前端注释早已声称「服务端白名单校验」，但实际从未实现——
   创建 generation-job 时 `model_id` 传任何值都会落库。本期在 create 路径落地校验，纠偏该历史偏差。

## 决策

### D1. text 是目录的第三种能力类型

- `generation_model_capability.capability_type` 允许 image / video / text 三值（DB 无枚举约束，
  由 admin 端校验限定）。
- text 档位与 image / video 共用同一张表与同一能力视图 shape（前端复用 `ImageModelCapability`
  类型），供后续 agent 文生文选型。**本期不接 agent 调用链**，agent 对话仍为 mock 回复。

### D2. 创建生成任务强制白名单

- `POST /api/projects/{id}/generation-jobs`：最终 `model_id`（视频模型名别名如 `seedance-2`
  先解析为真实 model_id）必须命中 `generation_model_capability` 中**启用且 capability_type 与
  生成类型匹配**的行，否则 400 明确拒绝。
- **别名不得绕过白名单**：先解析别名、再校验解析后的最终 model_id。
- 重试（retry）沿用原 job 已验证的 model_id，**不复校验**：期间模型被停用/软删时，该 job
  在 provider 阶段自然失败，属预期的管理员操作结果。
- 管理端启停（enabled）、软删（is_delete）即时生效于白名单：停用或软删的模型即从可调用集剔除。

## 连锁影响

- 前端 dock 模型选项 / 创建任务合法 `model_id` 均以目录为唯一来源；新建任务时 `model_id`
  不在目录、已停用、或类型不匹配都会收到 400。
- 白名单依赖注入到 generation 命令依赖（create 路径），cancel / retry 复用同一 deps 工厂但不消费。
- 目录扩 text 能力后，未来 agent 文生文选型可复用 `getTextModels()` 与同一能力视图，无需改表结构。

## 被否方案

- **白名单仅前端约束**（前端注释的历史状态）：拒绝理由——前端校验可被任意客户端绕过，
  mock 展示与真实调用脱节，无法作为「目录是唯一事实源」的落点。
- **重试也强制白名单**：拒绝理由——重试的对象是「已通过创建期校验」的既有任务，重新校验
  会让管理员停用一个模型时中断所有在途重试，超出本期 create-only 范围，故以文档化决策替代。
