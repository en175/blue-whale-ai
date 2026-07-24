-- V18：auto Creative Skill 候选冻结与激活幂等记账（IK3NPF）
-- 1. agent_runs 新增 auto_creative_skill_candidates：Run 创建时冻结的 auto 候选快照（JSON 文本）。
--    forced Run 与无 auto 关系用户 → 空数组 "[]"；升级前已存在 Run 该列 NULL → 安全解释为无候选。
-- 2. 新表 run_creative_skill_activations：Worker→Java 激活命令的幂等事实源，存 response_json 供
--    同键同载逐字节回放（契约 §4.4）。参照 run_commits + runtime_bundle_write_idempotency 组合。

ALTER TABLE agent_runs
    ADD COLUMN auto_creative_skill_candidates JSON NULL AFTER activated_creative_skill_versions;

CREATE TABLE run_creative_skill_activations
(
    id                        BIGINT PRIMARY KEY AUTO_INCREMENT,
    agent_run_id              BIGINT      NOT NULL,
    idempotency_key           VARCHAR(64) NOT NULL,
    request_hash              VARCHAR(64) NOT NULL,
    response_json             JSON        NOT NULL,
    run_version               INT         NOT NULL,
    creative_skill_id         VARCHAR(80) NOT NULL,
    creative_skill_version_id VARCHAR(80) NOT NULL,
    gmt_create                DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified              DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version                   INT         NOT NULL DEFAULT 0,
    is_delete                 TINYINT     NOT NULL DEFAULT 0,
    UNIQUE KEY uk_run_csa (agent_run_id, idempotency_key)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = 'Creative Skill auto 激活幂等记账（IK3NPF）';
