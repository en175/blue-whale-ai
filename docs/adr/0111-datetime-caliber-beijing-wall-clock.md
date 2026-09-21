# 全链路时间口径统一为北京时间（+08:00 墙钟字面量）

**状态**：accepted（2026-09-21，IKHJ0Q）

规则一句话：**库里 `DATETIME` 列存的是北京时间墙钟字面量；保证它的三处机制必须同批次上线；上线必须停机切换，不能滚动发布。**

## 动因

用 MySQL 客户端看库不方便——存的字面量是 UTC 墙钟，排查时心算 8 小时。页面显示本身是正常的（前端按浏览器时区渲染），所以这不是线上故障，是排查体验问题。

**为什么不能只加一个配置。** 全库时间列都是 `@db.DateTime`，**零个 `TIMESTAMP`**（`backend/prisma/schema.prisma`，92 列）。MySQL/MariaDB 的 `DATETIME` **不做时区换算**——存的就是字面量，读出来还是那个字面量。所以「让客户端里看到北京时间」只有一条路：**让写进去的字面量本身就是北京时间**。`SET time_zone` 改不了已存的值，它只影响 `NOW()` 一类服务端求值。

**为什么绕不开 patch 一个依赖。** Prisma 走 `@prisma/adapter-mariadb`，该适配器在每条查询上强制 `dateStrings: true`（`dist/index.js:335`），随后**自己硬编码 UTC**——读 `new Date(\`${value}Z\`)`（`:150`），写 `formatDateTime` 用 `getUTC*`（`:164-168`）。它是驱动适配器，上游驱动（mariadb / mysql2）的 `timezone` 选项够不着这一层，而适配器构造参数只有 `{ useTextProtocol }`。换驱动也不解决：npm 上没有 `@prisma/adapter-mysql2`，自写一个 adapter 的接口面是 403 行类型定义 + 533 行参考实现，比 4 行 patch 大两个数量级。

## 决定

口径由三处**互不相干**的机制共同保证，**缺一不可**：

| 机制 | 位置 | 管什么 |
| --- | --- | --- |
| `@prisma/adapter-mariadb` 补丁 | `patches/@prisma__adapter-mariadb@7.9.0.patch` | Node 侧 `DATETIME` 字面量的**读写偏移** |
| `timezone: "+08:00"` | `backend/libs/shared/persistence/db.ts` `buildPoolConfig` | Node 侧连接**会话时区**（`NOW()` / `DEFAULT CURRENT_TIMESTAMP`） |
| `WorkerClock` + `connectionInitSql` | `worker-java/.../WorkerClock`、`DataSourceConfig` | Java 侧写库时刻 + 会话时区 |

**只做一半会造成同一行内 8 小时撕裂**：`gmt_create` 走 DDL 默认值（会话时区生效）写北京，而 `gmt_modified` 走应用侧 `new Date()`（补丁生效）写 UTC。已实测复现。

### 上表**不覆盖**的第四个写入方：`prisma migrate`

`prisma migrate` 走 Prisma 自己的连接（`backend/prisma.config.ts` 只配了 `datasource.url`），**既没有 `db.ts` 的 `timezone`，也不经过 adapter 补丁**——它的会话时区就是服务端 `@@global.time_zone`。仓库里已有迁移直接写 `NOW()` 落到 `generation_model_capability.gmt_modified`：

- `backend/prisma/migrations/20260911120000_ikf4li_official_openai_images_protocol/migration.sql:61,65,75`
- `backend/prisma/migrations/20260910170000_ikesd6_i2i_model_alias_prompt_length/migration.sql:65,70`

**处置（只能选一条，另一条不能做）**：迁移执行前，**由执行方把 migrate 会话的时区显式钉住**（`SET time_zone='+08:00'`，或把 `@@global.time_zone` 设成 `+08:00`）。

**不能改已应用迁移里的 `NOW()`**：Prisma 在 `_prisma_migrations` 里存每条已应用迁移的校验和，改动文件会让 `migrate deploy` 校验失败；本仓另有「带编号的变更文件不再改写」的既有约定。已应用的那两条迁移属于「历史数据」，本次不回溯。

