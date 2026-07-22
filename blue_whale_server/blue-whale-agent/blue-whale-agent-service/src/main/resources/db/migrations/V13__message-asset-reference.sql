-- IK39QX：@ 引用随消息同事务持久化（消息 ↔ 素材）。
-- accept 端点接受可选 referenced_asset_ids（上限 10），越权/失效 id 静默过滤后落库；
-- conversation_id / project_id 冗余存储，白名单反查免 JOIN 消息表（读路径工单消费）。

CREATE TABLE IF NOT EXISTS message_asset_reference
(
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    message_id      BIGINT NOT NULL COMMENT '消息ID（→ conversation_messages.id）',
    conversation_id BIGINT NOT NULL COMMENT '冗余：白名单反查免 JOIN 消息表',
    project_id      BIGINT NOT NULL COMMENT '冗余：白名单反查免 JOIN 消息表',
    asset_id        BIGINT NOT NULL COMMENT '素材ID（→ assets.id）',
    mention_seq     INT NOT NULL COMMENT '引用顺序（按请求列表保序，1-based）',
    gmt_create      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    gmt_modified    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    version         INT NOT NULL DEFAULT 0 COMMENT '乐观锁版本',
    is_delete       TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    UNIQUE INDEX uk_message_asset (message_id, asset_id),
    INDEX idx_conversation (conversation_id),
    INDEX idx_project (project_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '@ 引用关系（消息 ↔ 素材）';
