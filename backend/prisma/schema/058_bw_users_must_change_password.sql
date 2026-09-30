-- bw_users 加 `must_change_password`：管理员重置口令后置 1，用户下次登录必须改密，改完清零。
--
-- ── 背景 ──────────────────────────────────────────────────────────────────────
-- IKJABH「管理员重置密码」：用户在用户列表里被管理员重置了口令，但**用什么挡住他继续用
-- 那个临时口令**？只靠「重置后踢掉全部会话」不够——他拿临时口令再登一次就回来了，
-- 临时口令于是永久有效，而管理员是知道它的。
-- 所以需要一个**登录后仍然生效**的标记：登录时带出它，前端据此强制弹改密、改完才放行。
--
-- ── 为什么是列而不是别的 ──────────────────────────────────────────────────────
-- 会话快照不行：那是登录那一刻的值，重置之后老会话里还是 0。
-- 单独一张表也不行：这是一个「有且仅有一个」的账号属性，和 `password` 同寿命，
-- 分成两张表只会让「改密时应不应该清它」变成两处实现。
--
-- ── 默认值必须是 0 ────────────────────────────────────────────────────────────
-- 存量用户与手机号验证码建号出来的用户都**没有**被重置过。默认 1 的话，
-- 全站用户下次登录会被集体拦去改密——一次规模不明、且没人预料到的意外。
--
-- ── 三轨（改一处必须三处同改，逐字一致）──────────────────────────────────────
--   * backend/prisma/migrations/20260930120000_bw_users_must_change_password/migration.sql
--   * backend/prisma/schema/058_bw_users_must_change_password.sql
--   * docs/sql/20260930_bw_users_must_change_password.sql
-- 断言见 backend/libs/shared/persistence/bw-users-must-change-password-parity.test.ts。
--
-- ── 回读验证（执行后）────────────────────────────────────────────────────────
--   SHOW COLUMNS FROM bw_users LIKE 'must\_change\_password';   -- Type 应为 tinyint(1)、Default 0、Null NO
SET NAMES utf8mb4;

ALTER TABLE `bw_users`
  ADD COLUMN `must_change_password` TINYINT(1) NOT NULL DEFAULT 0
  COMMENT '管理员重置口令后置 1：下次登录必须改密，改完清零';
