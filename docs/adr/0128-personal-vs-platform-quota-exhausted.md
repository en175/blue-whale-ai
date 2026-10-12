# ADR-0128：个人积分不足与上游平台额度不足分离——`platform_quota_exhausted`(1061)

- **状态**：Accepted
- **日期**：2026-10-13
- **决策者**：lixq
- **关联**：[ADR-0078](0078-generation-error-message-unification.md)（生成失败消息统一——本 ADR **推翻其 §5**）、[ADR-0114](0114-new-api-as-upstream-identity-and-billing-services.md)（new-api 作为上游身份与计费）、[ADR-0127](0127-charge-on-submit-and-refund-on-failure.md)（提交即扣 + 失败退款）、[生成任务错误码契约](../api/generation-job-error.md)、工单 IKL1S8
- **编号说明**：0120–0127 由批次线携带，本 ADR 接其后

## 背景

现场（工单 IKL1S8）：任务 `3369`（Seedance 2.5，5 秒样片）被拒。用户可用余额 8147 积分，平台已预扣 52 积分，随后 new-api 返回 HTTP 403 `insufficient_user_quota`；失败时平台统一调用账户余 ¥4.879638，本次需预扣 ¥17.50。平台已返还 52 积分、扣费状态 `released`，**但画布仍提示「账户余额不足，请充值后重试」**。

根因是 `quota_exhausted` / 数值码 `1001` 同时承载两条来源完全不同的路径：

1. **个人侧**（唯一入口）：提交预扣被拒 `INSUFFICIENT_CREDITS` → `billing-client.ts` 的 `toBillingChargeError` → `DomainError(1001)`，HTTP 402。该扣款在事务内发生，被拒即整体回滚，**job 不落库**（`generation-command-repo.ts` 的 `billing.charge`）。
2. **上游侧**：`NewApiErrorClassifier.isQuotaSignal` 命中 new-api 的 402 或欠费文案 → 吐同一个 `quota_exhausted`，由各 processor 落进 `job.error`。Java 侧共 31 处引用：1 处定义、14 处发射点（分类器 + 视频客户端 + 各 processor 的 classify 返回）、15 处 `PRESERVED_ERROR_CODES` 放行白名单、1 处 switch 文案。

两条路撞成同一个码，下游只能一路投影成 `1001` +「请充值」，把平台自己的欠费甩给用户。ADR-0078 §5 正是这么定的（「该码供前端后续做充值引导」），本 ADR 推翻它。

关键事实：new-api 只有**一份共享凭证**（`system_settings.upstream.new_api_key`，`NewApiUpstreamConfig.UpstreamCredential`），所以上游额度错误**必然是平台统一账户**，不可能是用户个人——「谁的额度」在码上必须写清楚。

## 决策

### 1. 新码 `platform_quota_exhausted`（数值码 1061）

文案「生成服务额度不足，请联系平台管理员」。上游的两种口语——`overdue balance`（欠费）与 `insufficient_user_quota`（额度不足）——**同归此码**：对用户而言动作一样（找管理员），不必再分。

### 2. `quota_exhausted` / 1001 收窄为个人侧专属

此后只由 `billing-client.ts` 的提交预扣路径产生（HTTP 402 + `code: 1001`）。上游不再吐它。

### 3. Java 侧换码并删旧常量

`GenerationError` 新增 `ERROR_PLATFORM_QUOTA_EXHAUSTED`、删除 `ERROR_QUOTA_EXHAUSTED`；14 处发射点、15 处放行白名单、1 处 switch 文案全部换成新常量。白名单**必须换成新码而非删除**——它是「上游码允许直落」的名单，放错码会把额度错误吞成家族兜底码。换完 Java 侧对新旧两码均 0 引用。

### 4. 旧记录按证据补救，不做数据回填

`projectPublicError` 见 `code === "quota_exhausted"` 且落库 `message` 命中 `NEW_API_QUOTA_SIGNAL` → 投影成 `platform_quota_exhausted`；命中不上则保持 `1001`。

只看 `message`，**不看 `details`**：`details` 是较新才有的字段，旧记录常为空，把判据绑在它上面等于把旧记录直接判成「证据不足」。`message` 是唯一一条所有年代记录都有的公共字段（`JobFinalizer` 落库时 `message` 存上游原文）。

### 5. 前端充值判据收窄

`web/src/utils/creditsGate.ts` 的 `isCreditsExhaustedError`：402 分支追加 `code === 1001` 约束，并显式排除 `platform_quota_exhausted`。这样任何来源的上游 402 都不再打开个人充值弹框。

### 6. 范围外

独立 `blue-whale-agent` 仓库不动。本单只改本仓（`worker-java` / `backend` / `web`）。

## 后果

- 前端 **零文案改动**：画布节点直接显示后端 `msg`（`MediaNode` 读 `detail.error.msg`），码变文案随之变。
- 重试按钮不动：1061 仍可重试。平台调用账户是站外依赖，运营充值后重试是用户唯一不必重建卡片的自愈路径。
- `GENERATION_ERROR_CODES` 白名单由数值表自动派生，新增 1061 后不会兜底成「生成失败」。
- **Java 与 TS 两份码表手工维护、无 parity 测试**，改动必须两处同步，否则新码被白名单吞掉兜底。
- 积分返还链路不变：上游拒绝 → 任务失败 → 按「提交即扣 + 失败退款」全额退回（ADR-0127），画布的「本次未消耗积分，预扣已退回」由 `chargeState === 'released'` 驱动，与错误码无关。
- **遗留**：运营侧目前没有「平台账户额度不足」的告警，只有各 processor 的 `log.warn(... code= ...)`，只能人肉 grep。

## 备选方案与为何不选

- **复用 `provider_credential_missing`(1009)**：因果错位——凭证没配 ≠ 账户没钱，且 1009/1010 已各占其位。
- **不新增码，只改文案**：两条来源仍撞一个码，前端无法按码分支，且 `quota_exhausted` 的语义继续含混。
- **旧记录一律翻 1061（不判证据）**：按本 ADR 上文的分析其实成立（个人侧不落 job），但与工单「证据不足时不推断来源」的措辞相悖，选保守的证据判据。
- **给上游的欠费与额度不足各开一码**：对用户无可操作差异，只增加码表与前端分支的维护面。
