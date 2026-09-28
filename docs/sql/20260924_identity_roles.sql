-- 自建用户体系：角色 / 用户角色 / 登录日志。
--
-- ── 这一刀解决什么 ────────────────────────────────────────────────────────────
-- 现在判断「是不是管理员」靠一行魔数：`auth.guard.ts:15` 的
-- `const ADMIN_ROLE_THRESHOLD = 10`，比的是 **new-api 返回的 role**。
-- 两个问题：
--   1. 魔数本身不可读——10 是什么、谁定的、改了会怎样，代码里没有答案；
--   2. **来源会消失**：new-api 独立后不再有用户概念，这个字段迟早返回不了。
--      那一刻所有管理员会同时失去权限，而没有任何一处会报错。
--
-- 这一刀把角色落到我们自己的库里。守卫的**切换**是另一件事（见文末），
-- 因为它改的是鉴权路径，且要顺带决定「每次请求查库还是随会话缓存」。
--
-- ── 三个刻意的决定 ────────────────────────────────────────────────────────────
--
-- ① **角色用 code 而不是等级数字。** `admin` 比 `10` 可读，且新增角色不必
--    重新分配数字、不必担心「10 和 11 谁大」。判断管理员是
--    「是否持有 admin 这一类角色」，是**集合成员**问题，不是数值比较问题。
--
-- ② **identity_user_roles 存 role_id 而不是 role_code。** 角色改名（`super_admin` →
--    `root`）时只改一行，不会散落成几十条待更新的关联行。
--
-- ③ **identity_login_logs.user_id 可空。** 登录失败时用户可能压根不存在
--    （用户名打错、撞库），此时没有 id 可写——强行 NOT NULL 会让这些
--    最需要留痕的尝试反而写不进日志。
SET NAMES utf8mb4;

-- ── 角色 ──
CREATE TABLE `identity_roles` (
    `id`           BIGINT       NOT NULL AUTO_INCREMENT,
    -- user | admin | super_admin —— 判断管理员看的是「持不持有这些 code」
    `code`         VARCHAR(32)  NOT NULL,
    `name`         VARCHAR(64)  NOT NULL,
    `description`  VARCHAR(255) NOT NULL DEFAULT '',
    -- 内置角色不可删；运营自建的角色可以
    `is_builtin`   TINYINT      NOT NULL DEFAULT 0,
    -- 仅用于后台列表排序，不参与任何权限判断
    `sort_order`   INTEGER      NOT NULL DEFAULT 0,
    `gmt_create`   DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version`      INTEGER      NOT NULL DEFAULT 0,
    `is_delete`    TINYINT      NOT NULL DEFAULT 0,

    UNIQUE INDEX `uk_identity_roles__code`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 内置角色。**必须有**：没有角色行，下面的授权就无从落笔，
-- 而「谁是管理员」这个问题在 new-api 断链那天会直接无解。
INSERT INTO `identity_roles` (`code`, `name`, `description`, `is_builtin`, `sort_order`) VALUES
    ('user',        '普通用户',   '登录即可获得，无后台权限',                         1, 10),
    ('admin',       '管理员',     '可访问管理端接口',                                 1, 20),
    ('super_admin', '超级管理员', '可访问管理端接口，并管理他人角色',                 1, 30);

-- ── 用户 ↔ 角色 ──
-- 关联表命名按 §9 ④：两表名复数用 _ 连接（identity_user_roles）。
CREATE TABLE `identity_user_roles` (
    `id`           BIGINT       NOT NULL AUTO_INCREMENT,
    `user_id`      BIGINT       NOT NULL,
    `role_id`      BIGINT       NOT NULL,
    -- 谁授的（审计需要；系统自动授予写 'system'）
    `granted_by`   VARCHAR(64)  NOT NULL DEFAULT 'system',
    -- 授权幂等键：同一 (用户,角色) 重复授予靠它拦下
    `grant_key`    VARCHAR(190) NOT NULL,
    `gmt_create`   DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version`      INTEGER      NOT NULL DEFAULT 0,
    `is_delete`    TINYINT      NOT NULL DEFAULT 0,

    UNIQUE INDEX `uk_identity_user_roles__grant_key`(`grant_key`),
    -- 「这个用户有哪些角色」走这条；**唯一的读法**是全部取回再判定，
    -- 不做「按角色反查用户」的索引——那个方向目前没有读者。
    INDEX `idx_identity_user_roles__user`(`user_id`, `is_delete`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── 登录日志 ──
CREATE TABLE `identity_login_logs` (
    `id`           BIGINT       NOT NULL AUTO_INCREMENT,
    -- ⚠️ 可空：登录失败时用户可能压根不存在（用户名打错、撞库），
    --    而这些恰恰是最需要留痕的尝试。
    `user_id`      BIGINT       NULL,
    -- 尝试登录时输入的用户名（不论该用户是否存在）
    `username`     VARCHAR(50)  NOT NULL,
    `ip`           VARCHAR(50)  NOT NULL,
    `user_agent`   VARCHAR(255) NOT NULL DEFAULT '',
    -- 1 = 成功，0 = 失败（与 identity_users.is_delete 等既有 TINYINT 布尔口径一致）
    `success`      TINYINT      NOT NULL,
    -- 失败原因（'账密错误' / '账号锁定' …）；成功时为空串
    `reason`       VARCHAR(64)  NOT NULL DEFAULT '',
    `gmt_create`   DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    -- 排查「这个 IP 在撞库吗」「这个账号最近从哪登录」两个方向
    INDEX `idx_identity_login_logs__user_time`(`user_id`, `gmt_create`),
    INDEX `idx_identity_login_logs__ip_time`(`ip`, `gmt_create`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── 本迁移**不做**的事 ────────────────────────────────────────────────────────
-- 不禁用 auth.guard.ts 的 ADMIN_ROLE_THRESHOLD：角色的**写侧**（谁有什么角色）
-- 现在落地，读侧（守卫怎么用）在 new-api 断链那一步切换。
-- 理由是它是鉴权路径：改它要同时决定「每请求查库还是随会话走」，
-- 而后者取决于会话里能不能安全地缓存角色——那是独立的一次评估，
-- 不该搭在「建三张表」这一刀上顺带做掉。
