-- ⚠️ 已归档（IK1W1E）：本迁移的变更已并入 V1 基线 (db/migrations/V1__baseline.sql)。
-- 历史保留供追溯，不再由迁移器执行。新增量请放在 db/migrations/V<n>__<slug>.sql。
-- IK1NRW：泛化 UserInputRequest 契约为产品中性输入请求
--
-- 将原"成本确认专用"的 user_input_requests 中性化为归属 AgentRun 的产品级输入请求，
-- 新增 request_type 区分创作澄清（creation_clarification）与成本确认（cost_confirmation）。
-- 创作澄清不需要报价/供应商/成本策略字段，因此相关字段改为可空；新增可见问题与回答绑定。
-- 详见 docs/adr/0036-generalize-user-input-request-contract.md。

-- 线上库渐进迁移：列可能已存在（老库补表）或不存在，统一用安全的 ADD COLUMN。
-- MySQL 8 不支持 ADD COLUMN IF NOT EXISTS，此处依赖首次执行时列尚未存在；重复执行需先校验。
ALTER TABLE user_input_requests
    ADD COLUMN request_type VARCHAR(32) NOT NULL DEFAULT 'cost_confirmation'
        AFTER user_id;

ALTER TABLE user_input_requests
    ADD COLUMN question TEXT NULL AFTER request_target_type;

ALTER TABLE user_input_requests
    ADD COLUMN answer_message_id BIGINT NULL AFTER consumed_at;

-- 成本字段改为可空：创作澄清请求不携带报价/供应商/策略版本。
ALTER TABLE user_input_requests
    MODIFY COLUMN quoted_amount_fen BIGINT NULL,
    MODIFY COLUMN quoted_provider VARCHAR(64) NULL,
    MODIFY COLUMN price_catalog_version VARCHAR(64) NULL,
    MODIFY COLUMN exchange_rate_version VARCHAR(64) NULL,
    MODIFY COLUMN model_policy_version VARCHAR(64) NULL,
    MODIFY COLUMN cost_rule_version VARCHAR(64) NULL;

ALTER TABLE user_input_requests
    COMMENT = '产品中性输入请求，归属 AgentRun，区分创作澄清与成本确认';
