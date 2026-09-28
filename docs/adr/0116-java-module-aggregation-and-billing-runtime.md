# ADR-0116：Java 模块聚合到 `java/`，新增 billing 运行时与 libs 共享模块（修订红线 #10）

- **状态**：Proposed（待评审）
- **日期**：2026-09-24
- **决策者**：lixq（架构讨论会话）
- **修订**：CLAUDE.md 红线 #10「除 `worker-java` 外禁止新增 Java 产品运行时」
- **关联**：[ADR-0115](0113-self-built-identity-and-billing-supersede-0062.md)、[ADR-0084](0084-generation-worker-java-runtime.md)、[ADR-0068](0068-node-typescript-product-runtime-and-specialized-compute-boundary.md)
- **规格**：`docs/specs/2026-09-24-用户与计费体系架构设计.md` §4

## 背景

ADR-0115 决定自建 `billing-svc`。语言选型需要修订红线 #10——该红线目前只允许 `worker-java`
一个 Java 产品运行时。

**语言不是性能问题。** 计费是纯 I/O 密集型（一次事务 = 若干行 UPDATE + INSERT），
瓶颈在 DB 分片、事务长度、连接池、幂等设计，语言是第五位的变量。
选 Java 的理由是**正确性的可验证性**：

- `BigDecimal` / `long` 无 JS 的 IEEE 754 精度陷阱（`9007199254740993` 会静默变 `...992`）
- 复用 `worker-java` 已有的 JVM 运维、监控、日志、发布链路——边际成本低
- 钱的服务「写完就少改」，适合保守、显式、强类型、审计友好的栈

**另一个事实**：全仓目前只有一个 `worker-java/pom.xml`，**没有任何共享 Java 模块**。
不建共享模块，「复用」只能靠源码复制，必然分叉。

## 决策

1. **新建 `java/billing/`**，Spring Boot 3.3.x + MyBatis-Plus + `rocketmq-client-java` + OkHttp。
   技术栈与 `worker-java` 逐项对齐（同一 Spring Boot 版本、同一 ORM、同一 MQ 客户端），
   **零新依赖学习成本**。

2. **Java 模块收进聚合目录 `java/`**（**目录搬迁**）：

   ```
   java/
   ├── pom.xml        ← packaging=pom，modules: libs / worker / billing
   ├── libs/          ← 新增：共享基础设施
   ├── worker/        ← 由 worker-java/ 迁入
   └── billing/       ← 新增
   ```

   **`worker-java/` → `java/worker/` 是搬迁，不是新建** —— 代价是全部路径引用
   与火山流水线的构建配置都要改。这笔账换的是长期结构对称，**认了**。

   > 命名上明确**不叫 `java-commons`**（已否）；也**不走「源码复制先跑通、后收敛」**——
   > 复制必然分叉，既然要搬就一次到位。

3. **红线 #10 修订**：Java 产品运行时从 **1 个变 2 个**（`java/worker` + `java/billing`），
   并新增 `java/libs` 共享模块。修订后的表述须同时说明：
   - 允许的两个 Java 运行时**各自边界**（worker = 执行面；billing = 控制面）
   - `java/libs` **只承载基础设施**（DB/MQ/HTTP/错误体系），**不得承载领域规则**
   - 未来新增 Java 运行时仍需单独 ADR

4. **复用边界：复用基础设施，不复用进程。**

   | worker 的资产 | billing 要不要 | 处理 |
   |---|---|---|
   | `Dockerfile` · `docker-settings.xml` · 构建链路 | **要** | 直接复用 |
   | `config/RocketMqConfig.java` | 要（消费 job 事件） | 抽 `java/libs` |
   | `gateway/NewApiHttpSupport.java` · `NewApiErrorClassifier.java` | 要（对账调 new-api） | 抽 `java/libs` |
   | `infrastructure/mapper/*` 的 MyBatis-Plus 用法 | 要 | **范式约定**，不复制代码 |
   | `domain/error/*` 错误体系 | 要 | 抽约定 |
   | `domain/contract/*`（生成域契约枚举） | **不要** | billing 不该依赖生成域 |
   | `application/processor/*`（执行逻辑） | **不要** | 完全无关 |

5. **`java/libs` 只放基础设施，不放领域规则。** 这条是 ADR-0084 从 `blue_whale_server`
   退役继承来的教训（双份契约漂移、第二套领域规则）——**共享基础设施不会漂移，
   共享领域规则必然漂移**。契约仍走 Buf proto（ADR-0115 决策 8）。

## 被否决的备选

- **billing 用 TypeScript**：零成本替代方案，技术上完全可行（`BigInt` + lint 禁浮点）。
  否决理由是钱路径的保守性——**但这不是技术必然，是取舍**。
- **billing 用 Go**：常驻 daemon 足迹与并发原语更优，但需引入团队零存量的第三语言
  （全栈目前是 TypeScript + Java）。收益是 1.1–2×，成本是第三条构建链与契约面。
- **Java 目录不搬迁**（`java-commons/` 与 `worker-java/` 平级，根 `pom.xml` 只聚合）：
  零搬迁成本，但目录结构不对称。**已由决策 2 推翻**——既然要建共享模块，
  一次把结构理顺，代价（改路径与流水线配置）**一次性付清**。
- **不抽 libs，靠源码复制起步**：零结构改动，但两份 `RocketMqConfig` / `NewApiHttpSupport`
  必然分叉。**已否**——ADR-0084 从 `blue_whale_server` 继承的教训正是「双份契约漂移」。

## 后果

- **正向**：billing 与 worker 共享构建/部署/MQ/HTTP 基础设施；两者的契约边界仍是 DB + MQ
  两个硬边界（不新增 HTTP 依赖）；Java 运维能力集中而非分散。
- **成本**：新增一个常驻服务（JVM 基线内存 ~300MB+，冷启动 5–10s）→ **保底常驻副本，
  不参与激进 autoscale**；**`worker-java/` → `java/worker/` 的搬迁成本**（全部路径引用 +
  火山流水线构建配置）；`java/libs` 的版本管理需约定（源码同仓，聚合构建）。
- **风险**：
  1. **`java/libs` 变成事实上的第二套领域层**——防线是决策 5 的「只放基础设施」，
     靠 code review 执行。一旦失守应重开本 ADR。
  2. **搬迁冲击 worker-java 的构建与部署**——`java/worker/` 落地后必须**回归其完整构建 +
     Docker 镜像 + 火山流水线**，在同一个 PR 内完成，不留下半迁移状态。
  3. **JVM 冷启动**与 K8s 滚动更新叠加，可能出现发布期容量下降——保底副本缓解。
- **成立前提**：ADR-0115 获批。若 ADR-0115 被否，本 ADR 自动失效。
