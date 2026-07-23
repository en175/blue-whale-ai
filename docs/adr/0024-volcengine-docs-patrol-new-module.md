# 新建火山 docs 巡检模块,而非扩展 ratio_sync / channel_upstream_update

火山方舟调价与模型上下线频繁,而 new-api 定价表/模型清单靠人工维护、无自动同步。现有两件都不覆盖「价格定时 + 官方源 + 待审报警」:`ratio_sync` 是手动触发、从 models.dev 第三方聚合拉 USD 价、直接覆盖库;`channel_upstream_update` 虽有定时(30min)但只检测已开通渠道的模型列表(Ark `/v1/models` 返回已创建接入点,非官方全量)、且火山渠道(type=45)被前端 `MODEL_FETCHABLE_TYPES` 屏蔽、完全不碰价格。

**决定**:新建独立的「火山官方 docs 巡检」模块,挂 new-api `system_task`,每天定时抓官方 docs 页(SSR 全量,免登录免 key),检测价格变动 + 模型上下线(全量,含未开通),走独立待审列表 + 飞书 webhook 报警,只报警不自动落库。`ratio_sync` 与 `channel_upstream_update` 保持不动。

## Considered Options

- **扩展 `ratio_sync`**(加火山源 + 定时 + 报警 + 待审)— 弃用:`ratio_sync` 语义是「同步覆盖」(拉了直接写库),加「检测 + 待审 + 不自动改」等于重写大半,且会把两种语义塞进一个 controller。
- **扩展 `channel_upstream_update`**(加价格检测 + 官方源)— 弃用:它的数据源是渠道上游 `/v1/models`(已开通接入点,非官方全量),职责是「渠道配置同步」;价格维度 + 官方全量源与之不匹配,且依赖渠道 key 而非公开 docs。
- **新建独立 docs 巡检**(采纳):复用 `system_task` 调度 + `channel_upstream_update` 的「通知抑制 + 待审 apply/ignore」范式,补两个真缺口(数据源换官方 docs + 价格定时维度)。现有两件职责不重叠,共存不冲突。

## Consequences

- 模型上下线检测与 `channel_upstream_update` 表面重叠,但职责不同:本巡检面向火山官方全量(含未开通),`channel_upstream_update` 面向已开通渠道配置同步。两者共存,不互替。
- 先做火山单供应商,`fetcher` 抽象成接口预留多供应商扩展(后续 OpenAI/Claude 等只新增实现)。
- 巡检只产出「变更待审」记录,不自动落库——防 docs 页结构变化或解析错误导致批量写错价。
- 价格报警阈值:任何实质变化都报(带浮点容差 <0.1%,防汇率/ratio 换算精度抖动)。
- 飞书 webhook 用巡检专属发送器(按飞书 `{msg_type,content}` 格式 POST),不复用 new-api 通用 webhook(其 `{type,title,content,...}` 格式飞书不认)。
