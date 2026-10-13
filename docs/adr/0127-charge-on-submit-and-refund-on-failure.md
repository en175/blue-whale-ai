# ADR-0127：计费改为「提交即扣 + 失败退款」——预扣与多退少补退役

- **状态**：Accepted
- **日期**：2026-10-12
- **决策者**：lixq
- **关联**：[ADR-0114](0114-new-api-as-upstream-identity-and-billing-services.md)（自建计费）、[ADR-0063](0063-new-api-upstream-video-channel.md)（网关视频通道）、[计费逻辑详细设计](../specs/2026-09-24-计费逻辑详细设计.md)、[计费单位契约](../specs/billing-units-contract.md)
- **编号说明**：0120–0126 由批次线携带，本 ADR 接其后

## 背景

现状是**两段式**：提交任务时 `hold` 冻结一笔预扣（`billing_cost_reservations` 记预留 + 批次 `frozen` 加钱 + 账本借 `WALLET` 贷 `FROZEN`），任务到终态时 `settle` 按报上来的用量重算，`refund = reserved − actual` **多退少补**，超扣写 `RECEIVABLE` 应收（`CreditService.hold` / `CreditService.settle`）。

这套形状带来三处代价：

1. **钱在任务跑之前就被占住**。用户点下按钮，余额当场减少，但任务还没开始。
2. **用量必须在提交之后才知道**，于是逼出两套补丁：音频是 TTS 接口、请求里没有 duration，只能配 `maxCredits` 按上限冻、再按实际秒数结算；视频按 token 计价，提交时只能用 `tokenEstimate`（宽 × 高 × fps × 时长 ÷ 1024）估一个数，等上游回真实 token 再对账。
3. **用户可见面必须藏住预扣**。契约里反复声明「任何用户可见界面永远只出现一个金额」，预扣额只对运营可见（`billing.proto` 的 `UserTransaction` / `ListLots` 注释）。这条硬规则存在的**唯一原因**就是预扣。

同时，业务侧的价目表本身已经是积分口径（视频档位系数、图片单价），而以元配价再乘 `creditsPerYuan` 的中间层让「1 元 = 多少积分」在视频、图片、音频三处不再一致。

## 决策

### 1. 提交即扣，成功不动账，失败全退

- 提交任务时**直接扣一笔**，扣的就是最终金额——记**消费**，不是冻结。
- 任务**成功**：不再有任何账务动作。
- 任务**失败**：全额退回原批次。
- **用户主动取消不自动退**：看实际结果——上游真把活干了、任务实际成功就不退（上游成本已经发生）；实际没成功才退。
- 提交时余额不足 → **直接拒绝提交**（沿用现有 `InsufficientCreditsException` 语义）。

### 2. 「冻结」与「应收」两个概念退役

`billing_credit_lots.frozen` 列、账本科目 `FROZEN` / `RECEIVABLE` 不再产生新分录。没有预扣就没有「超扣」，也就没有应收。

### 3. 用量上报退出计费路径

不再有「结算时按用量重算」，`JobCompletedEvent`（承载 `usage` / `catalog_version` / `succeeded_slots`）与 `usage.proto` 整体退出计费路径。worker 只需在**失败**时发一条事件。

### 4. 单价以积分配置，不再以元配置

管理端「模型 → 定价」页的输入单位从**元**改为**积分**（允许小数）。底层存储仍是 mc（1 积分 = 1000 mc），**库里已配的数据一行都不用迁移**——视频要重配只是因为要调价，不是因为换单位。

`creditsPerYuan` 退出定价路径，只剩自定义充值报价一处用途（[计费单位契约](../specs/billing-units-contract.md)）。

### 5. 视频：按秒 × 档位系数

`baseUnit` 从 `usage.c`（token）改为 `usage.seconds`；`basePrice` 按「模型 × 分辨率 × 是否含视频输入」查表。

两族口径不同，必须都支持：

- **2.0 系**（含 Fast / Mini）：含视频输入时**系数变大**，秒数只算生成秒数。
- **2.5 系**：系数不变，秒数 = **生成秒数 + 参考素材总秒数**。

