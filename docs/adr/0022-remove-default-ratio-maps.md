# ADR 0022: 删除 blue_whale_api 代码默认 ratio map,模型定价单一数据库源

- 状态:Proposed(2026-07-23)
- 决策者:李述 + Claude(grill-with-docs 会话 IK3HGV)
- 上游工单:IK3HGV(epic)/ IK3HHB

## 背景

blue_whale_api(开源 new-api 二开)模型定价两层:①**代码默认 ratio map**(`setting/ratio_setting/model_ratio.go` 的六个 default map:`defaultModelRatio`/`defaultModelPrice`/`defaultAudioRatio`/`defaultAudioCompletionRatio`/`defaultCompletionRatio`/`defaultImageRatio`,写死几百个社区模型,含 bge-large-en 等本站未接入模型);②**数据库 `options` 表**覆盖。启动加载默认 → DB 覆盖。

企业级上线只接火山引擎部分模型。代码默认 map 导致:管理员定价页堆几百个无关模型(界面乱);未配价模型偷用社区默认价计费(**静默用错价**,计费不可控)。

## 决策

**清空六个 default map 内容(留壳变量 `map[string]float64{}` 保编译)**,模型定价改为单一数据库源。不删变量/函数(`DefaultModelRatio2JSONString`/`GetDefault*Map` 仍被 reset/price.go/quota.go 引用),仅清 map 数据。本次改动 `-306 行`。

连带自动失效(符合目标,不改调用处):
- `relay/helper/price.go:194` `GetDefaultModelPriceMap()` → 空,走 ModelRatio 报错分支
- `service/quota.go:43` `GetDefaultModelRatioMap()` → 空

`ResetModelRatio`(`controller/pricing.go:79`)删 map 后序列化空 → reset 变"写 `{}` 清空 DB"(语义从"恢复默认"变"清空自定义")。

## 考虑过的替代方案

- **DB 空覆盖**(options 设 `{}` 盖默认):`types/rw_map.go:88` 是 replace 语义,能盖掉默认达等效。但代码默认仍在源码,DB 被清或误点 reset 后默认冒头。**否决**:用户要根除防冒头。
- **整个删变量/函数**:破坏 reset/price/quota 引用,编译挂。**否决**。

## 后果

- 未配价模型调用即报错(配合 ADR 0023 删自用模式);新模型上线必须"渠道 + 定价"双配。
- fork 与上游 new-api 分叉加大(默认 map 上游持续更新,merge 冲突)。
- 失去社区维护价表福利(新模型得自己跟)。
- reset 按钮语义变化(见 IK3HGV 待定项:保留当一键清空改文案,或删按钮)。

## 相关

- 工单:IK3HGV(epic)/ IK3HHB(本决策)
- 配套:ADR 0023(删自用模式,未配价硬报错的另一半)
- 术语:见 CONTEXT.md「计费与货币」(价格模式/比率模式/quota)
