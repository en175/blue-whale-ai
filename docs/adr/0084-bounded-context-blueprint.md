# 限界上下文划分蓝图（Bounded Context Blueprint）

- **状态**：Proposed（待评审落地）
- **日期**：2026-09-08
- **决策者**：李小强
- **关联工单**：IKDZGH（限界上下文重划）
- **上游决策**：[ADR-0083 统一错误码体系与唯一投影入口](0083-unified-error-codes-and-projection.md)（错误码单文件化，本蓝图的前置）

## 背景

`backend/libs/shared/` 平铺 40+ 领域模块（generation/jobs/assets/credits/topup-tier/media-extraction 等），彼此直接 import，无限界上下文（Bounded Context）边界。同一概念在不同模块叫不同名字（如"模型无效"在生成域 `invalid_input`=1002、text 域 `invalid_model` 无编号），是上下文未划干净的症状。

## 现状实证（模块依赖分析）

对 `backend/libs/shared/` 做 import 耦合分析，关键发现：

### 1. 业务模块被基础设施穿透（主要问题）
**所有业务模块直接 import `persistence`(43 处)/`prisma`(23 处)**——无防腐层，业务逻辑直接碰数据库访问。

| 模块 | 依赖的基础设施 |
| --- | --- |
| generation | persistence, prisma |
| jobs | persistence, prisma |
| assets | persistence, prisma |
| project | persistence, prisma |
| ...（几乎全部） | persistence, prisma |

**这是 DDD 最严重的边界缺失**：换 DB/ORM 要改 43 个模块的调用点；测试需 mock Prisma 而非仓储接口。

### 2. 业务模块间少量但真实的耦合
| 耦合 | 依赖符号 | 性质 |
| --- | --- | --- |
| generation → assets | `AssetStorageService`/`AssetUploadStorage` | 生成域用资产域**存储基础设施**——应走端口而非直接注入实现 |
| assets → errors | `AdminException` | 异常类型（跨切面，可接受） |
| account → credits/topup-tier | `creditsToNumber`/`quotaToCredits`/`QUOTA_PER_UNIT` | 账号域读支付计费域**金额换算纯函数**——共享内核 |
| template → assets | 存储服务 | 同 generation→assets |
| shared-assets → assets/scene-card | 存储服务 | 同 |

### 3. 错误码已单文件化
ADR-0083 落地后，`contracts/error-codes.ts` 是唯一错误码来源（生成域+账号域+全局码+一码一文案表）。这是本划界的前置基础——错误码分界随上下文划。

## 决策：限界上下文划分

划出以下限界上下文，每个上下文内部自洽（聚合根+规则），跨域只走共享内核/防腐层/领域事件：

### 一、生成上下文（Generation）
- **职责**：image/video/audio 生成任务的编排、状态机、失败投影
- **聚合根**：`GenerationJob`（状态机：queued→processing→succeeded/failed）
- **边界**：内部自含 provider 适配/媒体处理；对资产域只走 `AssetStoragePort`（存储端口），不直接注入 `AssetStorageService`
- **含**：`generation/`、`generation-runtime/`、`jobs/`（任务）、`media-extractions/`（媒体提取也是任务）

### 二、资产上下文（Assets）
- **职责**：素材/资产的存储、版本、生命周期
- **聚合根**：`Asset`（上传→转存→引用）
- **边界**：对外暴露`AssetStoragePort`/`AssetRepository`（仓储接口）；内部 persistence 实现下沉
- **含**：`assets/`、`shared-assets/`（共享资产）、`material/`（素材库引用）

### 三、支付计费上下文（Billing）
- **职责**：余额/配额/充值/消费记录
- **聚合根**：`AccountBalance`（配额、扣费、充值）
- **共享内核**：`credits/`、`topup-tier/` 的金额换算纯函数（`quotaToCredits`/`creditsToNumber`/`QUOTA_PER_UNIT`）——**多域共享，放共享内核而非某域私有**
- **含**：`credits/`、`topup-tier/`、`cost-reconciliation/`（成本对账）

### 四、认证上下文（Auth）
- **职责**：登录态、会话、鉴权
- **聚合根**：`Session`（HttpOnly cookie）
- **含**：`auth/`、`session/`、`account/`（账号自助，含改密）

### 五、画布上下文（Canvas）
- **职责**：画布/节点/连线/场景卡
- **聚合根**：`Canvas`（节点+边）
- **含**：`canvas/`、`scene-card/`、`template/`（场景模板）

### 六、管理上下文（Admin）
- **职责**：管理端操作（模型能力、技能、模板、运营）
- **含**：`model-capability/`、`skills/`、`operation-log/`、`homepage-hero/`
- **边界**：管理端数据改动走领域事件广播到对应域；管理错误信封（`{success,error}`）合并进统一信封（ADR-0083 阶段4）

### 七、共享内核（Shared Kernel）
- 错误码/契约（`contracts/`）——已是单文件（ADR-0083）
- 金额换算纯函数（`credits/topup-tier` 的 quota↔credits）
- 类型/工具（`types/`、`wire-integer`）

### 八、基础设施层（Infra，非业务上下文）
- `persistence/`、`prisma/`、`errors/`、`rate-limit/`、`operation-log/`
- **防腐层职责**：业务模块通过**仓储接口**（`XxxRepository`）访问数据，具体 prisma 实现下沉到 infra；换 DB 只改 infra

## 关键规则

1. **业务模块禁止直接 import `persistence`/`prisma`**——必须走仓储接口或领域服务（改造点，呼应 IKDZH0 基础设施下沉）。
2. **跨上下文只走**：
   - 共享内核（纯函数/契约）
   - 防腐层（Anti-Corruption Layer：A 域对 B 域是"端口/适配器"，不直接依赖 B 内部）
   - 领域事件（Domain Event：异步解耦，如"生成完成"→"资产入账"）
3. **聚合根自校验**：业务规则长在聚合根上（如 `VideoJob.validate()`），不在散落的 `validateXxx()` 函数——消除贫血模型。
4. **新增概念先问"属于哪个上下文"**——杜绝像"模型无效"在生成域/文本域各叫各的。

## 迁移路线（分阶段，避免一次性大改）

| 阶段 | 内容 | 影响面 |
| --- | --- | --- |
| 1 | 划界蓝图（本 ADR） | 文档 |
| 2 | 基础设施防腐层：`persistence` 下沉，业务模块改走仓储接口 | 43 处（最大，呼应 IKDZH0） |
| 3 | 生成域→资产域分离：`AssetStoragePort` 替代直接注入 | generation/assets |
| 4 | 共享内核：`credits/topup-tier` 金额函数归位 | account/credits/topup-tier |
| 5 | 领域事件：跨域异步解耦（生成完成→资产入账） | 多域 |
| 6 | 管理信封合并（ADR-0083 阶段4 续） | admin |

## 被否方案

- **直接拆模块目录**（把 shared/ 改成多个 package 分目录）：工程量大、且当前 `@lib/shared/*` 已按目录物理分区，核心问题不是"目录没分"而是"边界没有通过防腐层/端口落地"。渐进式改依赖优于一次性物理重排。
- **强行消除所有跨域 import**：部分跨域依赖是合理共享内核（金额换算）或跨切面（异常类型），强行归零会过度设计。

## 后果

- 蓝图文档作为后续改造（基础设施下沉/防腐层/领域事件）的路线图。
- 新增领域时按"属于哪个上下文"落位，不再制造平行概念。
- 与 ADR-0083（错误码单文件）、IKDZH0（基础设施下沉）协同。
