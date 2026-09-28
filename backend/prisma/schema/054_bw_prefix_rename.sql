-- 表名前缀收敛：`identity_*` → `bw_*`（六张表 + 其上的九个索引名）。
--
-- ── 为什么改 ──────────────────────────────────────────────────────────────────
-- ADR-0117 把前缀定义为「限界上下文 = 未来库名」，`identity_` 是按那条规则落地的。
-- 落到实处的体验是：这个前缀在**共库**时不自解释——`identity_users` 看不出属于哪个产品，
-- 而本产品的库、只读账号、会话 cookie 早就是 `bw_`（`bw_billing` / `bw_readonly` /
-- `bw_session`）。表名与它们对齐后，慢查询日志、库表清单、迁移文件名里一眼能看出归属。
-- 决策记录见 ADR-0118。
--
-- ── 语句顺序是刻意的：索引改名在前，表改名在后 ─────────────────────────────────
-- 沿用 20260924180000 的规矩——**有失败风险的那一步放最前，失败时表不受影响**。
-- 这里风险高的是九条 `RENAME INDEX`（要按名字精确命中，而 `RENAME INDEX` 没有
-- `IF EXISTS`）；表改名是一条多表 `RENAME TABLE`，MySQL 保证它原子。
-- 反过来的话（先改表名），任何一条索引改名失败都会停在「表已改名、索引没跟上」——
-- 旧代码当场读不到表，而 RENAME TABLE 不可重入，重跑第一步就报「表不存在」。
-- 按现在的顺序半途失败时：**表仍是原名，线上代码照常跑**，补完索引再重跑即可。
--
-- ── 半途失败怎么恢复 ──────────────────────────────────────────────────────────
-- 九个索引改名落在五个 `ALTER` 上，每个 `ALTER` 内部原子，但**五个之间不是全有全无**：
-- 若第 3 个失败，前两个表上的索引已经变成 `*_bw_*` 了。此时：
--   1. 把本文件余下的 `RENAME INDEX` 语句手工执行完；
--   2. 手工执行最下面那条多表 `RENAME TABLE`；
--   3. `prisma migrate resolve --applied 20260928100000_bw_prefix_rename` 补上记录。
-- ⚠️ **不要**直接重跑整个文件——已改名的索引会报「找不到」。
--
-- ── 为什么索引名也要跟着改（20260924180000 曾把它留作独立一步） ───────────────
-- 那次留下的理由是：「生产库里的实际索引名未必与 schema.prisma 的 map 一致，
-- 猜错就又是一次不可重入的失败」。**这条已被实测推翻**：本次用 `SHOW INDEX`
-- 在本地库与测试站两个真实库核对过，九个名字全部是**我们自己的迁移用显式名字建的**
-- （见 pre-flight ②），两边逐字一致——名字是确定的，不是猜的。
--
-- ⚠️ 核对时发现测试站 `identity_users` 上另有 `idx_users_username` / `username` /
--    `username_2` 三个**同列冗余索引**（本地没有；`users` 时代遗留，其中一个还非唯一）。
--    它们不含 `identity_` 前缀，**本条不动**——删索引是独立决策，不搭这次改名的车。
-- ⚠️ `idx_phone` / `idx_ip_created` / `idx_phone_created` / `idx_phone_unused` 同理不含
--    `identity_` 前缀，保持原样：它们是 baseline 带进来的名字，不在本次收敛范围。
--
-- ── 影响面（已核实） ──────────────────────────────────────────────────────────
--   * 全库零 FOREIGN KEY / 视图 / 触发器 → RENAME 无连带约束要处理。
--   * worker-java（直连 DB）不碰这六张表；billing 走 gRPC 不读本库 → Java 侧零改动。
--   * 前端与 backend 的 raw SQL 均无引用，Prisma 是唯一访问路径。
--
-- ── pre-flight：上线前先在目标库跑这三条 ──────────────────────────────────────
--
--   ① 六张表都在、且没有 bw_ 同名占用（期望：恰好六行，且全是 identity_ 开头。
--      出现 bw_ 开头的一行说明本迁移已跑过或目标名已被占用，两种情况下都不该再跑）
--
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema = DATABASE()
--      AND table_name IN ('identity_users','identity_verification_codes','identity_memberships',
--                         'identity_roles','identity_user_roles','identity_login_logs',
--                         'bw_users','bw_verification_codes','bw_memberships',
--                         'bw_roles','bw_user_roles','bw_login_logs');
--
--   ② 九个索引名与下表逐字一致。
--      ⚠️ **必须带 DISTINCT**：`information_schema.statistics` 是**一个索引列一行**，
--         这九个索引合计 14 列，不带 DISTINCT 会返回 14 行，和「九」对不上，
--         会把一个完全合规的库误判成「不同形」。
--
--   SELECT DISTINCT table_name, index_name FROM information_schema.statistics
--    WHERE table_schema = DATABASE() AND index_name <> 'PRIMARY'
--      AND (index_name LIKE 'uk\_identity\_%' OR index_name LIKE 'idx\_identity\_%')
--    ORDER BY table_name, index_name;
--
--   期望**恰九行**，逐字等于：
--     identity_users         uk_identity_users__email
--                            uk_identity_users__username
--     identity_memberships   uk_identity_memberships__grant_key
--                            idx_identity_memberships__user_status_expiry
--     identity_roles         uk_identity_roles__code
--     identity_user_roles    uk_identity_user_roles__grant_key
--                            idx_identity_user_roles__user
--     identity_login_logs    idx_identity_login_logs__user_time
--                            idx_identity_login_logs__ip_time
--   （identity_verification_codes 上没有 identity_ 前缀的索引）
--   多出或少一行都说明目标库与我们核对过的两个库不同形——**先停下来查清，别直接跑**。
--
--   ③ `RENAME INDEX` 需要 MySQL ≥ 5.7 / MariaDB ≥ 10.5.2。核对时本地库与测试站都是
--      MySQL 8.0.46，满足；换新环境时确认一次。
--
--   SELECT VERSION();
SET NAMES utf8mb4;

