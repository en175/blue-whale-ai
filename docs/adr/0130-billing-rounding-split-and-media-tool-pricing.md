# ADR-0130：计费口径与 MediaKit 工具计费扩展——参考秒四舍五入、分价维度、编辑 +15 秒与数量取整

- **状态**：Accepted
- **日期**：2026-10-19
- **决策者**：lixq（工程）、徐雯倩（产品价目）
- **关联**：[IKIUGJ](https://e.gitee.com/hangzhou-xuanfu_1/issues/table?issue=IKIUGJ)（计费体系盘点）、[IKK4SE](https://e.gitee.com/hangzhou-xuanfu_1/issues/table?issue=IKK4SE)（定价批量修正）、IKOSTQ（计费规格实现）、IKOSU1（编辑价目迁移）、[ADR-0127](0127-charge-on-submit-and-refund-on-failure.md)（提交即扣 + 失败退款）、[ADR-0068](0068-node-typescript-product-runtime-and-specialized-compute-boundary.md)（专用计算边界）

## 背景

2026-10-15《蓝鲸计费.xlsx》替换了旧价目：seedream 全系调价并区分文生/图生，seedance 2.5 编辑改为底价式，MediaKit 15 个工具由免费转收费。现有计价引擎（`AbstractPricingCalculator`）只有线性原语：`baseUnit + dims` 相加、`multipliers` 相乘、`dimPrices` 加价；`rounding` 只作用于最终 mc→积分，不作用于数量。由此产生四个需要拍板的形状问题：

1. 参考视频秒数怎么取整，计费与积分页显示怎么保持一致；
2. 文生/图生分价用什么维度表达；
3. 同一条规则同时服务普通生成与编辑，编辑的「底价 + 按秒」怎么表达；
4. MediaKit 价目里的「+1 秒」「每 5 秒一档」「整分钟」和每 10 个工具各自的计费量放在哪里。

## 决策

### 1. 参考视频秒数：先求和，再四舍五入

参考视频秒数取精确时长之和，最后 `Math.round`（四舍五入），不再逐段 `Math.floor`。编辑模式的源秒同样按 `Math.round` 写入 `duration_basis_seconds`。画布媒体节点的时长徽标用 `Math.round(duration)`（`MediaNode/index.tsx`），与计费同口径。

### 2. 文生/图生分价：新增 `image_reference` 布尔规格

`extractSpecs` 对图片任务写入 `image_reference = 参考图数 > 0 ? "1" : "0"`；`basePrice.table` 用 `size|image_reference` 组键。引擎的 table 轴由键自动推导，不需要改 Java；参考图本身不再通过 `dimPrices` 加价，5.0 Pro 的 `dimPrices/firstFree` 退役。

### 3. seedance 2.5 编辑：参考秒归零 + `videoEdit` 加 15

编辑态 `reference_seconds = 0`（源秒已由 `duration` 表达），规则加 `dims: {"usage.videoEdit": 150000}`（+15 单元），并删除 `multipliers.usage.videoEdit`。因为 720p=20×2.3、1080p=20×5.5，`分辨率单价 × (源秒 + 15)` 与 `(300 + 源秒×20)×系数` 逐积分相等，且不需要给引擎加「按 spec 匹配的规则变体」。

> **部署顺序**：本决策的代码（IKOSTQ）必须与编辑价目迁移（IKOSU1）同批上线。只上代码会把编辑单价减半；只回滚代码会按「2×源秒+15」多收。

### 4. MediaKit：独立 `media_tool_pricing` 表

> 实施状态：§4–§6 是已拍板方向，代码分别在 IKOSU3/IKOSUA 等 MediaKit 工单落地；本 ADR 不代表当前 HEAD 已全部实现。

工具不是模型，不写进 `generation_model_capability`（避免污染模型白名单与能力类型封闭枚举）。新表只存 `tool_type + pricing(JSON) + version`；Java 引擎仍只消费提交时冻结的规则快照，因此零改动。15 个工具的价目全部数据驱动。

### 5. 引擎扩型：可选键进 `pricing` JSON

新增 `quantityOffset`（先加）与 `quantityStep`（再向上取整到 step 的倍数），并放开 `unitDenominator`（不再只限 `usage.characters`）。三个字段都放在现有 `pricing` JSON 内，不新增表列；缺省即不生效，旧快照行为不变。这样「+1 秒」「每 5 秒一档」「向上取整到分钟」「每分钟单价 ÷60」都能用配置表达。

### 6. 时长准确性：worker ffprobe 探测 + 服务端覆盖 + fail closed

- worker-java 提供内部 `POST /internal/media/probe`，只读头部返回 `size/mime/width/height/duration_ms/fps/codec/container` 的可扩展对象；
- 上传 finalize 由服务端探测并覆盖客户端时长；video/audio 必须 `duration_ms > 0`，探测失败才失败；
- 存量缺失由回填 job 补；生成提交时缺时长的历史资产先惰性探测再计费；
- 计费不再把缺失参考秒静默按 0；探测失败才拒绝提交；
- 数据库 `CHECK (type NOT IN ('video','audio') OR duration_ms > 0)` 作为下一批收尾，等回填观察一轮后加。

### 7. 扣费时机沿 ADR-0127

MediaKit 工具与生成一致：提交即扣、失败全额退（复用 worker 终态 outbox 的 `refund:true`），不做部分退差。工具报价走后端接口，与 charge 共用同一份规则快照。4.5 改按张后，部分出图失败与重试重复扣费作为已知风险另行处理。

## 后果

- IKK4SE 保持「数据迁移 + 两处 TS 规格小改」，不把 Java 引擎改造塞进调价单；
- MediaKit 15 个工具只需接线，价格调整不再发版；
- 计费与积分页显示使用同一套取整，客诉时可以用页面秒数解释账单；
- 时长探测成为上传链路的同步依赖（典型 100–300ms，5 秒超时）；探测失败会拒绝上传/提交，这是有意的 fail closed；
- 部分失败不退差、重试重复扣费仍是已知缺口，需另行登记。

## 备选方案与为何不选

- **逐段 `floor` 参考秒**：与页面显示不一致，且 5.6+5.6 只收 10 秒，求和后四舍五入收 11 秒；
- **用 `reference_count` 精确值做分价轴**：参考图 ≥2 张时需要为每个张数配同价行，配置冗长且易漏键；
- **把编辑公式写成规则变体（按 spec 匹配）**：通用性更强，但为一条公式扩引擎不划算，且要同时改 Java/TS/管理端；
- **把 MediaKit 塞进能力行（`capability_type='tool'`）**：会扩张能力类型封闭枚举并污染模型列表；
- **纯 JS 解析视频时长**：容器覆盖不全；**客户端时长 + 异步校验**：存在错误计费窗口；
- **成功后再扣工具费用**：并发提交可透支，且与生成链路形成两套状态机。
