# 计费改「提交即扣 + 失败退款」——改动清单

> 决策见 [ADR-0127](../adr/0127-charge-on-submit-and-refund-on-failure.md)。本文只列**要动哪些地方**，不含实现方案。
> 日期：2026-10-12 ｜ 基准：`release/2026.09.29`

## 一、契约（`contracts/proto/billing/v1/`）

| 文件 | 改动 |
| --- | --- |
| `billing.proto` | `Hold` → 语义改为「直接扣一笔」并更名（`Charge`）。`HoldRequest` / `HoldResponse` 内的 `rule_snapshot`、`catalog_version` 保留（提交时解析定价仍需要）；`Quote` / `QueryBalance` / `ListTransactions` / `ListLots` 不动。文件头「只有 Hold 在用户等待路径上」「金额单位」两段注释按新语义重写。 |
| `events.proto` | `JobCompletedEvent` **删除**（成功不再触发任何账务）；`JobFailedEvent` 保留 → 触发全额退款。topic `generation-job-completed` 随之取消。 |
| `usage.proto` | **退出计费路径**（`JobCompletedEvent` 删掉后无人消费）。`UsageLine` 是否整体保留供成本观测，另定。 |
| `billing.proto` 运营面 | `AdminQueryBalanceResponse.receivable_credits` 退役；预留相关字段（运营面「这笔钱为什么先冻了 12、最后只扣了 1」的叙述）失去前提。 |
| `UserTransaction` / `ListLots` 注释 | 「刻意不含 `reserved_amount`」这条硬规则的前提消失，注释与字段一并重审。 |

## 二、计价维度（`UsageDim.java`）

- **新增** `usage.referenceSeconds` —— 视频 2.5 系「秒数 = 生成 + 参考」的基准量。producer：提交时把被引用素材的时长之和写进规格键（后端已在校验处求和，见 `backend/libs/shared/.../reference-limits.ts`）。
- **补 producer** `usage.characters` —— 现在只有枚举声明（`contractSource = null`），无任何产出方。音频按字数要求提交时从 `input.prompt` 数出码点数。
- **退役** `pricing.tokenEstimate`（`divisor` / `fps` / `inputSecondsKey` / `minimumTokens`）、`unitDenominator = 1000000` 那套、`usage.c` 分支与 `TokenEstimator`（Java 与 TS 两侧）——视频不再按 token 计价，这些没有读方也不再有意义。
  ⚠️ **不要连带删 `features.video_dimensions`**：它是**生成请求**用的（分辨率档 × 比例 → 输出宽高，`handle-create-generation-job.ts:798-806`、`handle-finalize-generation-job.ts:88-95`），与计费无关。`042_...sql` 注释③ 说"没有任何读方"的是**规则里那份副本**（`pricing.tokenEstimate.dimensions`），不是 features 里这份。
- 价格表**仍然按分辨率档配系数**（`basePrice.by = ["resolution","video"]`）。
- **新增** `usage.videoEdit`（标记维度，编辑模式 = 1、其余 = 0）—— 承载编辑模式的「最后 ×2」。`multipliers` 的机制正好合用：`mc = mc × (该维度量 × 万分比) / 10000`，量为 0 时按 10000（即 ×1）（`AbstractPricingCalculator.multiplierPermille`）。producer：提交时按冻结的 `input.video_mode === "edit"` 写 1。

## 三、数据表

| 表 / 列 | 处置 |
| --- | --- |
| `billing_credit_lots.frozen` | 退役。列是否物理删除按[迁移策略](../adr/0061-prisma-persistence-and-migration-policy.md)走：镜像不做 `migrate deploy`，先上新镜像再迁库。 |
| 账本科目 `FROZEN` / `RECEIVABLE` | 不再产生新分录。 |
| `billing_cost_reservations` | **待定**：或改语义为「这单扣了多少、退没退」的记录（保留 `uk_reservation__job` 作防重复扣），或整体退役、把幂等全部压到账本 `charge:<jobId>`。倾向前者——那张唯一键是现在真正生效的防重防线。 |
| `billing_ledger_entries` | 幂等基键改为 `charge:<jobId>` / `refund:<jobId>`（现在的 `"hold:" + commandId` 实际不命中）。 |
| `billing_pricing_catalogs.document.creditsPerYuan` | 退出定价路径，只剩自定义充值报价一处用途。 |

## 四、代码落点