-- ── ① 九个索引名先行改名（§9：`uk_{表}__{列}` / `idx_{表}__{列}`） ──
-- 此刻表还叫 identity_*，所以两条名字都用旧表名——`RENAME INDEX` 的目标名只是个字符串，
-- 不要求与表名一致；下一步表改完，两边自然对齐。
ALTER TABLE `identity_users`
    RENAME INDEX `uk_identity_users__username` TO `uk_bw_users__username`,
    RENAME INDEX `uk_identity_users__email`    TO `uk_bw_users__email`;

ALTER TABLE `identity_memberships`
    RENAME INDEX `uk_identity_memberships__grant_key`           TO `uk_bw_memberships__grant_key`,
    RENAME INDEX `idx_identity_memberships__user_status_expiry` TO `idx_bw_memberships__user_status_expiry`;

ALTER TABLE `identity_roles`
    RENAME INDEX `uk_identity_roles__code` TO `uk_bw_roles__code`;

ALTER TABLE `identity_user_roles`
    RENAME INDEX `uk_identity_user_roles__grant_key` TO `uk_bw_user_roles__grant_key`,
    RENAME INDEX `idx_identity_user_roles__user`     TO `idx_bw_user_roles__user`;

ALTER TABLE `identity_login_logs`
    RENAME INDEX `idx_identity_login_logs__user_time` TO `idx_bw_login_logs__user_time`,
    RENAME INDEX `idx_identity_login_logs__ip_time`   TO `idx_bw_login_logs__ip_time`;

-- ── ② 六张表改名（一条多表 RENAME，原子） ──
RENAME TABLE `identity_users`              TO `bw_users`,
             `identity_verification_codes` TO `bw_verification_codes`,
             `identity_memberships`        TO `bw_memberships`,
             `identity_roles`              TO `bw_roles`,
             `identity_user_roles`         TO `bw_user_roles`,
             `identity_login_logs`         TO `bw_login_logs`;

-- `identity_verification_codes` 上没有 identity_ 前缀的索引，无需处理。
