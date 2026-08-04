# ADR-0065: bluewhalepay 充值记录的支付方式落渠道族值

**日期：** 2026-08-04
**状态：** 已接受
**工单：** IK69BC
**关联：** 无

## 背景

`topups` 表用 `payment_method` 与 `payment_provider` 两个字段描述一笔充值走什么支付。对比两代集成：

- **epay（易支付，第三方聚合网关）**：建单时 `payment_method` 存用户选的子渠道（`alipay`/`wxpay`），`payment_provider` 存网关名（`epay`）；回调时还会用实际渠道 `verifyInfo.Type` 校正 `payment_method`（见 `controller/topup.go` `EpayNotify`）。
- **bluewhalepay（blue-whale-pay，自营聚合网关）**：建单时两字段都写死 `bluewhalepay`；区分渠道的 `wayCode`（`ALI_QR`/`WX_NATIVE`）只传给 pay、不落库；pay 回调通知带 `ifCode`（`alipay`/`wxpay`，参与签名、可信）与 `wayCode`，但 `BlueWhalePayNotify` 只读 `sign`/`state`/`mchOrderNo`，渠道字段被丢弃。

结果：bluewhalepay 充值记录无法区分支付宝/微信，相对 epay 是能力缺口，也是 `payment_method` 语义的异常值（对聚合网关不落子渠道）。

## 决策

bluewhalepay 充值记录自本次起，`payment_method` 落渠道族值，对齐 epay：

1. **仅新记录生效**；存量 `payment_method="bluewhalepay"` 记录不迁移、保持原值。
2. **建单时**（`controller/topup_bluewhalepay.go` `RequestBlueWhalePayPay`）按 `wayCode` 前缀推导 `payment_method`：`ALI_*`→`alipay`、`WX_*`→`wxpay`、未知值→`bluewhalepay` 兜底（等回调校正）。
3. **回调时**（`model/topup.go` `RechargeBlueWhalePay`，新增 `ifCode` 参数）以 pay 返回的 `ifCode` 为权威：锁内 pending→success 原子过渡时，若 `ifCode`∈{`alipay`,`wxpay`} 且与现值不一致，则覆盖并记 warning 日志（镜像 epay `EpayNotify` 的覆盖+日志行为）。
4. `payment_provider` 保持 `bluewhalepay` 不变，网关判别语义不动（`RechargeBlueWhalePay` 按 `PaymentProvider` 匹配，不依赖 `payment_method`）。

## 理由（方案取舍）

候选三方案：

- **复用 `payment_method` 存渠道族值（采纳）**：与 epay 完全同构（`payment_method`=子渠道、`payment_provider`=网关）；零 schema 迁移；两主题显示映射表已含 `alipay`/`wxpay`，显示零改动。代价是存量与新记录字段值不一致——本次已明确接受（存量按 `payment_provider` 仍可判别网关）。
- **复用 `payment_method` 存前端方法类型 `bluewhalepay_alipay`/`bluewhalepay_wechat`**：与前端选择器类型对齐，但与 epay 的裸 `alipay`/`wxpay` 风格不一致，且需补两条显示映射。
- **新增 `channel` 列存原始 wayCode/ifCode**：语义最干净，但要跨 SQLite/MySQL/PostgreSQL 做列迁移，且与 epay 既有模式不同构，模型反而更乱。

选 1：以代码库既有模式为锚，避免引入第三种表达。

## 后果

- 新 bluewhalepay 充值记录的 `payment_method` 语义与 epay 对齐：`alipay`/`wxpay`。
- 存量记录保持 `bluewhalepay`；按 `payment_provider` 仍可判别网关，混值不破坏查询。
- 显示零改动（classic `PAYMENT_METHOD_MAP` 与 default `PAYMENT_METHOD_NAMES` 已含 alipay/wxpay）。
- 后续若 bluewhalepay 出现新渠道族（如云闪付），沿用同一映射规则即可。