依赖版本锁死 `7.9.0`（`backend/package.json`）：`patchedDependencies` 按**精确版本**匹配 key，用 `^` 会在上游升版时静默失配。

## 排期前置条件（未确认不得排期）

**先确认生产库的全局时区现值**：

```sql
SELECT @@global.time_zone, @@system_time_zone, NOW(), UTC_TIMESTAMP();
```

这不是「未完成事项」，是**前置条件**——本 ADR 的 `+480` 推导、以及「历史数据整体偏早 8 小时」这条验收判据，**都建立在「生产全局时区是 UTC」这个前提上**。若生产本来就是 `+08:00`：

- **今天的全链路已经撕裂**，不是「风险画像不同」：`gmt_create` 走 DDL 默认值、受全局时区管，**已是北京**；`gmt_modified` 走应用写入，**是 UTC**。同一行差 8 小时，且已经落在库里的那些行就是错的。
- 验收判据**要按列分开写**：应用写入的列偏早 8 小时，DDL 默认值生成的列不偏。
- `+480` 的「逐字恢复原语义」不再成立——它会变成单纯放宽 8 小时（无害，但不是原意），窗口收敛时刻要重算。

同时需向运维核对两个窗口环境变量的**现值**（`RECOVERY_MAX_AGE_MINUTES` / `MATERIAL_STATUS_POLL_MAX_AGE_MINUTES`）：`+480` 是在 Java `@Value` 默认值（120 / 10）上推的。`ASSET_GC_DELAY_DAYS` 不在其列——它对应的 GC 在本批次线上不存在（见「后果」末条）。

## 发布程序（必须停机切换）

**不能滚动发布。** 两个方向都不可接受：

- **Node 先切** → Java 的 `next_action_at <= NOW()` 对北京值恒假 → **生成全线停摆 8 小时**
- **Java 先切** → 对 UTC 值恒真 → **重试退避被击穿成风暴**

Java 侧所有到期判断都在 SQL 里对 `NOW()`，Java 侧零比较（见 `GenerationJobMapper` 四组同形谓词），所以两侧的口径必须同时生效。

```
T-0   ① 停投递（关生成入口 / 停 producer）
      ② 停全部 writer（blue-whale API / worker-java），并确认在飞任务已跑完
      ③ 同窗口起新镜像，环境变量：
           RECOVERY_MAX_AGE_MINUTES=600              # 原值 + 480
           MATERIAL_STATUS_POLL_MAX_AGE_MINUTES=490  # 原值 + 480
T+120m RECOVERY_MAX_AGE_MINUTES 回原值
T+10m  MATERIAL_STATUS_POLL_MAX_AGE_MINUTES 回原值
```

**为什么 ② 必须「等任务真跑完」，而不是「等租约到期」。** 租约在轮询期间**一直被续期**（`updateMediaExtractProgress` 的 mapper 就是 `SET progress=?, last_polled_at=NOW(), lease_expires_at=<?>`；`updateVideoSceneSplitProgress` / `rescheduleVideoPoll` 同理），所以只停投递不停 writer 的话，租约永远不会「自然到期」，等多久都一样。而且这一步**本来也不承担安全职责**——见下。

**真正兜底的是 ②，不是等待。** 存量 `lease_expires_at` / `next_action_at` 是 UTC 字面量，切换后 `NOW()` 是北京，`GenerationJobMapper` 的谓词 `next_action_at <= NOW() AND (... lease_expires_at < NOW())` **两个条件会同时为真**——无论真实租约有没有过期，都被判成 8 小时前。所以存量的在飞状态在切换后一定会被重新认领；能做的是让「存量在飞」尽可能少，也就是把 ② 做实。

**预期代价（验收时不要当 bug 报）。** 切换瞬间仍处于 `processing` 的存量行，重启后必然被立刻重新认领并**重跑**。fencing token 能挡住旧 worker 的写入（不会产生并发写），但**挡不住重复打上游 provider、重复扣费**。能否续跑取决于该类型有没有存 `provider_task_id`：存了的（视频轮询类）能复用上游结果，没存的（图片类）会重新提交一次。

