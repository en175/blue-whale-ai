# blue_whale_api 接入 blue-whale-pay:HTTP 下单 + notifyUrl 回调(不走 dubbo/MQ)

## Context

工程2([0025](0025-payment-extension-via-blue-whale-pay.md) 支付扩展 + [0026](0026-java-go-dubbo-triple-rpc.md) dubbo 互通)已完成 pay 侧:jeepay 全量复制 + dubbo `PayService`(`unifiedOrder` HTTP 版 / `unifiedOrderMq` dubbo 版)+ `confirmSuccess` 回调分流(notifyUrl 空 → MQ / 非空 → HTTP)。pay 两种回调能力都实现并验证(支付宝沙箱 STATE_SUCCESS + MQ 消费)。

现在落地 **blue_whale_api(生产 Go 服务,new-api fork,go 1.25.1)接入 blue-whale-pay 作充值渠道**。客户端选型:dubbo + MQ(spike 验证的方案)还是 HTTP + notifyUrl。

## Considered Options

- **dubbo 下单 + MQ 回调(spike 验证的 `unifiedOrderMq`)**:复用 0026 dubbo 基建,typed proxy 免签名。但 blue_whale_api **零 dubbo / 零 MQ 基建**,要从零引 dubbo-go(**go 1.26 要求 + 150+ indirect 包**:etcd/nacos/grpc/otel/sentinel)+ rocketmq-client-go。且 MQ 回调要求 notifyUrl 空 = 必须走 `unifiedOrderMq`(dubbo)下单,两者绑定。
- **HTTP 下单 + MQ 回调**:下单 HTTP(签名),回调 MQ(rocketmq consumer)。只引 rocketmq(轻),不引 dubbo。但 blue_whale_api 唯一 MQ consumer(与现有 5 个 HTTP webhook 异类);且 MQ 回调要求 notifyUrl 空,而 HTTP 下单(`unifiedOrder`)notifyUrl 非空走 HTTP 分支 — 要么改 pay 加"HTTP 下单无 notifyUrl 也走 MQ"端点,要么绑定 dubbo 下单。
- **HTTP 下单 + notifyUrl 回调(选)**:blue_whale_api 带 jeepay MD5 签名 POST pay `/api/pay/unifiedOrder`(notifyUrl 指回 `/api/bluewhalepay/notify`);pay `confirmSuccess`(notifyUrl 非空)→ `PayMchNotifyMQ` 兜底 HTTP 回调 + 自动重试。**零新依赖**,沿用现有 stripe/creem/epay/waffo 五个 webhook 模式。

## Decision

选 **HTTP 下单 + notifyUrl 回调**。理由:

1. **跨服务只一条消息**:pay ↔ blue_whale_api 跨服务只有"支付成功通知"。pay 内部 MQ(补单 / 自动分账 / 商户通知重试 / 配置广播 / 登录缓存清理)是 pay 自身依赖,不要求 blue_whale_api 引 MQ。
2. **沿用现有模式**:blue_whale_api 现有 5 个支付渠道全是 HTTP webhook,jeepay 沿用 = 零增量基建 + 最大一致性。
3. **避免 dubbo-go 重依赖**:dubbo-go v3.3.2 要求 go 1.26 + 150+ 包,blue_whale_api(go 1.25.1)升级 + 依赖树膨胀 + 供应链面增大,成本高。Go 实现 jeepay 签名(`BlueWhalePaySign`,~30 行)远轻于引 150 包。
4. **pay 侧零改**:`unifiedOrder`(HTTP)+ `confirmSuccess` notifyUrl 分流已实现(0025),`PayMchNotifyMQ` 已做 HTTP 回调 + 重试兜底。
5. **MQ 拉模式优势不成立**:MQ 不暴露 webhook 的优势,在 blue_whale_api 已暴露 5 个 webhook 下不增量。

## Consequences

- blue_whale_api **零新依赖**,go 1.25.1 不升级。
- Go 实现 jeepay 商户签名 `BlueWhalePaySign`(对照 pay `JeepayKit.getSign`:每个参数 `k=v&` 按 key 不区分大小写排序 + 末尾 `key=<appSecret>` + MD5 大写)。**下单签名 + 回调验签共用一份**。
- 请求体必填 `version`/`signType`/`sign`/`reqTime`(`AbstractRQ` @NotBlank),均参与签名。
- webhook `/api/bluewhalepay/notify` 需公网可达(沿用现有 webhook 基建,LB / 域名 / 证书同 stripe/creem)。
- **0026 dubbo 基建保留**:pay 侧 provider + spike typed consumer 仍维护,供未来需要强契约 / 免签名的 java<>go 系统级调用;支付场景因回调选 HTTP 暂不用 dubbo。dubbo 基建不为支付独有,是为系统级互通打地基,不浪费。
- pay 内部 MQ(补单 / 分账 / 商户通知重试)照常运行,pay 服务仍依赖 RocketMQ。

## 验证(2026-07-26)

- ✅ **签名对齐**:`BlueWhalePaySign` 算 sign → POST pay `/api/pay/unifiedOrder` → pay 验签 `code=0`,返真实支付宝沙箱 WAP `payData` + payOrderId。Go 签名与 pay `JeepayKit.getSign` 完全一致。
- ✅ **编译**:blue_whale_api model/service/controller/router/setting 全包编译通过。
- ⏳ **端到端(支付 → 加额度)**:blue_whale_api 全栈(MySQL + 前端 dist + 配置)+ 支付宝沙箱扫码,待集成环境验证。
- ⏳ **前端 web/default 接入下阶段**(仿 Waffo Pancake:支付宝 WAP 跳转 + 微信二维码弹窗 `QRCodeSVG` + 管理端 bluewhalepay Tab)。

## 落地清单(blue_whale_api)

- `model/topup.go`:`PaymentProviderBlueWhalePay` / `PaymentMethodBlueWhalePay` 常量 + `RechargeBlueWhalePay`(仿 `RechargeCreem`:锁单 + 状态幂等 + `quota + ?`)
- `setting/payment_bluewhalepay.go`:PayUrl / MchNo / AppId / AppSecret / ServerBaseUrl / WayCode / Enabled + `model/option.go` 注册 + 加载
- `service/bluewhalepay_client.go`:`BlueWhalePaySign` + `BlueWhalePayRequestUnifiedOrder`(带 notifyUrl,version/signType 参与签名)
- `controller/topup_bluewhalepay.go`:`RequestBlueWhalePayPay`(建 TopUp + 下单)+ `BlueWhalePayNotify`(query/form 合并验签 + 加额度,返 "success")
- `router/api-router.go`:`POST /bluewhalepay/pay`(登录)+ `GET/POST /bluewhalepay/notify`(匿名回调)
- `service/bluewhalepay_sign_test.go`:签名对齐单测(`//go:build manual`,需本地 pay :8083)
