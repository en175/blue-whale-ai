-- 表名前缀收敛：`identity_*` → `bw_*`（六张表 + 其上的九个索引名）。
--
-- ── 为什么改 ──────────────────────────────────────────────────────────────────
-- ADR-0117 把前缀定义为「限界上下文 = 未来库名」，`identity_` 是按那条规则落地的。
-- 落到实处的体验是：这个前缀在**共库**时不自解释——`identity_users` 看不出属于哪个产品，
-- 而本产品的库、只读账号、会话 cookie 早就是 `bw_`（`bw_billing` / `bw_readonly` /
-- `bw_session`）。表名与它们对齐后，慢查询日志、库表清单、迁移文件名里一眼能看出归属。
--
-- ── 为什么表改名是**一条** RENAME ─────────────────────────────────────────────
-- MySQL 的多表 `RENAME TABLE` 是原子的：要么六张全改，要么一张都不改。
-- 拆成六条则一旦中途失败会停在「前几张改了、后几张没改」的半途，而 RENAME 不可重入，
-- 重跑直接报「表不存在」，只能人工收拾。这与 20260924180000 里「有失败风险的那一步
-- 放最前」是同一条理由的加强版：这里干脆让整步无法半途而废。
--
-- ── 为什么索引名这次也跟着改（20260924180000 曾把它留作独立一步） ─────────────
-- 那次留下的理由是：「生产库里的实际索引名未必与 schema.prisma 的 map 一致，
-- 猜错就又是一次不可重入的失败」。**这条理由已被实测推翻**：本次用 `SHOW INDEX`
-- 在本地库与测试站两个真实库核对过，九个 `uk_identity_*` / `idx_identity_*`
-- 全部是**我们自己的迁移用显式名字建的**（见下方 pre-flight ②），两边逐字一致——
-- 名字是确定的，不是猜的。于是按 §9 的 `uk_{表}__{列}` / `idx_{表}__{列}` 一并整改。
--
-- ⚠️ 核对时发现测试站 `identity_users` 上另有 `idx_users_username` / `username` /
--    `username_2` 三个**同列冗余索引**（本地没有；`users` 时代遗留，其中一个还非唯一）。
--    它们不含 `identity_` 前缀，**本条不动**——删索引是独立决策，不搭这次改名的车。
-- ⚠️ `idx_phone` / `idx_ip_created` / `idx_phone_created` / `idx_phone_unused` 同理不含
--    `identity_` 前缀，保持原样：它们是 baseline 带进来的名字，不在本次收敛范围。
--
-- ── 语句顺序是刻意的 ──────────────────────────────────────────────────────────
-- 表改名必须在最前：下面九条 `RENAME INDEX` 用的是**新表名**，表还没改完就执行会
-- 整片报「表不存在」。索引改名逐表独立，某张表失败不影响其他表。
--
-- ── 影响面（已核实） ──────────────────────────────────────────────────────────
--   * 全库零 FOREIGN KEY / 视图 / 触发器 → RENAME 无连带约束要处理。
--   * worker-java（直连 DB）不碰这六张表；billing 走 gRPC 不读本库 → Java 侧零改动。
--   * 前端与 backend 的 raw SQL 均无引用，Prisma 是唯一访问路径。
--
-- ── pre-flight：上线前先在目标库跑这两条 ──────────────────────────────────────
--   ① 六张表都在、且没有 bw_ 同名占用（期望：恰好六行，全是 identity_）
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema = DATABASE()
--      AND table_name IN ('identity_users','identity_verification_codes','identity_memberships',
--                         'identity_roles','identity_user_roles','identity_login_logs',
--                         'bw_users','bw_verification_codes','bw_memberships',
--                         'bw_roles','bw_user_roles','bw_login_logs');
--   ② 九个索引名与下表逐字一致（期望：恰好九行）
--   SELECT table_name, index_name FROM information_schema.statistics
--    WHERE table_schema = DATABASE() AND index_name <> 'PRIMARY'
--      AND (index_name LIKE 'uk_identity\_%' OR index_name LIKE 'idx_identity\_%')
--    ORDER BY table_name, index_name;
--   期望结果：
--     bw_users(此时仍叫 identity_users)          uk_identity_users__email
--                                                uk_identity_users__username
--     identity_memberships                       uk_identity_memberships__grant_key
--                                                idx_identity_memberships__user_status_expiry
--     identity_roles                             uk_identity_roles__code
--     identity_user_roles                        uk_identity_user_roles__grant_key
--                                                idx_identity_user_roles__user
--     identity_login_logs                        idx_identity_login_logs__user_time
--                                                idx_identity_login_logs__ip_time
--   多出或少一行都说明目标库与我们核对过的两个库不同形——**先停下来查清，别直接跑**。
SET NAMES utf8mb4;

-- ── ① 六张表改名（一条多表 RENAME，原子） ──
RENAME TABLE `identity_users`              TO `bw_users`,
             `identity_verification_codes` TO `bw_verification_codes`,
             `identity_memberships`        TO `bw_memberships`,
             `identity_roles`              TO `bw_roles`,
             `identity_user_roles`         TO `bw_user_roles`,
             `identity_login_logs`         TO `bw_login_logs`;

-- ── ② 九个索引名跟着表名走（§9：`uk_{表}__{列}` / `idx_{表}__{列}`） ──
-- 每个 ALTER 里的多条 RENAME INDEX 是原子的；同一列上的多个改名不会互相影响。
ALTER TABLE `bw_users`
    RENAME INDEX `uk_identity_users__username` TO `uk_bw_users__username`,
    RENAME INDEX `uk_identity_users__email`    TO `uk_bw_users__email`;

ALTER TABLE `bw_memberships`
    RENAME INDEX `uk_identity_memberships__grant_key`           TO `uk_bw_memberships__grant_key`,
    RENAME INDEX `idx_identity_memberships__user_status_expiry` TO `idx_bw_memberships__user_status_expiry`;

ALTER TABLE `bw_roles`
    RENAME INDEX `uk_identity_roles__code` TO `uk_bw_roles__code`;

ALTER TABLE `bw_user_roles`
    RENAME INDEX `uk_identity_user_roles__grant_key` TO `uk_bw_user_roles__grant_key`,
    RENAME INDEX `idx_identity_user_roles__user`     TO `idx_bw_user_roles__user`;

ALTER TABLE `bw_login_logs`
    RENAME INDEX `idx_identity_login_logs__user_time` TO `idx_bw_login_logs__user_time`,
    RENAME INDEX `idx_identity_login_logs__ip_time`   TO `idx_bw_login_logs__ip_time`;

-- bw_verification_codes 没有 identity_ 前缀的索引，无需处理。
