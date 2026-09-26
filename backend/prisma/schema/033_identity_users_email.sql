-- identity_users 补 email 列（设计 §6.2）。
--
-- 为什么它不是「顺手加的字段」：username 与 email 都是登录凭据（email+password 是
-- 已支持的登录方式之一），而 ETL 要从 new-api 把邮箱搬过来。少了这一列，
-- 存量用户的邮箱直接丢——将来想用邮箱找回密码就找不回来了。
SET NAMES utf8mb4;
ALTER TABLE `identity_users`
    ADD COLUMN `email` VARCHAR(50) NULL AFTER `phone`;
