CREATE TABLE `material_groups` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `material_group_id` VARCHAR(128) NOT NULL COMMENT '上游组ID（group-...）',
  `kind` VARCHAR(16) NOT NULL COMMENT 'virtual | real',
  `name` VARCHAR(128) NOT NULL COMMENT '组名',
  `cover_url` VARCHAR(512) NULL COMMENT '封面图（真人组用，virtual 可空）',
  `is_default` BOOLEAN NOT NULL DEFAULT false COMMENT '每用户虚拟默认组标记',
  `status` VARCHAR(32) NOT NULL DEFAULT 'normal',
  `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `version` INT NOT NULL DEFAULT 0,
  `is_delete` BOOLEAN NOT NULL DEFAULT false,
  `deleted_at` DATETIME(0) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_material_group_user_upstream` (`user_id`, `material_group_id`),
  KEY `idx_material_group_user_kind` (`user_id`, `kind`),
  KEY `idx_material_group_user_alive` (`user_id`, `is_delete`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
