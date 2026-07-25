-- 场景 3 夹具：模拟未知结构漂移。
-- 灌入 MySQL initdb.d 后造出一个"说谎的库"：
--   - schema_migrations 记账本谎称 V1 已 applied（status=1）
--   - 但 project 表实际不存在（漂移：表被误删或从未真正建出）
-- 迁移器看到记账本说 V1 已应用 → 跳过 V1 的 CREATE → 跑 V2 seed 时
-- INSERT INTO project 因表不存在而失败 → fail-closed，migration 容器 exit 非 0，
-- user/agent 因 depends_on: service_completed_successfully 不启动。

CREATE TABLE schema_migrations
(
    version INT PRIMARY KEY,
    slug VARCHAR(128) NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    status TINYINT NOT NULL,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO schema_migrations (version, slug, checksum, status) VALUES
    (1, 'baseline', 'forged-checksum-from-drift', 1);
