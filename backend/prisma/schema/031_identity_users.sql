-- 自建用户体系：账号主体的改造（`users` → `identity_users`，`verification_codes` → `identity_verification_codes`）。
--
-- ── 这一刀解决什么 ────────────────────────────────────────────────────────────
-- 现有 `users` 表的三处口径与新体系冲突，且都源于同一个前提：
-- **它当初是「手机号即账号」设计的，而 new-api 的存量用户根本没有手机号**
-- （核实自 `blue-whale-api/model/user.go`：`User` 结构体没有 `phone` 字段）。
--
--   1. `phone` NOT NULL + UNIQUE —— 存量用户没有手机号可填，迁不进来
--   2. `username` 非唯一 —— 而它才是登录凭据；不唯一则「用用户名登录」这句话不成立
--   3. 表名没有限界上下文前缀 —— 设计 §9：`identity_` / `billing_` / `generation_`
--
-- 改造后：**username 唯一且是登录凭据；phone 可空，是渐进增强（绑定过的用户多一种登录方式），
-- 不是存量迁移的前提**。手机号登录本身仍未接（`loginWithCode` 零调用者）。
--
-- ── ⚠️ pre-flight：上线前必须先在目标库跑这两条，确认结果符合预期 ────────────
--
--   -- ① 有没有重复的用户名？有则本迁移会**在此失败**（这是刻意的，见下）
--   SELECT username, COUNT(*) c FROM users GROUP BY username HAVING c > 1;
--
--   -- ② 有多少行没有可用用户名（会被回填成 user_<id>）
--   SELECT COUNT(*) FROM users WHERE username IS NULL OR username = '';
--
-- ── ⚠️ 语句顺序是刻意的：**有失败风险的那一步放在最前** ──────────────────────
-- MySQL 的 DDL 不是事务性的。若把 `ADD UNIQUE INDEX` 放在 RENAME 之后，
-- 一旦存在重复用户名，迁移会停在「表已改名、索引没加上」的半途——
-- 而 RENAME 不可重入，重跑会失败，只能人工收拾。
-- 放在最前则失败时库**完全没被改动**，补完数据直接重跑即可。
--
-- 为什么不自动去重：重复的 username 意味着「有两个人都叫 alice」。
-- 自动挑一个加后缀，等于**悄悄改掉某个人的登录凭据**——他明天就登不上了，
-- 而系统里没有任何地方解释过为什么。这种事必须由人决定。
SET NAMES utf8mb4;

-- ── ① 回填空用户名（幂等；必须在加唯一索引之前，否则空串会互撞） ──
-- 这些行本来也没有可用的登录凭据，`user_<id>` 至少让唯一索引能建上。
UPDATE `users`
SET `username` = CONCAT('user_', `id`)
WHERE `username` IS NULL OR `username` = '';

-- ── ② 用户名唯一（登录凭据）—— 有重复则在此失败，此时库尚未被改动 ──
ALTER TABLE `users`
    ADD UNIQUE INDEX `uk_identity_users__username`(`username`);

-- ── ③ 两表改名到 identity_ 限界上下文（多表 RENAME 是原子的） ──
RENAME TABLE `users` TO `identity_users`,
             `verification_codes` TO `identity_verification_codes`;

-- ── ④ phone 转可空：存量用户没有手机号，它只是「多一种登录方式」 ──
-- ⚠️ 唯一索引保留：MySQL 的唯一索引把 NULL 视作互不相等，可空与唯一不冲突。
ALTER TABLE `identity_users`
    MODIFY COLUMN `phone` VARCHAR(20) NULL;

-- 遗留说明：`idx_phone` 等既有索引名未按 §9 的 `uk_{表}__{列}` 规范改名。
-- 改名要 `RENAME INDEX`，而生产库里的实际索引名未必与 schema.prisma 的 map 一致，
-- 猜错就又是一次不可重入的失败。留作独立一步，等能用 SHOW INDEX 核对实际名再做。