**为什么是 +480。** `gmt_create > NOW() - INTERVAL W MINUTE` 在 +08:00 会话下，对存量 UTC 字面量等价于要求「创建于 `t_now + 480 - W` 之后」。取 `W' = W + 480` 得 `t > t_now - W`，**逐字恢复原语义、零额外放宽**；存量行在 W 分钟后自然老化出窗，所以只需维持 W 分钟。

**不加窗口的后果**：存量在飞任务**永远掉出 recovery 扫描窗口，不会自己恢复**（差距恒为负，`NOW()` 追不上），表现为用户可见的卡死。

### 回滚

回退是**对称**的，同样要停机、同样要做窗口处理（方向相反：回退后新写入的北京字面量相对 UTC 的 `NOW()` 会「躲进未来 8 小时」，recovery 扫不到，`MATERIAL_STATUS_POLL_MAX_AGE_MINUTES` 同样要放大）。

**但回退比前进脏**：回退时库里已经混入北京字面量，不再有「存量全是 UTC」那样干净的二分。窗口期过后，被回退那次切换期间写入的行会永久偏晚 8 小时。所以**回滚只有在确认口径判断错误时才做**，不要当成常规退路；若只是发布程序卡住，优先向前修。

## 后果

- **历史数据不迁移**：切换前写入的行读回**整体偏早 8 小时**（实测 `2026-09-21 06:30:34` → `2026-09-20T22:30:34Z`）。这是既定口径，不按 bug 报；判据是看行的时间是否接近「现在」。
- **接口响应仍是 UTC**，日志对齐的是库不是接口。Node 侧 `.toISOString()` 与 `JSON.stringify` 恒产 `Z` 结尾，改动面 20+ 处，本次不动。取舍与理由写在 `backend/libs/core/logger.ts` 的文档块里。
- **Java 容器日志仍是 UTC**：JVM 默认时区，容器未设 `TZ`。与 `WorkerClock` 无关，排查时注意差 8 小时。
- **跨服务日志的字符串排序性质，本次不保证。** 2026-09-03 把日志改成 UTC 的另一半理由是「跨服务日志按字符串排序」——`+08:00` 与 `Z` 混排时字典序不等于时间序（`+` < `Z`），所有新行会排在所有旧行之前。本次只把本仓日志改成 `+08:00`；另外两仓（agent 侧等）若未同批改，这条性质即失效。**本次的取舍**：日志对齐**库**（排查时先看库、再对接口）优先于对齐其它服务的日志。若跨服务排序仍被依赖，需另立工单把另外两仓同批改掉——不要只改本仓就宣布该性质还在。
- `assets.deleted_at` 的 GC 在本批次线上**不存在**（`asset-gc.service.ts` 随 node generation-worker 在 `1312c474` 一并退役，只在 master 上有）。**因此 `ASSET_GC_DELAY_DAYS` 不需要在发布时调整**——工单正文与 PR 正文里「唯一不可逆点，必须提前调该变量」的说法是照着 master 代码写的，已作废。若将来恢复 GC，其 `deleted_at` 比较需要同样的窗口处理。

## 验证

- `backend/libs/shared/persistence/tz-caliber.test.ts` —— 不连库，守两处机制的**存在性**（配置取值正确、补丁确实落在安装副本上）。默认门禁就能拦住。
- `backend/libs/shared/persistence/tz-caliber.integration.test.ts` —— DB 门控（`IKHJ0Q_DATABASE_URL`），守核心不变量「**DB 默认值与显式写入落在同一个钟**」。变异验证：删会话时区 → 报 28801 秒差；删补丁 → 报 28799 秒差。
- `worker-java` `WorkerClockTest` + 既有集成测试。变异 `WorkerClock` 回 UTC → `ClaimCasTests` 3 例失败（任务被提前认领）。
- 镜像构建必须实测：补丁文件此前不在 `.dockerignore` 白名单里，`pnpm install` 会 ENOENT（已修）。

## 相关

- [ADR-0074](0074-frontend-backend-separation-nestjs-product-api.md)（NestJS 产品 API）
- `docs/specs/2026-09-10-ikel4a-worker-java-migration-contract.md` §10 / §13.3（跨进程契约，已同步修订）