- `server/blue-whale-billing`：`CreditService.hold` → `charge`；`CreditService.settle` 与 `SettlementService` **整体退役**；`CreditService.refund` 保留（改为「失败全退」唯一触发点）；`ReservationSweeper` 退役（释放职责消失），`CreditExpirySweeper` 保留；`BasePriceResolver` / `AbstractPricingCalculator` 里的 token 分支退役。
- backend：`billing-hold.ts` / `billing-release.ts` / `job-billing.ts`（失败补偿）；`agent-session-credits.controller.ts` 的 `quotaToCredits` 换算改读产品账本。
- worker（`server/blue-whale-worker`）：`JobSettlementPublisher` 只剩 failed 事件；`SettlementUsageLines` 退役。
- 管理端（`web/src/admin/pages/ModelList/`）：`PricingTab` 标签「基准单价（元 / …）」→「基准单价（积分 / …）」；`catalogDraft.ts` 的 `yuanToMc` / `mcToYuan` 换成 `creditsToMc` / `mcToCredits`。校验文案里的「元」全部换掉。
- **新规则：编辑模式限单段参考视频**（本次新加，代码里没有）。`edit` 模式的参考视频上限从通用的 `features.video_reference_max` 收紧为 **1**；用户加第二段时模式自动切 `omni`。
  落点：
  - 前端 `web/src/pages/CanvasPage/videoModes.ts` —— `enabledVideoModes`（:34-57）与 `defaultVideoModeFor`（:60-66）现在按「有没有图片引用」切 `edit`/`omni`（`videos > 0 → images > 0 ? 'omni' : 'edit'`），要改成按**参考视频段数**切。
  - 后端 `backend/libs/contracts/capability-param-validation.ts` —— `resolveVideoMode`（:106-121）现在只按提示词意图词推断（含编辑意图词 → `edit`、含续写意图词 → `extend`、否则 `omni`），**个数不参与**；需补一条「视频引用 > 1 段 → `omni`」，且要在意图词判定之前。
  - 校验：`backend/libs/shared/generation-runtime/video-reference-validation.ts:113` 的 `videoCount > limits.video_reference_max` 需按模式收紧。

## 五、设计文档需改的章节

`docs/specs/2026-09-24-计费逻辑详细设计.md`：§2.1.2（冻结语义）、§2.4（内部预留）、§3（账本分录总表）、§4.2（预扣分配算法）、§4.3（结算算法）、§4.4（返还算法）、§4.5.3（计算管线里的 token 分支）。
`docs/specs/billing-units-contract.md`：蓝鲸侧「1 元 = 15 积分」一节（定价不再经元）。

## 六、价目表 → 配置 key 逐条映射

配置落在 `generation_model_capability.pricing`（每模型一行）。`basePrice` 的单位是 **mc**（1 积分 = 1000 mc），故「N 积分/秒」→ `N × 1000`。

### 视频

规则骨架（所有视频模型相同）：

```json
{
  "baseUnit": "usage.seconds",
  "unitDenominator": 1,
  "basePrice": { "kind": "table", "by": ["resolution", "video"], "table": { … } },
  "minCredits": 1
}
```

档位键取该模型 `supported_sizes` 的 id（小写，如 `480p` / `1080p` / `4k`）；`video=0` 不含视频输入，`video=1` 含。

| 模型（价目表名） | 分辨率 | `video=0` | `video=1` | 含视频输入的秒数口径 |
| --- | --- | --- | --- | --- |
| Seedance 2.0 | 480p | 13 积分/s（13000 mc） | 20（20000） | 只算生成秒数（系数变大） |
| | 720p | 27（27000） | 49（49000） | 同上 |
| | 1080p | 68（68000） | 110（110000） | 同上 |
| | 4K | 140（140000） | 260（260000） | 同上 |
| Seedance 2.0 Fast | 480p | 10（10000） | 16（16000） | 同上 |
| | 720p | 22（22000） | 41（41000） | 同上 |
| Seedance 2.0 Mini | 480p | 8（8000） | 9（9000） | 同上 |
| | 720p | 16（16000） | 20（20000） | 同上 |
| Seedance 2.5 | 480p | 20（20000） | 20（20000） | **生成 + 参考总秒数** |
| | 720p | 46（46000） | 46（46000） | 同上 |
| | 1080p | 110（110000） | 110（110000） | 同上 |

- 2.5 系含视频输入那三行需额外配 `dims`：`usage.referenceSeconds` 按 100%（万分比 `10000`）加进数量。该维度 = **所有被引用视频的时长之和**（全能参考引多段就全部相加）。
- 「Seedance 2.5 样片 / 480p」与 2.5 普通行同价 → **共用一条**（样片模式另有约束：分辨率固定、只允许单个输出）。
- **编辑模式（`mode = edit`）**：价格 = 该档基础价 ×2。配在规则上而不是价格表里：

  ```json
  { "multipliers": { "usage.videoEdit": 20000 } }
  ```

  数量取**参考视频秒数**（编辑模式产出时长 = 参考视频时长），单段参考。
  例：2.5 / 480p，引用 10 秒视频做编辑 → `10 × 20 × 2 = 400 积分`。
- 以上为**初始值**，运营在管理端可改。

### 图片（口径不变，只换单位）

| 项 | 现值 |
| --- | --- |
| Seedream 5.0 Pro `size=1k` / `1.5k` | 4500 mc = **4.5 积分/张** |
| Seedream 5.0 Pro `size=2k` | 9000 mc = **9 积分/张** |
| 参考图（第 2 张起） | `dimPrices["usage.referenceCount"] = { unitMc: 300, firstFree: true }` = **0.3 积分/张**，首张免费 |

### 音频

```json
{
  "baseUnit": "usage.characters",
  "basePrice": { "kind": "const", "value": 10 },
  "unitDenominator": 1,
  "minCredits": 1
}
```

每字 10 mc = 0.01 积分 → **每 100 字 1 积分**。原按秒规则（`usage.seconds` / 75 mc / `maxCredits: 12`）整体替换，`maxCredits` 不再需要（字数提交时已知）。