后者的基准量现在拿不到——`UsageDim` 只有 `usage.seconds`（生成秒数）与 `usage.referenceCount`（参考**张数**，`UsageDim.java`）。需新增使用维度 `usage.referenceSeconds`，并在提交时把被引用素材的时长之和写进规格键（该求和后端已在做，见 `reference-limits.ts` 的参考上限校验）。

**编辑模式（`mode = edit`）另有一条**：**产出时长跟着参考视频走**（编辑不选时长），**价格为该档基础价的 2 倍**，而**数量口径与「含视频输入」完全一致**——2.5 系按 `生成秒数 + 参考总秒数`（产出时长=参考时长，故实际是参考秒数的两倍），2.0 系只按生成秒数（系数里已折进视频输入）。`reference_seconds` 在编辑模式下**照写**，不做特殊去重。这个「最后 ×2」用规则里的 `multipliers` 表达——它正是管线里最后一步（`AbstractPricingCalculator.applyMultipliers`，在 `dimPrices` 之后、`clamp` 与舍入之前），由新增的「是否编辑模式」标记维度承载。判定依据是提交时冻结的 `input.video_mode`（`FROZEN_VIDEO_MODE_KEY`）。

编辑模式**只允许一段参考视频**；选第二段时模式切到 `omni`（全能参考）。这条是本次新加的产品规则——现有代码不按个数切（见改动清单）。

### 6. 音频：按字数

`baseUnit` 改为 `usage.characters`，**每 100 字 1 积分**（按 Unicode 码点计数，空白不计）。字数在提交时即可从 `input.prompt` 数出，满足「提交即定价」。

「按秒」不可行：Seed Audio 是 TTS 接口，时长由文案决定、请求里没有 duration 参数（见 `002_seed.sql` 的 IKG4UR 注），提交时取不到基准量——这正是当初 `maxCredits` 补丁的由来。

### 7. 图片：口径不变，只换单位

`size` 档查表 + 参考图 `dimPrices`（首张免费）保持原样，只把输入单位从元换成积分：`0.3 元/张 → 4.5 积分/张`。

### 8. 范围

计费域（billing-svc + backend 的 Hold 调用 + 管理端定价页）+ 清掉「网关 quota → 积分」的残留换算（`agent-session-credits.controller.ts` 改读产品账本；该清理 [ADR-0114](0114-new-api-as-upstream-identity-and-billing-services.md) 已列为待办）。

> 2026-10-13 补记：`agent-session-credits.controller.ts` 已整删（IKHCK4），不再改读产品账本——Agent 文本模型自 10-13 起不对外、不向用户计费（拍板见工单 IKL9N1），「本次对话累计消耗积分」不再有意义，前端那枚胶囊一并删除。充值侧与网关 quota 锚点不动。

## 后果

- **用户可见面天然只有一个金额**，「预扣只有运营可见」这条硬规则可以退役——`UserTransaction` / `ListLots` 的注释与运营面的预留字段一并重审。
- 一整套「估算用量」的机械随之消失：`TokenEstimator` / `tokenEstimate`、音频的 `maxCredits` 补丁、`ReservationSweeper` 的释放职责、`SettlementService`。
- **代价：平台承担「提交时估算与上游实际用量不符」的全部差额。** 视频从按 token 改按秒后，各分辨率/模型的真实 token 成本差异全部折进系数；图片、音频同理。这是本次调价的实质——档位系数不是成本换算，而是定价本身。
- **幂等防线移位**：现在真正防重复扣的是 `billing_cost_reservations` 的 `uk_reservation__job`（`CreditService.hold` 的账本幂等键是 `"hold:" + commandId`，而 `commandId` 每次尝试都不同，实际不命中）。预扣退役后必须以 `charge:<jobId>` 作为账本幂等基键，否则失去这层保护。
- 折扣不再需要冻结：`rule_snapshot` 与折扣在提交时解析并**直接决定那一笔扣款**，`discount_bp` 的「冻结快照」语义随之消失。
- 重试是新建任务 → 再扣一次；失败已退款的那次不受影响。

## 备选方案与为何不选

- **保留冻结、只改文案**：解决不了「钱被占」与「用量提交时不可知」两个根因，音频仍需 `maxCredits` 补丁。
- **按预估直接扣、完成后多退少补**：多退少补要求结算时重算用量，等于把 `settle` 留下，只是换名字。
