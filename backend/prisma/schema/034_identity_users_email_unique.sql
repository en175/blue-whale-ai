-- identity_users.email 加唯一索引（邮箱登录的正确性前提）。
--
-- ── 为什么必须唯一 ────────────────────────────────────────────────────────────
-- `findByLoginName` 用 `username = ? OR email = ?` 一次查出登录主体。email 不唯一时
-- 这条查询会命中**任意一行**——两个人共用邮箱，谁先被查到谁就能登，另一个人被忽略。
-- 这不是「偶尔选错」，这是一次**用别人的邮箱登进来**。
--
-- ── ⚠️ pre-flight：上线前必须先跑，有重复则本迁移在此失败（刻意的） ──────────
--   SELECT email, COUNT(*) c FROM identity_users
--   WHERE email IS NOT NULL AND email <> '' GROUP BY email HAVING c > 1;
--
--   为什么不自动去重：重复邮箱意味着「两个人填了同一个邮箱」。留哪个是**产品决定**
--   （是不是同一个人？要不要合并账号？），自动挑一个等于悄悄改掉某个人的登录凭据。
--
-- ── ⚠️ 空串必须先清成 NULL ────────────────────────────────────────────────────
-- MySQL 的唯一索引把 NULL 视作互不相等（多行 NULL 合法），但**空串互不相等这句话不成立**
-- ——第二行 email = '' 就会撞索引。存量里「只填手机号」的账号很可能把 email 存成了空串，
-- 不清就直接建索引，会以一条看不懂的 Duplicate entry '' 失败。
--
-- ⚠️ 语句顺序与 20260924180000 的取舍不同：那里的「有失败风险的步骤」可以排在最前，
--    这里不行——清空串必须早于建索引，否则索引建不起来。好在清空串是**幂等**的：
--    万一索引那步失败，库只是多了几行 email=NULL，重跑即可，不存在半途不可重入的状态。
SET NAMES utf8mb4;

-- ── ① 空串清成 NULL（幂等） ──
UPDATE `identity_users`
SET `email` = NULL
WHERE `email` = '';

-- ── ② 邮箱唯一（登录凭据）—— 有重复则在此失败 ──
ALTER TABLE `identity_users`
    ADD UNIQUE INDEX `uk_identity_users__email`(`email`);
