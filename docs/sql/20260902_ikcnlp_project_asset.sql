CREATE TABLE `project_asset` (
  `id`           BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
  `user_id`      BIGINT NOT NULL COMMENT '用户 id',
  `asset_id`     BIGINT NOT NULL COMMENT '素材 id（assets.id）',
  `project_id`   BIGINT NOT NULL COMMENT '项目 id（project.id）',
  `gmt_create`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `gmt_modified` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `is_delete`    TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除：0未删 1已删',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_project_asset` (`user_id`,`asset_id`,`project_id`),
  KEY `idx_pa_user_project` (`user_id`,`project_id`),
  KEY `idx_pa_asset` (`asset_id`),
  KEY `idx_pa_project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='素材-项目关联（画布使用素材时建立，snapshot 按此返回本项目素材）';
