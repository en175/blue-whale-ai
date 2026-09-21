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

依赖版本锁死 `7.9.0`（`backend/package.json`）：`patchedDependencies` 按**精确版本**匹配 key，用 `^` 会在上游升版时静默失配。

## 发布程序（必须停机切换）

**不能滚动发布。** 两个方向都不可接受：

- **Node 先切** → Java 的 `next_action_at <= NOW()` 对北京值恒假 → **生成全线停摆 8 小时**
- **Java 先切** → 对 UTC 值恒真 → **重试退避被击穿成风暴**

Java 侧所有到期判断都在 SQL 里对 `NOW()`，Java 侧零比较（见 `GenerationJobMapper` 四组同形谓词），所以两侧的口径必须同时生效。

```
T-0   ① 停投递，等在飞租约自然到期（≥5 min，覆盖最长租约）
      ② 停全部 writer（blue-whale API / worker-java）
      ③ 同窗口起新镜像，环境变量：
           RECOVERY_MAX_AGE_MINUTES=600              # 原值 + 480
           MATERIAL_STATUS_POLL_MAX_AGE_MINUTES=490  # 原值 + 480
T+120m RECOVERY_MAX_AGE_MINUTES 回原值
T+10m  MATERIAL_STATUS_POLL_MAX_AGE_MINUTES 回原值
```

**为什么是 +480。** `gmt_create > NOW() - INTERVAL W MINUTE` 在 +08:00 会话下，对存量 UTC 字面量等价于要求「创建于 `t_now + 480 - W` 之后」。取 `W' = W + 480` 得 `t > t_now - W`，**逐字恢复原语义、零额外放宽**；存量行在 W 分钟后自然老化出窗，所以只需维持 W 分钟。

**不加窗口的后果**：存量在飞任务**永远掉出 recovery 扫描窗口，不会自己恢复**（差距恒为负，`NOW()` 追不上），表现为用户可见的卡死。

## 后果

- **历史数据不迁移**：切换前写入的行读回**整体偏早 8 小时**（实测 `2026-09-21 06:30:34` → `2026-09-20T22:30:34Z`）。这是既定口径，不按 bug 报；判据是看行的时间是否接近「现在」。
- **接口响应仍是 UTC**，日志对齐的是库不是接口。Node 侧 `.toISOString()` 与 `JSON.stringify` 恒产 `Z` 结尾，改动面 20+ 处，本次不动。取舍与理由写在 `backend/libs/core/logger.ts` 的文档块里。
- **Java 容器日志仍是 UTC**：JVM 默认时区，容器未设 `TZ`。与 `WorkerClock` 无关，排查时注意差 8 小时。
- `assets.deleted_at` 的 GC 在本批次线上**不存在**（`asset-gc.service.ts` 随 node generation-worker 在 `1312c474` 一并退役，只在 master 上有）。若将来恢复 GC，其 `deleted_at` 比较需要同样的窗口处理。

## 验证

- `backend/libs/shared/persistence/tz-caliber.test.ts` —— 不连库，守两处机制的**存在性**（配置取值正确、补丁确实落在安装副本上）。默认门禁就能拦住。
- `backend/libs/shared/persistence/tz-caliber.integration.test.ts` —— DB 门控（`IKHJ0Q_DATABASE_URL`），守核心不变量「**DB 默认值与显式写入落在同一个钟**」。变异验证：删会话时区 → 报 28801 秒差；删补丁 → 报 28799 秒差。
- `worker-java` `WorkerClockTest` + 既有集成测试。变异 `WorkerClock` 回 UTC → `ClaimCasTests` 3 例失败（任务被提前认领）。
- 镜像构建必须实测：补丁文件此前不在 `.dockerignore` 白名单里，`pnpm install` 会 ENOENT（已修）。

## 相关

- [ADR-0074](0074-frontend-backend-separation-nestjs-product-api.md)（NestJS 产品 API）
- `docs/specs/2026-09-10-ikel4a-worker-java-migration-contract.md` §10 / §13.3（跨进程契约，已同步修订）
