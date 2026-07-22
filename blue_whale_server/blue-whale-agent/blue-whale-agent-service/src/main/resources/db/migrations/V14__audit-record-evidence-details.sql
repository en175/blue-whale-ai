-- IK3AH2：只读资源证据落主 audit_records（兑现只读追溯承诺）。
-- ReadEvidence（bundle.read_evidence）逐条审计，details 存 revision / content_digest / token_estimate。
-- 纯 DDL 无数据迁移；H2 测试 schema 以 CLOB 镜像本列（schema-h2.sql）。

ALTER TABLE audit_records ADD COLUMN details JSON NULL;
